import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL } from '../../infrastructure/database/database.tokens';

export type NotificationKind = 'sensor_stale' | 'signal_out_of_range' | 'tank_level' | 'tank_autonomy';
export type NotificationSeverity = 'critical' | 'warning' | 'info';

export interface NewNotification {
  kind: NotificationKind;
  severity: NotificationSeverity;
  plantId: string;
  /** Señal/tanque concreto, para que el front navegue al item exacto. */
  subject: string | null;
  title: string;
  message: string;
  /**
   * QUÉ HACER, en una frase. Se pinta aparte y destacado, no enterrado en el párrafo.
   *
   * Existe porque ningún aviso lo decía: describían el síntoma y, con suerte, el diagnóstico. El
   * único que justifica salir corriendo —el rebose real— cerraba con «Revisar la planta: se está
   * perdiendo agua tratada», sin decir qué válvula tocar ni a quién llamar.
   *
   * `null` cuando no hay una acción clara. Inventarse una es peor que no ponerla: enseña al
   * operario a ignorar este campo.
   */
  action?: string | null;
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
  /** Qué hacer, en una frase. `null` si no hay una acción clara. Ver `NewNotification.action`. */
  action: string | null;
  createdAt: string;
  seen: boolean;
}

const DUP_ENTRY = 'ER_DUP_ENTRY';

/**
 * `<kind>:<plantId>[:<subject>]:<severity>:<YYYY-MM-DD>` — un aviso por problema, GRAVEDAD y día.
 *
 * **La severidad entra en la clave, y esa es la parte que importa.** Sin ella, un tanque que a las
 * 19:05 estaba `indeterminado` (warning) y a las 21:00 pasa a `rebosando` (critical) NO generaba
 * aviso: mismo tipo, misma planta, mismo sujeto, mismo día. El empeoramiento se tragaba en silencio,
 * que es exactamente lo contrario de lo que un sistema de avisos debe hacer.
 *
 * Sigue callando la repetición idéntica —el mismo problema con la misma gravedad no vuelve a avisar
 * hasta el día siguiente—, que es para lo que se creó la deduplicación. Lo único que cambia es que
 * *empeorar* cuenta como noticia nueva. Mejorar también: un `critical` que baja a `warning` avisa, y
 * eso es información útil («va a mejor») que antes tampoco llegaba.
 */
function dedupeKeyOf(n: NewNotification): string {
  return [n.kind, n.plantId, n.subject ?? '-', n.severity, n.day].join(':');
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

/** Orden de gravedad. `info` no lo emite hoy ningún detector, pero el filtro no debe asumirlo. */
const ORDEN_SEVERIDAD: Record<NotificationSeverity, number> = { info: 0, warning: 1, critical: 2 };

/** Qué severidades pasan un mínimo dado. Se resuelve a una lista para poder usar `IN` con params. */
export function severidadesDesde(min: NotificationSeverity): NotificationSeverity[] {
  const piso = ORDEN_SEVERIDAD[min] ?? 0;
  return (['info', 'warning', 'critical'] as NotificationSeverity[]).filter((s) => ORDEN_SEVERIDAD[s] >= piso);
}

/** Ámbito completo de una consulta de bandeja: planta + preferencias del usuario. */
export interface NotificationScope {
  plantScope: string | null;
  /** Tipos que el usuario silenció. Vacío = ninguno. */
  mutedKinds?: string[];
  /** Gravedad mínima que quiere ver. Ausente = `info` = todo. */
  minSeverity?: NotificationSeverity;
  /**
   * `true` = enseña también lo silenciado (el interruptor «Ver también los silenciados»).
   *
   * Silenciar NO borra: el aviso sigue en la base y se puede consultar. Lo que hace es dejar de
   * contar en la campana y de aparecer por defecto. La diferencia entre «no me molestes con esto» y
   * «esto no existió» es justo la que hay que preservar en una planta.
   */
  includeMuted?: boolean;
}

/**
 * Fragmento `WHERE` compartido por las TRES consultas de la bandeja.
 *
 * Está en un solo sitio a propósito. Si el contador y el listado filtraran distinto, la campana
 * marcaría avisos que la bandeja no muestra y nunca bajaría a cero — el fallo concreto que este
 * diseño existe para hacer imposible.
 */
export function scopeFilter(scope: NotificationScope): { sql: string; params: (string | number)[] } {
  const planta = plantFilter(scope.plantScope);
  let sql = planta.sql;
  const params: (string | number)[] = [...planta.params];

  if (scope.includeMuted) return { sql, params };

  const mudos = (scope.mutedKinds ?? []).filter((k) => typeof k === 'string' && k.length > 0);
  if (mudos.length > 0) {
    sql += ` AND n.kind NOT IN (${mudos.map(() => '?').join(',')})`;
    params.push(...mudos);
  }

  const permitidas = severidadesDesde(scope.minSeverity ?? 'info');
  // Solo se añade si de verdad acota: con `info` pasan las tres y la condición sobra.
  if (permitidas.length < 3) {
    sql += ` AND n.severity IN (${permitidas.map(() => '?').join(',')})`;
    params.push(...permitidas);
  }

  return { sql, params };
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
        `INSERT INTO notification (dedupe_key, kind, severity, plant_id, subject, title, message, action)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [dedupeKeyOf(input), input.kind, input.severity, input.plantId, input.subject, input.title, input.message, input.action ?? null],
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
    scope: NotificationScope,
    sinceHours: number,
    limit: number,
  ): Promise<StoredNotification[]> {
    const planta = scopeFilter(scope);
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT n.id, n.kind, n.severity, n.plant_id, n.subject, n.title, n.message, n.action, n.created_at,
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
      action: (r.action as string | null) ?? null,
      createdAt: new Date(r.created_at as Date).toISOString(),
      seen: Boolean(r.seen),
    }));
  }

  /**
   * Cuántos avisos del historial reciente NO ha visto este usuario, dentro de su ámbito (es el
   * número de la campana). Va acotado igual que `listRecent`: si contara de más, la campana
   * marcaría avisos que la bandeja no llega a mostrar y nunca se podría dejar en cero.
   */
  async countUnseen(userId: string, scope: NotificationScope, sinceHours: number): Promise<number> {
    const planta = scopeFilter(scope);
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
   *
   * Va con el MISMO ámbito con el que se pintó la bandeja —preferencias incluidas—: se marca visto
   * exactamente lo que se enseñó. Si alguien deja de silenciar un tipo, esos avisos reaparecen sin
   * ver, que es la verdad: nunca los vio.
   */
  async markAllSeen(userId: string, scope: NotificationScope, sinceHours: number): Promise<number> {
    const planta = scopeFilter(scope);
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
