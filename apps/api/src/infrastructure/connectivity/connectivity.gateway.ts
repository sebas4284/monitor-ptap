import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Inject, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { Subscription } from 'rxjs';
import { PlantCache } from './pipeline/plant-cache';
import { PlantPipelineService } from './pipeline/plant-pipeline.service';

/**
 * Gateway Socket.IO del pipeline de dominio (PASO 3.7). Empuja:
 *   - opc:snapshot  → a la room de la planta, SOLO cuando el snapshot cambia (diff en el pipeline).
 *   - opc:liveness  → broadcast, en cada cambio de estado de liveness (para los badges del tablero).
 * La fuente es el puente crudo (PlantPipelineService), no el poller legado.
 */
@WebSocketGateway({ cors: { origin: '*' } })
export class ConnectivityGateway implements OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(ConnectivityGateway.name);
  private readonly subs: Subscription[] = [];

  constructor(
    @Optional() @Inject(PlantPipelineService) private readonly pipeline?: PlantPipelineService,
    @Optional() @Inject(PlantCache) private readonly cache?: PlantCache,
  ) {}

  onModuleInit(): void {
    if (!this.pipeline) {
      this.logger.warn('PlantPipelineService no disponible; el gateway queda en modo pasivo.');
      return;
    }
    this.subs.push(
      this.pipeline.snapshot$.subscribe((snapshot) => {
        this.server.to(snapshot.plantId).emit('opc:snapshot', snapshot);
      }),
    );
    this.subs.push(
      this.pipeline.liveness$.subscribe((change) => {
        this.server.emit('opc:liveness', change); // broadcast: badges del tablero
      }),
    );
  }

  onModuleDestroy(): void {
    for (const s of this.subs) s.unsubscribe();
  }

  @SubscribeMessage('opc:subscribe')
  async subscribeToPlant(
    @MessageBody() payload: { plantId?: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const plantId = payload?.plantId;
    if (!plantId) return;

    for (const room of client.rooms) {
      if (room !== client.id) await client.leave(room);
    }
    await client.join(plantId);

    // Estado actual desde cache (nunca toca el PLC).
    const snapshot = this.cache?.get(plantId) ?? null;
    client.emit('opc:snapshot', snapshot);
  }
}
