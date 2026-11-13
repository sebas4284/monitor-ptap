import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { claveDeItem, NOTIFICATION_PREFS_DEFAULT, type NotificationPrefsDto } from '@ptap/shared';
import { getJson, putJson } from './api';
import { isNotificationSession, notificationSession, type NotificationSession } from './notification-session';
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
 * fuera de rango son más de la mitad de los avisos de un día malo, así que es el interruptor que
 * más silencio compra y va arriba.
 *
 * Las maniobras de válvula NO están en esta lista, y no es un olvido: son el registro que sustituye
 * a la confirmación eléctrica que estas plantas no dan, y no se pueden silenciar.
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

interface PrefsState {
  session: NotificationSession;
  prefs: NotificationPrefsDto;
  hydrated: boolean;
  fetchedAt: number;
  inFlight: Promise<NotificationPrefsDto> | null;
}
let state: PrefsState | null = null;
function currentState(): PrefsState | null {
  const session = notificationSession();
  if (!session) { state = null; return null; }
  if (!state || state.session.generation !== session.generation) {
    state = { session, prefs: NOTIFICATION_PREFS_DEFAULT, hydrated: false, fetchedAt: 0, inFlight: null };
  }
  return state;
}
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getNotificationPrefs(): NotificationPrefsDto {
  return currentState()?.prefs ?? NOTIFICATION_PREFS_DEFAULT;
}

/** Normaliza lo que venga de la red o del disco: un campo corrupto no puede dejar a nadie sin avisos. */
function sanear(raw: Partial<NotificationPrefsDto> | null | undefined): NotificationPrefsDto {
  if (!raw || typeof raw !== 'object') return NOTIFICATION_PREFS_DEFAULT;
  const sev = raw.minSeverity;
  return {
    mutedKinds: Array.isArray(raw.mutedKinds) ? raw.mutedKinds.filter((k) => typeof k === 'string') : [],
    mutedItems: Array.isArray(raw.mutedItems) ? raw.mutedItems.filter((k) => typeof k === 'string') : [],
    minSeverity: sev === 'warning' || sev === 'critical' ? sev : 'info',
    quietFrom: typeof raw.quietFrom === 'string' ? raw.quietFrom : null,
    quietTo: typeof raw.quietTo === 'string' ? raw.quietTo : null,
  };
}

function set(owner: PrefsState, next: NotificationPrefsDto, persist = true): void {
  if (!isNotificationSession(owner.session)) return;
  owner.prefs = next;
  // Legacy unscoped copies cannot be assigned to an identity safely and are never read.
  if (persist) void AsyncStorage.setItem(`${KEY}:${owner.session.scope}`, JSON.stringify(next)).catch(() => {});
  emit();
}

const FRESCURA_MS = 60_000;

/** Cache and pending requests belong to one auth generation; persistent copies belong to its user/role/plant. */
export function loadNotificationPrefs(force = false): Promise<NotificationPrefsDto> {
  const owner = currentState();
  if (!owner) return Promise.resolve(NOTIFICATION_PREFS_DEFAULT);
  if (owner.inFlight) return owner.inFlight;
  if (!force && Date.now() - owner.fetchedAt < FRESCURA_MS) return Promise.resolve(owner.prefs);
  owner.inFlight = (async () => {
    if (!owner.hydrated) {
      owner.hydrated = true;
      try {
        const raw = await AsyncStorage.getItem(`${KEY}:${owner.session.scope}`);
        if (!isNotificationSession(owner.session)) return NOTIFICATION_PREFS_DEFAULT;
        if (raw) set(owner, sanear(JSON.parse(raw) as Partial<NotificationPrefsDto>), false);
      } catch { /* corrupt cache: retain defaults */ }
    }
    if (!isNotificationSession(owner.session)) return NOTIFICATION_PREFS_DEFAULT;
    try {
      const next = await getJson<NotificationPrefsDto>('/api/notifications/preferences');
      if (!isNotificationSession(owner.session)) return NOTIFICATION_PREFS_DEFAULT;
      set(owner, sanear(next));
      owner.fetchedAt = Date.now();
    } catch { /* only this identity's cached preferences are available offline */ }
    finally { owner.inFlight = null; }
    return isNotificationSession(owner.session) ? owner.prefs : NOTIFICATION_PREFS_DEFAULT;
  })();
  return owner.inFlight;
}

/** Optimistic updates and rollbacks can only affect the session that initiated the save. */
export async function saveNotificationPrefs(next: NotificationPrefsDto): Promise<void> {
  const owner = currentState();
  if (!owner) throw new Error('Sesión requerida');
  const previous = owner.prefs;
  set(owner, next);
  try {
    const saved = await putJson<NotificationPrefsDto>('/api/notifications/preferences', next);
    if (!isNotificationSession(owner.session)) return;
    set(owner, sanear(saved));
    owner.fetchedAt = Date.now();
  } catch (err) {
    set(owner, previous);
    throw err;
  }
}

/**
 * Estado de la campana de UN ítem, con su propia suscripción.
 *
 * Se separa del hook grande porque lo usan las tarjetas del tablero, que están memoizadas: si el
 * estado llegara como prop de la tarjeta se quedaría congelado. Con suscripción propia, el botón se
 * entera del cambio aunque la tarjeta no se vuelva a renderizar.
 */
export function useItemSilenciado(
  plantId: string,
  subject: string,
): { silenciado: boolean; guardando: boolean; alternar: () => void } {
  const actual = useSyncExternalStore(subscribe, getNotificationPrefs, getNotificationPrefs);
  const [guardando, setGuardando] = useState(false);
  const clave = claveDeItem(plantId, subject);
  const silenciado = actual.mutedItems.includes(clave);

  useEffect(() => {
    void loadNotificationPrefs();
  }, []);

  const alternar = useCallback(() => {
    setGuardando(true);
    const next: NotificationPrefsDto = {
      ...actual,
      mutedItems: silenciado ? actual.mutedItems.filter((k) => k !== clave) : [...actual.mutedItems, clave],
    };
    // Si el servidor rechaza, `saveNotificationPrefs` revierte y el botón vuelve solo a su sitio:
    // dejarlo mostrando un silencio que no se guardó sería peor que el propio fallo.
    saveNotificationPrefs(next)
      .catch(() => undefined)
      .finally(() => setGuardando(false));
  }, [actual, clave, silenciado]);

  return { silenciado, guardando, alternar };
}

export interface NotificationPrefsControl {
  prefs: NotificationPrefsDto;
  guardando: boolean;
  error: string | null;
  alternarTipo: (kind: NotificationKind) => void;
  fijarGravedad: (min: NotificationPrefsDto['minSeverity']) => void;
  fijarSilencio: (desde: string | null, hasta: string | null) => void;
  /** Devuelve la voz a TODAS las señales calladas una por una desde el tablero. */
  reactivarItems: () => void;
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
    reactivarItems: useCallback(() => guardar({ ...actual, mutedItems: [] }), [actual, guardar]),
  };
}
