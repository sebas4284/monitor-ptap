import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Inject, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { Subscription } from 'rxjs';
import { PlantCache } from './pipeline/plant-cache';
import { PlantPipelineService } from './pipeline/plant-pipeline.service';

/**
 * Gateway Socket.IO del pipeline de dominio (PASO 3.7). Empuja:
 *   - opc:snapshot  → a la room de la planta, SOLO cuando el snapshot cambia (diff en el pipeline).
 *   - opc:liveness  → broadcast, en cada cambio de estado de liveness (para los badges del tablero).
 *
 * Dependencias OBLIGATORIAS (sin @Optional): viven en este mismo módulo, así que si la
 * inyección falla es un bug de wiring y Nest debe morir en el arranque — no degradarse en
 * silencio a un "modo pasivo" que parece funcionar sin emitir nada (hallazgo P3-6 del audit).
 *
 * Gap conocido: este gateway NO autentica el handshake (ver docs/SECURITY_FINDING_P0.md §6).
 */
@WebSocketGateway({ cors: { origin: '*' } })
export class ConnectivityGateway implements OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(ConnectivityGateway.name);
  private readonly subs: Subscription[] = [];

  constructor(
    @Inject(PlantPipelineService) private readonly pipeline: PlantPipelineService,
    @Inject(PlantCache) private readonly cache: PlantCache,
  ) {}

  onModuleInit(): void {
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
    client.emit('opc:snapshot', this.cache.get(plantId));
  }
}
