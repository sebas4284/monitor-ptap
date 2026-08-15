/**
 * Tanques por encima de su máximo: distinguir un rebose REAL de un máximo mal medido.
 *
 * El caso que motivó esto (medido en campo el 2026-08-15): Carbonero a 2.96 m con un máximo
 * configurado de 2.80 (105,8 %) y Vorágine a 1.98 con máximo 1.97 (100,3 %). Ninguno había
 * derramado una gota. La app recortaba a 100 % y decía "lleno".
 *
 * El criterio es físico, no estadístico: **un tanque que rebosa no puede seguir subiendo**, porque
 * lo que entra por encima del rebosadero se va solo. De ahí salen las reglas que fijan estos tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PlantSnapshotDto, SignalDto } from '@ptap/shared';
import { analyzeTanks, type TankSample } from '../src/modules/notifications/tank-overflow.analyzer';

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

function snap(signals: Record<string, SignalDto>): PlantSnapshotDto {
  return {
    plantId: 'carbonero',
    displayName: 'Carbonero',
    sequence: 1,
    protocolVersion: 'v2',
    dtoVersion: 'v1',
    bridgeStatus: 'Connected',
    liveness: { state: 'live', lastChangeAt: null, windowSec: 300 },
    signals,
  } as PlantSnapshotDto;
}

/** Tanque 1 con máximo 2.80 m, más el caudal de entrada y el volumen que dé el caso. */
function tanque(nivel: number, caudal: number | null = null, volumen: number | null = null) {
  const s: Record<string, SignalDto> = {
    tank1Level: sig(nivel, { opMin: 1, opMax: 2.8, label: 'Nivel tanque 1' }),
  };
  if (caudal !== null) s.inletFlow1 = sig(caudal, { unit: 'l/s' });
  if (volumen !== null) s.tank1Volume = sig(volumen, { unit: 'm³' });
  return snap(s);
}

const sinHistoria = () => new Map<string, TankSample>();
const historiaCon = (nivel: number) => new Map<string, TankSample>([['tank1', { levelM: nivel, atMs: 0 }]]);

test('tanque: por debajo del máximo no genera nada', () => {
  const r = analyzeTanks(tanque(2.4, 12), 'Carbonero', sinHistoria(), new Map());
  assert.equal(r.length, 0);
});

test('tanque: justo en el máximo tampoco (no es "por encima")', () => {
  const r = analyzeTanks(tanque(2.8, 12), 'Carbonero', sinHistoria(), new Map());
  assert.equal(r.length, 0);
});

// ── El caso Carbonero: 2.96 sobre 2.80 = 105,8 % ─────────────────────────────
test('tanque: muy por encima del máximo → el MÁXIMO está mal (un rebosadero no sostiene eso)', () => {
  const r = analyzeTanks(tanque(2.96, 12), 'Carbonero', historiaCon(2.96), new Map());
  assert.equal(r.length, 1);
  assert.equal(r[0].verdict, 'maximo_mal');
  assert.ok(r[0].excessPct > 5 && r[0].excessPct < 6, `esperaba ~5,8 % y fue ${r[0].excessPct}`);
  assert.match(r[0].message, /no puede subir tanto sobre su rebosadero/);
  assert.equal(r[0].suggestedMaxM, 2.96, 'el máximo propuesto es el nivel realmente observado');
});

test('tanque: apenas por encima pero SIGUIENDO SUBIENDO → el máximo está mal', () => {
  // Si estuviera rebosando no podría subir: el agua sobrante se va.
  const r = analyzeTanks(tanque(2.83, 12), 'Carbonero', historiaCon(2.81), new Map());
  assert.equal(r[0].verdict, 'maximo_mal');
  assert.match(r[0].message, /SIGUE SUBIENDO/);
});

test('tanque: apenas por encima, ESTANCADO y con caudal entrando → se está REBOSANDO', () => {
  // Entra agua y el nivel no se mueve ⇒ el agua se está yendo por algún lado.
  const r = analyzeTanks(tanque(2.82, 15), 'Carbonero', historiaCon(2.82), new Map());
  assert.equal(r[0].verdict, 'rebosando');
  assert.match(r[0].message, /se está perdiendo agua tratada/);
  assert.match(r[0].message, /15\.0 l\/s/);
});

test('tanque: estancado pero SIN caudal entrando → no se afirma un rebose', () => {
  const r = analyzeTanks(tanque(2.82, 0), 'Carbonero', historiaCon(2.82), new Map());
  assert.equal(r[0].verdict, 'indeterminado', 'sin agua entrando no hay prueba de que se pierda');
});

test('tanque: sin caudal de entrada MAPEADO se dice explícitamente', () => {
  const r = analyzeTanks(tanque(2.82, null), 'Carbonero', historiaCon(2.82), new Map());
  assert.equal(r[0].verdict, 'indeterminado');
  assert.match(r[0].message, /no tiene caudal de entrada mapeado/);
});

test('tanque: sin historial todavía no se pronuncia sube/se mantiene', () => {
  const r = analyzeTanks(tanque(2.82, 12), 'Carbonero', sinHistoria(), new Map());
  assert.equal(r[0].verdict, 'indeterminado');
  assert.match(r[0].message, /aún no hay historial/);
});

test('tanque: sin máximo declarado NO se inventa un veredicto (caso Campoalegre)', () => {
  const s = snap({ tank1Level: sig(1.33, { opMin: 1 }) }); // sin opMax
  assert.equal(analyzeTanks(s, 'Campoalegre', sinHistoria(), new Map()).length, 0);
});

test('tanque: el aviso lleva el contexto que pidió el cliente (nivel, máximo, volumen y caudal)', () => {
  const r = analyzeTanks(tanque(2.96, 12.3, 148.5), 'Carbonero', historiaCon(2.96), new Map());
  assert.match(r[0].message, /nivel 2\.96 m/);
  assert.match(r[0].message, /máximo configurado 2\.80 m/);
  assert.match(r[0].message, /volumen 148\.5 m³/);
  assert.match(r[0].message, /caudal de entrada 12\.3 l\/s/);
});

test('tanque: el máximo propuesto usa el nivel más alto YA observado, no el actual', () => {
  // El tanque bajó un poco, pero llegó a estar en 3.05: esa es la evidencia dura.
  const r = analyzeTanks(tanque(2.96, 12), 'Carbonero', historiaCon(2.96), new Map([['tank1', 3.05]]));
  assert.equal(r[0].suggestedMaxM, 3.05);
});

test('tanque: varios tanques se evalúan por separado', () => {
  const s = snap({
    tank1Level: sig(2.96, { opMin: 1, opMax: 2.8 }), // por encima
    tank2Level: sig(1.9, { opMin: 1, opMax: 2.5 }), // dentro
  });
  const r = analyzeTanks(s, 'Sirena', sinHistoria(), new Map());
  assert.equal(r.length, 1);
  assert.equal(r[0].tankN, 1);
});

// ── Extremo BAJO: el mínimo de SERVICIO ──────────────────────────────────────
// Regla del cliente: por debajo de 1 m la planta no consigue llevar agua a las casas. El tanque
// puede bajar de ahí (no es el fondo), pero es el aviso más accionable de la bandeja.
// Caso vivo el 2026-08-15: Campoalegre tanque 3 a 0.986 m.

test('tanque: por debajo del mínimo de servicio avisa DICIENDO lo que significa', () => {
  const r = analyzeTanks(tanque(0.986, 5), 'Campoalegre', historiaCon(0.99), new Map());
  assert.equal(r.length, 1);
  assert.match(r[0].message, /no consigue llevar agua a las casas/);
  assert.match(r[0].title, /por debajo del mínimo de servicio/);
});

test('tanque: bajo el mínimo y BAJANDO es lo grave', () => {
  const r = analyzeTanks(tanque(0.9, 5), 'Campoalegre', historiaCon(0.95), new Map());
  assert.equal(r[0].verdict, 'bajo_minimo_cayendo');
  assert.match(r[0].message, /sigue bajando/);
});

test('tanque: bajo el mínimo y SIN agua entrando también es grave, aunque no baje', () => {
  const r = analyzeTanks(tanque(0.9, 0), 'Campoalegre', historiaCon(0.9), new Map());
  assert.equal(r[0].verdict, 'bajo_minimo_cayendo');
  assert.match(r[0].message, /NO está entrando agua/);
});

test('tanque: bajo el mínimo pero RECUPERÁNDOSE es aviso, no urgencia', () => {
  const r = analyzeTanks(tanque(0.95, 12), 'Campoalegre', historiaCon(0.9), new Map());
  assert.equal(r[0].verdict, 'bajo_minimo_recuperando');
  assert.match(r[0].message, /recuperándose/);
});

test('tanque: el mínimo se evalúa aunque la planta NO tenga máximo declarado', () => {
  // Es el caso de Campoalegre: sin opMax no hay porcentaje, pero el mínimo sí se puede juzgar.
  const s = snap({ tank1Level: sig(0.9, { opMin: 1, label: 'Nivel tanque 1' }), inletFlow1: sig(5, { unit: 'l/s' }) });
  const r = analyzeTanks(s, 'Campoalegre', historiaCon(0.95), new Map());
  assert.equal(r.length, 1);
  assert.equal(r[0].verdict, 'bajo_minimo_cayendo');
  assert.match(r[0].message, /sin máximo declarado/);
});

test('tanque: un nivel NEGATIVO no es "muy bajo", es un sensor roto → no lo trata este aviso', () => {
  // Soledad reporta -1.51 m con timestamp fresco. Decir "está por debajo del mínimo" seria dar
  // por bueno el dato; eso lo cubre el aviso de rango físico.
  const r = analyzeTanks(tanque(-1.51, 12), 'Soledad', historiaCon(-1.5), new Map());
  assert.equal(r.length, 0);
});

test('tanque: dentro de la franja de operación no genera nada por ningún extremo', () => {
  const r = analyzeTanks(tanque(1.8, 12), 'Carbonero', historiaCon(1.8), new Map());
  assert.equal(r.length, 0);
});

// El aviso decía "El nivel está 0 cm por encima del máximo" (Vorágine: eran 7 mm).
test('tanque: excesos por debajo del centímetro no se redondean a "0 cm"', () => {
  // Vorágine real: nivel 1.9771 m contra un máximo de 1.97 → 7 mm de exceso.
  const s = snap({
    tank1Level: sig(1.9771, { opMin: 1, opMax: 1.97, label: 'Nivel tanque 1' }),
    inletFlow1: sig(12, { unit: 'l/s' }),
  });
  const r = analyzeTanks(s, 'La Vorágine', historiaCon(1.9771), new Map());
  assert.doesNotMatch(r[0].message, /\b0 cm\b/, 'un aviso que dice "0 cm" se contradice a sí mismo');
  assert.match(r[0].message, /menos de 1 cm/);
});

test('tanque: un rebose real es crítico y un máximo mal medido no (severidad por caso)', () => {
  const rebose = analyzeTanks(tanque(2.82, 15), 'Carbonero', historiaCon(2.82), new Map())[0];
  const maxMal = analyzeTanks(tanque(2.96, 15), 'Carbonero', historiaCon(2.96), new Map())[0];
  // El detector traduce verdict → severity; aquí se fija el criterio que usa.
  assert.equal(rebose.verdict, 'rebosando', 'pierde agua tratada AHORA → critical');
  assert.equal(maxMal.verdict, 'maximo_mal', 'es un dato nuestro que corregir → warning');
});
