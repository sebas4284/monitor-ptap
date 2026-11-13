import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';

/** Las 16 plantas canónicas (slug = identidad única del sistema; ver opc_mapping.json). */
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
  // En integración (2026-10-19): aún sin señales en el PLC maestro. Mismo orden que el mapping.
  { id: 'cabuyo', name: 'Cabuyo' },
  { id: 'luisa', name: 'La Luisa' },
  { id: 'leonera', name: 'La Leonera' },
  { id: 'gloria', name: 'Gloria' },
];

/** Planta mostrada antes de saber quién ha iniciado sesión (las pantallas viven tras el login). */
const DEFAULT_PLANT = PLANTS.find((p) => p.id === 'montebello') ?? PLANTS[0];

/**
 * Planta del usuario. Si su slug no está en el catálogo, se devuelve tal cual en vez de caer a
 * otra planta: es preferible mostrar un nombre feo (o un 404 honesto) que enseñarle en silencio
 * los datos de una planta que no es la suya.
 */
function plantOf(plantSlug: string | undefined): PlantOption {
  if (!plantSlug) return DEFAULT_PLANT;
  return PLANTS.find((p) => p.id === plantSlug) ?? { id: plantSlug, name: plantSlug };
}

interface PlantContextType {
  selectedPlant: PlantOption;
  setSelectedPlant: (plant: PlantOption) => void;
  /** true si el usuario puede cambiar de planta (permiso `view_all_plants`; hoy solo Admin). */
  canSwitchPlant: boolean;
}

const PlantContext = createContext<PlantContextType | null>(null);

/**
 * La planta NO es una preferencia libre de la interfaz: es el ámbito de la cuenta. Cada usuario
 * está vinculado a una planta (`user.plant`) y el backend rechaza con 403 cualquier otra, salvo
 * que tenga `view_all_plants` (Admin). Aquí se refleja esa misma regla para que la interfaz no
 * ofrezca algo que el servidor va a negar.
 */
export function PlantProvider({ children }: { children: React.ReactNode }) {
  const { user, hasPermission } = useAuth();
  const canSwitchPlant = hasPermission('view_all_plants');
  const [selection, setSelection] = useState<{ owner: typeof user; plant: PlantOption } | null>(
    null,
  );
  // Resolver antes de pintar evita consultar la planta anterior durante la restauración de sesión.
  const selectedPlant = useMemo(
    () => (canSwitchPlant && selection?.owner === user ? selection.plant : plantOf(user?.plant)),
    [canSwitchPlant, selection, user],
  );

  const selectPlant = useCallback(
    (plant: PlantOption) => {
      if (!canSwitchPlant) return; // el selector ni siquiera se muestra; esto es la red de seguridad
      setSelection({ owner: user, plant });
    },
    [canSwitchPlant, user],
  );

  // Memoizado por la misma razón que AuthContext: envuelve toda la app, y un objeto literal nuevo
  // en cada render obligaba a re-renderizar a todos los consumidores de `usePlant()`.
  const value = useMemo(
    () => ({ selectedPlant, setSelectedPlant: selectPlant, canSwitchPlant }),
    [selectedPlant, selectPlant, canSwitchPlant],
  );

  return <PlantContext.Provider value={value}>{children}</PlantContext.Provider>;
}

export function usePlant() {
  const ctx = useContext(PlantContext);
  if (!ctx) throw new Error('usePlant must be used within PlantProvider');
  return ctx;
}
