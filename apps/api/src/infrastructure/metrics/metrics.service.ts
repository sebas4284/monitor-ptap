import { Inject, Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { AdapterDiagnostics, BridgeStatus, OpcQuality } from '../connectivity/ports/connectivity-adapter.port';
import type { DeadLetterType } from '../connectivity/pipeline/dead-letter.buffer';
import { PROM_REGISTRY } from './metrics.tokens';

const BRIDGE_STATES: BridgeStatus[] = ['Connecting', 'Connected', 'Recovering', 'Stale', 'Disconnected', 'Faulted'];

/**
 * Métricas Prometheus (Fase 4). No usa el patrón `collect()` de prom-client para los
 * gauges derivados del adapter/dead-letter — en su lugar OpcMetricsSubscriber empuja
 * valores explícitamente (refreshDiagnostics/refreshDeadLetter) cada vez que llega un
 * frame, lo que evita depender de un callback implícito en tiempo de scrape.
 */
@Injectable()
export class MetricsService {
  readonly registry: Registry;

  private readonly qualityGoodTotal: Counter<'plantId'>;
  private readonly qualityBadTotal: Counter<'plantId'>;
  private readonly subscriptionLatencyMs: Histogram<'plantId'>;
  private readonly notificationsTotal: Gauge;
  private readonly reconnectsTotal: Gauge;
  private readonly bridgeStatusGauge: Gauge<'state'>;
  private readonly deadLetterTotal: Gauge;
  private readonly parserErrorsTotal: Gauge;
  private readonly mappingErrorsTotal: Gauge;

  constructor(@Inject(PROM_REGISTRY) registry: Registry) {
    this.registry = registry;
    collectDefaultMetrics({ register: registry });

    this.qualityGoodTotal = new Counter({
      name: 'opc_quality_good_total',
      help: 'Muestras recibidas con OPC StatusCode Good, por planta',
      labelNames: ['plantId'],
      registers: [registry],
    });
    this.qualityBadTotal = new Counter({
      name: 'opc_quality_bad_total',
      help: 'Muestras recibidas con OPC StatusCode distinto de Good, por planta',
      labelNames: ['plantId'],
      registers: [registry],
    });
    this.subscriptionLatencyMs = new Histogram({
      name: 'opc_subscription_latency_ms',
      help: 'Latencia entre sourceTimestamp del PLC y la recepción del frame, por planta',
      labelNames: ['plantId'],
      buckets: [50, 100, 250, 500, 1000, 2000, 5000, 10000],
      registers: [registry],
    });
    this.notificationsTotal = new Gauge({
      name: 'opc_notifications_total',
      help: 'Notificaciones OPC UA recibidas (adapter completo, sesión única para las 12 plantas)',
      registers: [registry],
    });
    this.reconnectsTotal = new Gauge({
      name: 'opc_reconnects_total',
      help: 'Reconexiones del puente OPC UA (adapter completo)',
      registers: [registry],
    });
    this.bridgeStatusGauge = new Gauge({
      name: 'opc_bridge_status',
      help: 'Estado actual del bridge (1 = estado activo, 0 = el resto), por estado',
      labelNames: ['state'],
      registers: [registry],
    });
    this.deadLetterTotal = new Gauge({
      name: 'opc_dead_letter_total',
      help: 'Total de señales en el buffer DeadLetter (proceso completo, no por planta)',
      registers: [registry],
    });
    this.parserErrorsTotal = new Gauge({
      name: 'opc_parser_errors_total',
      help: 'Errores de parseo (NaN/Infinity, longitud inesperada) — proceso completo',
      registers: [registry],
    });
    this.mappingErrorsTotal = new Gauge({
      name: 'opc_mapping_errors_total',
      help: 'Errores de mapping (índice fuera de rango, buffer ausente) — proceso completo',
      registers: [registry],
    });
  }

  recordQuality(plantId: string, quality: OpcQuality): void {
    if (quality === 'Good') this.qualityGoodTotal.inc({ plantId });
    else if (quality === 'Bad') this.qualityBadTotal.inc({ plantId });
  }

  observeLatency(plantId: string, latencyMs: number): void {
    if (Number.isFinite(latencyMs) && latencyMs >= 0) {
      this.subscriptionLatencyMs.observe({ plantId }, latencyMs);
    }
  }

  refreshDiagnostics(diagnostics: AdapterDiagnostics): void {
    this.notificationsTotal.set(diagnostics.notificationsTotal);
    this.reconnectsTotal.set(diagnostics.reconnectCount);
    for (const state of BRIDGE_STATES) {
      this.bridgeStatusGauge.set({ state }, state === diagnostics.bridgeStatus ? 1 : 0);
    }
  }

  refreshDeadLetter(counts: Record<DeadLetterType, number>, total: number): void {
    this.deadLetterTotal.set(total);
    this.parserErrorsTotal.set(counts.INVALID_NUMBER + counts.UNEXPECTED_LENGTH);
    this.mappingErrorsTotal.set(counts.INDEX_OUT_OF_RANGE + counts.BUFFER_MISSING);
  }
}
