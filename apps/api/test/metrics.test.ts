/**
 * MetricsService (Fase 4, criterio de aceptación): /metrics expone las métricas
 * requeridas. Se construye contra un Registry fresco (sin Nest DI) y se verifica el
 * output de registry.metrics() por regex — el mismo formato que scrapea Prometheus.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Registry } from 'prom-client';
import { MetricsService } from '../src/infrastructure/metrics/metrics.service';
import type { AdapterDiagnostics } from '../src/infrastructure/connectivity/ports/connectivity-adapter.port';

function diagnostics(overrides: Partial<AdapterDiagnostics> = {}): AdapterDiagnostics {
  return {
    provider: 'simulator',
    bridgeStatus: 'Connected',
    lastNotificationAt: null,
    lastNotificationLatencyMs: null,
    subscriptionCount: 1,
    monitoredItemCount: 41,
    reconnectCount: 0,
    subscriptionRecycleCount: 0,
    notificationsTotal: 0,
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

test('metrics: expone las 9 métricas requeridas con valores plausibles', async () => {
  const registry = new Registry();
  const metrics = new MetricsService(registry);

  metrics.recordQuality('voragine', 'Good');
  metrics.recordQuality('voragine', 'Good');
  metrics.recordQuality('voragine', 'Bad');
  metrics.observeLatency('voragine', 120);
  metrics.refreshDiagnostics(diagnostics({ notificationsTotal: 50, reconnectCount: 2, bridgeStatus: 'Connected' }));
  metrics.refreshDeadLetter(
    { INVALID_NUMBER: 2, INDEX_OUT_OF_RANGE: 1, BUFFER_MISSING: 0, UNEXPECTED_LENGTH: 1 },
    4,
  );

  const output = await registry.metrics();

  assert.match(output, /opc_quality_good_total\{plantId="voragine"\} 2/);
  assert.match(output, /opc_quality_bad_total\{plantId="voragine"\} 1/);
  assert.match(output, /opc_subscription_latency_ms_bucket/);
  assert.match(output, /opc_notifications_total 50/);
  assert.match(output, /opc_reconnects_total 2/);
  assert.match(output, /opc_bridge_status\{state="Connected"\} 1/);
  assert.match(output, /opc_bridge_status\{state="Faulted"\} 0/);
  assert.match(output, /opc_dead_letter_total 4/);
  assert.match(output, /opc_parser_errors_total 3/); // INVALID_NUMBER(2) + UNEXPECTED_LENGTH(1)
  assert.match(output, /opc_mapping_errors_total 1/); // INDEX_OUT_OF_RANGE(1) + BUFFER_MISSING(0)
});

test('metrics: recordQuality ignora Uncertain (no incrementa good ni bad)', async () => {
  const registry = new Registry();
  const metrics = new MetricsService(registry);
  metrics.recordQuality('sirena', 'Uncertain');
  const output = await registry.metrics();
  assert.doesNotMatch(output, /opc_quality_good_total\{plantId="sirena"\}/);
  assert.doesNotMatch(output, /opc_quality_bad_total\{plantId="sirena"\}/);
});
