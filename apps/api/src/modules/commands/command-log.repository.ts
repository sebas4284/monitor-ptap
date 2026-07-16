import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL } from '../../infrastructure/database/database.tokens';

export type CommandStatus = 'pending' | 'confirmed' | 'failed' | 'rejected';

export type CommandValue = number | boolean | null;

export interface CommandReservation {
  idempotencyKey: string | null;
  plantId: string;
  target: string;
  command: string;
  userId: string | null;
  userEmail: string | null;
  role: string | null;
  ip: string | null;
}

export interface CommandFinalize {
  status: Exclude<CommandStatus, 'pending'>;
  reason: string | null;
  previousValue: CommandValue;
  writtenValue: CommandValue;
  confirmedValue: CommandValue;
  interlockSequence: number | null;
}

export interface StoredCommand {
  id: number;
  status: CommandStatus;
  reason: string | null;
  previousValue: CommandValue;
  writtenValue: CommandValue;
  confirmedValue: CommandValue;
  interlockSequence: number | null;
}

/** Serializa un valor de comando a string para la columna (o null). */
function toColumn(v: CommandValue): string | null {
  return v === null || v === undefined ? null : String(v);
}

/** Reconstruye un CommandValue desde la columna string. */
function fromColumn(raw: string | null): CommandValue {
  if (raw === null) return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const n = Number(raw);
  return Number.isFinite(n) && raw.trim() !== '' ? n : null;
}

const DUP_ENTRY = 'ER_DUP_ENTRY';

/**
 * Traza + idempotencia de comandos en MySQL (regla 1: es auditoría/operación, no telemetría).
 * `reserve()` implementa insert-pending-first: crea la fila 'pending' ANTES de escribir al PLC.
 * Si el idempotencyKey ya existía, devuelve la fila previa SIN reservar → el comando no se
 * re-ejecuta (evita doble accionamiento, incluso tras un reinicio del proceso).
 */
@Injectable()
export class CommandLogRepository {
  private readonly logger = new Logger('CommandLog');

  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}

  async reserve(
    input: CommandReservation,
  ): Promise<{ reserved: true; id: number } | { reserved: false; existing: StoredCommand }> {
    try {
      const [res] = await this.pool.query<ResultSetHeader>(
        `INSERT INTO command_log
           (idempotency_key, plant_id, target, command, user_id, user_email, role, ip, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [input.idempotencyKey, input.plantId, input.target, input.command, input.userId, input.userEmail, input.role, input.ip],
      );
      return { reserved: true, id: res.insertId };
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === DUP_ENTRY && input.idempotencyKey) {
        const existing = await this.findByIdempotencyKey(input.idempotencyKey);
        if (existing) return { reserved: false, existing };
      }
      throw err;
    }
  }

  async finalize(id: number, result: CommandFinalize): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE command_log
            SET status = ?, reason = ?, previous_value = ?, written_value = ?, confirmed_value = ?, interlock_sequence = ?
          WHERE id = ?`,
        [
          result.status,
          result.reason,
          toColumn(result.previousValue),
          toColumn(result.writtenValue),
          toColumn(result.confirmedValue),
          result.interlockSequence,
          id,
        ],
      );
    } catch (err) {
      // La traza no debe tumbar la respuesta del comando ya ejecutado; se loguea el fallo.
      this.logger.error(`No se pudo finalizar command_log id=${id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  async findByIdempotencyKey(key: string): Promise<StoredCommand | null> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT id, status, reason, previous_value, written_value, confirmed_value, interlock_sequence
         FROM command_log WHERE idempotency_key = ? LIMIT 1`,
      [key],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id as number,
      status: row.status as CommandStatus,
      reason: (row.reason as string | null) ?? null,
      previousValue: fromColumn(row.previous_value as string | null),
      writtenValue: fromColumn(row.written_value as string | null),
      confirmedValue: fromColumn(row.confirmed_value as string | null),
      interlockSequence: (row.interlock_sequence as number | null) ?? null,
    };
  }
}
