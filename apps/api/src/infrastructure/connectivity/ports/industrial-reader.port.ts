import type { OpcSnapshot, PlantDefinition } from '@ptap/shared';

export interface IndustrialReaderPort {
  listPlants(): PlantDefinition[];
  readSnapshot(plantId: string): Promise<OpcSnapshot>;
}
