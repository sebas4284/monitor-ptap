/**
 * Tests de la derivación de electroválvulas desde el snapshot real (services/valves.ts).
 * Cubre los DOS métodos de estado acordados con el operador (2026-07-30):
 *   1. `valve1State` = palabra de bits del PLC (bit14 válido, bit0 abierta) → 16384 cerrada / 16385 abierta.
 *   2. Caudal: <= 0.1 cerrada, > 0.1 abierta.
 * Y lo importante: que NO se elija uno en silencio cuando discrepan.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valvesFromSnapshot, isValveSignal, FLOW_CLOSED_THRESHOLD } from './valves';
import type { PlantSnapshotDto, SignalDto } from './api';

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
