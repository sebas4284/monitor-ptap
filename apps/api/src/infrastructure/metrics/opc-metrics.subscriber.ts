import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { CONNECTIVITY_ADAPTER } from '../connectivity/connectivity.tokens';
import { PlantPipelineService } from '../connectivity/pipeline/plant-pipeline.service';
import type { ConnectivityAdapter, RawPlantFrame } from '../connectivity/ports/connectivity-adapter.port';
import { MetricsService } from './metrics.service';

/**
 * Alimenta MetricsService desde los hooks públicos ya existentes del adapter/pipeline
 * (onFrame, getDiagnostics) — no toca nada interno de la Fase 1-3.
 */
@Injectable()
export class OpcMetricsSubscriber implements OnModuleInit {
  constructor(
    @Inject(CONNECTIVITY_ADAPTER) private readonly adapter: ConnectivityAdapter,
    @Inject(PlantPipelineService) private readonly pipeline: PlantPipelineService,
    @Inject(MetricsService) private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    this.adapter.onFrame((frame) => this.handleFrame(frame));
  }

  private handleFrame(frame: RawPlantFrame): void {
    const receivedAtMs = new Date(frame.receivedAt).getTime();
    for (const buffer of frame.buffers) {
      this.metrics.recordQuality(frame.plantId, buffer.quality);
      if (buffer.sourceTimestamp) {
        const latencyMs = receivedAtMs - new Date(buffer.sourceTimestamp).getTime();
        this.metrics.observeLatency(frame.plantId, latencyMs);
      }
    }

    this.metrics.refreshDiagnostics(this.adapter.getDiagnostics());
    const deadLetter = this.pipeline.getDeadLetter();
    this.metrics.refreshDeadLetter(deadLetter.counts, deadLetter.total);
  }
}
