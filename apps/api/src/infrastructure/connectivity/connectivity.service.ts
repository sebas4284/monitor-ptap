import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import type { OpcSnapshot, PlantDefinition } from '@ptap/shared';
import { Subject } from 'rxjs';
import { CONNECTIVITY_CONFIG, INDUSTRIAL_READER, PROTOCOL_ADAPTER } from './connectivity.tokens';
import type { ConnectivityConfig } from './connectivity.config';
import type { IndustrialReaderPort } from './ports/industrial-reader.port';
import type { ProtocolAdapterPort } from './ports/protocol-adapter.port';
import { OpcConfigService } from './opc-config.service';
import { RawFrameCache } from './raw-frame-cache';

@Injectable()
export class ConnectivityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConnectivityService.name);
  private readonly snapshots = new Map<string, OpcSnapshot>();
  private poller?: NodeJS.Timeout;
  private readonly resolvedOpcConfig: OpcConfigService;

  readonly snapshot$ = new Subject<OpcSnapshot>();

  constructor(
    @Inject(INDUSTRIAL_READER) private readonly reader: IndustrialReaderPort,
    @Inject(PROTOCOL_ADAPTER) private readonly adapter: ProtocolAdapterPort,
    @Inject(CONNECTIVITY_CONFIG) private readonly config: ConnectivityConfig,
    @Inject(RawFrameCache) private readonly rawFrameCache: RawFrameCache,
    @Optional() @Inject(OpcConfigService) opcConfig?: OpcConfigService,
  ) {
    this.resolvedOpcConfig = opcConfig ?? new OpcConfigService();
  }

  async onModuleInit(): Promise<void> {
    await this.adapter.connect();
    await this.pollOnce();
    this.poller = setInterval(() => void this.pollOnce(), this.resolvedOpcConfig.getPollingIntervalMs());
  }

  async onModuleDestroy(): Promise<void> {
    if (this.poller) {
      clearInterval(this.poller);
    }
    this.snapshot$.complete();
    await this.adapter.disconnect();
  }

  listPlants(): PlantDefinition[] {
    return this.reader.listPlants();
  }

  async getSnapshot(plantId: string): Promise<OpcSnapshot> {
    const cached = this.snapshots.get(plantId);
    if (cached) {
      return cached;
    }

    if (this.config.provider === 'opcua') {
      const frame = this.rawFrameCache.getLastFrame(plantId);
      if (frame) {
        return {
          plantId,
          timestamp: frame.receivedAt,
          connectionStatus: 'connected',
          sensors: frame.buffers
            .filter((buffer) => buffer.values.length > 0)
            .slice(0, 4)
            .map((buffer, index) => ({
              id: `${buffer.browseName}-${index}`,
              name: buffer.browseName,
              value: typeof buffer.values[0] === 'number' ? Number(buffer.values[0]) : 0,
              unit: buffer.channel,
              min: 0,
              max: 100,
              status: 'ok',
              icon: 'pulse-outline',
            })),
          tanks: [],
        };
      }

      return {
        plantId,
        timestamp: new Date().toISOString(),
        connectionStatus: 'connected',
        sensors: [],
        tanks: [],
      };
    }

    return this.reader.readSnapshot(plantId);
  }

  private async pollOnce(): Promise<void> {
    for (const plant of this.reader.listPlants()) {
      try {
        const snapshot = await this.getSnapshot(plant.id);
        this.snapshots.set(plant.id, snapshot);
        this.snapshot$.next(snapshot);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`No se pudo leer snapshot de ${plant.id}: ${message}`);
      }
    }
  }
}
