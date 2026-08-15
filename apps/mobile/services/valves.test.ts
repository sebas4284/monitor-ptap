/**
 * Tests de la derivación de electroválvulas desde el snapshot real (services/valves.ts).
 * Cubre los DOS métodos de estado acordados con el operador (2026-07-30):
 *   1. `valve1State` = palabra de bits del PLC (bit14 válido, bit0 abierta) → 16384 cerrada / 16385 abierta.
 *   2. Caudal: <= 0.1 cerrada, > 0.1 abierta.
 * Y lo importante: que NO se elija uno en silencio cuando discrepan.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valvesFromSnapshot, isValveSignal, FLOW_CLOSED_THRESHOLD, interpretCommand, detectManual } from './valves';
import type { PlantSnapshotDto, SignalDto, ValveCommandResult } from './api';

function sig(value: number | null, over: Partial<SignalDto> = {}): SignalDto {
  return {
    value,
    unit: 'l/s',
    quality: 'Good',
    usable: value !== null,
    mappingStatus: 'mapped',
    confidence: 'inferred',
    label: null,
    ts: '2026-07-30T12:00:00.000Z',
    ...over,
  } as SignalDto;
}

function snap(signals: Record<string, SignalDto>): PlantSnapshotDto {
  return {
    plantId: 'sirena',
    displayName: 'La Sirena',
    sequence: 1,
    protocolVersion: 'v2',
    dtoVersion: 'v1',
    bridgeStatus: 'Connected',
    liveness: { state: 'live', lastChangeAt: null, windowSec: 300 },
    signals,
  } as PlantSnapshotDto;
}

test('valves: sin señal de válvula → lista vacía (nada de mocks)', () => {
  assert.deepEqual(valvesFromSnapshot(snap({ inletFlow1: sig(5) })), []);
  assert.deepEqual(valvesFromSnapshot(undefined), []);
});

// ── Método 1: palabra de estado del PLC ──
test('valves: método 1 — 16384 (bit14) → CERRADA', () => {
  const v = valvesFromSnapshot(snap({ valve1: sig(0), valve1State: sig(16384) }))[0];
  assert.equal(v.byState, 'closed');
  assert.equal(v.state, 'closed');
  assert.equal(v.source, 'estado');
  assert.equal(v.rawState, 16384);
});

test('valves: método 1 — 16385 (bit14+bit0) → ABIERTA', () => {
  const v = valvesFromSnapshot(snap({ valve1: sig(0), valve1State: sig(16385) }))[0];
  assert.equal(v.byState, 'open');
  assert.equal(v.state, 'open');
});

// ── Método 1b: convención de valores LITERALES (stateEncoding) ──
// Cascajal no usa la máscara de bits: reporta 251 = CERRADA en INT_IN[1], verificado en campo
// (2026-08-13). Sin esta convención el valor no trae bit14 y la planta se quedaba sin estado.
test('valves: stateEncoding — 251 declarado como cerrada → CERRADA (aunque no tenga bit14)', () => {
  const v = valvesFromSnapshot(
    snap({ valve1: sig(0), valve1State: sig(251, { stateEncoding: { closed: 251 } }) }),
  )[0];
  assert.equal(v.byState, 'closed');
  assert.equal(v.state, 'closed');
  assert.equal(v.source, 'estado');
});

test('valves: stateEncoding — un valor NO declarado no se interpreta (no cae a la regla de bits)', () => {
  // 16385 tiene bit14+bit0 → la regla de bits diría "abierta". Pero el sitio declaró su propia
  // convención, y mezclarlas es exactamente como se inventaron estados falsos antes.
  const v = valvesFromSnapshot(
    snap({ valve1: sig(0), valve1State: sig(16385, { stateEncoding: { closed: 251 } }) }),
  )[0];
  assert.equal(v.byState, null, 'no se afirma nada con un valor ajeno a la convención declarada');
});

test('valves: stateEncoding — también sirve para declarar el valor de abierta', () => {
  const enc = { stateEncoding: { closed: 251, open: 1056 } };
  assert.equal(valvesFromSnapshot(snap({ valve1: sig(0), valve1State: sig(1056, enc) }))[0].byState, 'open');
  assert.equal(valvesFromSnapshot(snap({ valve1: sig(0), valve1State: sig(251, enc) }))[0].byState, 'closed');
});

test('valves: sin stateEncoding se conserva la regla de bits de siempre', () => {
  assert.equal(valvesFromSnapshot(snap({ valve1: sig(0), valve1State: sig(16384) }))[0].byState, 'closed');
  assert.equal(valvesFromSnapshot(snap({ valve1: sig(0), valve1State: sig(251) }))[0].byState, null);
});

test('valves: método 1 — sin bit14 el PLC no reporta estado válido → no se afirma nada', () => {
  const v = valvesFromSnapshot(snap({ valve1: sig(0), valve1State: sig(1) }))[0];
  assert.equal(v.byState, null, 'sin bit de validez no se puede decidir');
});

// ── Método 2: caudal ──
test('valves: método 2 — caudal <= 0.1 → CERRADA; por encima → ABIERTA', () => {
  const cerrada = valvesFromSnapshot(snap({ valve1: sig(0), outletFlow1: sig(FLOW_CLOSED_THRESHOLD) }))[0];
  assert.equal(cerrada.byFlow, 'closed');
  assert.equal(cerrada.source, 'caudal', 'sin palabra de estado, el veredicto sale del caudal');

  const abierta = valvesFromSnapshot(snap({ valve1: sig(0), outletFlow1: sig(0.11) }))[0];
  assert.equal(abierta.byFlow, 'open');
});

test('valves: método 2 usa la SALIDA si existe, y cae a la entrada si no', () => {
  const conSalida = valvesFromSnapshot(snap({ valve1: sig(0), inletFlow1: sig(9), outletFlow1: sig(0.05) }))[0];
  assert.equal(conSalida.byFlow, 'closed', 'debe mandar el caudal de salida');
  const soloEntrada = valvesFromSnapshot(snap({ valve1: sig(0), inletFlow1: sig(9) }))[0];
  assert.equal(soloEntrada.byFlow, 'open');
});

// ── Cruce de los dos métodos ──
test('valves: el método 1 MANDA sobre el 2 cuando ambos existen', () => {
  const v = valvesFromSnapshot(snap({ valve1: sig(0), valve1State: sig(16385), outletFlow1: sig(0) }))[0];
  assert.equal(v.state, 'open', 'la lectura del equipo tiene prioridad');
  assert.equal(v.source, 'estado');
});

test('valves: si los dos métodos DISCREPAN se marca (no se oculta)', () => {
  const v = valvesFromSnapshot(snap({ valve1: sig(0), valve1State: sig(16385), outletFlow1: sig(0) }))[0];
  assert.equal(v.byState, 'open');
  assert.equal(v.byFlow, 'closed');
  assert.equal(v.disagreement, true, 'estado abierta + caudal 0 es una inconsistencia que hay que avisar');
});

test('valves: si coinciden, no hay discrepancia', () => {
  const v = valvesFromSnapshot(snap({ valve1: sig(0), valve1State: sig(16384), outletFlow1: sig(0) }))[0];
  assert.equal(v.disagreement, false);
});

test('valves: sin estado ni caudal → unknown y se dice que no hay fuente', () => {
  const v = valvesFromSnapshot(snap({ valve1: sig(0) }))[0];
  assert.equal(v.state, 'unknown');
  assert.equal(v.source, 'ninguno');
});

test('valves: una señal no usable no se toma como lectura válida', () => {
  const v = valvesFromSnapshot(snap({ valve1: sig(0), valve1State: sig(16385, { usable: false }) }))[0];
  assert.equal(v.byState, null);
});

test('valves: varias válvulas se ordenan por número', () => {
  const vs = valvesFromSnapshot(
    snap({ valve2: sig(0), valve1: sig(0), valve2State: sig(16385), valve1State: sig(16384) }),
  );
  assert.deepEqual(vs.map((v) => v.id), ['valve1', 'valve2']);
  assert.equal(vs[1].state, 'open');
});

test('valves: isValveSignal reconoce comando y estado (para no duplicar en el tablero)', () => {
  assert.equal(isValveSignal('valve1'), true);
  assert.equal(isValveSignal('valve1State'), true);
  assert.equal(isValveSignal('inletFlow1'), false);
});

// ── Interpretación del resultado de un comando ──
// Lo crítico: distinguir "la señal salió" de "el equipo respondió". Un 502 con eco verificado NO es
// "no funcionó" — es "salió y el equipo no acusó el cambio" (probable falla física).
function res(over: Partial<ValveCommandResult>): ValveCommandResult {
  return {
    http: 200, status: 'confirmed', reason: null, previousValue: 0, writtenValue: 4096,
    confirmedValue: 16385, writeEcho: 4096, writeVerified: true, ...over,
  };
}

test('interpretCommand: confirmado → ok y señal enviada', () => {
  const v = interpretCommand(res({}), 'open', 'Válvula 1');
  assert.equal(v.ok, true);
  assert.equal(v.signalSent, true);
});

test('interpretCommand: 502 con eco verificado → la señal SÍ salió, avisa de posible falla física', () => {
  const v = interpretCommand(
    res({ http: 502, status: 'failed', reason: 'READBACK_UNCONFIRMED', confirmedValue: 16384, writeVerified: true }),
    'open',
    'Válvula 1',
  );
  assert.equal(v.ok, false, 'no se puede afirmar que la válvula se movió');
  assert.equal(v.signalSent, true, 'pero el bit se escribió: eso NO es un fallo del canal');
  assert.match(v.message, /FALLA FÍSICA/);
});

test('interpretCommand: WRITE_REJECTED → la señal NO salió', () => {
  const v = interpretCommand(res({ http: 502, status: 'failed', reason: 'WRITE_REJECTED', writeVerified: null, writtenValue: null }), 'close', 'Válvula 1');
  assert.equal(v.signalSent, false);
  assert.match(v.message, /RECHAZÓ/);
});

test('interpretCommand: interlock y permisos se explican sin culpar al equipo', () => {
  const il = interpretCommand(res({ http: 409, status: 'rejected', reason: 'INTERLOCK_FAILED: snapshot frozen' }), 'open', 'V1');
  assert.equal(il.signalSent, false);
  assert.match(il.title, /enclavamiento/i);
  const fb = interpretCommand(res({ http: 403, status: 'rejected', reason: 'FORBIDDEN' }), 'open', 'V1');
  assert.match(fb.title, /permiso/i);
});

test('interpretCommand: fallo de red NO afirma que la orden salió', () => {
  const v = interpretCommand(res({ http: 0, status: 'error', reason: 'NETWORK' }), 'close', 'V1');
  assert.equal(v.ok, false);
  assert.equal(v.signalSent, false);
});

// ── Detección de operación manual ──
test('detectManual: el caudal cruza el umbral y el PLC no reporta nada → MANUAL', () => {
  assert.equal(detectManual('closed', 'open', 'closed', 'closed', false), 'opened');
  assert.equal(detectManual('open', 'closed', 'open', 'open', false), 'closed');
});

test('detectManual: si NOSOTROS mandamos la orden hace poco, no es manual', () => {
  assert.equal(detectManual('closed', 'open', 'closed', 'closed', true), null);
});

test('detectManual: si el PLC SÍ reportó el cambio, fue eléctrico (no manual)', () => {
  assert.equal(detectManual('closed', 'open', 'closed', 'open', false), null);
});

test('detectManual: sin cambio de lado del caudal no hay evento', () => {
  assert.equal(detectManual('open', 'open', 'open', 'open', false), null);
  assert.equal(detectManual(null, 'open', null, null, false), null, 'sin lectura previa no se juzga');
});

// ── Qué caudal corresponde a cada válvula ────────────────────────────────────
// El orden por defecto prefiere la SALIDA. La Sirena tiene su única válvula en la ENTRADA
// (operador, 2026-08-15), y ahí la preferencia miente en el caso que importa: con la válvula de
// entrada cerrada, el tanque sigue entregando agua aguas abajo.
test('valves: si el mapping declara flowDomainKey, ese caudal MANDA sobre la preferencia', () => {
  const v = valvesFromSnapshot(
    snap({
      valve1: sig(0, { flowDomainKey: 'inletFlow1' }),
      inletFlow1: sig(23.3),
      outletFlow1: sig(0), // la salida diría CERRADA; la entrada, que es la que vale, dice ABIERTA
    }),
  )[0];
  assert.equal(v.byFlow, 'open');
  assert.equal(v.state, 'open');
});

test('valves: el caso inverso — entrada cerrada y el tanque vaciándose aguas abajo', () => {
  // Sin flowDomainKey esto habría dicho ABIERTA: 19 l/s saliendo del tanque con la válvula cerrada.
  const v = valvesFromSnapshot(
    snap({ valve1: sig(0, { flowDomainKey: 'inletFlow1' }), inletFlow1: sig(0), outletFlow1: sig(19.6) }),
  )[0];
  assert.equal(v.byFlow, 'closed');
});

test('valves: sin flowDomainKey se conserva la preferencia de siempre (salida primero)', () => {
  const v = valvesFromSnapshot(snap({ valve1: sig(0), inletFlow1: sig(0), outletFlow1: sig(19.6) }))[0];
  assert.equal(v.byFlow, 'open', 'sin declaración explícita manda el caudal de salida');
});

test('valves: cada válvula resuelve SU caudal por separado', () => {
  const v = valvesFromSnapshot(
    snap({
      valve1: sig(0, { flowDomainKey: 'inletFlow1' }),
      valve2: sig(0), // esta usa la preferencia por defecto
      inletFlow1: sig(20),
      outletFlow1: sig(0),
    }),
  );
  assert.equal(v[0].byFlow, 'open', 'valve1 mira la entrada');
  assert.equal(v[1].byFlow, 'closed', 'valve2 cae a la salida, que está en 0');
});

// El caso REAL que reportó el cliente: la app decía CERRADA con 23,33 l/s entrando.
test('valves: sin palabra de estado, el veredicto lo da el caudal (caso Sirena)', () => {
  const v = valvesFromSnapshot(
    snap({ valve1: sig(0, { flowDomainKey: 'inletFlow1' }), inletFlow1: sig(23.33) }),
  )[0];
  assert.equal(v.byState, null, 'Sirena ya no expone valve1State: su palabra no era fiable');
  assert.equal(v.state, 'open');
  assert.equal(v.source, 'caudal');
});
