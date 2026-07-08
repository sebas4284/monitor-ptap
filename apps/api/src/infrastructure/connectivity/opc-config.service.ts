import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlantDefinition } from '@ptap/shared';

interface OpcPlantConfig extends PlantDefinition {
  opcUaEndpoint: string;
  nodeIds: {
    sensorsArray: string;
    tanksArray: string;
    valvesPackedIntArray: string;
  };
  sensorIndexes: Record<string, number>;
  tankIndexes: Record<string, number>;
}

interface OpcConfig {
  metadata: {
    description: string;
    pollingIntervalMs: number;
    valvesMappingStatus: string;
  };
  plants: OpcPlantConfig[];
}

@Injectable()
export class OpcConfigService {
  private readonly config: OpcConfig;

  constructor() {
    const configPath = join(process.cwd(), 'opc-config.json');
    this.config = JSON.parse(readFileSync(configPath, 'utf8')) as OpcConfig;
  }

  getPollingIntervalMs(): number {
    return this.config.metadata.pollingIntervalMs;
  }

  listPlants(): PlantDefinition[] {
    return this.config.plants.map(({ id, name }) => ({ id, name }));
  }

  getPlant(plantId: string): OpcPlantConfig | undefined {
    return this.config.plants.find(plant => plant.id === plantId);
  }
}
