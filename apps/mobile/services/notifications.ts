import type { NotificationKind, NotificationSeverity } from '@ptap/shared';
import { getJson, postJson } from './api';

/**
 * Bandeja de notificaciones (persistente, en el servidor).
 *
 * No confundir con `services/alerts.ts`: aquello deriva alertas EN VIVO del snapshot y se pierde
 * al recargar. Esto es el historial que sobrevive, recuerda quién lo vio, y **nadie puede borrar**.
 */

/**
 * Tipos que emite el backend. Estuvo desincronizado —le faltaba `tank_level`, el aviso MÁS
 * accionable de todos, que por eso se pintaba con el icono genérico— así que ahora la definición
 * vive en `@ptap/shared` y la comparten backend y móvil. Aquí solo se reexporta.
 */
export type { NotificationKind, NotificationSeverity } from '@ptap/shared';

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
 * Historial reciente, SIN filtrar.
 *
 * Las preferencias del usuario no recortan esto: silenciar significa que no suena fuera de la app,
 * nunca que el aviso desaparece. Lo que se filtra —y solo para decidir si suena— es la notificación
 * del sistema, en `notification-sync`.
 */
export async function fetchNotifications(): Promise<{ notifications: AppNotification[]; unseen: number }> {
  return getJson('/api/notifications');
}

export async function fetchUnseenCount(): Promise<number> {
  const { unseen } = await getJson<{ unseen: number }>('/api/notifications/unseen-count');
  return unseen;
}

/** Marca vistos todos los avisos del historial. Se llama al ABRIR la bandeja. */
export async function markNotificationsSeen(): Promise<void> {
  await postJson('/api/notifications/seen', {});
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

/**
 * Familias con las que se filtra la bandeja.
 *
 * Existen porque con 139 avisos en tres días la lista deja de ser consultable: para saber quién
 * movió una válvula había que bajar por decenas de «señal fuera de rango». Agrupar por familia y no
 * por `kind` es deliberado — al operario le da igual si el aviso vino del detector de nivel o del
 * de autonomía; lo que busca es «lo del tanque».
 */
export type FamiliaAviso = 'valvulas' | 'tanques' | 'sensores' | 'senales';

export const FAMILIAS: { id: FamiliaAviso; etiqueta: string; kinds: NotificationKind[] }[] = [
  { id: 'valvulas', etiqueta: 'Válvulas', kinds: ['valve_command', 'valve_manual'] },
  { id: 'tanques', etiqueta: 'Tanques', kinds: ['tank_level', 'tank_autonomy'] },
  { id: 'sensores', etiqueta: 'Sensores', kinds: ['sensor_stale'] },
  { id: 'senales', etiqueta: 'Señales', kinds: ['signal_out_of_range'] },
];

export function familiaDe(kind: NotificationKind): FamiliaAviso | null {
  return FAMILIAS.find((f) => f.kinds.includes(kind))?.id ?? null;
}

/**
 * Filtra la bandeja por familia y por texto.
 *
 * En el cliente y no en el servidor: la bandeja son como mucho 200 filas ya descargadas, y filtrar
 * aquí responde al instante mientras se escribe. Pedirlo al servidor añadiría una espera a cada
 * pulsación para no ahorrar nada.
 */
export function filtrarAvisos(
  avisos: AppNotification[],
  familia: FamiliaAviso | null,
  texto: string,
): AppNotification[] {
  const q = texto.trim().toLowerCase();
  return avisos.filter((n) => {
    if (familia && familiaDe(n.kind) !== familia) return false;
    if (!q) return true;
    // Se busca también en el sujeto: es como se encuentra «valve1» o «tank1Level» cuando alguien
    // llega desde un dato del tablero y quiere ver su historia.
    return (
      n.title.toLowerCase().includes(q) ||
      n.message.toLowerCase().includes(q) ||
      (n.subject ?? '').toLowerCase().includes(q)
    );
  });
}
