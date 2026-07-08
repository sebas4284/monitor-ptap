import { useQuery } from '@tanstack/react-query';
import { fetchValves } from '../services/api';
import { usePlant } from '../context/PlantContext';

export function useElectrovalvulas() {
  const { selectedPlant } = usePlant();
  return useQuery({
    queryKey: ['valves', selectedPlant],
    queryFn: () => fetchValves(selectedPlant),
    refetchInterval: 30_000,
  });
}
