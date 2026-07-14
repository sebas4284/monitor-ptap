import { Logger, Module } from '@nestjs/common';
import { ConnectivityGateway } from './connectivity.gateway';
import { ConnectivityService } from './connectivity.service';
import {
  CONNECTIVITY_ADAPTER,
  CONNECTIVITY_CONFIG,
  INDUSTRIAL_READER,
  INDUSTRIAL_WRITER,
  PROTOCOL_ADAPTER,
} from './connectivity.tokens';
import { OpcConfigService } from './opc-config.service';
import { SimulatorConnectivityAdapter } from './adapters/simulator/simulator-connectivity.adapter';
import { loadConnectivityConfig, type ConnectivityConfig } from './connectivity.config';
import { loadMapping } from './mapping/opc-mapping.loader';
import { SimulatorBridgeAdapter } from './adapters/simulator/simulator-bridge.adapter';
import { OpcUaConnectivityAdapter } from './adapters/opcua/opcua-connectivity.adapter';
import { RawFrameCache } from './raw-frame-cache';
import { BridgeOrchestratorService } from './bridge-orchestrator.service';
import { OpcController } from './opc.controller';
import type { ConnectivityAdapter } from './ports/connectivity-adapter.port';

@Module({
  controllers: [OpcController],
  providers: [
    // ── Dominio legado (Fase 1: intacto para /api/plants y /api/snapshots en simulador) ──
    OpcConfigService,
    SimulatorConnectivityAdapter,
    ConnectivityService,
    ConnectivityGateway,
    { provide: INDUSTRIAL_READER, useExisting: SimulatorConnectivityAdapter },
    { provide: INDUSTRIAL_WRITER, useExisting: SimulatorConnectivityAdapter },
    { provide: PROTOCOL_ADAPTER, useExisting: SimulatorConnectivityAdapter },

    // ── Puente crudo (Fase 1) ─────────────────────────────────────────────────
    RawFrameCache,
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
  ],
  exports: [
    ConnectivityService,
    INDUSTRIAL_READER,
    INDUSTRIAL_WRITER,
    PROTOCOL_ADAPTER,
    CONNECTIVITY_ADAPTER,
    CONNECTIVITY_CONFIG,
    RawFrameCache,
  ],
})
export class ConnectivityModule {}
