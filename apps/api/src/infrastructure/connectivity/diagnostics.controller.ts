import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../modules/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../../modules/auth/guards/permission.guard';
import { AuditLogService, type AuditEventRow } from '../audit/audit-log.service';
import type { RouteCheckReport } from './route-check.service';
import { ROUTE_HISTORY_WINDOW_HOURS, ROUTE_PROBE_EVENT, RouteProbeSampler } from './route-probe.sampler';

/** Tipo de evento con el que ConnectionEventsSubscriber graba las transiciones del puente. */
const BRIDGE_EVENT = 'opc.bridge_status_change';

export interface RouteHistorySummary {
  windowHours: number;
  samples: number;
  plcOk: number;
  /** % de muestras de la ventana en las que el puerto del PLC aceptó conexión (1 decimal). */
  uptimePct: number;
  oldestAt: string | null;
  newestAt: string | null;
  /** Inicio de la racha de fallo VIGENTE (null si la muestra más reciente fue OK o no hay muestras). */
  downSince: string | null;
}

export interface RouteHistoryResponse {
  summary: RouteHistorySummary;
  /** Muestras dentro de la ventana, más reciente primero (el `detail` compacto del sampler). */
  samples: AuditEventRow[];
}

/** ¿La muestra alcanzó el puerto del PLC? (el veredicto '—' del sampler = ruta OK). */
function sampleOk(row: AuditEventRow): boolean {
  return row.detail?.code === '—';
}

/** Resumen puro (testeable sin BD) del registro continuo. `events` llega más reciente primero. */
export function buildRouteHistory(events: AuditEventRow[], windowHours: number): RouteHistoryResponse {
  const cutoff = Date.now() - windowHours * 3_600_000;
  const samples = events.filter((e) => new Date(e.at).getTime() >= cutoff);
  const plcOk = samples.filter(sampleOk).length;

  // Racha de fallo vigente: desde la muestra más reciente hacia atrás mientras siga fallando;
  // `downSince` es la MÁS ANTIGUA de esa racha (cuándo empezó el corte actual).
  let downSince: string | null = null;
  for (const s of samples) {
    if (sampleOk(s)) break;
    downSince = s.at;
  }

  return {
    summary: {
      windowHours,
      samples: samples.length,
      plcOk,
      uptimePct: samples.length === 0 ? 0 : Math.round((plcOk / samples.length) * 1000) / 10,
      oldestAt: samples.length > 0 ? samples[samples.length - 1].at : null,
      newestAt: samples.length > 0 ? samples[0].at : null,
      downSince,
    },
    samples,
  };
}

/**
 * Diagnóstico de conexión con el PLC, SOLO admin (`system_config`).
 *
 *  - `connection-events`: historial de transiciones del puente que ConnectionEventsSubscriber
 *    ya graba en el audit_log — no expone nada nuevo del adapter, solo lo persistido.
 *  - `route-check`: prueba MANUAL en vivo (botón "Probar ruta" / redirección de la notificación).
 *    Se GRABA en el registro como cualquier muestra (source='manual') — entra a la ventana de
 *    20 h y la más vieja sale de la vista.
 *  - `route-history`: el registro interno de 20 h (prueba automática oculta cada hora en punto).
 *
 * Todo alimenta la sección "Estado de conexión" de Ajustes y el informe .txt exportable.
 */
@Controller('diagnostics')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class DiagnosticsController {
  constructor(
    @Inject(AuditLogService) private readonly auditLog: AuditLogService,
    @Inject(RouteProbeSampler) private readonly sampler: RouteProbeSampler,
  ) {}

  /** Últimas transiciones del puente (técnico: `at`, `status`, `reason`). */
  @Get('connection-events')
  @RequirePermission('system_config')
  async connectionEvents(): Promise<{ events: AuditEventRow[] }> {
    const events = await this.auditLog.listByEventType(BRIDGE_EVENT, 100);
    return { events };
  }

  /** Prueba de ruta MANUAL (tarda ≤ ~5 s). Queda grabada en el registro (source='manual'). */
  @Get('route-check')
  @RequirePermission('system_config')
  async runRouteCheck(): Promise<RouteCheckReport> {
    return this.sampler.manualCheck();
  }

  /**
   * Registro interno de las últimas 20 h: una muestra automática por hora EN PUNTO (más las
   * manuales). Resumen: cuántas alcanzaron el PLC, desde cuándo dura el corte vigente, y cada
   * muestra con su detalle. (El límite de 500 filas cubre la ventana con holgura.)
   */
  @Get('route-history')
  @RequirePermission('system_config')
  async routeHistory(): Promise<RouteHistoryResponse> {
    const events = await this.auditLog.listByEventType(ROUTE_PROBE_EVENT, 500);
    return buildRouteHistory(events, ROUTE_HISTORY_WINDOW_HOURS);
  }
}
