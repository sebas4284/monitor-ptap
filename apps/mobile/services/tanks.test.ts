/**
 * Derivación de tanques desde el snapshot, y sobre todo LA REGLA DEL PORCENTAJE.
 *
 * Fijada con el cliente el 2026-08-15, tras encontrar que la app mostraba 54 % donde la anterior
 * mostraba 29 % para el mismo tanque:
 *
 *   % de llenado = nivel / máximo del tanque
 *
 * NO se descuenta el mínimo. El `MIN` de 1 m es el umbral por debajo del cual la planta no logra
 * llevar agua a las casas — un límite de SERVICIO, no el fondo del tanque, y el nivel puede bajar
 * de ahí. La fórmula vieja `(nivel−min)/(max−min)` daba 0 % con el tanque a 1 m teniendo agua.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tanksFromSnapshot, isTankSignal } from './tanks';
import type { PlantSnapshotDto, SignalDto } from './api';

function sig(value: number | null, over: Partial<SignalDto> = {}): SignalDto {
  return {
    value,
    unit: 'm',
    quality: 'Good',
    usable: true,
    mappingStatus: 'mapped',
    confidence: 'confirmed',
    label: null,
    ts: '2026-08-15T12:00:00.000Z',
    ...over,
  } as SignalDto;
}

function snap(plantId: string, signals: Record<string, SignalDto>): PlantSnapshotDto {
  return {
    plantId,
    displayName: plantId,
    sequence: 1,
    protocolVersion: 'v2',
    dtoVersion: 'v1',
    bridgeStatus: 'Connected',
    liveness: { state: 'live', lastChangeAt: null, windowSec: 300 },
    signals,
  } as PlantSnapshotDto;
}

// El caso EXACTO de la captura del cliente: Sirena tanque 1, nivel 1.52, máximo 2.80.
test('tanques: % = nivel / máximo — 1.52 sobre 2.80 es 54 %, no 29 %', () => {
  const t = tanksFromSnapshot(
    snap('sirena', { tank1Level: sig(1.52, { opMin: 1, opMax: 2.8 }), tank1Volume: sig(90.8, { unit: 'm³' }) }),
  )[0];
  assert.ok(t.percentage !== null);
  assert.equal(Math.round(t.percentage as number), 54);
  // La banda operativa habría dado 29 %: (1.52−1)/(2.8−1). Se descartó por acuerdo con el cliente.
  assert.notEqual(Math.round(t.percentage as number), 29);
});

test('tanques: a la altura del mínimo de servicio el tanque NO está vacío', () => {
  const t = tanksFromSnapshot(snap('sirena', { tank1Level: sig(1.0, { opMin: 1, opMax: 2.8 }) }))[0];
  // Con la fórmula vieja esto era 0 % — y el tanque tiene un metro de agua.
  assert.equal(Math.round(t.percentage as number), 36);
});

test('tanques: el máximo sale del mapping, no de una tabla en el front', () => {
  // Misma planta y mismo nivel, distinto opMax ⇒ distinto porcentaje. Si el número siguiera
  // horneado en la app, cambiar el mapping no movería nada (que era el defecto).
  const a = tanksFromSnapshot(snap('sirena', { tank1Level: sig(1.4, { opMax: 2.8 }) }))[0];
  const b = tanksFromSnapshot(snap('sirena', { tank1Level: sig(1.4, { opMax: 2.0 }) }))[0];
  assert.equal(Math.round(a.percentage as number), 50);
  assert.equal(Math.round(b.percentage as number), 70);
});

test('tanques: sin máximo declarado no se inventa un porcentaje (caso Campoalegre)', () => {
  const t = tanksFromSnapshot(snap('campoalegre', { tank1Level: sig(1.33, { opMin: 1 }) }))[0];
  assert.equal(t.percentage, null, 'calcularlo contra la cota de 20 m engañaría al operador');
  assert.equal(t.levelM, 1.33, 'el nivel real sí se muestra');
});

// El defecto reportado: marcaba "lleno" con el tanque aún subiendo y sin derramar.
test('tanques: por encima del máximo se devuelve el % REAL, sin recortar a 100', () => {
  // Carbonero medido en campo: 2.96 m contra un máximo configurado de 2.80.
  const t = tanksFromSnapshot(snap('carbonero', { tank1Level: sig(2.96, { opMin: 1, opMax: 2.8 }) }))[0];
  assert.ok((t.percentage as number) > 100, `esperaba >100 y fue ${t.percentage}`);
  assert.equal(Math.round(t.percentage as number), 106);
});

// Soledad reporta -1.512 m con timestamp FRESCO: no está congelada, manda un valor imposible.
test('tanques: un nivel NEGATIVO no produce un porcentaje negativo', () => {
  const t = tanksFromSnapshot(snap('soledad', { tank1Level: sig(-1.512, { opMin: 1, opMax: 2.8 }) }))[0];
  assert.equal(t.percentage, null, 'un llenado no puede ser negativo: era -54 %');
  assert.equal(t.levelM, -1.512, 'el nivel crudo SÍ se sigue mostrando, con su aviso');
});

test('tanques: el % del volumen no contamina el del nivel', () => {
  // El opMax del volumen está en m³. Si se tomara de ahí, el porcentaje sería disparatado.
  const t = tanksFromSnapshot(
    snap('sirena', {
      tank1Level: sig(1.52, { opMax: 2.8 }),
      tank1Volume: sig(90.8, { unit: 'm³', opMax: 200 }),
    }),
  )[0];
  assert.equal(Math.round(t.percentage as number), 54);
});

test('tanques: sin nivel no hay porcentaje, pero el tanque sigue apareciendo', () => {
  const t = tanksFromSnapshot(snap('sirena', { tank1Volume: sig(90.8, { unit: 'm³' }) }))[0];
  assert.equal(t.percentage, null);
  assert.equal(t.volumeM3, 90.8);
});

test('tanques: se ordenan por número y se listan todos los de la planta', () => {
  const t = tanksFromSnapshot(
    snap('sirena', {
      tank3Level: sig(1.6, { opMax: 2.5 }),
      tank1Level: sig(1.5, { opMax: 2.8 }),
      tank2Level: sig(1.7, { opMax: 2.5 }),
    }),
  );
  assert.deepEqual(t.map((x) => x.name), ['Tanque 1', 'Tanque 2', 'Tanque 3']);
});

test('tanques: isTankSignal reconoce los propios y los externos', () => {
  assert.equal(isTankSignal('tank1Level'), true);
  assert.equal(isTankSignal('sanAntonioTankLevel'), true);
  assert.equal(isTankSignal('inletFlow1'), false);
});
