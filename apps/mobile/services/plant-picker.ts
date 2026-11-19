import type { PlantListItem } from '@ptap/shared';
import type { PlantOption } from '../context/PlantContext';
import { plantStatus, type PlantStatus } from './plant-status';

export type PlantFilter = 'todas' | 'linea' | 'sin';

export const PLANT_FILTERS: { id: PlantFilter; label: string }[] = [
  { id: 'todas', label: 'Todas' },
  { id: 'linea', label: 'En línea' },
  { id: 'sin', label: 'Sin conexión' },
];

export interface PickerRow {
  plant: PlantOption;
  /** null = el servidor no ha informado esta planta (cargando, error o ausente): no se inventa estado. */
  status: PlantStatus | null;
}

/** Minúsculas y sin tildes: "pichinde" encuentra "Pichindé". */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Une el catálogo de plantas con el estado en vivo de `GET /api/plants`, en el orden del catálogo. */
export function pickerRows(
  plants: PlantOption[],
  live: PlantListItem[] | undefined,
  now: Date = new Date(),
): PickerRow[] {
  const byId = new Map((live ?? []).map((p) => [p.plantId, p]));
  return plants.map((plant) => {
    const item = byId.get(plant.id);
    return { plant, status: item ? plantStatus(item.liveness, item.bridgeStatus, now) : null };
  });
}

/**
 * Búsqueda por nombre + filtro por estado. Una planta sin estado conocido solo aparece en "Todas":
 * no consta ni como "En línea" ni como "Sin conexión".
 */
export function filterRows(rows: PickerRow[], query: string, filter: PlantFilter): PickerRow[] {
  const q = normalize(query);
  return rows.filter(({ plant, status }) => {
    if (q && !normalize(plant.name).includes(q)) return false;
    if (filter === 'linea') return status?.online === true;
    if (filter === 'sin') return status?.online === false;
    return true;
  });
}
