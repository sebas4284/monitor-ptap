import { useMemo } from 'react';
import { usePlant } from '../context/PlantContext';
import { useSnapshot } from './useSnapshot';
import { tanksFromSnapshot, type TankView } from '../services/tanks';
import type { LivenessState } from '../services/api';

/**
 * Tanques REALES de la planta seleccionada, derivados del snapshot (REST + push por
 * Socket.IO vía useSnapshot). Ya no consume mocks: si la planta no tiene señales
 * tank<N>Level mapeadas, tanks queda vacío y la UI lo dice explícitamente.
 */
export function useTanques() {
  const { selectedPlant } = usePlant();
  const query = useSnapshot(selectedPlant.id);
  const tanks: TankView[] = useMemo(() => tanksFromSnapshot(query.data), [query.data]);
  const livenessState: LivenessState = query.data?.liveness.state ?? 'unknown';
  return { ...query, tanks, livenessState };
}
