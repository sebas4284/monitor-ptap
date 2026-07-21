import type { RawPlantFrame } from '../ports/connectivity-adapter.port';
import type { LivenessDto, LivenessState } from './plant-snapshot.dto';

interface PlantLiveness {
  lastKnown: Map<string, string>; // browseName → firma de valores (para detectar CAMBIO real)
  lastChangeAt: string | null; // sourceTimestamp del último CAMBIO observado; null = nunca
  windowSec: number;
}

/**
 * Frescura de datos (PASO 3.3). TRES estados, y la clave es que el veredicto cruza DOS cosas:
 * cuánto hace que un valor cambió Y si la sesión con el PLC sigue sana.
 *
 *   live   → hubo un cambio en los últimos liveSec (con la sesión sana).
 *   stable → sesión sana, pero los valores no se mueven. Es OPERACIÓN NORMAL: un tanque a
 *            nivel constante o una presión sostenida no son una avería, y sus datos VALEN.
 *   frozen → la sesión NO está sana: perdimos la fuente y no sabemos qué pasa en la planta.
 *
 * Por qué se puede afirmar "stable" sin mentir: el puente mantiene un heartbeat y la
 * suscripción OPC UA su keepalive. Si el puente sigue `Connected`, la sesión respondió hace
 * segundos — luego la ausencia de cambios es del PROCESO, no del enlace. Sin ese cruce, la
 * versión anterior marcaba `stale` por reloj y además invalidaba las señales, de modo que una
 * planta en régimen estable aparecía "congelada" y "sin dato" estando perfectamente bien.
 *
 * Un CAMBIO = el valor de algún buffer difiere del anterior conocido. La PRIMERA vez que vemos
 * un buffer NO es un cambio (no hay delta): con la sesión sana eso es `stable`, no un error.
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

  /**
   * @param sourceHealthy true si la sesión con el PLC está viva (puente `Connected`, heartbeat
   *   respondiendo). Es lo que separa "no se mueve" (stable) de "no llega" (frozen).
   */
  get(plantId: string, sourceHealthy: boolean, now = Date.now()): LivenessDto {
    const entry = this.ensure(plantId);
    return {
      state: this.stateOf(entry, sourceHealthy, now),
      lastChangeAt: entry.lastChangeAt,
      windowSec: entry.windowSec,
    };
  }

  private stateOf(entry: PlantLiveness, sourceHealthy: boolean, now: number): LivenessState {
    // Sin sesión sana no se puede afirmar nada de la planta: da igual lo reciente que sea el
    // último cambio, el dato que tenemos ya no está respaldado por nadie.
    if (!sourceHealthy) return 'frozen';
    if (!entry.lastChangeAt) return 'stable'; // conectados, aún sin ver movimiento
    const ageSec = (now - new Date(entry.lastChangeAt).getTime()) / 1000;
    return ageSec <= this.liveSec ? 'live' : 'stable';
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
