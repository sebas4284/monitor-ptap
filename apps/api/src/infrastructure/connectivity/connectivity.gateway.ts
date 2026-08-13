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
import { hasPermission } from '@ptap/shared';
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
 * Ámbito de plantas de un socket. `plant: null` = todas — solo lo obtiene `view_all_plants` (hoy
 * el Admin) y el arranque de demo sin login.
 */
interface SocketScope {
  plant: string | null;
}

/** Room de ámbito de quien ve TODAS las plantas. */
const SCOPE_ALL = 'scope:*';

/**
 * Room de ámbito, SEPARADA de la room de planta a la que se entra con `opc:subscribe`.
 *
 * Son dos cosas distintas a propósito: la de planta cambia al navegar (y se recicla en cada
 * `opc:subscribe`), mientras que la de ámbito dura toda la conexión. Sin esa separación no se
 * podría acotar `opc:liveness`, que hay que entregar aunque el cliente no esté mirando ninguna
 * planta concreta — es lo que pinta los badges del tablero.
 */
function scopeRoomOf(plant: string | null): string {
  return plant === null ? SCOPE_ALL : `scope:${plant}`;
}

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
 *
 * ÁMBITO POR PLANTA: autenticar no basta. Antes se validaba el JWT y se DESCARTABA el payload, de
 * modo que cualquier cuenta autenticada podía pedir `opc:subscribe` de cualquier planta y recibir
 * su telemetría en vivo — datos de proceso completos, no solo avisos. Lo tapaba que el móvil solo
 * pide la suya. Ahora el ámbito sale del token y se aplica tanto a `opc:subscribe` como a
 * `opc:liveness`, con la misma regla del resto del sistema: `view_all_plants` ve todo, el resto
 * su planta.
 *
 * ⚠️ El ámbito sale del TOKEN, no de la base — este módulo es DB-free a propósito (ver arriba), y
 * acoplarle MySQL sería un cambio mayor. Consecuencia real: si un admin cambia la planta o el rol
 * de alguien, su socket YA ABIERTO conserva el ámbito viejo hasta que reconecte (como mucho 8 h,
 * la vida del JWT). El camino HTTP sí es inmediato, porque `JwtAuthGuard` relee la fila en cada
 * petición. No leer esto como una garantía más fuerte de lo que es.
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

  /**
   * Autentica el handshake y FIJA el ámbito: sin JWT válido se corta la conexión antes de que
   * pueda suscribirse; con él, el socket queda marcado con las plantas que le corresponden.
   */
  async handleConnection(client: Socket): Promise<void> {
    if (process.env.SOCKET_AUTH_REQUIRED === 'false') {
      // Demo sin login (main.telemetry.ts): no hay identidad, así que no hay ámbito que aplicar.
      await this.applyScope(client, { plant: null });
      return;
    }

    const token = (client.handshake.auth as { token?: string } | undefined)?.token;
    try {
      if (!token) throw new Error('sin token en el handshake');
      const payload = (this.jwt ??= new JwtService()).verify(token);
      const plant = hasPermission(payload.role, 'view_all_plants') ? null : payload.plant;
      await this.applyScope(client, { plant });
    } catch {
      this.logger.warn(`socket rechazado: handshake sin JWT válido (${client.id})`);
      client.disconnect(true);
    }
  }

  private async applyScope(client: Socket, scope: SocketScope): Promise<void> {
    (client.data as { scope?: SocketScope }).scope = scope;
    await client.join(scopeRoomOf(scope.plant));
  }

  onModuleInit(): void {
    this.subs.push(
      this.pipeline.snapshot$.subscribe((snapshot) => {
        this.server.to(snapshot.plantId).emit('opc:snapshot', snapshot);
      }),
    );
    this.subs.push(
      this.pipeline.liveness$.subscribe((change) => {
        // Badges del tablero, pero SOLO a quien puede ver esa planta. Antes era un broadcast
        // global que repartía el estado de las doce a todo el mundo. Es seguro acotarlo: el
        // listado de plantas ya viene filtrado, así que un no-admin nunca pinta badges ajenos.
        this.server.to([scopeRoomOf(change.plantId), SCOPE_ALL]).emit('opc:liveness', change);
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

    if (!this.puedeVer(client, plantId)) {
      const scope = (client.data as { scope?: SocketScope }).scope;
      this.logger.warn(
        `socket ${client.id} pidió la planta "${plantId}", fuera de su ámbito (${scope?.plant ?? 'sin ámbito'})`,
      );
      // Rechazo EXPLÍCITO, no silencio. Mismo criterio que PlantScopeGuard: un mensaje claro evita
      // que el operador pierda el tiempo creyendo que es una avería, ante una pantalla vacía.
      client.emit('opc:denied', {
        plantId,
        reason: 'Tu cuenta solo tiene acceso a la planta asignada',
      });
      return;
    }

    // Sale de la room de la planta anterior, pero CONSERVA la de ámbito: si se saliera de ella,
    // el socket dejaría de recibir `opc:liveness` y los badges del tablero se congelarían.
    for (const room of client.rooms) {
      if (room !== client.id && !room.startsWith('scope:')) await client.leave(room);
    }
    await client.join(plantId);

    // Estado actual desde cache (nunca toca el PLC).
    client.emit('opc:snapshot', this.cache.get(plantId));
  }

  /**
   * Autorización por planta. Falla CERRADO: un socket sin ámbito (fallo de wiring, o un
   * `handleConnection` que no llegó a correr) no accede a nada, en vez de acceder a todo.
   */
  private puedeVer(client: Socket, plantId: string): boolean {
    const scope = (client.data as { scope?: SocketScope }).scope;
    if (!scope) return false;
    return scope.plant === null || scope.plant === plantId;
  }

  /** Sale de la room de una planta: el cliente deja de recibir sus snapshots (al desmontar la
   *  pantalla). Sin esto el servidor seguía empujando la planta a un socket que ya no la mira. */
  @SubscribeMessage('opc:unsubscribe')
  async unsubscribeFromPlant(
    @MessageBody() payload: { plantId?: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    if (payload?.plantId) await client.leave(payload.plantId);
  }
}
