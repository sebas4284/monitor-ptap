import type { PlantSnapshotDto, SignalDto } from './api';

/**
 * Electroválvulas REALES derivadas del snapshot de dominio (PLC → mapping → snapshot.signals).
 * Ya no hay mocks: si la planta no tiene válvula mapeada, la lista queda vacía y la pantalla lo dice.
 *
 * ESTADO de la válvula — dos métodos, por instrucción del operador (2026-07-30):
 *   1. `valve1State` (lectura directa de intIn[0]): máscara de bits del PLC → bit0 = abierta(1) /
 *      cerrada(0), con bit14 = estado válido. Es decir 16384 = CERRADA, 16385 = ABIERTA.
 *   2. Caudal: si el caudal es <= 0.1 la válvula está CERRADA; por encima, ABIERTA.
 *
 * Se muestran AMBOS y se cruzan: el método 1 manda (es la lectura del propio equipo) y el 2 corrobora.
 * Si discrepan se marca `disagreement` — eso es información valiosa para el operador (sensor de estado
 * o caudalímetro inconsistente), nunca se oculta eligiendo uno en silencio.
 */

/** Umbral de caudal por debajo del cual se considera la válvula cerrada (método 2). */
export const FLOW_CLOSED_THRESHOLD = 0.1;

/** Bits de la palabra de estado (intIn[0]) según la interpretación de válvulas del PLC. */
const BIT_VALID = 1 << 14; // 16384 — el PLC reporta un estado válido
const BIT_OPEN = 1 << 0; //     1 — abierta

export type ValveState = 'open' | 'closed' | 'unknown';
export type ValveStateSource = 'estado' | 'caudal' | 'ninguno';

export interface ValveView {
  id: string; // domainKey del comando, p. ej. 'valve1'
  name: string;
  /** Veredicto final (método 1 si está disponible; si no, método 2). */
  state: ValveState;
  /** De dónde salió el veredicto. */
  source: ValveStateSource;
  /** Método 1 — lectura directa del PLC (null si no hay dato usable). */
  byState: ValveState | null;
  /** Método 2 — inferido del caudal (null si la planta no tiene caudal mapeado). */
  byFlow: ValveState | null;
  /** Caudal usado por el método 2 y su unidad (para mostrarlo). */
  flowValue: number | null;
  flowUnit: string | null;
  flowLabel: string | null;
  /** Los dos métodos dan resultados distintos → avisar, no elegir en silencio. */
  disagreement: boolean;
  /** Valor crudo de la palabra de estado (diagnóstico). */
  rawState: number | null;
  ts: string | null;
}

function numeric(signal: SignalDto | undefined): number | null {
  return signal && typeof signal.value === 'number' && signal.usable ? signal.value : null;
}

/** Método 1: decodifica la palabra de estado del PLC. */
function stateFromWord(word: number | null): ValveState | null {
  if (word === null) return null;
  // Sin bit14 el PLC no está reportando un estado válido → no se afirma nada.
  if ((word & BIT_VALID) === 0) return null;
  return (word & BIT_OPEN) !== 0 ? 'open' : 'closed';
}

/** Método 2: caudal <= 0.1 → cerrada; por encima → abierta. */
function stateFromFlow(flow: number | null): ValveState | null {
  if (flow === null) return null;
  return flow <= FLOW_CLOSED_THRESHOLD ? 'closed' : 'open';
}

/**
 * Caudal de referencia para el método 2. Se prefiere la SALIDA (lo que la válvula entrega) y, si la
 * planta no la tiene mapeada, se usa la entrada. Devuelve también su etiqueta para poder mostrar de
 * dónde salió el veredicto.
 */
function referenceFlow(signals: Record<string, SignalDto>): { value: number | null; unit: string | null; label: string | null } {
  const preferred = ['outletFlow1', 'outletFlow2', 'inletFlow1', 'inletFlow2'];
  for (const key of preferred) {
    const sig = signals[key];
    const value = numeric(sig);
    if (value !== null) return { value, unit: sig?.unit ?? null, label: sig?.label ?? key };
  }
  return { value: null, unit: null, label: null };
}

export function valvesFromSnapshot(snapshot: PlantSnapshotDto | undefined): ValveView[] {
  if (!snapshot) return [];
  const out: ValveView[] = [];
  const flow = referenceFlow(snapshot.signals);

  // Una válvula por cada señal de comando valve<N> presente en el mapping de la planta.
  const nums = new Set<number>();
  for (const key of Object.keys(snapshot.signals)) {
    const m = /^valve(\d+)$/.exec(key);
    if (m) nums.add(Number(m[1]));
  }

  for (const n of [...nums].sort((a, b) => a - b)) {
    const cmd = snapshot.signals[`valve${n}`];
    const stateSig = snapshot.signals[`valve${n}State`];
    const rawState = numeric(stateSig);
    const byState = stateFromWord(rawState);
    const byFlow = stateFromFlow(flow.value);

    const state: ValveState = byState ?? byFlow ?? 'unknown';
    const source: ValveStateSource = byState !== null ? 'estado' : byFlow !== null ? 'caudal' : 'ninguno';

    out.push({
      id: `valve${n}`,
      name: cmd?.label ?? `Válvula ${n}`,
      state,
      source,
      byState,
      byFlow,
      flowValue: flow.value,
      flowUnit: flow.unit,
      flowLabel: flow.label,
      disagreement: byState !== null && byFlow !== null && byState !== byFlow,
      rawState,
      ts: stateSig?.ts ?? cmd?.ts ?? null,
    });
  }
  return out;
}

/** true si el domainKey lo consume la pantalla de válvulas (para no duplicarlo en el tablero). */
export function isValveSignal(domainKey: string): boolean {
  return /^valve\d+(State)?$/.test(domainKey);
}
