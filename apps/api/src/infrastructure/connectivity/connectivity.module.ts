import { Module } from '@nestjs/common';
import { ConnectivityGateway } from './connectivity.gateway';
import { ConnectivityService } from './connectivity.service';
import { INDUSTRIAL_READER, INDUSTRIAL_WRITER, PROTOCOL_ADAPTER } from './connectivity.tokens';
import { OpcConfigService } from './opc-config.service';
import { SimulatorConnectivityAdapter } from './adapters/simulator/simulator-connectivity.adapter';

@Module({
  providers: [
    OpcConfigService,
    SimulatorConnectivityAdapter,
    ConnectivityService,
    ConnectivityGateway,
    { provide: INDUSTRIAL_READER, useExisting: SimulatorConnectivityAdapter },
    { provide: INDUSTRIAL_WRITER, useExisting: SimulatorConnectivityAdapter },
    { provide: PROTOCOL_ADAPTER, useExisting: SimulatorConnectivityAdapter },
  ],
  exports: [ConnectivityService, INDUSTRIAL_READER, INDUSTRIAL_WRITER, PROTOCOL_ADAPTER],
})
export class ConnectivityModule {}
