import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GroupId } from './signal-groups';

/**
 * Preferencias de presentación del tablero, persistidas en el dispositivo.
 *
 * Store de módulo + `useSyncExternalStore`. Se evita a propósito montar otro Context: el tablero ya
 * está envuelto en dos, y añadir un tercero que cambia con cada preferencia haría re-renderizar el
 * árbol entero para cambiar una densidad.
 */

const KEY = 'ptap_dashboard_prefs';

export interface DashboardPrefs {
  /** Modo compacto: oculta rangos y diagnósticos, deja el número y su estado. */
  compact: boolean;
  /** Grupos que el usuario plegó a mano. Un grupo `lockedOpen` ignora esto. */
  collapsed: GroupId[];
}

const DEFAULTS: DashboardPrefs = { compact: false, collapsed: [] };

// `prefs` SIEMPRE se reemplaza por un objeto nuevo, nunca se muta: así sirve directamente como
// snapshot de `useSyncExternalStore` y no hace falta un contador de versión aparte.
let prefs: DashboardPrefs = DEFAULTS;
let hydrated = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

function subscribePrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPrefs(): DashboardPrefs {
  return prefs;
}

/**
 * Hidrata desde el almacenamiento, UNA sola vez por arranque. Silencioso ante fallos: una
 * preferencia perdida no es un error que deba molestar a nadie.
 */
async function loadPrefs(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<DashboardPrefs>;
    const next: DashboardPrefs = {
      compact: typeof parsed.compact === 'boolean' ? parsed.compact : DEFAULTS.compact,
      collapsed: Array.isArray(parsed.collapsed) ? (parsed.collapsed as GroupId[]) : [],
    };
    // Solo notificar si de verdad cambió algo respecto a los valores por defecto.
    if (next.compact === prefs.compact && next.collapsed.length === 0) return;
    prefs = next;
    emit();
  } catch {
    // Preferencia corrupta o storage no disponible: se sigue con los valores por defecto.
  }
}

/**
 * Lee las preferencias y se suscribe a sus cambios, hidratando el almacenamiento al montar.
 *
 * Es UN hook y no tres exports sueltos a propósito: suscribirse y leer son inseparables — llamar a
 * `getPrefs()` sin la suscripción deja la pantalla con datos viejos para siempre, en silencio.
 */
export function useDashboardPrefs(): DashboardPrefs {
  const current = useSyncExternalStore(subscribePrefs, getPrefs, getPrefs);
  useEffect(() => {
    void loadPrefs();
  }, []);
  return current;
}

function persist(): void {
  void AsyncStorage.setItem(KEY, JSON.stringify(prefs)).catch(() => {});
}

export function setCompact(compact: boolean): void {
  prefs = { ...prefs, compact };
  persist();
  emit();
}

export function toggleGroup(id: GroupId): void {
  const collapsed = prefs.collapsed.includes(id)
    ? prefs.collapsed.filter((g) => g !== id)
    : [...prefs.collapsed, id];
  prefs = { ...prefs, collapsed };
  persist();
  emit();
}
