import { Inject, Injectable, Logger } from '@nestjs/common';
import { NOTIFICATION_PREFS_DEFAULT, type NotificationPrefsDto } from '@ptap/shared';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL } from '../../infrastructure/database/database.tokens';

/**
 * Qué avisos quiere recibir cada usuario.
 *
 * Sin fila guardada devuelve el default: **todo llega**. Nadie tiene que configurar nada para que
 * el sistema siga comportándose como hasta ahora, y un tipo de aviso nuevo alcanza a todo el mundo
 * en vez de quedar invisible hasta que cada uno lo active.
 */
@Injectable()
export class NotificationPrefsRepository {
  private readonly logger = new Logger('NotificationPrefs');

  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}

  async get(userId: string): Promise<NotificationPrefsDto> {
    try {
      const [rows] = await this.pool.query<RowDataPacket[]>(
        'SELECT kinds_silenciados, min_severidad, silencio_desde, silencio_hasta FROM notification_prefs WHERE user_id = ?',
        [userId],
      );
      const r = rows[0];
      if (!r) return NOTIFICATION_PREFS_DEFAULT;
      return {
        mutedKinds: parseKinds(r.kinds_silenciados),
        minSeverity: parseSeverity(r.min_severidad),
        quietFrom: horaCorta(r.silencio_desde),
        quietTo: horaCorta(r.silencio_hasta),
      };
    } catch (err) {
      // Un fallo leyendo preferencias NO puede dejar a nadie sin avisos: se cae al default, que es
      // "todo llega". Equivocarse hacia el lado de avisar de más es recuperable; hacia el de callar
      // significa que un tanque rebosa y nadie se entera.
      this.logger.warn(`no se pudieron leer las preferencias de ${userId}: ${err instanceof Error ? err.message : err}`);
      return NOTIFICATION_PREFS_DEFAULT;
    }
  }

  async save(userId: string, prefs: NotificationPrefsDto): Promise<void> {
    await this.pool.query(
      `INSERT INTO notification_prefs (user_id, kinds_silenciados, min_severidad, silencio_desde, silencio_hasta)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         kinds_silenciados = VALUES(kinds_silenciados),
         min_severidad     = VALUES(min_severidad),
         silencio_desde    = VALUES(silencio_desde),
         silencio_hasta    = VALUES(silencio_hasta)`,
      [
        userId,
        JSON.stringify(prefs.mutedKinds ?? []),
        prefs.minSeverity,
        prefs.quietFrom,
        prefs.quietTo,
      ],
    );
  }
}

/** MySQL devuelve JSON ya parseado o como texto según versión y driver; se cubren ambos. */
function parseKinds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((k): k is string => typeof k === 'string');
  if (typeof raw === 'string') {
    try {
      const v: unknown = JSON.parse(raw);
      return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseSeverity(raw: unknown): NotificationPrefsDto['minSeverity'] {
  return raw === 'warning' || raw === 'critical' ? raw : 'info';
}

/** `TIME` de MySQL llega como `HH:MM:SS`; al front le basta `HH:MM`. */
function horaCorta(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length < 5) return null;
  return raw.slice(0, 5);
}
