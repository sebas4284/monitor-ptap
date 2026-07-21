import { Logger, Module } from '@nestjs/common';
import { ConnectivityGateway } from './connectivity.gateway';
import { CONNECTIVITY_ADAPTER, CONNECTIVITY_CONFIG } from './connectivity.tokens';
import { loadConnectivityConfig, type ConnectivityConfig } from './connectivity.config';
import { loadMapping } from './mapping/opc-mapping.loader';
import { SimulatorBridgeAdapter } from './adapters/simulator/simulator-bridge.adapter';
import { OpcUaConnectivityAdapter } from './adapters/opcua/opcua-connectivity.adapter';
import { BridgeOrchestratorService } from './bridge-orchestrator.service';
import { PlantCache } from './pipeline/plant-cache';
import { PlantPipelineService } from './pipeline/plant-pipeline.service';
import type { ConnectivityAdapter } from './ports/connectivity-adapter.port';

/**
 * Puente crudo + pipeline de dominio (Fases 1-3). DELIBERADAMENTE sin dependencia de
 * MySQL/Auth: lo importa tanto main.ts (app completa) como main.telemetry.ts (arranque
 * de demo sin BD). Observabilidad Fase 4 (OpcController, guards, audit, métricas,
 * logging) vive en OpcObservabilityModule — que SÍ requiere BD (auth) — para que
 * importar este módulo nunca obligue a tener MySQL arriba.
 *
 * Un solo camino de datos: PLC → adapter → pipeline → PlantCache → REST/Socket.IO.
 */
@Module({
  controllers: [],
  providers: [
    // ── Puente crudo ──────────────────────────────────────────────────────────
    { provide: CONNECTIVITY_CONFIG, useFactory: (): ConnectivityConfig => loadConnectivityConfig() },
    {
      provide: CONNECTIVITY_ADAPTER,
      inject: [CONNECTIVITY_CONFIG],
      useFactory: (config: ConnectivityConfig): ConnectivityAdapter => {
        const mapping = loadMapping();
        const logger = new Logger('ConnectivityModule');
        logger.log(
          `Puente OPC UA: provider=${config.provider}, ${mapping.plants.length} plantas, ${mapping.targets.length} buffers de datos`,
        );
        return config.provider === 'opcua'
          ? new OpcUaConnectivityAdapter(config.opcua, mapping)
          : new SimulatorBridgeAdapter(config.opcua, mapping);
      },
    },
    BridgeOrchestratorService,

    // ── Pipeline de dominio en RAM (parser → liveness → mapping → quality → DTO) ──
    PlantCache,
    PlantPipelineService,
    ConnectivityGateway,
  ],
  exports: [CONNECTIVITY_ADAPTER, CONNECTIVITY_CONFIG, PlantCache, PlantPipelineService],
})
export class ConnectivityModule {}
