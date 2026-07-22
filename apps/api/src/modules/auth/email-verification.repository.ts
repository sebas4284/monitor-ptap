import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL } from '../../infrastructure/database/database.tokens';

/** Token de verificación crudo + su hash. El crudo va en el enlace; el hash se persiste. */
export interface IssuedToken {
  raw: string;
  hash: string;
}

interface TokenRow extends RowDataPacket {
  id: string;
  user_id: string;
}

/** Hash SHA-256 (hex) del token — lo que se guarda y con lo que se busca. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** TTL del token de verificación (horas). Default 24. */
function ttlHours(): number {
  const raw = Number(process.env.EMAIL_VERIFICATION_TTL_HOURS ?? 24);
  return Number.isFinite(raw) && raw > 0 ? raw : 24;
}

/**
 * Tokens de verificación de correo (tabla `email_verification_tokens`). Guarda SOLO el hash del
 * token; el valor crudo vive únicamente en el enlace del correo. De un solo uso y con expiración.
 */
@Injectable()
export class EmailVerificationRepository {
  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}

  /** Genera un token nuevo, lo persiste (hash + expiry) para un usuario y devuelve el crudo. */
  async issue(userId: string): Promise<IssuedToken> {
    const raw = randomBytes(32).toString('base64url');
    const hash = hashToken(raw);
    const expiresAt = new Date(Date.now() + ttlHours() * 3_600_000);
    await this.pool.query(
      `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`,
      [randomUUID(), userId, hash, expiresAt],
    );
    return { raw, hash };
  }

  /**
   * Consume un token: si existe, no está usado y no venció, lo marca usado y devuelve el user_id.
   * Atómico contra doble-uso: el UPDATE condicional solo afecta filas aún válidas (afRows=1 la
   * primera vez, 0 en un reintento). Devuelve null si el token no sirve.
   */
  async consume(raw: string): Promise<string | null> {
    const hash = hashToken(raw);
    const [rows] = await this.pool.query<TokenRow[]>(
      `SELECT id, user_id FROM email_verification_tokens
        WHERE token_hash = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP(3) LIMIT 1`,
      [hash],
    );
    if (rows.length === 0) return null;

    const { id, user_id } = rows[0];
    const [result] = await this.pool.query(
      `UPDATE email_verification_tokens SET used_at = CURRENT_TIMESTAMP(3)
        WHERE id = ? AND used_at IS NULL`,
      [id],
    );
    // Otra petición concurrente pudo consumirlo entre el SELECT y el UPDATE.
    if ((result as { affectedRows?: number }).affectedRows !== 1) return null;
    return user_id;
  }

  /** Invalida los tokens pendientes de un usuario (al reenviar, para que solo el último sirva). */
  async invalidateForUser(userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE email_verification_tokens SET used_at = CURRENT_TIMESTAMP(3)
        WHERE user_id = ? AND used_at IS NULL`,
      [userId],
    );
  }
}
