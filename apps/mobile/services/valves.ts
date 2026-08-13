import type { PlantSnapshotDto, SignalDto, ValveCommandResult } from './api';

/**
 * Electroválvulas REALES derivadas del snapshot de dominio (PLC → mapping → snapshot.signals).
 * Ya no hay mocks: si la planta no tiene válvula mapeada, la lista queda vacía y la pantalla lo dice.
 *
 * ESTADO de la válvula — dos métodos, por instrucción del operador (2026-07-30):
 *   1. `valve1State` (lectura directa de intIn): máscara de bits del PLC → bit0 = abierta(1) /
 *      cerrada(0), con bit14 = estado válido. Es decir 16384 = CERRADA, 16385 = ABIERTA. Los
 *      sitios que no siguen esa máscara declaran sus valores literales en `stateEncoding`
 *      (Cascajal: 251 = CERRADA) — ver `stateFromWord`.
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

/**
 * Método 1: decodifica la palabra de estado del PLC.
 *
 * Dos convenciones, porque las plantas no son iguales:
 *
 *  1. **Valores literales** (`stateEncoding` en el mapping), si el sitio los declara. Cascajal
 *     reporta `251` = CERRADA en `INT_IN[1]`, verificado en campo por el operador el 2026-08-13.
 *     Ese valor NO trae el bit14, así que la regla de bits lo descartaba como "sin estado válido"
 *     y la planta se quedaba muda: por eso los literales mandan cuando existen.
 *  2. **Máscara de bits** (Vorágine/Sirena): bit14 = estado válido, bit0 = abierta.
 *
 * En ambas, un valor que no encaja devuelve `null` y el veredicto cae al caudal. Es deliberado:
 * más vale no afirmar nada que enseñar una válvula "cerrada" que está abierta.
 */
function stateFromWord(word: number | null, encoding?: SignalDto['stateEncoding']): ValveState | null {
  if (word === null) return null;

  if (encoding && (encoding.closed !== undefined || encoding.open !== undefined)) {
    if (word === encoding.closed) return 'closed';
    if (word === encoding.open) return 'open';
    // El sitio declaró su convención y este valor no es ninguno de los suyos. NO se cae a la regla
    // de bits: mezclarlas es justo como se inventaron estados falsos antes (ver fix-valve-state).
    return null;
  }

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
    const byState = stateFromWord(rawState, stateSig?.stateEncoding);
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

// ── Interpretación del resultado de un comando ────────────────────────────────────────────────

export interface CommandVerdict {
  /** Éxito real: el equipo confirmó el cambio de estado. */
  ok: boolean;
  /** La orden salió al PLC (el bit se escribió), aunque el equipo no haya respondido. */
  signalSent: boolean;
  title: string;
  message: string;
}

/**
 * Traduce el resultado del canal oficial a algo que un operador entienda, distinguiendo lo que de
 * verdad importa: **¿salió la señal?** vs **¿respondió el equipo?**. Un `502` con el eco verificado
 * NO es "no funcionó": es "la orden salió y el equipo no acusó el cambio" — típicamente una falla
 * física que impide accionar.
 */
export function interpretCommand(r: ValveCommandResult, verb: 'open' | 'close', valveName: string): CommandVerdict {
  const accion = verb === 'open' ? 'abrir' : 'cerrar';
  const nuevoEstado = verb === 'open' ? 'ABIERTA' : 'CERRADA';

  if (r.status === 'confirmed') {
    return {
      ok: true,
      signalSent: true,
      title: `Orden confirmada`,
      message: `${valveName}: el equipo confirmó el cambio. Ahora está ${nuevoEstado}.`,
    };
  }

  // La orden salió y el eco la verificó, pero el canal de estado de este sitio no está verificado
  // en campo: no hay con qué afirmar NI negar que la válvula se movió. Se informa exactamente eso.
  if (r.status === 'sent') {
    return {
      ok: true,
      signalSent: true,
      title: 'Orden enviada al equipo',
      message:
        `${valveName}: la señal de ${accion} se escribió en el PLC y quedó verificada en el canal ` +
        `(bit ${r.writtenValue}). Esta planta no reporta un estado eléctrico verificado, así que el ` +
        `sistema no puede confirmar por sí solo que la válvula se movió. Verifique en sitio.`,
    };
  }

  if (r.status === 'failed' && r.reason === 'WRITE_REJECTED') {
    return {
      ok: false,
      signalSent: false,
      title: 'No se pudo enviar la señal',
      message:
        `${valveName}: el PLC RECHAZÓ la escritura, así que la orden de ${accion} no salió. ` +
        `Revisa la conexión con el equipo y vuelve a intentar.`,
    };
  }

  if (r.status === 'failed') {
    // READBACK_UNCONFIRMED (u otro fallo tras escribir).
    const eco = r.writeVerified === true;
    return {
      ok: false,
      signalSent: eco,
      title: eco ? 'La señal salió, el equipo no respondió' : 'La orden no se pudo confirmar',
      message: eco
        ? `${valveName}: la señal de ${accion} SÍ se escribió en el PLC (bit ${r.writtenValue} verificado), ` +
          `pero el equipo no reportó el cambio de estado. Es probable que exista una FALLA FÍSICA que impida ` +
          `accionar la válvula. La app mantiene el último estado real leído.`
        : `${valveName}: no se pudo verificar que la orden de ${accion} llegara al equipo. No se asume ningún cambio.`,
    };
  }

  // Rechazos ANTES de escribir: nada llegó al PLC.
  const reason = r.reason ?? '';
  if (reason.startsWith('INTERLOCK_FAILED')) {
    return {
      ok: false,
      signalSent: false,
      title: 'No se envió: enclavamiento',
      message:
        `${valveName}: por seguridad no se acciona sin datos frescos del sitio. ` +
        `Espera a que la planta vuelva a reportar y reintenta. (${reason})`,
    };
  }
  if (reason === 'FORBIDDEN') {
    return { ok: false, signalSent: false, title: 'Sin permiso', message: `Tu rol no puede operar válvulas.` };
  }
  if (reason === 'WRITES_DISABLED_INSECURE_SESSION') {
    return {
      ok: false,
      signalSent: false,
      title: 'Escritura deshabilitada',
      message: `El servidor tiene el canal de escritura bloqueado por configuración. Avisa al administrador.`,
    };
  }
  if (reason === 'UNKNOWN_COMMAND') {
    return {
      ok: false,
      signalSent: false,
      title: `Comando no disponible`,
      message: `${valveName}: la orden de ${accion} no está definida para esta válvula.`,
    };
  }
  if (reason === 'TARGET_NOT_WRITABLE') {
    return {
      ok: false,
      signalSent: false,
      title: 'Válvula no operable',
      message: `${valveName} no tiene canal de mando configurado.`,
    };
  }
  if (reason === 'IN_PROGRESS') {
    return { ok: false, signalSent: false, title: 'Orden en curso', message: `${valveName}: ya hay una orden ejecutándose. Espera el resultado.` };
  }
  if (reason === 'SESSION_EXPIRED') {
    return { ok: false, signalSent: false, title: 'Sesión vencida', message: 'Vuelve a iniciar sesión.' };
  }
  if (reason === 'NETWORK') {
    return {
      ok: false,
      signalSent: false,
      title: 'Sin conexión con el servidor',
      message: `No se pudo enviar la orden de ${accion}. No se sabe si salió: verifica el estado antes de reintentar.`,
    };
  }
  return { ok: false, signalSent: false, title: 'La orden no se ejecutó', message: `${valveName}: ${reason || 'motivo desconocido'}.` };
}

// ── Detección de operación MANUAL ─────────────────────────────────────────────────────────────

export type ManualEvent = 'opened' | 'closed' | null;

/**
 * ¿La válvula se operó A MANO? La pista es física: el estado según el CAUDAL cambió (cruzó el umbral
 * de 0.1) mientras la lectura eléctrica del PLC NO lo reflejó y nosotros no mandamos ninguna orden.
 * En ese caso el estado de la app debe seguir al caudal, o quedaría desincronizado y mandaríamos
 * "abrir" a algo ya abierto.
 *
 * @param prevFlow  estado por caudal en la lectura anterior
 * @param currFlow  estado por caudal ahora
 * @param prevState estado eléctrico anterior (método 1)
 * @param currState estado eléctrico ahora (método 1)
 * @param commandRecently true si NOSOTROS mandamos una orden hace poco (entonces no es manual)
 */
export function detectManual(
  prevFlow: ValveState | null,
  currFlow: ValveState | null,
  prevState: ValveState | null,
  currState: ValveState | null,
  commandRecently: boolean,
): ManualEvent {
  if (commandRecently) return null; // el cambio lo provocamos nosotros
  if (prevFlow === null || currFlow === null || prevFlow === currFlow) return null; // el caudal no cambió de lado
  if (prevState !== null && currState !== null && prevState !== currState) return null; // el PLC sí lo reportó → fue eléctrico
  return currFlow === 'open' ? 'opened' : 'closed';
}
