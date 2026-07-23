import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchSnapshot, type PlantSnapshotDto } from '../services/api';
import { subscribePlant } from '../services/socket';
import {
  getLastSnapshot,
  lastDataVersion,
  rememberSnapshot,
  subscribeLastData,
} from '../services/last-snapshot-store';

/**
 * Snapshot de una planta en tiempo real:
 *  - Carga inicial por REST (desde cache RAM del backend).
 *  - Push por Socket.IO (opc:snapshot) en cada cambio; opc:liveness parchea el estado.
 *  - sequence: si se detecta un HUECO (llega N+2 sin ver N+1), se re-sincroniza por REST.
 *  - RESPALDO: cada lectura real se recuerda en el dispositivo; si la conexión se cae (o el
 *    backend se reinició con el PLC caído y su cache RAM nació vacía), `data` entrega la última
 *    lectura conocida SIEMPRE marcada `frozen` — se ven los últimos valores, nunca pantalla vacía,
 *    y nunca un dato viejo aparentando frescura.
 */
export function useSnapshot(plantId: string, enabled = true) {
  const queryClient = useQueryClient();
  const queryKey = ['snapshot', plantId];
  const lastSeq = useRef<number>(0);
  // Re-lee el respaldo cuando la hidratación del storage termina (nativo llega async).
  const storeVersion = useSyncExternalStore(subscribeLastData, lastDataVersion, lastDataVersion);

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const snapshot = await fetchSnapshot(plantId);
      rememberSnapshot(snapshot); // ignora respuestas de espera sin señales
      return snapshot;
    },
    staleTime: Infinity, // el push mantiene el dato fresco; no re-fetch por tiempo
    refetchInterval: false, // sin esto hereda el poll de 30s global (app/_layout.tsx) y duplica el socket
    // `enabled=false` para roles sin view_dashboard (Civil): NO se pide el snapshot detallado
    // (el backend responde 403) NI se abre la suscripción de socket (el gateway aún no valida
    // permisos por planta, así que suscribir al Civil filtraría datos que su rol no debe ver).
    enabled,
  });

  useEffect(() => {
    if (!enabled) return; // Civil: nunca se suscribe al socket de la planta (evita fuga de datos)
    lastSeq.current = 0;
    const unsubscribe = subscribePlant(plantId, {
      onSnapshot: (snapshot: PlantSnapshotDto) => {
        // Detección de hueco: si perdimos un snapshot intermedio, re-sincronizar por REST.
        if (lastSeq.current > 0 && snapshot.sequence > lastSeq.current + 1) {
          void queryClient.invalidateQueries({ queryKey });
        }
        lastSeq.current = Math.max(lastSeq.current, snapshot.sequence);
        queryClient.setQueryData(queryKey, snapshot);
        rememberSnapshot(snapshot);
      },
      onLiveness: (change) => {
        if (change.plantId !== plantId) return;
        queryClient.setQueryData<PlantSnapshotDto>(queryKey, (prev) =>
          prev
            ? { ...prev, liveness: { state: change.state, lastChangeAt: change.lastChangeAt, windowSec: change.windowSec } }
            : prev,
        );
      },
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantId, enabled]);

  // Fallback: sin señales frescas (error de red, o backend con cache vacía → `pending`),
  // entrega la última lectura conocida del dispositivo. El estado del puente fresco manda si
  // existe (el banner debe reflejar la realidad actual, no la de la lectura guardada), y el
  // liveness se fuerza a `frozen`: los valores son viejos y así se marcan.
  const data = useMemo<PlantSnapshotDto | undefined>(() => {
    if (!enabled) return undefined;
    const fresh = query.data;
    if (fresh && Object.keys(fresh.signals).length > 0) return fresh;
    const stored = getLastSnapshot(plantId);
    if (!stored) return fresh;
    return {
      ...stored,
      bridgeStatus: fresh?.bridgeStatus ?? stored.bridgeStatus,
      liveness: { ...stored.liveness, state: 'frozen' },
    };
    // storeVersion: getLastSnapshot lee estado EXTERNO al render; la versión es la señal de
    // que ese estado cambió (hidratación async del storage). El linter no puede saberlo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, plantId, storeVersion, enabled]);

  return { ...query, data };
}
