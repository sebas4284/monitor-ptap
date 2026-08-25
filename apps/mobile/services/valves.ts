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
  /**
   * ¿Se puede accionar desde la app? `false` = la válvula existe y su estado se muestra, pero no
   * tiene canal de comando en el mapping (la de ENTRADA de La Vorágine, cuya frecuencia de bits aún
   * no conocemos). Sin esto se le ofrecía al operador un botón que, tras confirmar la maniobra en un
   * diálogo, solo podía devolver un 404.
   */
  commandable: boolean;
  /**
   * Verbos que ESTA válvula acepta, según su mapping (`SignalDto.commands`).
   *
   * No es lo mismo que `commandable`. Ese dice si hay canal de mando; esto dice QUÉ se puede
   * mandar por él: hoy solo La Vorágine y La Sirena declaran `close`, así que en las otras ocho
   * un "cerrar" sale al backend para volver con `UNKNOWN_COMMAND` después de que el operador
   * confirmara la maniobra. Vacío = el mapping no declara ninguno (no debería ocurrir).
   */
  commands: string[];
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
function stateFromWord(
  word: number | null,
  encoding?: SignalDto['stateEncoding'],
  trusted?: boolean,
): ValveState | null {
  if (word === null) return null;
  // El sitio declara que su palabra de estado NO es fiable: se sigue mostrando como diagnóstico
  // (`rawState`), pero el veredicto lo da el caudal, que es evidencia física. La Sirena está así:
  // su registro decía CERRADA con 23,33 l/s entrando.
  if (trusted === false) return null;

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
function referenceFlow(
  signals: Record<string, SignalDto>,
  declarado?: string,
): { value: number | null; unit: string | null; label: string | null } {
  // Si el mapping declara QUÉ caudal corresponde a esta válvula, manda ese y no se adivina. El
  // orden de abajo es una SUPOSICIÓN que acierta o falla según dónde esté físicamente la válvula,
  // y elegir mal miente justo en el caso que importa: una válvula de salida cerrada con la entrada
  // llenando el tanque, o una de entrada cerrada con el tanque vaciándose aguas abajo. En ambos
  // hay caudal en el lado que NO manda, y se afirmaría "abierta" con la válvula cerrada.
  const orden = declarado ? [declarado] : ['outletFlow1', 'outletFlow2', 'inletFlow1', 'inletFlow2'];
  for (const key of orden) {
    const sig = signals[key];
    const value = numeric(sig);
    if (value !== null) return { value, unit: sig?.unit ?? null, label: sig?.label ?? key };
  }
  return { value: null, unit: null, label: null };
}

export function valvesFromSnapshot(snapshot: PlantSnapshotDto | undefined): ValveView[] {
  if (!snapshot) return [];
  const out: ValveView[] = [];

  // Una válvula por cada señal de comando valve<N> presente en el mapping de la planta.
  const nums = new Set<number>();
  for (const key of Object.keys(snapshot.signals)) {
    const m = /^valve(\d+)$/.exec(key);
    if (m) nums.add(Number(m[1]));
  }

  for (const n of [...nums].sort((a, b) => a - b)) {
    const cmd = snapshot.signals[`valve${n}`];
    // El caudal se resuelve POR VÁLVULA: cada una puede estar en un punto distinto del proceso.
    const flow = referenceFlow(snapshot.signals, cmd?.flowDomainKey);
    const stateSig = snapshot.signals[`valve${n}State`];
    const rawState = numeric(stateSig);
    const byState = stateFromWord(rawState, stateSig?.stateEncoding, stateSig?.stateTrusted);
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
      // Ausente ⇒ accionable: el backend solo manda el campo cuando vale false, y así una válvula
      // de las de siempre se comporta igual que antes de que este campo existiera.
      commandable: cmd?.commandable !== false,
      commands: cmd?.commands ?? [],
      rawState,
      ts: stateSig?.ts ?? cmd?.ts ?? null,
    });
  }
  return out;
}

/**
 * ¿Qué se puede hacer con esta válvula AHORA, y si no se puede, por qué?
 *
 * Vive aquí y no en el componente porque es la regla que decide si se dibuja un control sobre un
 * actuador físico: se prueba sin UI. Y devuelve el MOTIVO además del veredicto, porque un control
 * que desaparece sin explicación se lee como una app rota — fue justo lo que pasó al quitar el
 * mando entero: había un icono con forma de interruptor que no respondía y nadie sabía por qué.
 *
 * Orden de las puertas, de la más dura a la más específica:
 *
 *  1. `frozen` — la planta no reporta. El interlock del backend rechazaría la orden de todas
 *     formas (`snapshot frozen`), así que ofrecerla es prometer algo que no va a pasar.
 *  2. Sin canal de mando (`commandable:false`) — la válvula existe y se muestra, pero su mapping
 *     no tiene por dónde escribir. Es la de ENTRADA de La Vorágine.
 *  3. Estado desconocido — no se sabe si está abierta o cerrada, así que no se sabe hacia dónde
 *     moverla. Accionar a ciegas un actuador es peor que no ofrecerlo; y en la práctica este caso
 *     casi siempre coincide con el 1, porque el estado se deduce del caudal y un caudal inusable
 *     es justo lo que deja la planta congelada.
 *  4. El verbo que TOCA no está declarado — el caso de las ocho plantas sin `close`. Antes esto
 *     llegaba al backend y volvía `UNKNOWN_COMMAND` DESPUÉS de que el operador confirmara.
 */
export type ValveAction =
  | { kind: 'command'; verb: 'open' | 'close' }
  | { kind: 'blocked'; reason: 'frozen' | 'no-channel' | 'unknown-state' | 'verb-missing'; explain: string };

export function accionDisponible(valve: ValveView, frozen: boolean): ValveAction {
  if (frozen) {
    return { kind: 'blocked', reason: 'frozen', explain: 'La planta no está reportando: no se puede accionar sin lecturas recientes.' };
  }
  if (!valve.commandable) {
    return { kind: 'blocked', reason: 'no-channel', explain: 'Esta válvula no tiene canal de mando configurado; solo se muestra su estado.' };
  }
  // Se usa el estado EFECTIVO (el que sigue al caudal si se detectó operación manual): mandar
  // "abrir" a algo que ya se abrió a mano no es inofensivo, es una orden redundante en un equipo.
  const estado = valve.state;
  if (estado === 'unknown') {
    return { kind: 'blocked', reason: 'unknown-state', explain: 'No se sabe si está abierta o cerrada, así que no se puede saber hacia dónde moverla.' };
  }
  const verbo = estado === 'open' ? 'close' : 'open';
  if (!valve.commands.includes(verbo)) {
    return {
      kind: 'blocked',
      reason: 'verb-missing',
      explain:
        verbo === 'close'
          ? 'Esta planta no declara canal de cierre: solo puede accionarse la apertura.'
          : 'Esta planta no declara canal de apertura.',
    };
  }
  return { kind: 'command', verb: verbo };
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
  /**
   * Cómo se pinta el resultado. Tres estados, no dos, y esa es la corrección que importa.
   *
   * Con un booleano, el desenlace «la señal salió pero nadie puede confirmar que la válvula se
   * movió» devolvía `ok: true` y el diálogo lo pintaba **verde con un tick**, sobre un texto que
   * decía «Verifique en sitio». El semáforo afirmaba éxito y la letra pequeña pedía ir a mirar:
   * nadie va a mirar. Ahora ese caso es ÁMBAR, que es lo que significa de verdad — ni éxito ni
   * fallo, sino incertidumbre que alguien tiene que resolver con los ojos.
   */
  tone: 'success' | 'warning' | 'danger';
  title: string;
  message: string;
  /** Códigos internos y valores crudos: útiles para reportar, nunca dentro de la frase. */
  technical?: string | null;
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
      tone: 'success',
      title: `Orden confirmada`,
      message: `${valveName}: el equipo confirmó el cambio. Ahora está ${nuevoEstado}.`,
    };
  }

  // La orden salió y el eco la verificó, pero el canal de estado de este sitio no está verificado
  // en campo: no hay con qué afirmar NI negar que la válvula se movió. Se informa exactamente eso —
  // y en ÁMBAR, porque pintarlo de verde convertía «ve a comprobarlo» en «listo, ya está».
  if (r.status === 'sent') {
    return {
      ok: true,
      signalSent: true,
      tone: 'warning',
      title: 'Verifique en la planta: no se pudo confirmar',
      message:
        `${valveName}: la orden de ${accion} salió y quedó registrada. Esta planta no informa del ` +
        `estado real de la válvula, así que el sistema no puede saber si se movió. Compruébelo en sitio.`,
      // El valor crudo del bit fuera de la frase: no significa nada para quien opera y rompía la
      // lectura. Sigue disponible para reportar una incidencia.
      technical: `valor escrito: ${r.writtenValue}`,
    };
  }

  if (r.status === 'failed' && r.reason === 'WRITE_REJECTED') {
    return {
      ok: false,
      signalSent: false,
      tone: 'danger',
      title: 'No se pudo enviar la señal',
      message:
        `${valveName}: el equipo RECHAZÓ la orden de ${accion}, así que no salió. ` +
        `Revisa la conexión con la planta y vuelve a intentarlo.`,
    };
  }

  if (r.status === 'failed') {
    // READBACK_UNCONFIRMED (u otro fallo tras escribir).
    const eco = r.writeVerified === true;
    return {
      ok: false,
      signalSent: eco,
      tone: 'danger',
      title: eco ? 'La válvula no respondió' : 'La orden no se pudo confirmar',
      message: eco
        ? `${valveName}: la orden de ${accion} salió correctamente, pero la válvula no cambió de estado. ` +
          `Lo más probable es que esté trabada o sin energía. Revísala en sitio.`
        : `${valveName}: no se pudo verificar que la orden de ${accion} llegara al equipo. No se asume ningún cambio.`,
      technical: eco ? `valor escrito: ${r.writtenValue}, verificado` : null,
    };
  }

  // Rechazos ANTES de escribir: nada llegó al PLC.
  const reason = r.reason ?? '';
  if (reason.startsWith('INTERLOCK_FAILED')) {
    return {
      ok: false,
      signalSent: false,
      tone: 'danger',
      title: 'No se envió: falta dato fresco',
      message:
        `${valveName}: por seguridad no se acciona una válvula sin lecturas recientes de la planta. ` +
        `Espera a que vuelva a reportar y reinténtalo.`,
      technical: reason,
    };
  }
  if (reason === 'FORBIDDEN') {
    return { ok: false, signalSent: false, tone: 'danger', title: 'Sin permiso', message: `Tu rol no puede operar válvulas.` };
  }
  if (reason === 'WRITES_DISABLED_INSECURE_SESSION') {
    return {
      ok: false,
      signalSent: false,
      tone: 'danger',
      title: 'Escritura deshabilitada',
      message: `El servidor tiene el canal de escritura bloqueado por configuración. Avisa al administrador.`,
    };
  }
  if (reason === 'UNKNOWN_COMMAND') {
    return {
      ok: false,
      signalSent: false,
      tone: 'danger',
      title: `Comando no disponible`,
      message: `${valveName}: la orden de ${accion} no está definida para esta válvula.`,
    };
  }
  if (reason === 'TARGET_NOT_WRITABLE') {
    return {
      ok: false,
      signalSent: false,
      tone: 'danger',
      title: 'Válvula no operable',
      message: `${valveName} no tiene canal de mando configurado.`,
    };
  }
  if (reason === 'IN_PROGRESS') {
    return { ok: false, signalSent: false, tone: 'warning', title: 'Orden en curso', message: `${valveName}: ya hay una orden ejecutándose. Espera el resultado.` };
  }
  if (reason === 'SESSION_EXPIRED') {
    return { ok: false, signalSent: false, tone: 'danger', title: 'Sesión vencida', message: 'Vuelve a iniciar sesión.' };
  }
  if (reason === 'NETWORK') {
    return {
      ok: false,
      signalSent: false,
      tone: 'danger',
      title: 'Sin conexión con el servidor',
      message: `No se pudo enviar la orden de ${accion}. No se sabe si salió: verifica el estado antes de reintentar.`,
    };
  }
  // El fallback NO vuelca el código del backend como si fuese español: se leía
  // "Válvula de salida: RATE_LIMITED." El código va aparte, para poder reportarlo.
  return {
    ok: false,
    signalSent: false,
    tone: 'danger',
    title: 'La orden no se ejecutó',
    message: `${valveName}: el servidor rechazó la orden y no llegó a la planta.`,
    technical: reason || 'motivo desconocido',
  };
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
