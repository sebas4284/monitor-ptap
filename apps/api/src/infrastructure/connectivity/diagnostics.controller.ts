import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../modules/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../../modules/auth/guards/permission.guard';
import { AuditLogService, type AuditEventRow } from '../audit/audit-log.service';

/** Tipo de evento con el que ConnectionEventsSubscriber graba las transiciones del puente. */
const BRIDGE_EVENT = 'opc.bridge_status_change';

/**
 * Diagnóstico de conexión con el PLC, SOLO admin (`system_config`). Lee del audit_log los
 * eventos que `ConnectionEventsSubscriber` ya graba en cada transición del puente — no expone
 * nada nuevo del adapter, solo el historial persistido. Es la fuente de la sección "Estado de
 * conexión" de Ajustes y del informe .txt que el admin exporta para escalar a un técnico.
 */
@Controller('diagnostics')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class DiagnosticsController {
  constructor(@Inject(AuditLogService) private readonly auditLog: AuditLogService) {}

  /** Últimas transiciones del puente (técnico: `at`, `status`, `reason`). */
  @Get('connection-events')
  @RequirePermission('system_config')
  async connectionEvents(): Promise<{ events: AuditEventRow[] }> {
    const events = await this.auditLog.listByEventType(BRIDGE_EVENT, 100);
    return { events };
  }
}
