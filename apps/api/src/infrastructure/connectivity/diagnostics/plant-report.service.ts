import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../../audit/audit-log.service';
import { CONNECTIVITY_ADAPTER } from '../connectivity.tokens';
import type { ConnectivityAdapter } from '../ports/connectivity-adapter.port';
import { PlantPipelineService } from '../pipeline/plant-pipeline.service';
import { PlantCache } from '../pipeline/plant-cache';
import { FreshnessService } from '../opcua/freshness.service';
import { ROUTE_PROBE_EVENT } from '../route-probe.sampler';
import { buildPlantReport } from './plant-report';

@Injectable()
export class PlantReportService {
  constructor(
    @Inject(CONNECTIVITY_ADAPTER) private readonly adapter: ConnectivityAdapter,
    @Inject(PlantPipelineService) private readonly pipeline: PlantPipelineService,
    @Inject(PlantCache) private readonly cache: PlantCache,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(FreshnessService) private readonly freshness: FreshnessService,
  ) {}

  async report(plantId: string, deep = false) {
    const mapping = this.pipeline.getMapping();
    const plant = mapping.plants.find((p) => p.plantId === plantId);
    if (!plant) throw new NotFoundException(`planta desconocida: ${plantId}`);
    const [routeEvents, connectionEvents] = await Promise.all([
      this.audit.listByEventType(ROUTE_PROBE_EVENT, 100),
      this.audit.listByEventType('opc.bridge_status_change', 100),
    ]);
    return buildPlantReport({
      plantId, displayName: plant.displayName, at: new Date().toISOString(),
      diagnostics: this.adapter.getDiagnostics(), buffers: this.adapter.getBufferHealth(),
      snapshot: this.cache.get(plantId),
      bufferSourceTimestamps: Object.fromEntries([...(this.pipeline.getLatestBuffers(plantId) ?? [])].map(([name, sample]) => [name, sample.sourceTimestamp])),
      anomalies: this.pipeline.getDeadLetter().recent,
      routeEvents, connectionEvents,
      ...(deep ? { freshness: await this.freshness.probe(mapping.targets.filter((t) => t.plantId === plantId)) } : {}),
    });
  }
}
