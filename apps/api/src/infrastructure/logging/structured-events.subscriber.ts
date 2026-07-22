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
    // DEF-09: una línea por snapshot son ~21.600/hora en operación normal — ahogaba los errores
    // reales y encarecía el shipping. Va en `debug`: invisible con LOG_LEVEL=info (el default),
    // recuperable al instante con LOG_LEVEL=debug cuando se investiga el pipeline.
    this.pipeline.snapshot$.subscribe((snapshot) => {
      this.logger.debug({
        msg: 'snapshot emitted',
        plantId: snapshot.plantId,
        bridgeStatus: snapshot.bridgeStatus,
        sequence: snapshot.sequence,
      });
    });

    // Las transiciones del puente son raras y significativas: se quedan en `info`.
    this.adapter.onStatusChange((status, reason) => {
      this.logger.log({ msg: 'bridge status change', bridgeStatus: status, reason });
    });
  }
}
