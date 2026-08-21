import { getJson, postJson } from './api';

/**
 * Bandeja de notificaciones (persistente, en el servidor).
 *
 * No confundir con `services/alerts.ts`: aquello deriva alertas EN VIVO del snapshot y se pierde
 * al recargar. Esto es el historial que sobrevive, recuerda quién lo vio, y **nadie puede borrar**.
 */

/**
 * Tipos que emite el backend. Estuvo desincronizado: le faltaba `tank_level`, que es el aviso MÁS
 * accionable de todos, y por eso se pintaba con el icono genérico. La fuente de verdad es
 * `apps/api/src/modules/notifications/notification.repository.ts`.
 */
export type NotificationKind = 'sensor_stale' | 'signal_out_of_range' | 'tank_level' | 'tank_autonomy';
export type NotificationSeverity = 'critical' | 'warning' | 'info';

export interface AppNotification {
  id: number;
  kind: NotificationKind;
  severity: NotificationSeverity;
  plantId: string;
  /** Señal concreta (domainKey) cuando aplica: permite saltar al item exacto. */
  subject: string | null;
  title: string;
  message: string;
  /**
   * QUÉ HACER, en una frase. La API lo devuelve desde el 2026-08-18 y el móvil lo ignoraba, que era
   * tanto como no tenerlo: el aviso volvía a ser solo un síntoma. `null` cuando no hay una acción
   * clara — y entonces no se pinta nada, en vez de un hueco vacío.
   */
  action: string | null;
  createdAt: string;
  seen: boolean;
}

/**
 * Historial reciente. Ya viene filtrado por las preferencias de la cuenta (ver Ajustes).
 *
 * `incluirSilenciados` enseña también lo que el usuario decidió no recibir: silenciar NO borra, y
 * el historial es evidencia. Aun así el contador `unseen` sigue siendo el de siempre —solo lo que
 * el usuario pidió que le reclamara la atención—, para que la campana no se descuadre.
 */
export async function fetchNotifications(
  incluirSilenciados = false,
): Promise<{ notifications: AppNotification[]; unseen: number }> {
  return getJson(`/api/notifications${incluirSilenciados ? '?incluirSilenciados=1' : ''}`);
}

export async function fetchUnseenCount(): Promise<number> {
  const { unseen } = await getJson<{ unseen: number }>('/api/notifications/unseen-count');
  return unseen;
}

/**
 * Marca vistos los avisos del historial. Se llama al ABRIR la bandeja.
 *
 * Va con el MISMO ámbito con el que se está mirando: se marca visto lo que se enseñó, ni más ni
 * menos. Si se marcaran también los silenciados, al dejar de silenciar un tipo sus avisos
 * aparecerían ya leídos sin que nadie los hubiera visto nunca.
 */
export async function markNotificationsSeen(incluirSilenciados = false): Promise<void> {
  await postJson(`/api/notifications/seen${incluirSilenciados ? '?incluirSilenciados=1' : ''}`, {});
}

/** "hace 3 h", "ayer 09:14" — el operador necesita saber CUÁNDO, no solo qué. */
export function formatWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const mins = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return 'ahora mismo';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (hours < 48) return `ayer ${hhmm}`;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${hhmm}`;
}
