import React, { createContext, useContext, useState } from 'react';

export const PLANTS = ['PTAP Norte', 'PTAP Sur', 'Planta Rio'] as const;
export type Plant = (typeof PLANTS)[number];

interface PlantContextType {
  selectedPlant: Plant;
  setSelectedPlant: (plant: Plant) => void;
}

const PlantContext = createContext<PlantContextType | null>(null);

export function PlantProvider({ children }: { children: React.ReactNode }) {
  const [selectedPlant, setSelectedPlant] = useState<Plant>(PLANTS[0]);

  return (
    <PlantContext.Provider value={{ selectedPlant, setSelectedPlant }}>
      {children}
    </PlantContext.Provider>
  );
}

export function usePlant() {
  const ctx = useContext(PlantContext);
  if (!ctx) throw new Error('usePlant must be used within PlantProvider');
  return ctx;
}
