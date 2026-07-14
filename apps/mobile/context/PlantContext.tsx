import React, { createContext, useContext, useState } from 'react';

/** Las 12 plantas canónicas (slug = identidad única del sistema; ver opc_mapping.json). */
export interface PlantOption {
  id: string; // slug canónico
  name: string; // displayName provisional
}

export const PLANTS: PlantOption[] = [
  { id: 'voragine', name: 'La Vorágine' },
  { id: 'soledad', name: 'Soledad' },
  { id: 'montebello', name: 'Montebello' },
  { id: 'cascajal', name: 'Cascajal' },
  { id: 'km18', name: 'Km 18' },
  { id: 'alto-los-mangos', name: 'Alto de los Mangos' },
  { id: 'campoalegre', name: 'Campoalegre' },
  { id: 'pichinde', name: 'Pichindé' },
  { id: 'carbonero', name: 'Carbonero' },
  { id: 'sirena', name: 'La Sirena' },
  { id: 'san-antonio', name: 'San Antonio' },
  { id: 'quijote', name: 'El Quijote' },
];

/** Montebello es la única con caudal real mapeado hoy → arranca seleccionada. */
const DEFAULT_PLANT = PLANTS.find((p) => p.id === 'montebello') ?? PLANTS[0];

interface PlantContextType {
  selectedPlant: PlantOption;
  setSelectedPlant: (plant: PlantOption) => void;
}

const PlantContext = createContext<PlantContextType | null>(null);

export function PlantProvider({ children }: { children: React.ReactNode }) {
  const [selectedPlant, setSelectedPlant] = useState<PlantOption>(DEFAULT_PLANT);

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
