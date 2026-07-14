import type { OpcSnapshot, PlantDefinition } from '@ptap/shared';

/**
 * @deprecated Camino de datos legado (pre-puente crudo). Se ELIMINA cuando la Fase 3
 * tenga el Mapping Engine. No añadir consumidores nuevos. Ver docs/DEPRECATION.md.
 */
export interface IndustrialReaderPort {
  listPlants(): PlantDefinition[];
  readSnapshot(plantId: string): Promise<OpcSnapshot>;
}
