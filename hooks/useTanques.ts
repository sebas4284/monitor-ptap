import { useQuery } from '@tanstack/react-query';
import { fetchTanks } from '../services/api';
import { usePlant } from '../context/PlantContext';

export function useTanques() {
  const { selectedPlant } = usePlant();
  return useQuery({
    queryKey: ['tanks', selectedPlant],
    queryFn: () => fetchTanks(selectedPlant),
    refetchInterval: 30_000,
  });
}
