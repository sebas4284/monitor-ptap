import { useQuery } from '@tanstack/react-query';
import { fetchSensors } from '../services/api';
import { usePlant } from '../context/PlantContext';

export function useSensores() {
  const { selectedPlant } = usePlant();
  return useQuery({
    queryKey: ['sensores', selectedPlant],
    queryFn: () => fetchSensors(selectedPlant),
    refetchInterval: 30_000,
  });
}
