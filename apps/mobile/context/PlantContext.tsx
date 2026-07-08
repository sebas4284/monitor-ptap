import React, { createContext, useContext, useEffect, useState } from 'react';
import { fetchPlants } from '../services/api';

export type Plant = string;

interface PlantContextType {
  selectedPlant: Plant;
  setSelectedPlant: (plant: Plant) => void;
  plants: Plant[];
}

const PlantContext = createContext<PlantContextType | null>(null);

export function PlantProvider({ children }: { children: React.ReactNode }) {
  const [plants, setPlants] = useState<Plant[]>([]);
  const [selectedPlant, setSelectedPlant] = useState<Plant>('');

  useEffect(() => {
    fetchPlants()
      .then(data => {
        const nextPlants = data.map(plant => plant.id);
        setPlants(nextPlants);
        if (!selectedPlant && nextPlants.length > 0) {
          setSelectedPlant(nextPlants[0]);
        }
      })
      .catch(() => {
        setPlants([]);
      });
  }, []);

  return (
    <PlantContext.Provider value={{ selectedPlant, setSelectedPlant, plants }}>
      {children}
    </PlantContext.Provider>
  );
}

export function usePlant() {
  const ctx = useContext(PlantContext);
  if (!ctx) throw new Error('usePlant must be used within PlantProvider');
  return ctx;
}
