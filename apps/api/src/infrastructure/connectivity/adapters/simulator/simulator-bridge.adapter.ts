import { Logger } from '@nestjs/common';
import { BridgeStateMachine } from '../../bridge/bridge-state-machine';
import { Watchdog } from '../../bridge/watchdog';
import type { OpcUaConfig } from '../../connectivity.config';
import type { LoadedMapping, MonitorTarget } from '../../mapping/opc-mapping.loader';
import type {
  AdapterDiagnostics,
  BridgeStatus,
  BufferHealth,
  ConnectivityAdapter,
  RawBufferSample,
  RawPlantFrame,
  ServerInfo,
} from '../../ports/connectivity-adapter.port';

/**
 * Adaptador de puente SIMULADO. Implementa ConnectivityAdapter emitiendo frames
 * crudos falsos con la MISMA topología del mapping. Puede emular todos los estados
 * del bridge (Connected/Stale/Faulted) para probar el pipeline sin PLC (regla 5).
 *
 * Métodos freeze()/unfreeze()/faultBuffer() son para tests; no pertenecen al puerto.
 */
export class SimulatorBridgeAdapter implements ConnectivityAdapter {
  readonly provider = 'simulator' as const;

  private readonly logger = new Logger('SimulatorBridge');
  private readonly bridge = new BridgeStateMachine(this.logger, 'simulator');
  private readonly watchdog: Watchdog;
  private readonly frameListeners = new Set<(f: RawPlantFrame) => void>();
  private readonly targets: MonitorTarget[];
  private readonly faultedBuffers = new Set<string>(); // key: plantId/browseName

  private emitTimer: NodeJS.Timeout | null = null;
  private frozen = false;
  private started = false;
  private recycleCount = 0;
  private reconnectCount = 0;
  private notificationsTotal = 0;
  private lastNotificationAt: string | null = null;
  private readonly lastFrameByPlant = new Map<string, string>();

  constructor(
    private readonly config: OpcUaConfig,
    private readonly mapping: LoadedMapping,
  ) {
    this.targets = mapping.targets;
    this.watchdog = new Watchdog(config.watchdogTimeoutMs, () => this.onWatchdogTimeout());
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.bridge.transition('Connecting', 'inicio del simulador');
    this.bridge.transition('Connected', 'simulador listo');
    this.watchdog.start();
    this.emitTimer = setInterval(() => this.tick(), this.config.publishingIntervalMs);
    if (typeof this.emitTimer.unref === 'function') this.emitTimer.unref();
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.emitTimer) clearInterval(this.emitTimer);
    this.emitTimer = null;
    this.watchdog.stop();
    this.bridge.transition('Disconnected', 'stop() del simulador');
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

  // ── emulación ────────────────────────────────────────────────────────────────

  /** Congela la emisión (para probar el watchdog → Stale). */
  freeze(): void {
    this.frozen = true;
    this.logger.warn('[sim] emisión CONGELADA');
  }

  /** Reanuda la emisión (recuperación desde Stale). */
  unfreeze(): void {
    this.frozen = false;
    this.logger.warn('[sim] emisión REANUDADA');
  }

  /** Marca un buffer como faulted (para probar la degradación por buffer). */
  faultBuffer(plantId: string, browseName: string): void {
    this.faultedBuffers.add(`${plantId}/${browseName}`);
  }

  // ── interno ──────────────────────────────────────────────────────────────────

  private tick(): void {
    if (this.frozen) return; // sin notificaciones → el watchdog terminará disparando

    const now = new Date().toISOString();
    for (const target of this.targets) {
      if (this.faultedBuffers.has(`${target.plantId}/${target.browseName}`)) continue;
      const frame: RawPlantFrame = {
        plantId: target.plantId,
        buffers: [this.fakeBuffer(target)],
        receivedAt: now,
      };
      this.emit(frame);
    }

    this.watchdog.kick();
    if (!this.bridge.is('Connected')) {
      this.recycleCount = 0;
      this.bridge.transition('Connected', 'frames reanudados');
    }
  }

  private emit(frame: RawPlantFrame): void {
    this.notificationsTotal++;
    this.lastNotificationAt = frame.receivedAt;
    this.lastFrameByPlant.set(frame.plantId, frame.receivedAt);
    for (const l of this.frameListeners) {
      try {
        l(frame);
      } catch (err) {
        this.logger.error(`listener de frame falló: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private fakeBuffer(target: MonitorTarget): RawBufferSample {
    const len = target.arrayLength ?? 4;
    const t = Date.now() / 1000;
    const values: Array<number | boolean> =
      target.channel === 'bitIn' || target.channel === 'bitOut'
        ? Array.from({ length: len }, (_, i) => Math.sin(t + i) > 0)
        : Array.from({ length: len }, (_, i) => Number((50 + 40 * Math.sin(t / 5 + i)).toFixed(2)));
    return {
      browseName: target.browseName,
      channel: target.channel,
      values,
      quality: 'Good',
      statusCode: 'Good',
      sourceTimestamp: new Date().toISOString(),
      serverTimestamp: new Date().toISOString(),
    };
  }

  private onWatchdogTimeout(): void {
    if (this.bridge.is('Connected')) {
      this.bridge.transition('Stale', `watchdog: sin notificaciones en ${this.config.watchdogTimeoutMs}ms`);
    }
    this.recycleCount++;
    if (this.recycleCount > this.config.subscriptionRecycleMaxAttempts) {
      this.bridge.transition('Faulted', `reciclaje falló ${this.recycleCount - 1} veces`);
      return; // permanece Faulted hasta stop()/start()
    }
    this.reconnectCount++;
    this.logger.warn(`[sim] reciclando subscription (intento ${this.recycleCount})`);
    this.watchdog.kick(); // re-arma para volver a chequear
  }

  getDiagnostics(): AdapterDiagnostics {
    const perPlant = this.mapping.plants.map((p) => {
      const bufs = this.targets.filter((t) => t.plantId === p.plantId);
      const faulted = bufs.filter((t) => this.faultedBuffers.has(`${t.plantId}/${t.browseName}`)).length;
      return {
        plantId: p.plantId,
        lastFrameAt: this.lastFrameByPlant.get(p.plantId) ?? null,
        buffersTotal: bufs.length,
        buffersFaulted: faulted,
      };
    });
    return {
      provider: this.provider,
      bridgeStatus: this.bridge.get(),
      lastNotificationAt: this.lastNotificationAt,
      lastNotificationLatencyMs: null,
      subscriptionCount: this.bridge.is('Connected') ? 1 : 0,
      monitoredItemCount: this.targets.length - this.faultedBuffers.size,
      reconnectCount: this.reconnectCount,
      subscriptionRecycleCount: this.recycleCount,
      notificationsTotal: this.notificationsTotal,
      buffersActive: this.targets.length - this.faultedBuffers.size,
      buffersFaulted: this.faultedBuffers.size,
      perPlant,
      recentTransitions: this.bridge.recentTransitions(),
    };
  }

  async getServerInfo(): Promise<ServerInfo> {
    return {
      provider: this.provider,
      endpoint: 'simulator://in-memory',
      activeSecurityMode: 'None',
      activeSecurityPolicy: 'None',
      identity: 'Simulated',
      productName: 'PTAP Simulator Bridge',
      manufacturerName: 'monitor-ptap',
      softwareVersion: '1.0.0',
      buildNumber: null,
      serverState: this.bridge.is('Connected') ? 'Running' : this.bridge.get(),
      serverCurrentTime: new Date().toISOString(),
      namespaces: ['simulator'],
      sessionId: 'sim-session',
      subscription: {
        publishingIntervalMs: this.config.publishingIntervalMs,
        samplingIntervalMs: this.config.samplingIntervalMs,
      },
    };
  }

  getBufferHealth(): BufferHealth[] {
    return this.targets.map((t) => {
      const faulted = this.faultedBuffers.has(`${t.plantId}/${t.browseName}`);
      return {
        plantId: t.plantId,
        browseName: t.browseName,
        channel: t.channel,
        resolved: true,
        faulted,
        reason: faulted ? 'faulted por emulación' : null,
      };
    });
  }
}
