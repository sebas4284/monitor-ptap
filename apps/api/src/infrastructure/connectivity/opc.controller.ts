import { Controller, Get, Inject } from '@nestjs/common';
import { CONNECTIVITY_ADAPTER } from './connectivity.tokens';
import { PlantPipelineService } from './pipeline/plant-pipeline.service';
import type { ConnectivityAdapter } from './ports/connectivity-adapter.port';

/**
 * Endpoints de observabilidad del puente OPC UA (Fase 1). Responden en ambos
 * providers (simulator | opcua).
 */
@Controller('opc')
export class OpcController {
  constructor(
    @Inject(CONNECTIVITY_ADAPTER) private readonly adapter: ConnectivityAdapter,
    @Inject(PlantPipelineService) private readonly pipeline: PlantPipelineService,
  ) {}

  /** Estado operativo del puente: bridgeStatus, notificaciones, reconexiones, por planta. */
  @Get('status')
  getStatus() {
    return this.adapter.getDiagnostics();
  }

  /** Metadata del servidor/PLC para soporte. Campos no disponibles → null explícito. */
  @Get('info')
  async getInfo() {
    return this.adapter.getServerInfo();
  }

  /** Salud por buffer: NodeId resuelto o faulted (degradación por buffer). */
  @Get('buffers')
  getBuffers() {
    return this.adapter.getBufferHealth();
  }

  /** DeadLetter (regla 12): señales anómalas descartadas del pipeline. Endpoint admin. */
  @Get('dead-letter')
  getDeadLetter() {
    return this.pipeline.getDeadLetter();
  }
}

