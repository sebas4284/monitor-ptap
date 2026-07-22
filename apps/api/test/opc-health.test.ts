/**
 * computeOpcHealth() (Fase 4 + fix de monitoreo): /health/opc → 200 SOLO cuando el puente está
 * `Connected`; 503 en cualquier otro estado (incluido `Connecting`, el caso real de un corte del
 * enlace al PLC). Antes solo `Stale`/`Faulted` daban 503, dejando un corte atascado en `Connecting`
 * como 200 "sano" e invisible para un uptime-monitor. Función pura, un fixture por cada BridgeStatus.
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
  const expected = status === 'Connected' ? 200 : 503;
  test(`opc-health: bridgeStatus=${status} → httpStatus ${expected}`, () => {
    const { httpStatus } = computeOpcHealth(diagnostics(status), 0);
    assert.equal(httpStatus, expected);
  });
}

test('opc-health: Connecting (corte real, enlace no arriba) → 503, ya NO 200', () => {
  // Regresión del hueco de monitoreo: un corte deja al puente reintentando en `Connecting`;
  // el health debe reportarlo degradado para que un monitor externo lo detecte.
  assert.equal(computeOpcHealth(diagnostics('Connecting'), 0).httpStatus, 503);
});

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
