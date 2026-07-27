import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../modules/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../../modules/auth/guards/permission.guard';
import { CONNECTIVITY_ADAPTER } from './connectivity.tokens';
import { PlantPipelineService } from './pipeline/plant-pipeline.service';
import type { ConnectivityAdapter } from './ports/connectivity-adapter.port';

/**
 * Endpoints de observabilidad del puente OPC UA (Fase 1). Responden en ambos
 * providers (simulator | opcua). RBAC (Fase 4): TODOS los endpoints (status/info/buffers/
 * dead-letter) exigen `system_config` (solo admin) — son diagnóstico de infraestructura. La
 * auditoría de accesos (permitidos y denegados) la aplica AuditMiddleware a nivel de app.
 */
@Controller('opc')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class OpcController {
  constructor(
    @Inject(CONNECTIVITY_ADAPTER) private readonly adapter: ConnectivityAdapter,
    @Inject(PlantPipelineService) private readonly pipeline: PlantPipelineService,
  ) {}

  /** Estado operativo del puente: bridgeStatus, notificaciones, reconexiones, por planta.
   *  Diagnóstico de infraestructura → `system_config` (admin), como el resto de /opc/*. */
  @Get('status')
  @RequirePermission('system_config')
  getStatus() {
    return this.adapter.getDiagnostics();
  }

  /** Metadata del servidor/PLC para soporte. Campos no disponibles → null explícito. */
  @Get('info')
  @RequirePermission('system_config')
  async getInfo() {
    return this.adapter.getServerInfo();
  }

  /** Salud por buffer: NodeId resuelto o faulted (degradación por buffer). */
  @Get('buffers')
  @RequirePermission('system_config')
  getBuffers() {
    return this.adapter.getBufferHealth();
  }

  /** DeadLetter (regla 12): señales anómalas descartadas del pipeline. Endpoint admin. */
  @Get('dead-letter')
  @RequirePermission('system_config')
  getDeadLetter() {
    return this.pipeline.getDeadLetter();
  }
}
