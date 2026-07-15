import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
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
}
