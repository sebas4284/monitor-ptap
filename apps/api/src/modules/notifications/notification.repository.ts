import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL } from '../../infrastructure/database/database.tokens';

export type NotificationKind = 'sensor_stale' | 'signal_out_of_range';
export type NotificationSeverity = 'critical' | 'warning' | 'info';

export interface NewNotification {
  kind: NotificationKind;
  severity: NotificationSeverity;
  plantId: string;
  /** Señal/tanque concreto, para que el front navegue al item exacto. */
  subject: string | null;
  title: string;
  message: string;
  /** Día al que se ancla la deduplicación (YYYY-MM-DD). */
  day: string;
}

export interface StoredNotification {
  id: number;
  kind: NotificationKind;
  severity: NotificationSeverity;
  plantId: string;
  subject: string | null;
  title: string;
  message: string;
  createdAt: string;
  seen: boolean;
}

const DUP_ENTRY = 'ER_DUP_ENTRY';

/** `<kind>:<plantId>[:<subject>]:<YYYY-MM-DD>` — un aviso por problema y por día. */
function dedupeKeyOf(n: NewNotification): string {
  return [n.kind, n.plantId, n.subject ?? '-', n.day].join(':');
}

/**
 * Ámbito por planta de las consultas de la bandeja.
 *
 * `null` = sin acotar, y eso SOLO lo concede `view_all_plants` (hoy el Admin). Se devuelve como
 * fragmento + parámetros en lugar de interpolar el identificador en el SQL.
 */
function plantFilter(plantScope: string | null): { sql: string; params: string[] } {
  return plantScope === null ? { sql: '', params: [] } : { sql: ' AND n.plant_id = ?', params: [plantScope] };
}

/**
 * Bandeja de notificaciones.
 *
 * Dos decisiones que conviene no revertir sin pensarlo:
 *
 *  1. **La deduplicación la hace la BASE, no el código.** `create()` inserta y deja que el índice
 *     único rechace el duplicado. Comprobar-y-luego-insertar tendría una carrera: dos ciclos del
 *     detector solapados crearían dos avisos del mismo problema.
 *  2. **No existe `delete()`.** El usuario no puede borrar un aviso, solo marcarlo visto: el
 *     historial es evidencia operativa. Lo único que borra filas es la purga por retención.
 */
@Injectable()
export class NotificationRepository {
  private readonly logger = new Logger('Notifications');

  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}

  /**
   * Crea el aviso si no existe ya uno del mismo problema ese día.
   * @returns true si se creó (es nuevo), false si ya existía.
   */
  async create(input: NewNotification): Promise<boolean> {
    try {
      await this.pool.query<ResultSetHeader>(
        `INSERT INTO notification (dedupe_key, kind, severity, plant_id, subject, title, message)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [dedupeKeyOf(input), input.kind, input.severity, input.plantId, input.subject, input.title, input.message],
      );
      return true;
    } catch (err) {
      if ((err as { code?: string }).code === DUP_ENTRY) return false; // ya se avisó hoy
      this.logger.error(`No se pudo crear la notificación: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }

  /**
   * Historial reciente con el estado de lectura DE ESE usuario, acotado a `plantScope`
   * (`null` = todas las plantas).
   */
  async listRecent(
    userId: string,
    plantScope: string | null,
    sinceHours: number,
    limit: number,
  ): Promise<StoredNotification[]> {
    const planta = plantFilter(plantScope);
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT n.id, n.kind, n.severity, n.plant_id, n.subject, n.title, n.message, n.created_at,
              (s.user_id IS NOT NULL) AS seen
         FROM notification n
         LEFT JOIN notification_seen s ON s.notification_id = n.id AND s.user_id = ?
        WHERE n.created_at >= NOW() - INTERVAL ? HOUR${planta.sql}
        ORDER BY n.created_at DESC
        LIMIT ?`,
      [userId, sinceHours, ...planta.params, limit],
    );
    return rows.map((r) => ({
      id: r.id as number,
      kind: r.kind as NotificationKind,
      severity: r.severity as NotificationSeverity,
      plantId: r.plant_id as string,
      subject: (r.subject as string | null) ?? null,
      title: r.title as string,
      message: r.message as string,
      createdAt: new Date(r.created_at as Date).toISOString(),
      seen: Boolean(r.seen),
    }));
  }

  /**
   * Cuántos avisos del historial reciente NO ha visto este usuario, dentro de su ámbito (es el
   * número de la campana). Va acotado igual que `listRecent`: si contara de más, la campana
   * marcaría avisos que la bandeja no llega a mostrar y nunca se podría dejar en cero.
   */
  async countUnseen(userId: string, plantScope: string | null, sinceHours: number): Promise<number> {
    const planta = plantFilter(plantScope);
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n
         FROM notification n
         LEFT JOIN notification_seen s ON s.notification_id = n.id AND s.user_id = ?
        WHERE n.created_at >= NOW() - INTERVAL ? HOUR
          AND s.user_id IS NULL${planta.sql}`,
      [userId, sinceHours, ...planta.params],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Marca como vistos los avisos recientes DEL ÁMBITO de ese usuario. Idempotente: `INSERT IGNORE`
   * deja intacta la marca previa, así que `seen_at` conserva la PRIMERA vez que lo vio.
   *
   * Acotado a propósito: sin el filtro se marcarían como vistos avisos de plantas que la persona
   * nunca vio, y si mañana un admin la reasigna a otra planta llegaría con el historial ya "leído".
   */
  async markAllSeen(userId: string, plantScope: string | null, sinceHours: number): Promise<number> {
    const planta = plantFilter(plantScope);
    const [res] = await this.pool.query<ResultSetHeader>(
      `INSERT IGNORE INTO notification_seen (notification_id, user_id)
       SELECT n.id, ? FROM notification n
        WHERE n.created_at >= NOW() - INTERVAL ? HOUR${planta.sql}`,
      [userId, sinceHours, ...planta.params],
    );
    return res.affectedRows ?? 0;
  }

  /** Purga por retención. Las marcas de visto caen solas por la FK en cascada. */
  async purgeOlderThan(days: number): Promise<number> {
    const [res] = await this.pool.query<ResultSetHeader>(
      `DELETE FROM notification WHERE created_at < NOW() - INTERVAL ? DAY`,
      [days],
    );
    return res.affectedRows ?? 0;
  }
}
