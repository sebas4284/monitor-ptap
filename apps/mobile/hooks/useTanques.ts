import { useQuery } from '@tanstack/react-query';
import { fetchTanks } from '../services/mock-data';
import { usePlant } from '../context/PlantContext';

export function useTanques() {
  const { selectedPlant } = usePlant();
  return useQuery({
    queryKey: ['tanks', selectedPlant.id],
    queryFn: () => fetchTanks(selectedPlant.id),
    refetchInterval: 30_000,
  });
}
