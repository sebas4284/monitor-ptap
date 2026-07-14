import { Logger } from '@nestjs/common';
import { BridgeStateMachine } from '../../bridge/bridge-state-machine';
import { FrameCoalescer } from '../../bridge/frame-coalescer';
import { HeartbeatMonitor } from '../../bridge/heartbeat-monitor';
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

type Outcome = 'success' | 'fail';

/**
 * Adaptador de puente SIMULADO. Implementa ConnectivityAdapter emitiendo frames
 * crudos falsos con la MISMA topología del mapping. Puede emular TODOS los estados
 * del bridge (Connected/Stale/Recovering/Faulted) para probar el pipeline sin PLC
 * (regla 5), incluidos el reciclaje automático del watchdog y el heartbeat.
 *
 * Métodos de emulación para tests (no pertenecen al puerto): freeze(), faultBuffer(),
 * setRecycleOutcome(), setHeartbeatOutcome().
 */
export class SimulatorBridgeAdapter implements ConnectivityAdapter {
  readonly provider = 'simulator' as const;

  private readonly logger = new Logger('SimulatorBridge');
  private readonly bridge = new BridgeStateMachine(this.logger, 'simulator');
  private readonly watchdog: Watchdog;
  private readonly heartbeat: HeartbeatMonitor;
  private readonly coalescer: FrameCoalescer;
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

  // Perillas de emulación: el resultado que darán los reciclajes y los probes de heartbeat.
  private recycleOutcome: Outcome = 'success';
  private heartbeatOutcome: Outcome = 'success';

  constructor(
    private readonly config: OpcUaConfig,
    private readonly mapping: LoadedMapping,
  ) {
    this.targets = mapping.targets;
    this.watchdog = new Watchdog(config.watchdogTimeoutMs, () => this.onWatchdogTimeout());
    this.coalescer = new FrameCoalescer(config.coalesceWindowMs, (f) => this.emitFrame(f));
    this.heartbeat = new HeartbeatMonitor({
      intervalMs: config.heartbeatIntervalMs,
      maxFailures: config.heartbeatMaxFailures,
      probe: () => this.heartbeatProbe(),
      onFailureThreshold: (reason) => this.onHeartbeatThreshold(reason),
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.bridge.transition('Connecting', 'inicio del simulador');
    this.bridge.transition('Connected', 'simulador listo');
    this.watchdog.start();
    this.heartbeat.start();
    this.startEmitTimer();
  }

  async stop(): Promise<void> {
    this.started = false;
    this.stopEmitTimer();
    this.watchdog.stop();
    this.heartbeat.stop();
    this.coalescer.stop(); // flushea pendientes con el bridge aún "vivo" (regla 12)
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

  // ── emulación (solo tests) ─────────────────────────────────────────────────────

  /** Congela la emisión: emula una Subscription muerta (sin notificaciones → watchdog). */
  freeze(): void {
    this.frozen = true;
    this.logger.warn('[sim] emisión CONGELADA');
  }

  /** Marca un buffer como faulted (para probar la degradación por buffer). */
  faultBuffer(plantId: string, browseName: string): void {
    this.faultedBuffers.add(`${plantId}/${browseName}`);
  }

  /** Define si los reciclajes (subscription/sesión) tendrán éxito o fallarán. */
  setRecycleOutcome(outcome: Outcome): void {
    this.recycleOutcome = outcome;
  }

  /** Define si el probe de heartbeat resolverá (success) o lanzará (fail). */
  setHeartbeatOutcome(outcome: Outcome): void {
    this.heartbeatOutcome = outcome;
  }

  // ── emisión interna ─────────────────────────────────────────────────────────────

  private startEmitTimer(): void {
    this.stopEmitTimer();
    this.emitTimer = setInterval(() => this.tick(), this.config.publishingIntervalMs);
    if (typeof this.emitTimer.unref === 'function') this.emitTimer.unref();
  }

  private stopEmitTimer(): void {
    if (this.emitTimer) clearInterval(this.emitTimer);
    this.emitTimer = null;
  }

  private tick(): void {
    if (this.frozen) return; // sin notificaciones → el watchdog terminará disparando

    for (const target of this.targets) {
      if (this.faultedBuffers.has(`${target.plantId}/${target.browseName}`)) continue;
      this.notificationsTotal++;
      this.lastNotificationAt = new Date().toISOString();
      this.coalescer.add(target.plantId, this.fakeBuffer(target)); // coalescing por planta (A2)
    }

    this.watchdog.kick();
    if (this.bridge.is('Stale', 'Recovering')) {
      this.recycleCount = 0;
      this.bridge.transition('Connected', 'frames reanudados');
    }
  }

  /** Callback del coalescer: un frame por planta con todos los buffers de la ventana. */
  private emitFrame(frame: RawPlantFrame): void {
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

  // ── watchdog: reciclaje EMULADO de verdad ───────────────────────────────────────

  private onWatchdogTimeout(): void {
    if (this.bridge.is('Connected')) {
      this.bridge.transition('Stale', `watchdog: sin notificaciones en ${this.config.watchdogTimeoutMs}ms`);
    }
    this.recycleCount++;

    if (this.recycleCount <= this.config.subscriptionRecycleMaxAttempts) {
      if (this.recycleOutcome === 'success') {
        this.recycleSubscriptionEmulated();
        return;
      }
      this.logger.warn(`[sim] reciclaje de subscription falló (emulado, intento ${this.recycleCount})`);
      this.watchdog.kick(); // re-arma para reintentar al próximo timeout
      return;
    }

    // Escalar: reciclar la sesión completa (emulada).
    if (this.recycleOutcome === 'success') {
      this.recycleSessionEmulated('watchdog');
    } else {
      this.heartbeat.stop();
      this.stopEmitTimer();
      this.bridge.transition(
        'Faulted',
        `reciclaje de sesión falló (emulado) tras ${this.recycleCount - 1} intentos de subscription`,
      );
    }
  }

  /** Recrea la emisión interna: el equivalente simulado de recrear la Subscription. */
  private recycleSubscriptionEmulated(): void {
    this.frozen = false;
    this.startEmitTimer();
    this.recycleCount = 0;
    this.watchdog.start();
    this.bridge.transition('Connected', 'subscription reciclada (emulada)');
  }

  /** Recrea la sesión completa (emulada). */
  private recycleSessionEmulated(trigger: string): void {
    this.reconnectCount++;
    this.frozen = false;
    this.startEmitTimer();
    this.recycleCount = 0;
    this.watchdog.start();
    this.heartbeat.reset();
    this.bridge.transition('Connected', `sesión reciclada (emulada, ${trigger})`);
  }

  // ── heartbeat emulado ───────────────────────────────────────────────────────────

  private async heartbeatProbe(): Promise<void> {
    if (this.heartbeatOutcome === 'fail') throw new Error('heartbeat emulado en fallo');
  }

  private onHeartbeatThreshold(reason: string): void {
    // No resucitar un bridge terminal ni pisar un arranque en curso (la state machine
    // ejecuta transiciones no estándar, solo advierte: hay que guardarlas aquí).
    if (this.bridge.is('Faulted', 'Disconnected', 'Connecting')) return;
    this.bridge.transition('Recovering', reason);
    if (this.recycleOutcome === 'success') {
      this.recycleSessionEmulated('heartbeat');
    } else {
      this.heartbeat.stop();
      this.stopEmitTimer();
      this.bridge.transition('Faulted', 'reciclaje de sesión falló (emulado) tras heartbeat');
    }
  }

  // ── diagnósticos / info ─────────────────────────────────────────────────────────

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
    const hb = this.heartbeat.getStats();
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
      lastHeartbeatAt: hb.lastHeartbeatAt,
      lastSuccessfulHeartbeatAt: hb.lastSuccessfulHeartbeatAt,
      heartbeatFailures: hb.heartbeatFailures,
      heartbeatFailuresTotal: hb.heartbeatFailuresTotal,
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
