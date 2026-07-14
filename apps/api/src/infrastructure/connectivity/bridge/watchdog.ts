/**
 * Watchdog: si no llega ninguna señal (kick) dentro de `timeoutMs`, dispara
 * `onTimeout`. Se usa para detectar Subscriptions congeladas (regla 11: Stale).
 * Nunca espera indefinidamente. Compartido por ambos adaptadores.
 */
export class Watchdog {
  private timer: NodeJS.Timeout | null = null;
  private lastKickAt = 0;

  constructor(
    private readonly timeoutMs: number,
    private readonly onTimeout: () => void,
  ) {}

  start(): void {
    this.kick();
  }

  /** Reinicia la cuenta. Llamar en cada notificación recibida. */
  kick(): void {
    this.lastKickAt = Date.now();
    this.arm();
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onTimeout();
    }, this.timeoutMs);
    // No mantener vivo el event loop solo por el watchdog.
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  msSinceLastKick(): number {
    return this.lastKickAt ? Date.now() - this.lastKickAt : -1;
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
