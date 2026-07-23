import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { MYSQL_POOL } from '../database/database.tokens';

/**
 * Limpieza periódica de `audit_log`, que de otro modo crece indefinidamente. Dos retenciones:
 *  - `opc.route_probe` (las muestras de ruta cada hora): solo se necesitan ~20 h para el
 *    diagnóstico → retención CORTA (`ROUTE_PROBE_RETENTION_DAYS`, default 2 días).
 *  - Todo lo demás (accesos, login, cambios de usuario, transiciones del puente): retención LARGA
 *    (`AUDIT_RETENTION_DAYS`, default 90 días) — es trazabilidad, se conserva más.
 *
 * Poner cualquiera de las dos en `0` la deshabilita. Corre una vez al arrancar (tras un pequeño
 * retraso) y luego cada 24 h. Es mantenimiento de auditoría, no telemetría → puede tocar la BD.
 */
@Injectable()
export class AuditRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('AuditRetention');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}

  onModuleInit(): void {
    // Primera pasada 60 s tras arrancar (no competir con el bootstrap), luego cada 24 h.
    const kickoff = setTimeout(() => void this.purge(), 60_000);
    kickoff.unref?.();
    this.timer = setInterval(() => void this.purge(), 24 * 60 * 60 * 1000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Borra las filas vencidas según cada retención. Nunca lanza (es mantenimiento en segundo plano). */
  async purge(): Promise<void> {
    const routeDays = this.days('ROUTE_PROBE_RETENTION_DAYS', 2);
    const auditDays = this.days('AUDIT_RETENTION_DAYS', 90);
    try {
      if (routeDays > 0) {
        const [r] = await this.pool.query(
          `DELETE FROM audit_log WHERE event_type = 'opc.route_probe' AND at < (NOW() - INTERVAL ? DAY)`,
          [routeDays],
        );
        const n = (r as { affectedRows?: number }).affectedRows ?? 0;
        if (n > 0) this.logger.log(`purga: ${n} muestras opc.route_probe (> ${routeDays} d)`);
      }
      if (auditDays > 0) {
        const [r] = await this.pool.query(
          `DELETE FROM audit_log WHERE event_type <> 'opc.route_probe' AND at < (NOW() - INTERVAL ? DAY)`,
          [auditDays],
        );
        const n = (r as { affectedRows?: number }).affectedRows ?? 0;
        if (n > 0) this.logger.log(`purga: ${n} filas de auditoría (> ${auditDays} d)`);
      }
    } catch (err) {
      this.logger.warn(`purga de auditoría fallida: ${err instanceof Error ? err.message : err}`);
    }
  }

  private days(name: string, fallback: number): number {
    const raw = Number(process.env[name]);
    return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
  }
}
