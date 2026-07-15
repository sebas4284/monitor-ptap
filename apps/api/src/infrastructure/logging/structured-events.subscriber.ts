import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { CONNECTIVITY_ADAPTER } from '../connectivity/connectivity.tokens';
import { PlantPipelineService } from '../connectivity/pipeline/plant-pipeline.service';
import type { ConnectivityAdapter } from '../connectivity/ports/connectivity-adapter.port';
import { JsonLogger } from './json-logger.service';

/**
 * Logging estructurado explícito con plantId/bridgeStatus/sequence como campos (regla
 * del prompt maestro), colgado de los hooks públicos ya existentes (snapshot$,
 * onStatusChange) — no toca el pipeline ni el adapter.
 */
@Injectable()
export class StructuredEventsSubscriber implements OnModuleInit {
  constructor(
    @Inject(CONNECTIVITY_ADAPTER) private readonly adapter: ConnectivityAdapter,
    @Inject(PlantPipelineService) private readonly pipeline: PlantPipelineService,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  onModuleInit(): void {
    this.pipeline.snapshot$.subscribe((snapshot) => {
      this.logger.log({
        msg: 'snapshot emitted',
        plantId: snapshot.plantId,
        bridgeStatus: snapshot.bridgeStatus,
        sequence: snapshot.sequence,
      });
    });

    this.adapter.onStatusChange((status, reason) => {
      this.logger.log({ msg: 'bridge status change', bridgeStatus: status, reason });
    });
  }
}
