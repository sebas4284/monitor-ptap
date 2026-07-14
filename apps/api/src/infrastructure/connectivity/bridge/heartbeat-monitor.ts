export interface HeartbeatStats {
  lastHeartbeatAt: string | null;
  lastSuccessfulHeartbeatAt: string | null;
  /** Fallos CONSECUTIVOS actuales (un probe OK los resetea). */
  heartbeatFailures: number;
  /** Fallos acumulados desde la creación del monitor. */
  heartbeatFailuresTotal: number;
}

export interface HeartbeatMonitorOptions {
  intervalMs: number;
  /** Fallos consecutivos que disparan onFailureThreshold. */
  maxFailures: number;
  /** resolve = servidor sano; reject = fallo de heartbeat. */
  probe: () => Promise<void>;
  onFailureThreshold: (reason: string) => void;
}

/**
 * Heartbeat FUNCIONAL (no decorativo): sondea al servidor cada `intervalMs` y,
 * tras `maxFailures` fallos consecutivos, dispara `onFailureThreshold` para que
 * el adaptador transicione el bridge (Connected → Recovering) y recicle.
 *
 * - Al disparar el threshold, el contador consecutivo se auto-resetea: hacen
 *   falta N fallos NUEVOS para re-disparar (evita tormentas de reciclaje
 *   mientras la recuperación async está en curso).
 * - Un probe in-flight no se solapa: si el anterior no resolvió, el tick se salta
 *   (una red degradada puede tardar más que el intervalo).
 * - `runOnce()` es público para tests deterministas sin timers.
 */
export class HeartbeatMonitor {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private lastHeartbeatAt: string | null = null;
  private lastSuccessfulHeartbeatAt: string | null = null;
  private consecutiveFailures = 0;
  private failuresTotal = 0;

  constructor(private readonly opts: HeartbeatMonitorOptions) {}

  start(): void {
    this.stop();
    this.timer = setInterval(() => void this.runOnce(), this.opts.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Resetea el contador consecutivo (llamar tras una recuperación exitosa). */
  reset(): void {
    this.consecutiveFailures = 0;
  }

  getStats(): HeartbeatStats {
    return {
      lastHeartbeatAt: this.lastHeartbeatAt,
      lastSuccessfulHeartbeatAt: this.lastSuccessfulHeartbeatAt,
      heartbeatFailures: this.consecutiveFailures,
      heartbeatFailuresTotal: this.failuresTotal,
    };
  }

  /** Un ciclo de probe. Lo invoca el interval y también los tests. */
  async runOnce(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    this.lastHeartbeatAt = new Date().toISOString();
    try {
      await this.opts.probe();
      this.lastSuccessfulHeartbeatAt = new Date().toISOString();
      this.consecutiveFailures = 0;
    } catch (err) {
      this.consecutiveFailures++;
      this.failuresTotal++;
      if (this.consecutiveFailures >= this.opts.maxFailures) {
        const message = err instanceof Error ? err.message : String(err);
        const count = this.consecutiveFailures;
        this.consecutiveFailures = 0; // N fallos nuevos para re-disparar
        this.opts.onFailureThreshold(`heartbeat: ${count} fallos consecutivos (${message})`);
      }
    } finally {
      this.inFlight = false;
    }
  }
}
