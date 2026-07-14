import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { ConnectionStatus, OpcSnapshot, PlantDefinition, Sensor, Tank } from '@ptap/shared';
import type { IndustrialReaderPort } from '../../ports/industrial-reader.port';
import type { IndustrialWriterPort } from '../../ports/industrial-writer.port';
import type { ProtocolAdapterPort } from '../../ports/protocol-adapter.port';
import { OpcConfigService } from '../../opc-config.service';

const SENSOR_BASE: Array<Omit<Sensor, 'value' | 'status'> & { value: number }> = [
  { id: 'pressure', name: 'Presion', value: 42.5, unit: 'psi', min: 30, max: 60, icon: 'speedometer-outline' },
  { id: 'flow', name: 'Caudal', value: 187.3, unit: 'm3/h', min: 100, max: 250, icon: 'water-outline' },
  { id: 'ph', name: 'pH', value: 7.2, unit: 'pH', min: 6.5, max: 8.5, icon: 'flask-outline' },
  { id: 'turbidity', name: 'Turbidez', value: 3.8, unit: 'NTU', min: 0, max: 5, icon: 'eye-outline' },
];

const TANK_BASE: Tank[] = [
  { id: 'tank-1', name: 'Tanque 1', percentage: 70, levelM: 3.5, maxLevelM: 5, volumeM3: 350, maxVolumeM3: 500 },
  { id: 'tank-2', name: 'Tanque 2', percentage: 23, levelM: 1.15, maxLevelM: 5, volumeM3: 115, maxVolumeM3: 500 },
  { id: 'tank-3', name: 'Tanque 3', percentage: 85, levelM: 4.25, maxLevelM: 5, volumeM3: 425, maxVolumeM3: 500 },
  { id: 'tank-4', name: 'Tanque 4', percentage: 50, levelM: 2.5, maxLevelM: 5, volumeM3: 250, maxVolumeM3: 500 },
];

@Injectable()
export class SimulatorConnectivityAdapter
  implements IndustrialReaderPort, IndustrialWriterPort, ProtocolAdapterPort
{
  private status: ConnectionStatus = 'mock';
  private readonly resolvedOpcConfig: OpcConfigService;

  constructor(@Optional() @Inject(OpcConfigService) opcConfig?: OpcConfigService) {
    this.resolvedOpcConfig = opcConfig ?? new OpcConfigService();
  }

  async connect(): Promise<void> {
    this.status = 'mock';
  }

  async disconnect(): Promise<void> {
    this.status = 'disconnected';
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  listPlants(): PlantDefinition[] {
    return this.resolvedOpcConfig.listPlants();
  }

  async readSnapshot(plantId: string): Promise<OpcSnapshot> {
    const plant = this.resolvedOpcConfig.getPlant(plantId);
    if (!plant) {
      throw new NotFoundException(`PTAP no configurada: ${plantId}`);
    }

    return {
      plantId: plant.id,
      timestamp: new Date().toISOString(),
      connectionStatus: this.status,
      sensors: SENSOR_BASE.map(sensor => this.makeSensor(sensor, plant.id)),
      tanks: TANK_BASE.map(tank => this.makeTank(tank, plant.id)),
    };
  }

  async writeCommand(): Promise<void> {
    throw new Error('Control real de electroválvulas pendiente de mapeo de bits INT.');
  }

  private makeSensor(sensor: (typeof SENSOR_BASE)[number], plantId: string): Sensor {
    const numericPlant = Number(plantId.replace('ptap-', '')) || 1;
    const value = this.round(sensor.value + Math.sin(Date.now() / 30_000 + numericPlant) * 1.8);
    const status = value < sensor.min || value > sensor.max ? 'error' : value > sensor.max * 0.85 ? 'warning' : 'ok';
    return { ...sensor, value, status };
  }

  private makeTank(tank: Tank, plantId: string): Tank {
    const numericPlant = Number(plantId.replace('ptap-', '')) || 1;
    const percentage = Math.min(100, Math.max(0, this.round(tank.percentage + Math.cos(Date.now() / 45_000 + numericPlant) * 2)));
    return {
      ...tank,
      percentage,
      levelM: this.round((percentage / 100) * tank.maxLevelM),
      volumeM3: Math.round((percentage / 100) * tank.maxVolumeM3),
    };
  }

  private round(value: number): number {
    return Math.round(value * 10) / 10;
  }
}
