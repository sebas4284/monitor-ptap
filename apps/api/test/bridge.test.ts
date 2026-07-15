/**
 * Tests del puente crudo (Fase 1 + 1.1) contra el SimulatorBridgeAdapter y el guard
 * de cliente del OpcUaConnectivityAdapter. Node built-in test runner vía tsx.
 * Ejecutar: npm run test:bridge
 *
 * Los asserts de recuperación miran la HISTORIA de transiciones, no el estado
 * instantáneo, para evitar flakiness con timers reales.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import { BridgeStateMachine } from '../src/infrastructure/connectivity/bridge/bridge-state-machine';
import { SimulatorBridgeAdapter } from '../src/infrastructure/connectivity/adapters/simulator/simulator-bridge.adapter';
import { OpcUaConnectivityAdapter } from '../src/infrastructure/connectivity/adapters/opcua/opcua-connectivity.adapter';
import type { OpcUaConfig } from '../src/infrastructure/connectivity/connectivity.config';
import type { LoadedMapping, MonitorTarget } from '../src/infrastructure/connectivity/mapping/opc-mapping.loader';
import type { RawPlantFrame } from '../src/infrastructure/connectivity/ports/connectivity-adapter.port';

Logger.overrideLogger(false); // silenciar logs en tests

function fastConfig(overrides: Partial<OpcUaConfig> = {}): OpcUaConfig {
  return {
    endpoint: 'opc.tcp://test',
    endpointMustExist: false,
    securityMode: 'None',
    securityPolicy: 'None',
    identity: { type: 'anonymous' },
    publishingIntervalMs: 20,
    samplingIntervalMs: 10,
    subscriptionLifetimeCount: 100,
    subscriptionMaxKeepAliveCount: 10,
    coalesceWindowMs: 10, // < publishingIntervalMs: un flush por tick, sin fusionar ciclos
    watchdogTimeoutMs: 60,
    heartbeatIntervalMs: 1000,
    heartbeatMaxFailures: 2,
    reconnectInitialDelayMs: 10,
    reconnectMaxDelayMs: 50,
    reconnectMaxRetry: 3,
    subscriptionRecycleMaxAttempts: 2,
    staleThresholdMs: 300000,
    writesEnabled: false,
    ...overrides,
  };
}

function twoPlantMapping(): LoadedMapping {
  const targets: MonitorTarget[] = [
    { plantId: 'voragine', browseName: 'REAL_IN_VORAGINE', channel: 'realIn', node: { nsUri: 'AQUATECH', identifier: 'g=1' }, arrayLength: 4, dataType: 'Float' },
    { plantId: 'voragine', browseName: 'INT_IN_VORAGINE', channel: 'intIn', node: { nsUri: 'AQUATECH', identifier: 'g=2' }, arrayLength: 2, dataType: 'Int16' },
    { plantId: 'soledad', browseName: 'REAL_IN_SOLEDAD', channel: 'realIn', node: { nsUri: 'AQUATECH', identifier: 'g=3' }, arrayLength: 4, dataType: 'Float' },
  ];
  return {
    version: '0.2.0',
    protocolVersion: 'v2',
    dtoVersion: 'v1',
    plants: [
      { plantId: 'voragine', displayName: 'La Vorágine', livenessWindowSec: null },
      { plantId: 'soledad', displayName: 'Soledad', livenessWindowSec: null },
    ],
    targets,
    signals: [],
    raw: { plants: [] },
  };
}

/** Una planta con 7 buffers (como montebello) para probar el coalescing (A2). */
function sevenBufferMapping(): LoadedMapping {
  const channels = ['realIn', 'realIn', 'realIn', 'realIn', 'realOut', 'intIn', 'intOut'];
  const targets: MonitorTarget[] = channels.map((channel, i) => ({
    plantId: 'montebello',
    browseName: `BUF_${i}_MONTEBELLO`,
    channel,
    node: { nsUri: 'AQUATECH', identifier: `g=${i + 1}` },
    arrayLength: 4,
    dataType: 'Float',
  }));
  return {
    version: '0.2.0',
    protocolVersion: 'v2',
    dtoVersion: 'v1',
    plants: [{ plantId: 'montebello', displayName: 'Montebello', livenessWindowSec: null }],
    targets,
    signals: [],
    raw: { plants: [] },
  };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── BridgeStateMachine ─────────────────────────────────────────────────────────

test('BridgeStateMachine: transición notifica y registra historia', () => {
  const sm = new BridgeStateMachine(new Logger('t'), 'test');
  const seen: string[] = [];
  sm.onChange((s) => seen.push(s));
  sm.transition('Connected', 'ok');
  sm.transition('Stale', 'congelado');
  assert.deepEqual(seen, ['Connected', 'Stale']);
  assert.equal(sm.get(), 'Stale');
  assert.equal(sm.recentTransitions().length, 2);
});

test('BridgeStateMachine: transición al mismo estado es no-op', () => {
  const sm = new BridgeStateMachine(new Logger('t'), 'test');
  sm.transition('Connected', 'a');
  let count = 0;
  sm.onChange(() => count++);
  sm.transition('Connected', 'b'); // mismo estado
  assert.equal(count, 0);
});

// ── SimulatorBridgeAdapter ──────────────────────────────────────────────────────

test('simulador: start conecta y emite frames crudos de las plantas del mapping', async () => {
  const adapter = new SimulatorBridgeAdapter(fastConfig(), twoPlantMapping());
  const frames: RawPlantFrame[] = [];
  adapter.onFrame((f) => frames.push(f));
  await adapter.start();
  await delay(80);
  await adapter.stop();

  assert.equal(adapter.getBridgeStatus(), 'Disconnected');
  assert.ok(frames.length > 0, 'debe haber emitido frames');
  const plantIds = new Set(frames.map((f) => f.plantId));
  assert.ok(plantIds.has('voragine') && plantIds.has('soledad'));
  const sample = frames[0].buffers[0];
  assert.ok(Array.isArray(sample.values) && sample.values.length > 0);
  assert.equal(sample.quality, 'Good');
});

test('simulador: coalescing — una planta con 7 buffers emite 1 frame con 7 buffers (A2)', async () => {
  const adapter = new SimulatorBridgeAdapter(fastConfig(), sevenBufferMapping());
  const frames: RawPlantFrame[] = [];
  adapter.onFrame((f) => frames.push(f));
  await adapter.start();
  await delay(90);
  await adapter.stop();

  assert.ok(frames.length > 0, 'debe haber emitido frames');
  assert.ok(
    frames.every((f) => f.plantId === 'montebello' && f.buffers.length === 7),
    `todo frame debe tener 7 buffers; tamaños: ${frames.map((f) => f.buffers.length).join(',')}`,
  );
  // cada frame lleva los 7 browseNames distintos (no 7 frames de 1 buffer)
  assert.equal(new Set(frames[0].buffers.map((b) => b.browseName)).size, 7);
});

test('simulador: freeze SIN unfreeze → Stale → recuperación AUTOMÁTICA por reciclaje', async () => {
  const adapter = new SimulatorBridgeAdapter(fastConfig({ watchdogTimeoutMs: 50 }), twoPlantMapping());
  const states: string[] = [];
  adapter.onStatusChange((s) => states.push(s));
  await adapter.start();
  await delay(40);
  assert.equal(adapter.getBridgeStatus(), 'Connected');

  adapter.freeze(); // subscription "muerta"; NO llamamos unfreeze()
  await delay(220); // watchdog dispara, recicla la subscription emulada y reanuda emisión

  assert.ok(states.includes('Stale'), `debió pasar por Stale. estados: ${states.join(',')}`);
  assert.equal(
    adapter.getBridgeStatus(),
    'Connected',
    `debió recuperarse solo, sin unfreeze(). estados: ${states.join(',')}`,
  );
  assert.ok(states.lastIndexOf('Connected') > states.indexOf('Stale'), 'Connected posterior a Stale');
  await adapter.stop();
});

test('simulador: reciclaje que falla escala a sesión y termina en Faulted', async () => {
  const adapter = new SimulatorBridgeAdapter(
    fastConfig({ watchdogTimeoutMs: 30, subscriptionRecycleMaxAttempts: 1 }),
    twoPlantMapping(),
  );
  adapter.setRecycleOutcome('fail'); // ni subscription ni sesión se recuperan
  await adapter.start();
  await delay(30);
  adapter.freeze();
  await delay(260); // timeout 1: sub-recycle falla; timeout 2: escala a sesión → Faulted

  assert.equal(adapter.getBridgeStatus(), 'Faulted');
  const reasons = adapter.getDiagnostics().recentTransitions.map((t) => t.reason);
  assert.ok(reasons.some((r) => /reciclaje de sesión falló/.test(r)), reasons.join(' | '));
  await adapter.stop();
});

test('simulador: heartbeat fallido consecutivo transiciona el bridge a Recovering (A3)', async () => {
  const adapter = new SimulatorBridgeAdapter(
    fastConfig({ heartbeatIntervalMs: 15, heartbeatMaxFailures: 2 }),
    twoPlantMapping(),
  );
  const states: string[] = [];
  adapter.onStatusChange((s) => states.push(s));
  await adapter.start();
  adapter.setHeartbeatOutcome('fail'); // el servidor emulado deja de responder al heartbeat
  await delay(130); // ~2 fallos consecutivos → threshold

  assert.ok(states.includes('Recovering'), `debió transicionar a Recovering. estados: ${states.join(',')}`);
  const diag = adapter.getDiagnostics();
  assert.ok(diag.heartbeatFailuresTotal >= 2, `total de fallos: ${diag.heartbeatFailuresTotal}`);
  await adapter.stop();
});

test('simulador: buffer faulted degrada solo ese buffer, no el bridge', async () => {
  const adapter = new SimulatorBridgeAdapter(fastConfig(), twoPlantMapping());
  adapter.faultBuffer('voragine', 'INT_IN_VORAGINE');
  await adapter.start();
  await delay(60);
  const diag = adapter.getDiagnostics();
  assert.equal(diag.bridgeStatus, 'Connected'); // el bridge sigue vivo
  assert.equal(diag.buffersFaulted, 1);
  const health = adapter.getBufferHealth().find((h) => h.browseName === 'INT_IN_VORAGINE');
  assert.equal(health?.faulted, true);
  await adapter.stop();
});

test('simulador: diagnostics expone los campos esperados incluidos los de heartbeat', async () => {
  const adapter = new SimulatorBridgeAdapter(fastConfig({ heartbeatIntervalMs: 20 }), twoPlantMapping());
  await adapter.start();
  await delay(80);
  const diag = adapter.getDiagnostics();
  assert.equal(diag.provider, 'simulator');
  assert.equal(diag.perPlant.length, 2);
  assert.ok(diag.notificationsTotal > 0);
  // campos de heartbeat presentes y coherentes (probe por defecto = success)
  assert.ok(diag.lastHeartbeatAt, 'lastHeartbeatAt debe estar poblado');
  assert.equal(diag.heartbeatFailures, 0);
  assert.equal(diag.heartbeatFailuresTotal, 0);
  const info = await adapter.getServerInfo();
  assert.equal(info.provider, 'simulator');
  assert.ok(Array.isArray(info.namespaces));
  await adapter.stop();
});

// ── OpcUaConnectivityAdapter: guard de cliente (A1) ─────────────────────────────

test('opcua: reciclar sin cliente → Faulted con causa clara, NO un TypeError', async () => {
  // Adaptador recién construido (nunca start()): client === null. El constructor no
  // toca red ni PKI, así que instanciarlo es seguro.
  const adapter = new OpcUaConnectivityAdapter(fastConfig(), twoPlantMapping());
  // Invocar el watchdog directamente vía cast ESTRUCTURAL tipado (sin `any`).
  const internal = adapter as unknown as { onWatchdogTimeout(): Promise<void> };
  await internal.onWatchdogTimeout(); // no debe lanzar

  assert.equal(adapter.getBridgeStatus(), 'Faulted');
  const reasons = adapter.getDiagnostics().recentTransitions.map((t) => t.reason);
  assert.ok(reasons.some((r) => /sin cliente OPC UA/.test(r)), reasons.join(' | '));
});
