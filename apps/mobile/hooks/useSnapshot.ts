import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchSnapshot, type PlantSnapshotDto } from '../services/api';
import { subscribePlant } from '../services/socket';

/**
 * Snapshot de una planta en tiempo real:
 *  - Carga inicial por REST (desde cache RAM del backend).
 *  - Push por Socket.IO (opc:snapshot) en cada cambio; opc:liveness parchea el estado.
 *  - sequence: si se detecta un HUECO (llega N+2 sin ver N+1), se re-sincroniza por REST.
 */
export function useSnapshot(plantId: string) {
  const queryClient = useQueryClient();
  const queryKey = ['snapshot', plantId];
  const lastSeq = useRef<number>(0);

  const query = useQuery({
    queryKey,
    queryFn: () => fetchSnapshot(plantId),
    staleTime: Infinity, // el push mantiene el dato fresco; no re-fetch por tiempo
  });

  useEffect(() => {
    lastSeq.current = 0;
    const unsubscribe = subscribePlant(plantId, {
      onSnapshot: (snapshot: PlantSnapshotDto) => {
        // Detección de hueco: si perdimos un snapshot intermedio, re-sincronizar por REST.
        if (lastSeq.current > 0 && snapshot.sequence > lastSeq.current + 1) {
          void queryClient.invalidateQueries({ queryKey });
        }
        lastSeq.current = Math.max(lastSeq.current, snapshot.sequence);
        queryClient.setQueryData(queryKey, snapshot);
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
  }, [plantId]);

  return query;
}
