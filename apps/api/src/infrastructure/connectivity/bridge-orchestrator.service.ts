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

  constructor(
    // @Inject explícito: tsx (esbuild) no emite design:paramtypes; la inyección por
    // tipo llega undefined (bug P2-3 del audit).
    @Inject(CONNECTIVITY_ADAPTER) private readonly adapter: ConnectivityAdapter,
    @Inject(CONNECTIVITY_CONFIG) private readonly config: ConnectivityConfig,
  ) {}

  onModuleInit(): void {
    this.adapter.onStatusChange((status, reason) =>
      this.logger.log(`bridge(${this.adapter.provider}) → ${status}: ${reason}`),
    );
    // Fire-and-forget: no bloquear el arranque de la app por la conexión al PLC.
    void this.startWithRetry();
  }

  private async startWithRetry(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.adapter.start();
    } catch (err) {
      const delay = this.config.opcua.reconnectMaxDelayMs;
      this.logger.warn(
        `arranque del puente falló (${err instanceof Error ? err.message : err}); reintento en ${delay}ms`,
      );
      this.retryTimer = setTimeout(() => void this.startWithRetry(), delay);
      if (typeof this.retryTimer.unref === 'function') this.retryTimer.unref();
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    await this.adapter.stop().catch(() => undefined);
  }
}
