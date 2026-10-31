import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Inject, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { Subscription } from 'rxjs';
import { hasPermission, ROLES, type Role } from '@ptap/shared';
import { JwtService } from '../../modules/auth/jwt.service';
import { readHttpHardeningConfig } from '../http-hardening.config';
import { PlantCache } from './pipeline/plant-cache';
import { PlantPipelineService } from './pipeline/plant-pipeline.service';

export const SOCKET_IDENTITY = Symbol('SOCKET_IDENTITY');
export interface SocketIdentity { id: string; role: Role; plant: string }
export type SocketIdentityResolver = (id: string) => Promise<SocketIdentity | null>;
interface Session {
  user: SocketIdentity;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
}
interface SocketScope { plant: string | null }
const SCOPE_ALL = 'scope:*';
const scopeRoomOf = (plant: string | null) => plant === null ? SCOPE_ALL : `scope:${plant}`;
const wsCorsOrigin = readHttpHardeningConfig().corsOrigins ?? '*';

/** Full application resolves current account state before each delivery, never token role claims.
 * The DB-free demo explicitly provides no resolver and cannot run with production auth disabled. */
@WebSocketGateway({ cors: { origin: wsCorsOrigin } })
export class ConnectivityGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() private server!: Server;
  private readonly logger = new Logger(ConnectivityGateway.name);
  private readonly subs: Subscription[] = [];
  private readonly sessions = new Map<Socket, Session>();
  private jwt: JwtService | null = null;
  private sweep: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PlantPipelineService) private readonly pipeline: PlantPipelineService,
    @Inject(PlantCache) private readonly cache: PlantCache,
    @Optional() @Inject(SOCKET_IDENTITY) private readonly resolveIdentity?: SocketIdentityResolver,
  ) {}

  private get demo(): boolean {
    return process.env.SOCKET_AUTH_REQUIRED === 'false' && process.env.NODE_ENV !== 'production';
  }

  async handleConnection(client: Socket): Promise<void> {
    if (this.demo) {
      await this.applyScope(client, { plant: null });
      return;
    }
    try {
      const token = client.handshake.auth?.token;
      if (typeof token !== 'string' || !this.resolveIdentity) throw new Error('sin autenticación');
      const payload = (this.jwt ??= new JwtService()).verify(token);
      const exp = (payload as { exp?: number }).exp;
      if (!Number.isFinite(exp) || !exp || exp * 1000 <= Date.now()) throw new Error('sin vigencia');
      const user = await this.resolveIdentity(payload.sub);
      if (!this.allowed(user) || exp * 1000 <= Date.now()) throw new Error('cuenta sin acceso');
      this.handleDisconnect(client);
      const timer = setTimeout(() => this.reject(client), Math.min(exp * 1000 - Date.now(), 2_147_483_647));
      timer.unref?.();
      this.sessions.set(client, { user, expiresAt: exp * 1000, timer });
      await this.applyScope(client, { plant: hasPermission(user.role, 'view_all_plants') ? null : user.plant });
    } catch {
      this.logger.warn(`socket rechazado (${client.id})`);
      this.reject(client);
    }
  }

  private allowed(user: SocketIdentity | null): user is SocketIdentity {
    return Boolean(user && ROLES.includes(user.role) && hasPermission(user.role, 'view_dashboard') &&
      (hasPermission(user.role, 'view_all_plants') || user.plant));
  }

  private async applyScope(client: Socket, scope: SocketScope): Promise<void> {
    client.data.scope = scope;
    await client.join(scopeRoomOf(scope.plant));
  }

  handleDisconnect(client: Socket): void {
    const session = this.sessions.get(client);
    if (session) clearTimeout(session.timer);
    this.sessions.delete(client);
    delete client.data.scope;
  }

  private reject(client: Socket): void {
    this.handleDisconnect(client);
    client.disconnect(true);
  }

  private async authorized(client: Socket): Promise<boolean> {
    if (this.demo) return Boolean(client.data.scope);
    const session = this.sessions.get(client);
    if (!session || session.expiresAt <= Date.now() || !this.resolveIdentity) {
      this.reject(client);
      return false;
    }
    try {
      const user = await this.resolveIdentity(session.user.id);
      // A concurrent disconnect/reconnect must not revive an older in-flight authorization.
      if (this.sessions.get(client) !== session) return false;
      if (!this.allowed(user) || user.role !== session.user.role || user.plant !== session.user.plant ||
        session.expiresAt <= Date.now()) {
        this.reject(client);
        return false;
      }
      return true;
    } catch {
      this.reject(client);
      return false;
    }
  }

  /** Also checks idle connections; deliveries always perform their own current-state check. */
  async revalidateConnections(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((client) => this.authorized(client)));
  }

  private async deliver(event: string, plantId: string, value: unknown, snapshot: boolean): Promise<void> {
    if (this.demo) {
      this.server.to(snapshot ? plantId : [scopeRoomOf(plantId), SCOPE_ALL]).emit(event, value);
      return;
    }
    await Promise.all([...this.sessions.keys()].map(async (client) => {
      if (snapshot && !client.rooms.has(plantId)) return;
      if (await this.authorized(client) && this.canSee(client, plantId)) client.emit(event, value);
    }));
  }

  onModuleInit(): void {
    this.subs.push(this.pipeline.snapshot$.subscribe((value) => { void this.deliver('opc:snapshot', value.plantId, value, true); }));
    this.subs.push(this.pipeline.liveness$.subscribe((value) => { void this.deliver('opc:liveness', value.plantId, value, false); }));
    this.sweep = setInterval(() => { void this.revalidateConnections(); }, 30_000);
    this.sweep.unref?.();
  }

  onModuleDestroy(): void {
    for (const sub of this.subs) sub.unsubscribe();
    if (this.sweep) clearInterval(this.sweep);
    for (const client of this.sessions.keys()) this.reject(client);
  }

  @SubscribeMessage('opc:subscribe')
  async subscribeToPlant(@MessageBody() payload: { plantId?: string }, @ConnectedSocket() client: Socket): Promise<void> {
    const plantId = payload?.plantId;
    if (typeof plantId !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(plantId)) return;
    if (!await this.authorized(client)) return;
    if (!this.canSee(client, plantId)) {
      client.emit('opc:denied', { plantId, reason: 'Tu cuenta solo tiene acceso a la planta asignada' });
      return;
    }
    for (const room of client.rooms) {
      if (room !== client.id && !room.startsWith('scope:')) await client.leave(room);
    }
    await client.join(plantId);
    // join may yield: recheck before releasing the cached detail.
    if (await this.authorized(client) && this.canSee(client, plantId)) client.emit('opc:snapshot', this.cache.get(plantId));
  }

  private canSee(client: Socket, plantId: string): boolean {
    const scope = client.data.scope as SocketScope | undefined;
    return Boolean(scope && (scope.plant === null || scope.plant === plantId));
  }

  @SubscribeMessage('opc:unsubscribe')
  async unsubscribeFromPlant(@MessageBody() payload: { plantId?: string }, @ConnectedSocket() client: Socket): Promise<void> {
    if (typeof payload?.plantId === 'string' && !payload.plantId.startsWith('scope:') && payload.plantId !== client.id) {
      await client.leave(payload.plantId);
    }
  }
}
