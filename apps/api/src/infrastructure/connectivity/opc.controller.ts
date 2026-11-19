import { Controller, Get, Inject, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../modules/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../../modules/auth/guards/permission.guard';
import { CONNECTIVITY_ADAPTER } from './connectivity.tokens';
import { PlantPipelineService } from './pipeline/plant-pipeline.service';
import type { ConnectivityAdapter } from './ports/connectivity-adapter.port';
import { buildRawBuffersView } from './diagnostics/raw-buffers';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { plantIdParamSchema } from '../validation/plant-id.schema';

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

  /**
   * Buffers CRUDOS de una planta, al estilo de UA Expert. Solo lectura.
   *
   * Sale de la cache del pipeline: **no dispara ni una lectura al PLC**, igual que el resto de
   * `/opc/*`. Lo que devuelve es la última muestra que llegó por la Subscription, con el NodeId
   * delante y, junto a cada índice, qué señal lo consume.
   *
   * Existe porque diagnosticar un índice mal apuntado exigía abrir fixtures a mano y cruzar plantas
   * (así se encontró que `cascajal.inletPressure1` lee 4095/10, el fondo de escala de un ADC de 12
   * bits). Esto pone el mismo dato a un toque.
   */
  @Get('raw/:plantId')
  @RequirePermission('system_config')
  getRawBuffers(@Param('plantId', new ZodValidationPipe(plantIdParamSchema)) plantId: string) {
    const view = buildRawBuffersView(
      this.pipeline.getMapping(),
      plantId,
      this.pipeline.getLatestBuffers(plantId),
    );
    if (!view) throw new NotFoundException(`planta desconocida: ${plantId}`);
    return view;
  }
}
