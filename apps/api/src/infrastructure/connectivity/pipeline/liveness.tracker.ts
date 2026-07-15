import type { RawPlantFrame } from '../ports/connectivity-adapter.port';
import type { LivenessDto, LivenessState } from './plant-snapshot.dto';

interface PlantLiveness {
  lastKnown: Map<string, string>; // browseName → firma de valores (para detectar CAMBIO real)
  lastChangeAt: string | null; // sourceTimestamp del último CAMBIO observado; null = nunca
  windowSec: number;
}

/**
 * Liveness por FRESCURA de datos (PASO 3.3). Cuatro estados:
 *   live    → hubo un cambio en los últimos liveSec
 *   idle    → hubo un cambio entre liveSec y windowSec
 *   stale   → ningún cambio en windowSec
 *   unknown → nunca observamos un cambio (obligatorio: al arrancar no es "stale")
 *
 * Un CAMBIO = el valor de algún buffer difiere del anterior conocido. La PRIMERA vez que
 * vemos un buffer NO es un cambio (no hay delta): sin un 2º valor distinto, la planta
 * sigue `unknown`. Así los sitios congelados (mandan su valor inicial y nada más) se ven
 * honestamente como unknown/stale, no como conectados con un dato viejo.
 *
 * DN/ER/TO están descartados como fuente (inobservables por Optix, Fase 0.3): NO se usan.
 */
export class LivenessTracker {
  private readonly plants = new Map<string, PlantLiveness>();

  constructor(
    private readonly liveSec: number,
    private readonly defaultWindowSec: number,
  ) {}

  /** Registra el default por planta (del mapping) antes de recibir frames. */
  configurePlant(plantId: string, windowSec: number | null): void {
    const entry = this.ensure(plantId);
    entry.windowSec = windowSec ?? this.defaultWindowSec;
  }

  /** Procesa un frame y devuelve true si detectó un cambio real (para el diff aguas abajo). */
  ingest(frame: RawPlantFrame): boolean {
    const entry = this.ensure(frame.plantId);
    let changed = false;
    for (const buf of frame.buffers) {
      const sig = JSON.stringify(buf.values);
      const prev = entry.lastKnown.get(buf.browseName);
      if (prev !== undefined && prev !== sig) changed = true; // 1ª vez no cuenta
      entry.lastKnown.set(buf.browseName, sig);
    }
    if (changed) {
      entry.lastChangeAt = frame.buffers[0]?.sourceTimestamp ?? frame.receivedAt;
    }
    return changed;
  }

  get(plantId: string, now = Date.now()): LivenessDto {
    const entry = this.ensure(plantId);
    return {
      state: this.stateOf(entry, now),
      lastChangeAt: entry.lastChangeAt,
      windowSec: entry.windowSec,
    };
  }

  private stateOf(entry: PlantLiveness, now: number): LivenessState {
    if (!entry.lastChangeAt) return 'unknown';
    const ageSec = (now - new Date(entry.lastChangeAt).getTime()) / 1000;
    if (ageSec <= this.liveSec) return 'live';
    if (ageSec <= entry.windowSec) return 'idle';
    return 'stale';
  }

  private ensure(plantId: string): PlantLiveness {
    let entry = this.plants.get(plantId);
    if (!entry) {
      entry = { lastKnown: new Map(), lastChangeAt: null, windowSec: this.defaultWindowSec };
      this.plants.set(plantId, entry);
    }
    return entry;
  }
}
