import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { OpcSnapshot, PlantDefinition } from '@ptap/shared';
import { Subject } from 'rxjs';
import { INDUSTRIAL_READER, PROTOCOL_ADAPTER } from './connectivity.tokens';
import type { IndustrialReaderPort } from './ports/industrial-reader.port';
import type { ProtocolAdapterPort } from './ports/protocol-adapter.port';
import { OpcConfigService } from './opc-config.service';

@Injectable()
export class ConnectivityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConnectivityService.name);
  private readonly snapshots = new Map<string, OpcSnapshot>();
  private poller?: NodeJS.Timeout;

  readonly snapshot$ = new Subject<OpcSnapshot>();

  constructor(
    @Inject(INDUSTRIAL_READER) private readonly reader: IndustrialReaderPort,
    @Inject(PROTOCOL_ADAPTER) private readonly adapter: ProtocolAdapterPort,
    private readonly opcConfig: OpcConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.adapter.connect();
    await this.pollOnce();
    this.poller = setInterval(() => void this.pollOnce(), this.opcConfig.getPollingIntervalMs());
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
    return this.reader.readSnapshot(plantId);
  }

  private async pollOnce(): Promise<void> {
    for (const plant of this.reader.listPlants()) {
      try {
        const snapshot = await this.reader.readSnapshot(plant.id);
        this.snapshots.set(plant.id, snapshot);
        this.snapshot$.next(snapshot);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`No se pudo leer snapshot de ${plant.id}: ${message}`);
      }
    }
  }
}
