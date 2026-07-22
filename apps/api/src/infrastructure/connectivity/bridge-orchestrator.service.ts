import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CONNECTIVITY_ADAPTER, CONNECTIVITY_CONFIG } from './connectivity.tokens';
import type { ConnectivityConfig } from './connectivity.config';
import type { ConnectivityAdapter } from './ports/connectivity-adapter.port';

/**
 * Gestiona el ciclo de vida del ConnectivityAdapter (Fase 1): lo arranca y lo detiene al
 * apagar. El arranque no bloquea el boot: si el PLC no está accesible, se reintenta en
 * segundo plano (la reconexión posterior a la primera conexión la maneja node-opcua).
 *
 * Los frames los consume PlantPipelineService directamente vía adapter.onFrame().
 */
@Injectable()
export class BridgeOrchestratorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('BridgeOrchestrator');
  private retryTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  /** true mientras `adapter.start()` está en vuelo: distingue un Faulted DE ARRANQUE (lo maneja
   *  el catch de startWithRetry, con backoff) de uno POST-arranque (lo recupera este servicio). */
  private starting = false;

  constructor(
    // @Inject explícito: tsx (esbuild) no emite design:paramtypes; la inyección por
    // tipo llega undefined (bug P2-3 del audit).
    @Inject(CONNECTIVITY_ADAPTER) private readonly adapter: ConnectivityAdapter,
    @Inject(CONNECTIVITY_CONFIG) private readonly config: ConnectivityConfig,
  ) {}

  onModuleInit(): void {
    this.adapter.onStatusChange((status, reason) => {
      this.logger.log(`bridge(${this.adapter.provider}) → ${status}: ${reason}`);
      // Recuperación de Faulted POST-arranque: sin esto, si recycleSession() falla tras haber
      // estado operativo, el puente queda Faulted PARA SIEMPRE (nadie más lo reintenta). Solo
      // se actúa fuera de un ciclo de (re)arranque en curso: durante el arranque, el Faulted lo
      // maneja el catch de startWithRetry (con backoff), así se evita doble recuperación.
      if (status === 'Faulted' && !this.stopped && !this.starting && !this.retryTimer) {
        void this.recoverFromFaulted(reason);
      }
    });
    // Fire-and-forget: no bloquear el arranque de la app por la conexión al PLC.
    void this.startWithRetry();
  }

  /** Relanza el puente tras un Faulted terminal: stop() (libera cliente/sesión) + reintento con backoff. */
  private async recoverFromFaulted(reason: string): Promise<void> {
    this.logger.warn(`bridge en Faulted (${reason}); recuperando con stop()+reintento`);
    await this.adapter.stop().catch(() => undefined);
    await this.startWithRetry();
  }

  private async startWithRetry(): Promise<void> {
    if (this.stopped) return;
    this.starting = true;
    try {
      await this.adapter.start();
    } catch (err) {
      const delay = this.config.opcua.reconnectMaxDelayMs;
      this.logger.warn(
        `arranque del puente falló (${err instanceof Error ? err.message : err}); reintento en ${delay}ms`,
      );
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.startWithRetry();
      }, delay);
      if (typeof this.retryTimer.unref === 'function') this.retryTimer.unref();
    } finally {
      this.starting = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    await this.adapter.stop().catch(() => undefined);
  }
}
