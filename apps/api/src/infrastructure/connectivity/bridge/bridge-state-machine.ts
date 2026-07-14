import { Logger } from '@nestjs/common';
import type { BridgeStatus } from '../ports/connectivity-adapter.port';

export interface BridgeTransition {
  at: string;
  from: BridgeStatus;
  to: BridgeStatus;
  reason: string;
}

/** Transiciones permitidas. Una transición fuera de este mapa se loguea como warning. */
const ALLOWED: Record<BridgeStatus, BridgeStatus[]> = {
  Connecting: ['Connected', 'Disconnected', 'Faulted'],
  Connected: ['Recovering', 'Stale', 'Disconnected', 'Faulted'],
  Recovering: ['Connected', 'Disconnected', 'Faulted'],
  Stale: ['Connected', 'Recovering', 'Disconnected', 'Faulted'],
  Disconnected: ['Connecting', 'Recovering', 'Faulted'],
  Faulted: ['Connecting'], // solo se sale de Faulted reintentando el arranque
};

/**
 * Máquina de estados explícita del puente (regla 11). Nunca un booleano.
 * Registra cada transición en log estructurado y notifica a los suscriptores.
 */
export class BridgeStateMachine {
  private status: BridgeStatus = 'Disconnected'; // idle hasta start()
  private readonly history: BridgeTransition[] = [];
  private readonly listeners = new Set<(s: BridgeStatus, reason: string) => void>();
  private readonly maxHistory = 50;

  constructor(
    private readonly logger: Logger,
    private readonly label: string,
  ) {}

  get(): BridgeStatus {
    return this.status;
  }

  is(...states: BridgeStatus[]): boolean {
    return states.includes(this.status);
  }

  recentTransitions(limit = 10): BridgeTransition[] {
    return this.history.slice(-limit);
  }

  onChange(listener: (s: BridgeStatus, reason: string) => void): void {
    this.listeners.add(listener);
  }

  /** Transiciona a `to`. Idempotente si ya está en `to` (no re-notifica). */
  transition(to: BridgeStatus, reason: string): void {
    const from = this.status;
    if (from === to) return;

    const allowed = ALLOWED[from].includes(to);
    const entry: BridgeTransition = { at: new Date().toISOString(), from, to, reason };
    this.history.push(entry);
    if (this.history.length > this.maxHistory) this.history.shift();
    this.status = to;

    const line = `[${this.label}] BridgeStatus ${from} → ${to} (${reason})`;
    if (allowed) this.logger.log(line);
    else this.logger.warn(`${line} [transición no estándar]`);

    for (const listener of this.listeners) {
      try {
        listener(to, reason);
      } catch (err) {
        this.logger.error(`listener de BridgeStatus falló: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}
