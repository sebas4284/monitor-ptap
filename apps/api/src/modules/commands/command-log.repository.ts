import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL } from '../../infrastructure/database/database.tokens';

// 'sent' = escrito y verificado por eco, pero el canal de estado del sitio no tiene semántica
// verificada, así que no se afirma ni se niega el movimiento del equipo (ver CommandOutcome).
// La columna es VARCHAR(32), no un ENUM: agregar un estado no requiere migración.
export type CommandStatus = 'pending' | 'confirmed' | 'sent' | 'failed' | 'rejected';

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

/** Una orden con realimentación que se quedó sosteniendo sin resultado (ver `sostenidosSinResultado`). */
export interface SostenidoSinResultado {
  id: number;
  at: string;
  plantId: string;
  target: string;
  command: string;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  role: string | null;
  ip: string | null;
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

  /**
   * Cambia SOLO `reason` de una fila ya finalizada.
   *
   * Existe por la firma encadenada: `status` y `confirmed_value` están SELLADOS (ver
   * `command-signature.ts`), y una orden con realimentación se firma al salir (`sent`), antes de
   * saber cómo acaba. Reescribir su `status` al final rompería el sello y la verificación lo
   * denunciaría como manipulación. `reason` no se sella: ahí se anota cómo acabó, y el resultado
   * sellado va en su propia fila (ver `WriteService.registrarResultado`).
   */
  async anotarMotivo(id: number, reason: string): Promise<void> {
    try {
      await this.pool.query('UPDATE command_log SET reason = ? WHERE id = ?', [reason, id]);
    } catch (err) {
      this.logger.error(`No se pudo anotar el motivo de command_log id=${id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Órdenes con realimentación que se quedaron en `sent` + `SENT_HOLDING_UNTIL_FEEDBACK`, creadas
   * ANTES de `antesDe`: las de un proceso anterior que se detuvo con el sostenido en marcha. Las del
   * proceso actual nunca entran (son posteriores a su arranque), así que no se puede dar por
   * interrumpida una orden que todavía se está sosteniendo.
   */
  async sostenidosSinResultado(motivoEnCurso: string, antesDe: Date): Promise<SostenidoSinResultado[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT id, at, plant_id, target, command, user_id, user_email, user_name, role, ip
         FROM command_log
        WHERE status = 'sent' AND reason = ? AND at < ?
        ORDER BY id ASC`,
      [motivoEnCurso, antesDe],
    );
    return rows.map((r) => {
      const at = r.at as Date | string;
      return {
        id: r.id as number,
        at: at instanceof Date ? at.toISOString() : new Date(at).toISOString(),
        plantId: r.plant_id as string,
        target: r.target as string,
        command: r.command as string,
        userId: (r.user_id as string | null) ?? null,
        userEmail: (r.user_email as string | null) ?? null,
        userName: (r.user_name as string | null) ?? null,
        role: (r.role as string | null) ?? null,
        ip: (r.ip as string | null) ?? null,
      };
    });
  }

  /**
   * ¿Salió de la app alguna orden sobre esa válvula en los últimos `minutos`?
   *
   * Lo usa el detector de maniobras manuales para no acusar de "alguien la movió a mano" un cambio
   * de caudal que provocamos nosotros. Cuenta CUALQUIER estado, incluido `rejected`: una orden
   * rechazada no tocó el equipo, pero sí explica que alguien estuviera operando ahí en ese momento.
   */
  async huboOrdenReciente(plantId: string, target: string, minutos: number): Promise<boolean> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT 1 FROM command_log
        WHERE plant_id = ? AND target = ? AND at >= NOW() - INTERVAL ? MINUTE
        LIMIT 1`,
      [plantId, target, minutos],
    );
    return rows.length > 0;
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
