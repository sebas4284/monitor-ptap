import { Controller, Get, Inject, UseGuards, UseInterceptors } from '@nestjs/common';
import { MinTier } from '../../modules/auth/decorators/min-tier.decorator';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { MinTierGuard } from '../../modules/auth/guards/min-tier.guard';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { CONNECTIVITY_ADAPTER } from './connectivity.tokens';
import { PlantPipelineService } from './pipeline/plant-pipeline.service';
import type { ConnectivityAdapter } from './ports/connectivity-adapter.port';

/**
 * Endpoints de observabilidad del puente OPC UA (Fase 1). Responden en ambos
 * providers (simulator | opcua). RBAC (Fase 4): status → viewer, info/buffers/dead-letter → admin.
 */
@Controller('opc')
@UseGuards(JwtAuthGuard, MinTierGuard)
export class OpcController {
  constructor(
    @Inject(CONNECTIVITY_ADAPTER) private readonly adapter: ConnectivityAdapter,
    @Inject(PlantPipelineService) private readonly pipeline: PlantPipelineService,
  ) {}

  /** Estado operativo del puente: bridgeStatus, notificaciones, reconexiones, por planta. */
  @Get('status')
  @MinTier('viewer')
  getStatus() {
    return this.adapter.getDiagnostics();
  }

  /** Metadata del servidor/PLC para soporte. Campos no disponibles → null explícito. */
  @Get('info')
  @MinTier('admin')
  @UseInterceptors(AuditInterceptor)
  async getInfo() {
    return this.adapter.getServerInfo();
  }

  /** Salud por buffer: NodeId resuelto o faulted (degradación por buffer). */
  @Get('buffers')
  @MinTier('admin')
  @UseInterceptors(AuditInterceptor)
  getBuffers() {
    return this.adapter.getBufferHealth();
  }

  /** DeadLetter (regla 12): señales anómalas descartadas del pipeline. Endpoint admin. */
  @Get('dead-letter')
  @MinTier('admin')
  @UseInterceptors(AuditInterceptor)
  getDeadLetter() {
    return this.pipeline.getDeadLetter();
  }
}

