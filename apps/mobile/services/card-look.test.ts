import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PlantSnapshotDto, SignalDto, TankAutonomyDto } from '@ptap/shared';
import {
  AUTONOMIA_CRITICA_H,
  FRACCION_CRITICA,
  anomalyBanner,
  autonomyLook,
  directionLook,
  isAnomalous,
  isAutonomyLow,
  shouldFlash,
  signalState,
  tankFill,
  tankState,
} from './card-look';
import { tanksFromSnapshot } from './tanks';

const signal = (over: Partial<SignalDto>): SignalDto => ({
  value: 2,
  unit: 'l/s',
  quality: 'Good',
  usable: true,
  mappingStatus: 'mapped',
  confidence: 'confirmed',
  label: 'Caudal de salida',
  ts: null,
  ...over,
});

test('card-look: el rango OPERATIVO también pinta en rojo aunque el backend no marque outOfRange', () => {
  assert.equal(isAnomalous(signal({ value: 62.27, opMin: 1, opMax: 3 })), true);
  assert.equal(isAnomalous(signal({ value: 0.5, opMin: 1 })), true);
  assert.equal(isAnomalous(signal({ value: 2, opMin: 1, opMax: 3 })), false);
  assert.equal(isAnomalous(signal({ value: 2, outOfRange: true })), true);
  assert.equal(isAnomalous(signal({ value: null, opMax: 3 })), false);
});

test('card-look: entrada y salida con icono, etiqueta y dos azules distintos', () => {
  const inlet = directionLook('inletFlow1');
  const outlet = directionLook('outletPressure1');
  assert.deepEqual([inlet?.label, inlet?.icon], ['Entrada', 'arrow-forward']);
  assert.deepEqual([outlet?.label, outlet?.icon], ['Salida', 'arrow-back']);
  assert.notEqual(inlet?.color, outlet?.color);
  assert.equal(directionLook('conductivity'), null);
});

test('card-look: tanque sin capacidad confirmada no dibuja nivel; por encima de 100 % es rebose', () => {
  assert.deepEqual(tankFill(null), { kind: 'unconfirmed', drawPct: null });
  assert.deepEqual(tankFill(72), { kind: 'normal', drawPct: 72 });
  assert.deepEqual(tankFill(106), { kind: 'overflow', drawPct: 100 });
  assert.deepEqual(tankFill(-3), { kind: 'normal', drawPct: 0 });
});

// ── Autonomía baja: la MISMA regla que TankAutonomyDetector.avisoDe ──────────────────────────
const aut = (over: Partial<TankAutonomyDto>): TankAutonomyDto => ({
  tankN: 1,
  hoursTo50: 4,
  hoursTo0: 10,
  flowLps: 3.2,
  basis: 'vaciado_real',
  ...over,
});

test('card-look: las constantes copiadas coinciden con el backend (tank-autonomy.analyzer.ts)', () => {
  assert.equal(FRACCION_CRITICA, 0.5);
  assert.equal(AUTONOMIA_CRITICA_H, 1);
});

test('card-look: autonomía baja = bajo el 50 % o vaciándose con ≤ 1 h; una proyección sobre el 50 % no', () => {
  assert.equal(isAutonomyLow(aut({ hoursTo50: 0 })), true);
  assert.equal(isAutonomyLow(aut({ hoursTo50: 0, basis: 'proyeccion_24h' })), true);
  assert.equal(isAutonomyLow(aut({ hoursTo50: 0.2, hoursTo0: 1 })), true);
  assert.equal(isAutonomyLow(aut({ hoursTo50: 0.2, hoursTo0: 1.5 })), false);
  assert.equal(isAutonomyLow(aut({ hoursTo50: 0.2, hoursTo0: 0.5, basis: 'proyeccion_24h' })), false);
  assert.equal(isAutonomyLow(null), false);
});

test('card-look: la proyección se rotula "Si cierras la entrada"; la cuenta atrás, "Autonomía"', () => {
  assert.equal(autonomyLook(aut({ basis: 'proyeccion_24h' }))?.label, 'Si cierras la entrada');
  assert.equal(autonomyLook(aut({}))?.label, 'Autonomía');
  assert.equal(autonomyLook(aut({ hoursTo0: 15.97, hoursTo50: 7.97 }))?.texto, '15 h 58 min · 7 h 58 min al 50 %');
  assert.equal(autonomyLook(aut({ hoursTo0: null })), null);
});

// ── Los 4 tanques de prueba (el simulador da niveles imposibles) ─────────────────────────────
const lvl = (value: number | null, opMax?: number): SignalDto =>
  signal({ value, unit: 'm', label: null, opMin: 1, ...(opMax !== undefined ? { opMax } : {}) });

const SNAP: PlantSnapshotDto = {
  plantId: 'prueba',
  displayName: 'Prueba',
  sequence: 1,
  bridgeStatus: 'Connected',
  liveness: { state: 'live', lastChangeAt: null, windowSec: 300 },
  signals: {
    tank1Level: lvl(1.96, 2.8), // 70 %
    tank1Volume: signal({ value: 116.8, unit: 'm³' }),
    tank2Level: lvl(1.0, 2.5), // 40 %: bajo el 50 %
    tank3Level: { ...lvl(2.96, 2.8), outOfRange: true }, // 106 %: rebose
    tank4Level: lvl(1.42), // sin opMax: capacidad sin confirmar
  },
  autonomy: [
    aut({ tankN: 1, hoursTo50: 6, hoursTo0: 20, basis: 'proyeccion_24h' }),
    aut({ tankN: 2, hoursTo50: 0, hoursTo0: 3 }),
  ],
} as PlantSnapshotDto;

test('card-look: tanque normal ~70 % se dibuja a su nivel, sin amarillo ni rojo', () => {
  const t = tanksFromSnapshot(SNAP)[0];
  assert.equal(Math.round(t.percentage as number), 70);
  assert.deepEqual(tankFill(t.percentage), { kind: 'normal', drawPct: t.percentage });
  assert.equal(tankState(t), 'ok');
  assert.equal(autonomyLook(t.autonomy)?.label, 'Si cierras la entrada');
  assert.equal(autonomyLook(t.autonomy)?.low, false);
});

test('card-look: tanque bajo el 50 % → autonomía en amarillo', () => {
  const t = tanksFromSnapshot(SNAP)[1];
  assert.equal(Math.round(t.percentage as number), 40);
  assert.equal(tankState(t), 'autonomy_low');
  assert.equal(autonomyLook(t.autonomy)?.low, true);
});

test('card-look: tanque en rebose se dibuja lleno y conserva el % real', () => {
  const t = tanksFromSnapshot(SNAP)[2];
  assert.equal(Math.round(t.percentage as number), 106);
  assert.deepEqual(tankFill(t.percentage), { kind: 'overflow', drawPct: 100 });
  assert.equal(tankState(t), 'overflow');
});

test('card-look: tanque sin capacidad confirmada no dibuja nivel', () => {
  const t = tanksFromSnapshot(SNAP)[3];
  assert.equal(t.percentage, null);
  assert.equal(t.levelM, 1.42);
  assert.deepEqual(tankFill(t.percentage), { kind: 'unconfirmed', drawPct: null });
  assert.equal(tankState(t), 'ok');
});

// ── Franja roja y destello por cambio de estado ──────────────────────────────────────────────
test('card-look: la franja dice cuál, su valor y el límite que rompe, y cuántas más', () => {
  const out = signal({ value: 62.27, opMin: 1, opMax: 3, label: 'Caudal de salida' });
  const low = signal({ value: 0.4, opMin: 1, label: 'Presión de entrada', unit: 'psi' });
  const ok = signal({ value: 2, opMin: 1, opMax: 3 });
  assert.equal(anomalyBanner([['outletPressure1', ok]]), null);
  assert.deepEqual(anomalyBanner([['outletFlow1', out]]), {
    text: 'Caudal de salida fuera de rango: 62,27 l/s, máximo 3,00',
    more: 0,
  });
  assert.deepEqual(anomalyBanner([['x', ok], ['inletPressure1', low], ['outletFlow1', out]]), {
    text: 'Presión de entrada fuera de rango: 0,40 psi, mínimo 1,00',
    more: 1,
  });
});

test('card-look: el estado de la tarjeta cambia al entrar en rango o quedarse sin dato, no con el valor', () => {
  assert.equal(signalState(signal({ value: 2, opMax: 3 })), signalState(signal({ value: 2.5, opMax: 3 })));
  assert.equal(signalState(signal({ value: 4, opMax: 3 })), 'out_of_range');
  assert.equal(signalState(signal({ value: null })), 'no_data');
});

test('card-look: destello solo si el estado cambió, la planta está viva y hay movimiento', () => {
  assert.equal(shouldFlash(1, 2, false, false), true);
  assert.equal(shouldFlash(undefined, 2, false, false), false); // primer pintado
  assert.equal(shouldFlash(2, 2, false, false), false);
  assert.equal(shouldFlash(1, 2, true, false), false); // congelada
  assert.equal(shouldFlash(1, 2, false, true), false); // reducir movimiento
  assert.equal(shouldFlash(1, 2, false, null), false); // aún sin saber
});
