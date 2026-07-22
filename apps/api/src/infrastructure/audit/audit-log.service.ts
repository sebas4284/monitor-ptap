import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL } from '../database/database.tokens';

export interface AuditEntry {
  eventType: string;
  userId: string | null;
  userEmail: string | null;
  role: string | null;
  ip: string | null;
  method: string | null;
  path: string | null;
  statusCode: number | null;
  detail?: Record<string, unknown>;
}

/** Un evento leído de la auditoría (para diagnóstico; solo los campos que interesan). */
export interface AuditEventRow {
  at: string;
  eventType: string;
  detail: Record<string, unknown> | null;
}

interface RawAuditRow extends RowDataPacket {
  at: Date;
  event_type: string;
  /** La columna es JSON: mysql2 la entrega YA parseada como objeto (string solo si otro
   *  driver/config no parsea). Asumir string aquí fue el bug del 500 del diagnóstico. */
  detail: Record<string, unknown> | string | null;
}

/** Tolera ambas formas del driver: objeto (columna JSON parseada) o string JSON crudo. */
function parseDetail(raw: RawAuditRow['detail']): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { raw };
  }
}

function detailMaxBytes(): number {
  const raw = Number(process.env.AUDIT_LOG_DETAIL_MAX_BYTES ?? 4096);
  return Number.isFinite(raw) && raw > 0 ? raw : 4096;
}

function truncateDetail(detail: Record<string, unknown> | undefined): string | null {
  if (!detail) return null;
  const json = JSON.stringify(detail);
  const max = detailMaxBytes();
  if (Buffer.byteLength(json, 'utf8') <= max) return json;
  return JSON.stringify({ truncated: true, preview: json.slice(0, max) });
}

/**
 * Auditoría (MySQL, tabla audit_log — es auditoría, no telemetría; regla 1 lo permite
 * explícitamente). `record()` NUNCA lanza: un fallo del audit log no debe romper la
 * request que audita, solo se loguea el error.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger('AuditLog');

  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO audit_log (event_type, user_id, user_email, role, ip, method, path, status_code, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.eventType,
          entry.userId,
          entry.userEmail,
          entry.role,
          entry.ip,
          entry.method,
          entry.path,
          entry.statusCode,
          truncateDetail(entry.detail),
        ],
      );
    } catch (err) {
      this.logger.error(`No se pudo registrar evento de auditoría "${entry.eventType}": ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Lee los últimos eventos de un tipo (para el diagnóstico de conexión del admin). Solo
   * lectura; el `detail` se devuelve ya parseado. A diferencia de `record()`, esto SÍ puede
   * lanzar: el llamador es un endpoint que debe fallar con 500 si la BD no responde, no
   * tragarse el error en silencio.
   */
  async listByEventType(eventType: string, limit: number): Promise<AuditEventRow[]> {
    const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), 500);
    const [rows] = await this.pool.query<RawAuditRow[]>(
      `SELECT at, event_type, detail FROM audit_log WHERE event_type = ? ORDER BY id DESC LIMIT ?`,
      [eventType, safeLimit],
    );
    return rows.map((r) => ({
      at: new Date(r.at).toISOString(),
      eventType: r.event_type,
      detail: parseDetail(r.detail),
    }));
  }
}
