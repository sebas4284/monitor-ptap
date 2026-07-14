import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import {
  AttributeIds,
  ClientMonitoredItem,
  ClientSession,
  ClientSubscription,
  DataValue,
  MessageSecurityMode,
  OPCUACertificateManager,
  OPCUAClient,
  resolveNodeId,
  SecurityPolicy,
  TimestampsToReturn,
  UserTokenType,
} from 'node-opcua';
import type { UserIdentityInfo } from 'node-opcua';
import { BridgeStateMachine } from '../../bridge/bridge-state-machine';
import { Watchdog } from '../../bridge/watchdog';
import type { OpcUaConfig } from '../../connectivity.config';
import type { LoadedMapping, MonitorTarget } from '../../mapping/opc-mapping.loader';
import { NamespaceNotFoundError, resolveNamespaces } from '../../opcua/namespace-resolver';
import type {
  AdapterDiagnostics,
  BridgeStatus,
  BufferHealth,
  ConnectivityAdapter,
  OpcQuality,
  RawBufferSample,
  RawPlantFrame,
  ServerInfo,
} from '../../ports/connectivity-adapter.port';

interface ResolvedTarget extends MonitorTarget {
  nodeId: string;
  resolved: boolean;
  faultReason: string | null;
}

const SECURITY_MODES: Record<string, MessageSecurityMode> = {
  None: MessageSecurityMode.None,
  Sign: MessageSecurityMode.Sign,
  SignAndEncrypt: MessageSecurityMode.SignAndEncrypt,
};

function toSecurityPolicy(name: string): SecurityPolicy {
  const key = name as keyof typeof SecurityPolicy;
  const value = SecurityPolicy[key];
  return typeof value === 'string' ? (value as SecurityPolicy) : SecurityPolicy.None;
}

/** Severidad Good (bits 30-31 == 0) del StatusCode, sin depender de igualdad por referencia. */
function isGoodStatus(sc: { value: number }): boolean {
  return ((sc.value >>> 30) & 0x3) === 0;
}

const SERVER_STATES = ['Running', 'Failed', 'NoConfiguration', 'Suspended', 'Shutdown', 'Test', 'CommunicationFault', 'Unknown'];
function serverStateName(raw: unknown): string | null {
  if (typeof raw !== 'number') return raw != null ? String(raw) : null;
  return SERVER_STATES[raw] ?? String(raw);
}

/**
 * Adaptador OPC UA real. Push-based: los datos llegan por una Subscription
 * (regla 6: 1 MonitoredItem por buffer). Máquina de estados BridgeStatus,
 * reconexión con backoff, watchdog, heartbeat y verificación de NodeIds al conectar.
 * No conoce la PTAP (regla 3): solo endpoints, NodeIds y buffers crudos.
 */
export class OpcUaConnectivityAdapter implements ConnectivityAdapter {
  readonly provider = 'opcua' as const;

  private readonly logger = new Logger('OpcUaBridge');
  private readonly bridge = new BridgeStateMachine(this.logger, 'opcua');
  private readonly watchdog: Watchdog;
  private readonly frameListeners = new Set<(f: RawPlantFrame) => void>();

  private client: OPCUAClient | null = null;
  private session: ClientSession | null = null;
  private subscription: ClientSubscription | null = null;
  private monitoredItems: ClientMonitoredItem[] = [];
  private heartbeatTimer: NodeJS.Timeout | null = null;

  private targets: ResolvedTarget[] = [];
  private nsMap = new Map<string, number>();

  private reconnectCount = 0;
  private recycleCount = 0;
  private notificationsTotal = 0;
  private lastNotificationAt: string | null = null;
  private lastNotificationLatencyMs: number | null = null;
  private readonly lastFrameByPlant = new Map<string, string>();
  private starting = false;

  constructor(
    private readonly config: OpcUaConfig,
    private readonly mapping: LoadedMapping,
  ) {
    this.watchdog = new Watchdog(config.watchdogTimeoutMs, () => void this.onWatchdogTimeout());
  }

  // ── ciclo de vida ──────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.starting || this.bridge.is('Connected')) return;
    this.starting = true;
    this.bridge.transition('Connecting', `conectando a ${this.config.endpoint}`);
    try {
      this.client = this.createClient();
      this.wireClientEvents(this.client);
      this.logger.log(`conectando a ${this.config.endpoint} (${this.config.securityMode}/${this.config.securityPolicy})`);
      await this.client.connect(this.config.endpoint);
      this.logger.log('canal seguro abierto; creando sesión');
      this.session = await this.client.createSession(this.buildIdentity());
      this.logger.log('sesión abierta; resolviendo NodeIds');
      await this.resolveTargets();
      await this.setupSubscription();
      this.startHeartbeat();
      this.watchdog.start();
      this.bridge.transition('Connected', 'sesión + subscription listas');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof NamespaceNotFoundError) {
        // Config/servidor equivocado: no se arregla reintentando.
        this.bridge.transition('Faulted', `namespace no resuelto: ${message}`);
      } else {
        this.bridge.transition('Disconnected', `fallo al conectar: ${message}`);
      }
      await this.teardownSession().catch(() => undefined);
      throw err;
    } finally {
      this.starting = false;
    }
  }

  async stop(): Promise<void> {
    this.watchdog.stop();
    this.stopHeartbeat();
    await this.teardownSession().catch(() => undefined);
    if (this.client) await this.client.disconnect().catch(() => undefined);
    this.client = null;
    this.bridge.transition('Disconnected', 'stop()');
  }

  getBridgeStatus(): BridgeStatus {
    return this.bridge.get();
  }
  onFrame(listener: (frame: RawPlantFrame) => void): void {
    this.frameListeners.add(listener);
  }
  onStatusChange(listener: (status: BridgeStatus, reason: string) => void): void {
    this.bridge.onChange(listener);
  }

  // ── conexión ───────────────────────────────────────────────────────────────

  private createClient(): OPCUAClient {
    return OPCUAClient.create({
      applicationName: 'monitor-ptap-gateway',
      endpointMustExist: this.config.endpointMustExist,
      securityMode: SECURITY_MODES[this.config.securityMode] ?? MessageSecurityMode.None,
      securityPolicy: toSecurityPolicy(this.config.securityPolicy),
      connectionStrategy: {
        initialDelay: this.config.reconnectInitialDelayMs,
        maxDelay: this.config.reconnectMaxDelayMs,
        maxRetry: this.config.reconnectMaxRetry,
      },
      keepSessionAlive: true,
      clientCertificateManager: new OPCUACertificateManager({
        // cwd del backend es apps/api (npm -w @ptap/api). PKI del cliente OPC UA (gitignored).
        rootFolder: join(process.cwd(), 'pki'),
        automaticallyAcceptUnknownCertificate: true,
      }),
    });
  }

  private buildIdentity(): UserIdentityInfo {
    if (this.config.identity.type === 'username') {
      return {
        type: UserTokenType.UserName,
        userName: this.config.identity.userName,
        password: this.config.identity.password,
      };
    }
    return { type: UserTokenType.Anonymous };
  }

  private wireClientEvents(client: OPCUAClient): void {
    client.on('connection_lost', () => {
      this.watchdog.stop();
      this.bridge.transition('Recovering', 'connection_lost (backoff en curso)');
    });
    client.on('connection_reestablished', () => {
      this.reconnectCount++;
      this.logger.warn(`reconexión #${this.reconnectCount}: re-creando subscription`);
      void this.onReconnected();
    });
    client.on('backoff', (retry: number, delay: number) => {
      this.logger.warn(`backoff de reconexión: intento ${retry}, próximo en ${delay}ms`);
    });
  }

  private async onReconnected(): Promise<void> {
    try {
      await this.resolveTargets();
      await this.setupSubscription();
      this.watchdog.start();
      this.bridge.transition('Connected', 'reconectado; subscription re-creada');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof NamespaceNotFoundError) this.bridge.transition('Faulted', `namespace no resuelto tras reconexión: ${message}`);
      else this.bridge.transition('Recovering', `re-setup falló: ${message}`);
    }
  }

  // ── resolución de NodeIds (requiere sesión viva) ───────────────────────────

  private async resolveTargets(): Promise<void> {
    if (!this.session) throw new Error('sin sesión');
    const namespaceArray = await this.session.readNamespaceArray();
    // Lanza NamespaceNotFoundError → Faulted (política de fallo dura).
    this.nsMap = resolveNamespaces(namespaceArray, this.mapping.raw as never);

    const resolved: ResolvedTarget[] = this.mapping.targets.map((t) => {
      const nsIndex = this.nsMap.get(t.node.nsUri);
      const nodeId = `ns=${nsIndex};${t.node.identifier}`;
      return { ...t, nodeId, resolved: false, faultReason: null };
    });

    // Verificación: leer NodeClass de cada buffer. Bad → buffer faulted (solo ese).
    const reads = resolved.map((t) => ({ nodeId: t.nodeId, attributeId: AttributeIds.NodeClass }));
    const results = await this.session.read(reads);
    results.forEach((dv: DataValue, i) => {
      const good = isGoodStatus(dv.statusCode);
      resolved[i].resolved = good;
      resolved[i].faultReason = good ? null : `NodeId no resoluble: ${dv.statusCode.toString()}`;
      if (!good) this.logger.warn(`buffer faulted ${resolved[i].plantId}/${resolved[i].browseName}: ${resolved[i].faultReason}`);
    });

    this.targets = resolved;
    const faulted = resolved.filter((t) => !t.resolved).length;
    this.logger.log(`NodeIds resueltos: ${resolved.length - faulted}/${resolved.length} (faulted: ${faulted})`);
  }

  // ── subscription + monitored items (1 por buffer) ──────────────────────────

  private async setupSubscription(): Promise<void> {
    if (!this.session) throw new Error('sin sesión');
    await this.teardownSubscription();

    this.subscription = await this.session.createSubscription2({
      requestedPublishingInterval: this.config.publishingIntervalMs,
      requestedLifetimeCount: 100,
      requestedMaxKeepAliveCount: 10,
      maxNotificationsPerPublish: 0,
      publishingEnabled: true,
      priority: 1,
    });

    this.subscription.on('keepalive', () => this.watchdog.kick());
    this.subscription.on('terminated', () => this.logger.warn('subscription terminada'));

    this.monitoredItems = [];
    for (const target of this.targets) {
      if (!target.resolved) continue; // los faulted no se suscriben; el bridge sigue
      const item = await this.subscription.monitor(
        { nodeId: resolveNodeId(target.nodeId), attributeId: AttributeIds.Value },
        { samplingInterval: this.config.samplingIntervalMs, discardOldest: true, queueSize: 1 },
        TimestampsToReturn.Both,
      );
      item.on('changed', (dv: DataValue) => this.onBufferChanged(target, dv));
      this.monitoredItems.push(item);
    }

    this.logger.log(`Subscription lista: ${this.monitoredItems.length} MonitoredItems`);
  }

  private onBufferChanged(target: ResolvedTarget, dv: DataValue): void {
    const now = Date.now();
    const sample = this.toSample(target, dv);
    const frame: RawPlantFrame = { plantId: target.plantId, buffers: [sample], receivedAt: new Date(now).toISOString() };

    this.notificationsTotal++;
    this.lastNotificationAt = frame.receivedAt;
    if (sample.sourceTimestamp) {
      this.lastNotificationLatencyMs = Math.max(0, now - new Date(sample.sourceTimestamp).getTime());
    }
    this.lastFrameByPlant.set(target.plantId, frame.receivedAt);
    this.watchdog.kick();
    if (this.bridge.is('Stale', 'Recovering')) this.bridge.transition('Connected', 'notificaciones reanudadas');

    for (const l of this.frameListeners) {
      try {
        l(frame);
      } catch (err) {
        this.logger.error(`listener de frame falló: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private toSample(target: ResolvedTarget, dv: DataValue): RawBufferSample {
    const raw = dv.value ? dv.value.value : null;
    const values = this.toValueArray(raw);
    const severity = (dv.statusCode.value >>> 30) & 0x3;
    const quality: OpcQuality = severity === 0 ? 'Good' : severity === 1 ? 'Uncertain' : 'Bad';
    return {
      browseName: target.browseName,
      channel: target.channel,
      values,
      quality,
      statusCode: dv.statusCode.name,
      sourceTimestamp: dv.sourceTimestamp ? dv.sourceTimestamp.toISOString() : null,
      serverTimestamp: dv.serverTimestamp ? dv.serverTimestamp.toISOString() : null,
    };
  }

  private toValueArray(raw: unknown): Array<number | boolean> {
    if (raw === null || raw === undefined) return [];
    if (Array.isArray(raw)) return raw.map((v) => (typeof v === 'boolean' ? v : Number(v)));
    if (ArrayBuffer.isView(raw)) return Array.from(raw as unknown as ArrayLike<number>);
    if (typeof raw === 'boolean') return [raw];
    return [Number(raw)];
  }

  // ── watchdog + heartbeat ───────────────────────────────────────────────────

  private async onWatchdogTimeout(): Promise<void> {
    if (this.bridge.is('Connected')) {
      this.bridge.transition('Stale', `watchdog: sin notificaciones en ${this.config.watchdogTimeoutMs}ms`);
    }
    this.recycleCount++;
    if (this.recycleCount <= this.config.subscriptionRecycleMaxAttempts) {
      this.logger.warn(`reciclando subscription (intento ${this.recycleCount})`);
      try {
        await this.setupSubscription();
        this.watchdog.start();
        return;
      } catch (err) {
        this.logger.warn(`reciclaje de subscription falló: ${err instanceof Error ? err.message : err}`);
      }
    }
    // Escalar: reciclar la sesión completa.
    this.logger.warn('reciclaje de subscription agotado; reciclando la sesión');
    try {
      await this.teardownSession();
      this.session = await this.client!.createSession(this.buildIdentity());
      await this.resolveTargets();
      await this.setupSubscription();
      this.recycleCount = 0;
      this.watchdog.start();
      this.bridge.transition('Connected', 'sesión reciclada');
    } catch (err) {
      this.bridge.transition('Faulted', `reciclaje de sesión falló: ${err instanceof Error ? err.message : err}`);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.session) return;
      this.session
        .read({ nodeId: 'i=2258', attributeId: AttributeIds.Value }) // Server_ServerStatus_CurrentTime
        .then((dv) => {
          if (!isGoodStatus(dv.statusCode)) this.logger.warn(`heartbeat con status ${dv.statusCode.toString()}`);
        })
        .catch((err) => this.logger.warn(`heartbeat falló: ${err instanceof Error ? err.message : err}`));
    }, this.config.heartbeatIntervalMs);
    if (typeof this.heartbeatTimer.unref === 'function') this.heartbeatTimer.unref();
  }
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private async teardownSubscription(): Promise<void> {
    for (const item of this.monitoredItems) item.removeAllListeners();
    this.monitoredItems = [];
    if (this.subscription) {
      await this.subscription.terminate().catch(() => undefined);
      this.subscription = null;
    }
  }
  private async teardownSession(): Promise<void> {
    await this.teardownSubscription();
    if (this.session) {
      await this.session.close().catch(() => undefined);
      this.session = null;
    }
  }

  // ── diagnósticos / info ────────────────────────────────────────────────────

  getDiagnostics(): AdapterDiagnostics {
    const buffersFaulted = this.targets.filter((t) => !t.resolved).length;
    const perPlant = this.mapping.plants.map((p) => {
      const bufs = this.targets.filter((t) => t.plantId === p.plantId);
      return {
        plantId: p.plantId,
        lastFrameAt: this.lastFrameByPlant.get(p.plantId) ?? null,
        buffersTotal: bufs.length,
        buffersFaulted: bufs.filter((t) => !t.resolved).length,
      };
    });
    return {
      provider: this.provider,
      bridgeStatus: this.bridge.get(),
      lastNotificationAt: this.lastNotificationAt,
      lastNotificationLatencyMs: this.lastNotificationLatencyMs,
      subscriptionCount: this.subscription ? 1 : 0,
      monitoredItemCount: this.monitoredItems.length,
      reconnectCount: this.reconnectCount,
      subscriptionRecycleCount: this.recycleCount,
      notificationsTotal: this.notificationsTotal,
      buffersActive: this.targets.filter((t) => t.resolved).length,
      buffersFaulted,
      perPlant,
      recentTransitions: this.bridge.recentTransitions(),
    };
  }

  async getServerInfo(): Promise<ServerInfo> {
    const base: ServerInfo = {
      provider: this.provider,
      endpoint: this.config.endpoint,
      activeSecurityMode: this.config.securityMode,
      activeSecurityPolicy: this.config.securityPolicy,
      identity: this.config.identity.type,
      productName: null,
      manufacturerName: null,
      softwareVersion: null,
      buildNumber: null,
      serverState: null,
      serverCurrentTime: null,
      namespaces: [...this.nsMap.keys()],
      sessionId: this.session ? this.session.sessionId.toString() : null,
      subscription: {
        publishingIntervalMs: this.subscription ? this.config.publishingIntervalMs : null,
        samplingIntervalMs: this.subscription ? this.config.samplingIntervalMs : null,
      },
    };
    if (!this.session) return base;

    try {
      const nodes = {
        productName: 'i=2261',
        manufacturerName: 'i=2262',
        softwareVersion: 'i=2264',
        buildNumber: 'i=2265',
        state: 'i=2259',
        currentTime: 'i=2258',
      };
      const dvs = await this.session.read(
        Object.values(nodes).map((nodeId) => ({ nodeId, attributeId: AttributeIds.Value })),
      );
      const val = (i: number): unknown => (dvs[i]?.value ? dvs[i].value.value : null);
      base.productName = typeof val(0) === 'string' ? (val(0) as string) : null;
      base.manufacturerName = typeof val(1) === 'string' ? (val(1) as string) : null;
      base.softwareVersion = typeof val(2) === 'string' ? (val(2) as string) : null;
      base.buildNumber = val(3) != null ? String(val(3)) : null;
      base.serverState = serverStateName(val(4));
      base.serverCurrentTime = val(5) instanceof Date ? (val(5) as Date).toISOString() : null;
    } catch (err) {
      this.logger.warn(`getServerInfo parcial: ${err instanceof Error ? err.message : err}`);
    }
    return base;
  }

  getBufferHealth(): BufferHealth[] {
    return this.targets.map((t) => ({
      plantId: t.plantId,
      browseName: t.browseName,
      channel: t.channel,
      resolved: t.resolved,
      faulted: !t.resolved,
      reason: t.faultReason,
    }));
  }
}
