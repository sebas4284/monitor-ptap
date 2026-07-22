import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAuth } from '../context/AuthContext';
import { usePlant } from '../context/PlantContext';
import { useSnapshot } from './useSnapshot';
import { deriveAlerts, type Alert } from '../services/alerts';

/**
 * Alertas de la planta seleccionada, derivadas EN VIVO del snapshot (no hay mocks). Descartar una
 * alerta la oculta durante la sesión; si su condición se resuelve y vuelve a ocurrir, reaparece
 * (el descarte se limpia solo cuando la alerta deja de estar activa).
 *
 * Solo para roles con `view_dashboard` (operador/jefe/admin). El Civil no recibe señales
 * detalladas (su rol solo ve el estado básico), así que para él no hay alertas de proceso.
 */

// Descartes en memoria (sesión). Compartidos entre la campana del header y la pantalla de alertas.
const dismissed = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
function notify(): void {
  version++;
  listeners.forEach((l) => l());
}
function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
function getVersion(): number {
  return version;
}

export function useAlerts(): {
  alerts: Alert[];
  count: number;
  dismiss: (id: string) => void;
  dismissAll: () => void;
} {
  const { hasPermission } = useAuth();
  const { selectedPlant } = usePlant();
  const canDashboard = hasPermission('view_dashboard');

  // enabled=false para el Civil: ni pide el snapshot ni abre socket.
  const { data } = useSnapshot(selectedPlant.id, canDashboard);
  const dismissedVersion = useSyncExternalStore(subscribe, getVersion, getVersion); // re-render al descartar

  const active = useMemo(() => (canDashboard ? deriveAlerts(data) : []), [canDashboard, data]);

  // Limpia los descartes de alertas que ya no están activas: si la condición vuelve, reaparece.
  useEffect(() => {
    const activeIds = new Set(active.map((a) => a.id));
    let changed = false;
    for (const id of dismissed) {
      if (!activeIds.has(id)) {
        dismissed.delete(id);
        changed = true;
      }
    }
    if (changed) notify();
  }, [active]);

  // dismissedVersion: `dismissed` es un Set EXTERNO al render; su versión es la señal de que
  // cambió (se descartó/limpió algo). El linter no puede saber que hay que recomputar por eso.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const alerts = useMemo(() => active.filter((a) => !dismissed.has(a.id)), [active, dismissedVersion]);

  const dismiss = useCallback((id: string) => {
    dismissed.add(id);
    notify();
  }, []);
  const dismissAll = useCallback(() => {
    alerts.forEach((a) => dismissed.add(a.id));
    notify();
  }, [alerts]);

  return { alerts, count: alerts.length, dismiss, dismissAll };
}
