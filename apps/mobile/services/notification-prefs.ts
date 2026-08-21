import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NOTIFICATION_PREFS_DEFAULT, type NotificationPrefsDto } from '@ptap/shared';
import { getJson, putJson } from './api';
import type { NotificationKind } from './notifications';

/**
 * Qué avisos quiere recibir esta persona.
 *
 * **La verdad vive en el servidor**, en su cuenta: el contador de la campana lo calcula el backend,
 * así que si el filtro viviera solo aquí la campana diría «3» sobre una bandeja que muestra dos. Y
 * de paso la elección le sigue si cambia de teléfono.
 *
 * Lo de aquí es una COPIA local, y existe por una razón concreta: la tarea en segundo plano que
 * levanta las notificaciones del sistema tiene que decidir si algo puede sonar a las tres de la
 * mañana, y no puede depender de que la red conteste. Sin copia se cae al default —todo suena—,
 * que es el lado correcto en el que equivocarse.
 */

const KEY = 'ptap_notification_prefs';

/**
 * Los tipos que el usuario puede callar, con el nombre que entiende quien está en planta.
 *
 * El orden es el de la pantalla y está puesto a mano: primero lo que más ruido hace. Las señales
 * fuera de rango son más de la mitad de los avisos de un día malo, así que es el interruptor que de
 * verdad limpia la bandeja y va arriba.
 */
export const TIPOS_DE_AVISO: { kind: NotificationKind; titulo: string; detalle: string }[] = [
  {
    kind: 'signal_out_of_range',
    titulo: 'Señales fuera de rango',
    detalle: 'Caudal, presión, turbiedad o cloro fuera de lo normal. Es el aviso más frecuente.',
  },
  {
    kind: 'sensor_stale',
    titulo: 'Sensores sin actualizar',
    detalle: 'Un instrumento dejó de refrescar su lectura. Suele ser comunicación o el propio equipo.',
  },
  {
    kind: 'tank_level',
    titulo: 'Nivel de tanque',
    detalle: 'Tanque rebosando o por debajo del mínimo.',
  },
  {
    kind: 'tank_autonomy',
    titulo: 'Autonomía de tanque',
    detalle: 'Cuánto aguanta el tanque al ritmo de salida actual.',
  },
];

export const NIVELES_DE_GRAVEDAD: { valor: NotificationPrefsDto['minSeverity']; titulo: string; detalle: string }[] = [
  { valor: 'info', titulo: 'Todo', detalle: 'Cualquier aviso, por leve que sea.' },
  { valor: 'warning', titulo: 'Avisos y críticos', detalle: 'Se omite lo puramente informativo.' },
  { valor: 'critical', titulo: 'Solo críticos', detalle: 'Únicamente lo que exige actuar ya.' },
];

let prefs: NotificationPrefsDto = NOTIFICATION_PREFS_DEFAULT;
let hidratado = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getNotificationPrefs(): NotificationPrefsDto {
  return prefs;
}

/** Normaliza lo que venga de la red o del disco: un campo corrupto no puede dejar a nadie sin avisos. */
function sanear(raw: Partial<NotificationPrefsDto> | null | undefined): NotificationPrefsDto {
  if (!raw || typeof raw !== 'object') return NOTIFICATION_PREFS_DEFAULT;
  const sev = raw.minSeverity;
  return {
    mutedKinds: Array.isArray(raw.mutedKinds) ? raw.mutedKinds.filter((k) => typeof k === 'string') : [],
    minSeverity: sev === 'warning' || sev === 'critical' ? sev : 'info',
    quietFrom: typeof raw.quietFrom === 'string' ? raw.quietFrom : null,
    quietTo: typeof raw.quietTo === 'string' ? raw.quietTo : null,
  };
}

function set(next: NotificationPrefsDto): void {
  prefs = next;
  void AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
  emit();
}

/**
 * Copia local primero, servidor después.
 *
 * En ese orden a propósito: la pantalla se pinta al instante con lo último conocido en vez de
 * parpadear con los valores por defecto, y cuando el servidor contesta se corrige si hace falta.
 */
export async function loadNotificationPrefs(force = false): Promise<NotificationPrefsDto> {
  if (!hidratado || force) {
    hidratado = true;
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) set(sanear(JSON.parse(raw) as Partial<NotificationPrefsDto>));
    } catch {
      /* copia corrupta: se sigue con el default, que es "todo llega" */
    }
  }
  try {
    const remoto = sanear(await getJson<NotificationPrefsDto>('/api/notifications/preferences'));
    set(remoto);
  } catch {
    // Sin red se usa la copia. Nunca se lanza: no poder leer las preferencias no puede impedir
    // abrir Ajustes ni, mucho menos, que suenen los avisos.
  }
  return prefs;
}

/**
 * Guarda en el servidor. Optimista: la pantalla responde al instante y, si el servidor rechaza, se
 * revierte y se avisa — dejar un interruptor mostrando algo que no se guardó sería peor que el
 * propio fallo.
 */
export async function saveNotificationPrefs(next: NotificationPrefsDto): Promise<void> {
  const previo = prefs;
  set(next);
  try {
    set(sanear(await putJson<NotificationPrefsDto>('/api/notifications/preferences', next)));
  } catch (err) {
    set(previo);
    throw err;
  }
}

export interface NotificationPrefsControl {
  prefs: NotificationPrefsDto;
  guardando: boolean;
  error: string | null;
  alternarTipo: (kind: NotificationKind) => void;
  fijarGravedad: (min: NotificationPrefsDto['minSeverity']) => void;
  fijarSilencio: (desde: string | null, hasta: string | null) => void;
}

/**
 * Lee las preferencias y las modifica. Es UN hook y no exports sueltos porque suscribirse y leer
 * son inseparables: `getNotificationPrefs()` sin la suscripción deja la pantalla congelada.
 */
export function useNotificationPrefs(): NotificationPrefsControl {
  const actual = useSyncExternalStore(subscribe, getNotificationPrefs, getNotificationPrefs);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadNotificationPrefs();
  }, []);

  const guardar = useCallback((next: NotificationPrefsDto) => {
    setGuardando(true);
    setError(null);
    saveNotificationPrefs(next)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo guardar'))
      .finally(() => setGuardando(false));
  }, []);

  return {
    prefs: actual,
    guardando,
    error,
    alternarTipo: useCallback(
      (kind: NotificationKind) => {
        const mudo = actual.mutedKinds.includes(kind);
        guardar({
          ...actual,
          mutedKinds: mudo ? actual.mutedKinds.filter((k) => k !== kind) : [...actual.mutedKinds, kind],
        });
      },
      [actual, guardar],
    ),
    fijarGravedad: useCallback(
      (minSeverity: NotificationPrefsDto['minSeverity']) => guardar({ ...actual, minSeverity }),
      [actual, guardar],
    ),
    fijarSilencio: useCallback(
      (quietFrom: string | null, quietTo: string | null) => guardar({ ...actual, quietFrom, quietTo }),
      [actual, guardar],
    ),
  };
}
