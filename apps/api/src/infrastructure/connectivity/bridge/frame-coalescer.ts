import type { RawBufferSample, RawPlantFrame } from '../ports/connectivity-adapter.port';

interface PendingPlant {
  buffers: Map<string, RawBufferSample>; // browseName → última muestra (last-wins, coherente con queueSize:1)
  timer: NodeJS.Timeout;
}

/**
 * Agregador de notificaciones por planta: acumula las muestras de MonitoredItems
 * que llegan dentro de una ventana `windowMs` y emite UN RawPlantFrame por planta
 * con todos los buffers que cambiaron en ese ciclo (nunca un frame por buffer).
 *
 * - La ventana arranca con el PRIMER sample de la planta y NUNCA espera buffers
 *   que no llegaron: al vencer, emite lo acumulado y reinicia.
 * - `receivedAt` es el instante del flush (metadato de transporte); la verdad de
 *   proceso sigue siendo el sourceTimestamp de cada sample (regla 7).
 * - `stop()` flushea lo pendiente antes de morir (regla 12: nada se pierde).
 * - Con windowMs=0 el flush corre en el siguiente macrotask, así que un batch
 *   síncrono (un publish response, un tick del simulador) igual coalesce en un frame.
 *
 * Compartido por ambos adaptadores (mismo contrato de grano).
 */
export class FrameCoalescer {
  private readonly pending = new Map<string, PendingPlant>();
  private stopped = false;

  constructor(
    private readonly windowMs: number,
    private readonly onFlush: (frame: RawPlantFrame) => void,
  ) {}

  add(plantId: string, sample: RawBufferSample): void {
    if (this.stopped) return;
    let entry = this.pending.get(plantId);
    if (!entry) {
      const timer = setTimeout(() => this.flushPlant(plantId), this.windowMs);
      if (typeof timer.unref === 'function') timer.unref();
      entry = { buffers: new Map(), timer };
      this.pending.set(plantId, entry);
    }
    entry.buffers.set(sample.browseName, sample);
  }

  /** Emite ya todo lo pendiente (sin esperar las ventanas). */
  flushAll(): void {
    for (const plantId of [...this.pending.keys()]) this.flushPlant(plantId);
  }

  /** Flushea pendientes y garantiza cero timers vivos. Tras stop(), add() es no-op. */
  stop(): void {
    this.flushAll();
    this.stopped = true;
  }

  private flushPlant(plantId: string): void {
    const entry = this.pending.get(plantId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(plantId);
    const frame: RawPlantFrame = {
      plantId,
      buffers: [...entry.buffers.values()],
      receivedAt: new Date().toISOString(),
    };
    try {
      this.onFlush(frame);
    } catch {
      // Los adaptadores ya protegen a sus listeners; esto es defensa en profundidad
      // para no matar el camino del timer por un callback roto.
    }
  }
}
