import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { RouteCheckService, type RouteCheckReport } from './route-check.service';

/** Tipo de evento de las muestras del registro continuo (leído por /diagnostics/route-history). */
export const ROUTE_PROBE_EVENT = 'opc.route_probe';

/** Ventana del registro que se muestra/exporta: las últimas 20 horas. */
export const ROUTE_HISTORY_WINDOW_HOURS = 20;

/** Milisegundos que faltan para la próxima hora EN PUNTO (:00). Pura, testeable. */
export function msUntilNextTopOfHour(nowMs: number): number {
  const HOUR = 3_600_000;
  return HOUR - (nowMs % HOUR);
}

/**
 * Registro CONTINUO de la conexión con el PLC — pruebas INTERNAS, nunca mostradas al usuario:
 *
 *  - Una prueba automática **cada hora en punto** (alineada al reloj: si el servidor arranca a
 *    las 5:37, la primera automática cae a las 6:00, luego 7:00, 8:00…). Que un admin pida una
 *    prueba manual a las 5:30 NO corre el calendario: la de las 6:00 se toma igual — así el
 *    registro queda lleno y actualizado siempre, con una muestra por hora.
 *  - Las pruebas MANUALES (botón "Probar ruta") también se graban (detail.source='manual'):
 *    entran a la ventana de 20 h y la muestra más vieja sale de la vista por el corte temporal.
 *  - Catch-up al arrancar: si la última muestra tiene más de 1 h (el servidor estuvo apagado en
 *    una hora en punto), se toma una de inmediato para no dejar el hueco.
 *
 * Persiste en `audit_log` (`opc.route_probe`). NO viola la regla 1 (telemetría solo en RAM):
 * esto no es telemetría de proceso de la planta, es auditoría de conectividad — la misma
 * categoría que las transiciones del puente. `record()` nunca lanza.
 *
 * Vive en OpcObservabilityModule (requiere BD): el arranque de telemetría sin BD no muestrea.
 * Kill-switch: ROUTE_PROBE_ENABLED=false.
 */
@Injectable()
export class RouteProbeSampler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('RouteProbeSampler');
  private alignTimer: ReturnType<typeof setTimeout> | null = null;
  private hourlyTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(RouteCheckService) private readonly routeCheck: RouteCheckService,
    @Inject(AuditLogService) private readonly auditLog: AuditLogService,
  ) {}

  onModuleInit(): void {
    if (process.env.ROUTE_PROBE_ENABLED === 'false') {
      this.logger.log('muestreo de ruta deshabilitado (ROUTE_PROBE_ENABLED=false)');
      return;
    }

    // Alineación al reloj: primera automática en la próxima hora en punto, luego cada hora.
    const wait = msUntilNextTopOfHour(Date.now());
    this.alignTimer = setTimeout(() => {
      void this.sample('auto');
      this.hourlyTimer = setInterval(() => void this.sample('auto'), 3_600_000);
      this.hourlyTimer.unref?.();
    }, wait);
    this.alignTimer.unref?.(); // no retener el proceso vivo solo por el muestreo
    this.logger.log(`muestreo de ruta cada hora en punto (próxima en ${Math.round(wait / 1000)} s)`);

    // Catch-up: si el servidor estuvo apagado en la última hora en punto, el registro tiene un
    // hueco — se toma una muestra ya para mantenerlo lleno.
    void this.catchUpIfStale();
  }

  onModuleDestroy(): void {
    if (this.alignTimer) clearTimeout(this.alignTimer);
    if (this.hourlyTimer) clearInterval(this.hourlyTimer);
    this.alignTimer = null;
    this.hourlyTimer = null;
  }

  private async catchUpIfStale(): Promise<void> {
    try {
      const [latest] = await this.auditLog.listByEventType(ROUTE_PROBE_EVENT, 1);
      const age = latest ? Date.now() - new Date(latest.at).getTime() : Infinity;
      if (age > 3_600_000) await this.sample('auto');
    } catch (err) {
      this.logger.warn(`catch-up del registro fallido: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Prueba MANUAL (botón del admin / redirección de la notificación): corre las sondas, la graba
   * en el registro como cualquier muestra (source='manual') y devuelve el informe para la UI.
   */
  async manualCheck(): Promise<RouteCheckReport> {
    const report = await this.routeCheck.run();
    await this.record(report, 'manual');
    return report;
  }

  /** Una muestra automática: corre las sondas y persiste. Nunca lanza. */
  async sample(source: 'auto' | 'manual' = 'auto'): Promise<void> {
    try {
      const report = await this.routeCheck.run();
      await this.record(report, source);
    } catch (err) {
      this.logger.warn(`muestra de ruta fallida: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async record(r: RouteCheckReport, source: 'auto' | 'manual'): Promise<void> {
    await this.auditLog.record({
      eventType: ROUTE_PROBE_EVENT,
      userId: null,
      userEmail: null,
      role: null,
      ip: null,
      method: null,
      path: null,
      statusCode: null,
      detail: {
        source,
        code: r.verdict.code,
        where: r.verdict.where,
        bridge: r.bridge.status,
        target: `${r.target.host}:${r.target.port}`,
        probes: Object.fromEntries(r.probes.map((p) => [p.name, { outcome: p.outcome, ms: p.ms }])),
      },
    });
  }
}
