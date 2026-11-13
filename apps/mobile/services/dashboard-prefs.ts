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
let compactEdited = false;
let collapsedEdited = false;
let writes: Promise<void> = Promise.resolve();
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
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    const saved = parsed as Partial<DashboardPrefs>;
    const next: DashboardPrefs = {
      compact: compactEdited ? prefs.compact : typeof saved.compact === 'boolean' ? saved.compact : DEFAULTS.compact,
      collapsed: collapsedEdited ? prefs.collapsed : Array.isArray(saved.collapsed)
        ? [...new Set(saved.collapsed.filter((id): id is GroupId => id === 'inlet' || id === 'outlet' || id === 'process'))]
        : [],
    };
    if (next.compact === prefs.compact && next.collapsed.length === prefs.collapsed.length &&
      next.collapsed.every((id, index) => id === prefs.collapsed[index])) return;
    prefs = next;
    // Preserve untouched saved fields alongside edits made while the read was pending.
    if (compactEdited || collapsedEdited) persist();
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
  const value = JSON.stringify(prefs);
  writes = writes.then(() => AsyncStorage.setItem(KEY, value)).catch(() => {});
}

export function setCompact(compact: boolean): void {
  compactEdited = true;
  prefs = { ...prefs, compact };
  persist();
  emit();
}

export function toggleGroup(id: GroupId): void {
  collapsedEdited = true;
  const collapsed = prefs.collapsed.includes(id)
    ? prefs.collapsed.filter((g) => g !== id)
    : [...prefs.collapsed, id];
  prefs = { ...prefs, collapsed };
  persist();
  emit();
}
