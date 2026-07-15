/**
 * computeOpcHealth() (Fase 4, criterio de aceptación): /health/opc → 503 en Stale/Faulted.
 * Función pura, testeada con fixtures de AdapterDiagnostics para cada BridgeStatus.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOpcHealth } from '../src/modules/health/opc-health';
import type { AdapterDiagnostics, BridgeStatus } from '../src/infrastructure/connectivity/ports/connectivity-adapter.port';

function diagnostics(bridgeStatus: BridgeStatus, overrides: Partial<AdapterDiagnostics> = {}): AdapterDiagnostics {
  return {
    provider: 'simulator',
    bridgeStatus,
    lastNotificationAt: '2026-07-14T00:00:00.000Z',
    lastNotificationLatencyMs: 42,
    subscriptionCount: 1,
    monitoredItemCount: 41,
    reconnectCount: 0,
    subscriptionRecycleCount: 0,
    notificationsTotal: 100,
    droppedNotificationsTotal: 0,
    lastHeartbeatAt: null,
    lastSuccessfulHeartbeatAt: null,
    heartbeatFailures: 0,
    heartbeatFailuresTotal: 0,
    buffersActive: 41,
    buffersFaulted: 0,
    perPlant: [],
    recentTransitions: [],
    ...overrides,
  };
}

const STATUSES: BridgeStatus[] = ['Connecting', 'Connected', 'Recovering', 'Stale', 'Disconnected', 'Faulted'];

for (const status of STATUSES) {
  test(`opc-health: bridgeStatus=${status} → httpStatus ${status === 'Stale' || status === 'Faulted' ? 503 : 200}`, () => {
    const { httpStatus } = computeOpcHealth(diagnostics(status), 0);
    assert.equal(httpStatus, status === 'Stale' || status === 'Faulted' ? 503 : 200);
  });
}

test('opc-health: plcReachable true en Connected y Stale, false en el resto', () => {
  assert.equal(computeOpcHealth(diagnostics('Connected'), 0).report.plcReachable, true);
  assert.equal(computeOpcHealth(diagnostics('Stale'), 0).report.plcReachable, true);
  assert.equal(computeOpcHealth(diagnostics('Disconnected'), 0).report.plcReachable, false);
  assert.equal(computeOpcHealth(diagnostics('Faulted'), 0).report.plcReachable, false);
});

test('opc-health: propaga deadLetterCount, droppedNotifications y los campos requeridos', () => {
  const { report } = computeOpcHealth(diagnostics('Connected', { droppedNotificationsTotal: 7, reconnectCount: 3 }), 12);
  assert.equal(report.deadLetterCount, 12);
  assert.equal(report.droppedNotifications, 7);
  assert.equal(report.reconnectCount, 3);
  assert.equal(report.subscriptionAlive, true);
  assert.equal(report.publishLatencyMs, 42);
});

test('opc-health: subscriptionAlive=false cuando subscriptionCount=0', () => {
  const { report } = computeOpcHealth(diagnostics('Connected', { subscriptionCount: 0 }), 0);
  assert.equal(report.subscriptionAlive, false);
});
