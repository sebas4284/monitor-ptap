import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Inject, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { Subscription } from 'rxjs';
import { JwtService } from '../../modules/auth/jwt.service';
import { readHttpHardeningConfig } from '../http-hardening.config';
import { PlantCache } from './pipeline/plant-cache';
import { PlantPipelineService } from './pipeline/plant-pipeline.service';

/**
 * Origen CORS del WebSocket: la MISMA allowlist que el HTTP (CORS_ORIGINS). Fallback a '*' solo
 * si no está definida — el arranque de telemetría/demo (main.telemetry.ts) no fija CORS_ORIGINS y
 * necesita aceptar cualquier origen. El JWT del handshake (SRV-04) sigue siendo la defensa real;
 * esto es defensa en profundidad para que un origen no permitido ni siquiera intente el handshake.
 */
const wsCorsOrigin = readHttpHardeningConfig().corsOrigins ?? '*';

/**
 * Gateway Socket.IO del pipeline de dominio (PASO 3.7). Empuja:
 *   - opc:snapshot  → a la room de la planta, SOLO cuando el snapshot cambia (diff en el pipeline).
 *   - opc:liveness  → broadcast, en cada cambio de estado de liveness (para los badges del tablero).
 *
 * Dependencias OBLIGATORIAS (sin @Optional): viven en este mismo módulo, así que si la
 * inyección falla es un bug de wiring y Nest debe morir en el arranque — no degradarse en
 * silencio a un "modo pasivo" que parece funcionar sin emitir nada (hallazgo P3-6 del audit).
 *
 * SEGURIDAD (SRV-04): el handshake se autentica con el mismo JWT del login (el móvil lo envía en
 * `handshake.auth.token`). Sin token válido se rechaza la conexión, así que la telemetría en vivo
 * ya no es legible por cualquier cliente con red al backend. Se puede desactivar con
 * `SOCKET_AUTH_REQUIRED=false` — solo lo hace `main.telemetry.ts` (demo sin login ni BD).
 * `JwtService` es DB-free: verificarlo aquí NO acopla MySQL a este módulo.
 */
@WebSocketGateway({ cors: { origin: wsCorsOrigin } })
export class ConnectivityGateway implements OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(ConnectivityGateway.name);
  private readonly subs: Subscription[] = [];
  /** Perezoso: no se construye (ni lee JWT_SECRET) si la auth está desactivada (demo). */
  private jwt: JwtService | null = null;

  constructor(
    @Inject(PlantPipelineService) private readonly pipeline: PlantPipelineService,
    @Inject(PlantCache) private readonly cache: PlantCache,
  ) {}

  /** Autentica el handshake: sin JWT válido, se corta la conexión antes de que pueda suscribirse. */
  handleConnection(client: Socket): void {
    if (process.env.SOCKET_AUTH_REQUIRED === 'false') return; // demo sin login (main.telemetry.ts)
    const token = (client.handshake.auth as { token?: string } | undefined)?.token;
    try {
      if (!token) throw new Error('sin token en el handshake');
      (this.jwt ??= new JwtService()).verify(token);
    } catch {
      this.logger.warn(`socket rechazado: handshake sin JWT válido (${client.id})`);
      client.disconnect(true);
    }
  }

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
