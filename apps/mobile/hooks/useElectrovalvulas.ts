import { useQuery } from '@tanstack/react-query';
import { fetchValves } from '../services/mock-data';
import { usePlant } from '../context/PlantContext';

export function useElectrovalvulas() {
  const { selectedPlant } = usePlant();
  return useQuery({
    queryKey: ['valves', selectedPlant.id],
    queryFn: () => fetchValves(selectedPlant.id),
    refetchInterval: 30_000,
  });
}
