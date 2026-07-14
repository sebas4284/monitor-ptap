/**
 * Tests del puente crudo contra el SimulatorBridgeAdapter (Fase 1).
 * Node built-in test runner vía tsx. Ejecutar: npm run test:bridge
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import { BridgeStateMachine } from '../src/infrastructure/connectivity/bridge/bridge-state-machine';
import { SimulatorBridgeAdapter } from '../src/infrastructure/connectivity/adapters/simulator/simulator-bridge.adapter';
import type { OpcUaConfig } from '../src/infrastructure/connectivity/connectivity.config';
import type { LoadedMapping } from '../src/infrastructure/connectivity/mapping/opc-mapping.loader';
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
    watchdogTimeoutMs: 60,
    heartbeatIntervalMs: 1000,
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
  const targets = [
    { plantId: 'voragine', browseName: 'REAL_IN_VORAGINE', channel: 'realIn', node: { nsUri: 'AQUATECH', identifier: 'g=1' }, arrayLength: 4, dataType: 'Float' },
    { plantId: 'voragine', browseName: 'INT_IN_VORAGINE', channel: 'intIn', node: { nsUri: 'AQUATECH', identifier: 'g=2' }, arrayLength: 2, dataType: 'Int16' },
    { plantId: 'soledad', browseName: 'REAL_IN_SOLEDAD', channel: 'realIn', node: { nsUri: 'AQUATECH', identifier: 'g=3' }, arrayLength: 4, dataType: 'Float' },
  ];
  return {
    version: '0.2.0',
    protocolVersion: 'v2',
    plants: [
      { plantId: 'voragine', displayName: 'La Vorágine' },
      { plantId: 'soledad', displayName: 'Soledad' },
    ],
    targets,
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

  assert.equal(adapter.getBridgeStatus() === 'Disconnected' || adapter.getBridgeStatus() === 'Connected', true);
  assert.ok(frames.length > 0, 'debe haber emitido frames');
  const plantIds = new Set(frames.map((f) => f.plantId));
  assert.ok(plantIds.has('voragine') && plantIds.has('soledad'));
  const sample = frames[0].buffers[0];
  assert.ok(Array.isArray(sample.values) && sample.values.length > 0);
  assert.equal(sample.quality, 'Good');
});

test('simulador: congelar dispara watchdog → Stale → reciclaje → recuperación', async () => {
  const adapter = new SimulatorBridgeAdapter(fastConfig({ watchdogTimeoutMs: 50 }), twoPlantMapping());
  const states: string[] = [];
  adapter.onStatusChange((s) => states.push(s));
  await adapter.start();
  await delay(40);
  assert.equal(adapter.getBridgeStatus(), 'Connected');

  adapter.freeze(); // sin emisión → watchdog
  await delay(120); // supera el timeout, entra en Stale + reciclaje
  assert.equal(adapter.getBridgeStatus(), 'Stale', `estados: ${states.join(',')}`);

  adapter.unfreeze(); // recuperación
  await delay(60);
  assert.equal(adapter.getBridgeStatus(), 'Connected');
  await adapter.stop();

  assert.ok(states.includes('Stale'), 'debió pasar por Stale');
  assert.ok(states.lastIndexOf('Connected') > states.indexOf('Stale'), 'debió recuperarse a Connected');
});

test('simulador: reciclaje agotado escala a Faulted', async () => {
  const adapter = new SimulatorBridgeAdapter(
    fastConfig({ watchdogTimeoutMs: 30, subscriptionRecycleMaxAttempts: 1 }),
    twoPlantMapping(),
  );
  await adapter.start();
  await delay(30);
  adapter.freeze();
  await delay(200); // varios timeouts del watchdog sin recuperación
  assert.equal(adapter.getBridgeStatus(), 'Faulted');
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

test('simulador: diagnostics e info exponen los campos esperados', async () => {
  const adapter = new SimulatorBridgeAdapter(fastConfig(), twoPlantMapping());
  await adapter.start();
  await delay(60);
  const diag = adapter.getDiagnostics();
  assert.equal(diag.provider, 'simulator');
  assert.equal(diag.perPlant.length, 2);
  assert.ok(diag.notificationsTotal > 0);
  const info = await adapter.getServerInfo();
  assert.equal(info.provider, 'simulator');
  assert.ok(Array.isArray(info.namespaces));
  await adapter.stop();
});
