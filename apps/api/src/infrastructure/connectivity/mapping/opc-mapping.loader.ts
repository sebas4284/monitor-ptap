import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Carga config/opc_mapping.json y expone lo que el adaptador necesita para
 * suscribirse: la lista de buffers de datos por planta con su { nsUri, identifier }.
 * Fail-fast: si el archivo falta o no parsea, el proceso no arranca.
 *
 * NO valida el schema completo aquí (eso es scripts/validate-mapping.ts, gate de CI);
 * hace comprobaciones mínimas de forma para fallar temprano y claro.
 */

export interface NodeRef {
  nsUri: string;
  identifier: string; // con prefijo de tipo: g= | i= | s= | b=
}

export interface MonitorTarget {
  plantId: string;
  browseName: string;
  channel: string;
  node: NodeRef;
  arrayLength: number | null;
  dataType: string | null;
}

/** Par opMin/opMax para un tipo de día concreto (ver `SignalMapping.opRangeByDay`). */
export interface RangoOperativo {
  opMin?: number;
  opMax?: number;
}

/** Elemento de un buffer (canal + browseName + índice). Fase 5: destino/feedback de escritura. */
export interface BufferElementRef {
  channel: string;
  sourceBuffer: string;
  index: number;
}

/** Un paso de una orden compuesta: qué valor va a qué posición del buffer de salida. */
export interface WriteStep {
  index: number;
  value: number | boolean;
}

/**
 * Elemento de realimentación que dice cuándo soltar una señal sostenida (`pulse.until`).
 *
 * Se compara por VALOR COMPLETO, no por bits, y es una decisión deliberada: en La Vorágine
 * `INT_IN[1]` vale 1025 = bits{0,10}, así que una condición "bit 0 encendido" ya se cumpliría con la
 * válvula quieta y cortaría la señal antes de que llegara a moverse.
 */
export interface FeedbackRef {
  channel: string;
  sourceBuffer: string | null;
  index: number;
  equals: number | boolean;
}

/**
 * Realimentación POR BITS de una orden de pulso (`pulse.feedback`). Integrador del PLC de La
 * Vorágine, entrega del 2026-10-23: el bit de mando se mantiene en 1 hasta que el PLC informa
 * «abierta» o «cerrada» (según el verbo) o «falla», y entonces vuelve a 0.
 *
 * Cada campo es una MÁSCARA DE UN BIT dentro de la palabra `sourceBuffer[index]`, que pueden
 * compartir varias válvulas (en La Vorágine, `INT_IN_VORAGINE[1]`: entrada abierta bit0, cerrada
 * bit1, falla bit4; salida abierta bit10, cerrada bit11, falla bit14). Es por bits, y no por valor
 * completo como `until`, porque la palabra lleva a la vez los bits de las dos válvulas: el 16/10 valía
 * 1041 = {0,4,10}, entrada abierta CON falla y salida abierta.
 *
 * Reglas en `motivoRealimentacionInvalida`.
 */
export interface RealimentacionPorBits {
  channel: string;
  sourceBuffer: string;
  index: number;
  open: number;
  close: number;
  fault: number;
}

/** Tope duro de un sostenido con realimentación: 180 s (la planta usa 120 s; ver el mapping). */
export const HOLD_MS_MAX_CON_REALIMENTACION = 180_000;

/**
 * Mando RETIRADO de una válvula que hoy no se acciona (`writable: false`) pero que se accionó con
 * este spec y pudo dejar bits puestos en el PLC. No da botón, ni verbos, ni pasa por el WriteService:
 * existe SOLO para que la limpieza de bits huérfanos sepa qué bits apagar al conectar el puente
 * (especificación del integrador del 2026-10-23: ningún 1 de mando puede quedarse puesto).
 */
export interface MandoConservado {
  target: BufferElementRef;
  /** Todos los bits de mando de la válvula (OR de las máscaras de sus verbos). */
  bits: number;
  commands: Record<string, number>;
}

/** Fase 5: traducción de comando de dominio a escritura de buffer/bit (vive en el mapping, regla 2). */
export interface WriteSpec {
  target: BufferElementRef; // buffer de SALIDA donde se escribe
  commands: Record<string, number | boolean>; // verbo → valor a escribir
  /**
   * ORDEN COMPUESTA: un verbo que necesita escribir VARIAS posiciones del mismo buffer para que el
   * equipo se mueva.
   *
   * Existe porque en La Sirena (y probablemente en el resto) la válvula la maneja un relé
   * conmutador en montaje de inversión de giro: una posición del buffer da el sentido y otra lo
   * quita. Escribir solo una **no puede mover la válvula jamás** — es exactamente por lo que la
   * prueba de campo del 2026-08-03 concluyó "canal sin actuador" cuando en realidad la orden
   * estaba incompleta.
   *
   * Reglas que el loader EXIGE (una secuencia que las incumpla invalida el spec entero y deja la
   * señal como no-writable, que es el lado seguro):
   *  1. el verbo debe existir también en `commands`, y el paso que toca `target.index` debe llevar
   *     el mismo valor — si no, el mapping se contradice a sí mismo;
   *  2. **primero se desenergiza, después se energiza**: ningún paso a cero puede ir detrás de uno
   *     distinto de cero. Al revés existe una ventana con las dos direcciones activas a la vez, que
   *     es justo lo que el protocolo declara ERROR;
   *  3. como mucho UNA posición queda energizada al final, por el mismo motivo;
   *  4. sin índices repetidos (dos valores para la misma posición es ambigüedad, no orden).
   *
   * Los pasos se escriben SIEMPRE en absoluto: la posición es el canal, no un bit dentro de una
   * palabra compartida, así que `mode: bitmask` es incompatible y también invalida el spec.
   */
  sequences?: Record<string, WriteStep[]>;
  /**
   * `true` ⇒ la orden es SOSTENIDA: el valor se queda puesto y NO se hace rollback si el estado no
   * confirma. Es lo correcto cuando cada verbo define un estado eléctrico completo y su opuesto es
   * el otro verbo (abrir = c0:1/c1:0, cerrar = c0:0/c1:1): deshacer un "abrir" a 0/0 dejaría el
   * actuador en un estado que no es ni abierto ni cerrado, y que nadie pidió.
   *
   * Incompatible con `pulse` (uno se limpia solo, el otro no debe limpiarse). Es la versión para
   * ÓRDENES COMPUESTAS (`sequences`, posiciones del array en absoluto); para un par de bits dentro
   * de una palabra compartida está `sustained`.
   */
  latched?: boolean;
  /**
   * **RETIRADA el 2026-10-23** para toda válvula accionable (`MOTIVO_SOSTENIDA_RETIRADA`): el
   * integrador corrigió la especificación y la orden se mantiene solo hasta la realimentación
   * (`pulse.feedback`). El loader ya no carga una válvula `writable` con `sustained`; el spec solo
   * sobrevive como mando conservado de una `writable: false`, para la limpieza de huérfanos. Lo de
   * abajo describe lo que fue, que es lo que esa limpieza deshace.
   *
   * `true` ⇒ SEÑAL SOSTENIDA en una palabra compartida. Integrador del PLC de La Vorágine,
   * 2026-10-16, textual: «estas señales deben ser sostenidas, es decir que todo el tiempo debe quedar
   * la señal de apertura o la señal de cierre, nunca las dos, siempre una de las dos».
   *
   * Cada verbo es una máscara de bits de `target` y la orden es UNA escritura read-modify-write:
   * `(actual & ~bitsDeLosOtrosVerbos) | bitsDelVerbo` (ver `WriteService.applyValue`). La palabra pasa
   * de un verbo al otro sin ningún instante con los dos (1/1) ni con ninguno (0/0), y los bits de las
   * demás válvulas de la palabra no se tocan. Y luego **no se suelta nunca**: ni al terminar, ni si el
   * estado no confirma, ni si algo falla — soltar es justo dejar la válvula en 0/0.
   *
   * Reglas que el loader EXIGE, y con las que el backend NO ARRANCA si se incumplen (ver
   * `motivoSostenidaInvalida`): `mode: 'bitmask'`; al menos dos verbos, cada uno una máscara entera
   * de 1 a 65535 y sin bits compartidos entre ellos; y prohibidos `pulse`, `rollbackValue`,
   * `sequences` y `latched`.
   *
   * Se llama `sustained` y no se reutilizó `latched` aunque ambos «no deshacen»: `latched` es de las
   * órdenes compuestas (posiciones en absoluto, con su `rollbackValue`), y en este código «enclavar»
   * significa otra cosa en los dos sitios donde aparece — un bit ENCLAVADO es la avería que el pulso
   * evita, y `latchMode: 'latch'` del simulador es un PLC que se mueve con el flanco, lo contrario de
   * lo que pidió el integrador. «Sostenida» es su palabra.
   */
  sustained?: boolean;
  /**
   * Cómo se aplica el valor sobre el elemento:
   *  - `absolute` (default): se escribe el valor tal cual (pisa la palabra completa).
   *  - `bitmask`: read-modify-write → activar = `(actual & ~bitsDeLosOtrosVerbos) | valor` (apaga el
   *    verbo contrario de la MISMA válvula en la misma escritura), limpiar = `actual & ~valor`.
   *    OBLIGATORIO cuando la palabra concentra VARIOS comandos/válvulas: escribir absoluto
   *    apagaría los bits ajenos que estuvieran activos (p. ej. otra válvula del mismo sitio).
   */
  mode: 'absolute' | 'bitmask';
  /**
   * Si está presente, el comando es un PULSO: se activa, se sostiene `holdMs` y se limpia
   * SIEMPRE (haya confirmado el estado o no). Sin esto, un comando `confirmed` dejaba el bit
   * ENCLAVADO para siempre, porque el rollback solo corría al fallar el read-back.
   *
   * Con `until`, el sostenido deja de ser a ciegas: se sondea ese elemento y el bit se suelta en
   * cuanto vale `equals`, que es como funciona un actuador motorizado — la señal se mantiene hasta
   * que el final de carrera avisa. Ahí `holdMs` pasa a ser el **tope duro**, no la duración: si la
   * realimentación no llega nunca (sensor averiado, válvula atascada) el bit se limpia igualmente y
   * el comando se reporta fallido. Nunca se sostiene indefinidamente, lo pida quien lo pida: dejar
   * una bobina energizada sin que nadie se entere es peor que abortar la maniobra.
   *
   * Con `feedback` (realimentación POR BITS, integrador 2026-10-23) el sostenido corre en SEGUNDO
   * PLANO: la orden responde en cuanto la escritura sale, y el bit se suelta cuando, pasados
   * `minHoldMs`, el PLC informa el estado del verbo o la falla; o al vencer `holdMs`. `minHoldMs`
   * existe porque la MSG tarda ~16 s en cada sentido: una lectura anterior a la orden no puede darse
   * por buena.
   */
  pulse: { holdMs: number; minHoldMs?: number; until?: FeedbackRef; feedback?: RealimentacionPorBits } | null;
  readBack: {
    channel: string;
    sourceBuffer: string | null;
    index: number;
    confirmsWrittenValue: boolean;
    expectedValue?: number | boolean;
    /**
     * Estado esperado POR VERBO. Necesario cuando cada comando deja un estado distinto: abrir espera
     * `16385` y cerrar `16384`, así que un único `expectedValue` no puede confirmar ambos. Si el verbo
     * no está aquí, se cae a `confirmsWrittenValue`/`expectedValue`.
     */
    expectedByCommand?: Record<string, number | boolean>;
    /** Compare only these status bits; the fault mask always takes priority. */
    mask?: number;
    faultMask?: number;
    /**
     * ¿La semántica de este canal de estado está VERIFICADA en campo? Default `true`.
     *
     * Con `false`, la falta de confirmación deja de significar «el equipo no respondió»: si el eco
     * demuestra que el valor quedó escrito en el canal de comando, el resultado es `sent`
     * (`SENT_STATE_UNVERIFIED`) en vez de `failed`. Existe porque el `expectedValue` de estas
     * plantas es una inferencia del patrón de Vorágine que nunca se observó en campo — y declarar
     * un fallo del equipo a partir de un número no verificado afirma tanto como declarar un éxito.
     */
    stateVerified: boolean;
  };
  timeoutMs: number;
  /**
   * Valor con el que se limpia un pulso en `absolute` y se deshace una orden no confirmada.
   * Obligatorio en todo spec SALVO en una orden sostenida (`sustained`, retirada) y en una con
   * realimentación por bits (`pulse.feedback`), donde está PROHIBIDO: la sostenida no se deshacía
   * nunca, y la de realimentación se limpia apagando SOLO su bit — un valor absoluto borraría la otra
   * válvula de la palabra.
   */
  rollbackValue?: number | boolean;
  permission: string; // Permission de @ptap/shared (control_valves | acknowledge_alarms | adjust_setpoints)
}

/** Señal de proceso mapeada: un elemento de un buffer con semántica de dominio. */
export interface SignalMapping {
  plantId: string;
  buffer: string; // canal (realIn, intIn, …); refiere al buffer PRIMARIO de ese canal en el sitio
  /** browseName exacto del buffer fuente. Obligatorio si el canal tiene varios buffers del mismo tamaño (la resolución por tamaño sería no determinista). */
  sourceBuffer?: string | null;
  index: number;
  domainKey: string;
  label: string | null;
  unit: string | null;
  min: number | null;
  max: number | null;
  /** Rango operativo/normativo (se expone en el DTO para que el front lo muestre). */
  opMin?: number | null;
  opMax?: number | null;
  /**
   * Rango operativo que CAMBIA segun el dia. Cuando esta, MANDA sobre opMin/opMax para el tipo de
   * dia que toque; `opMin`/`opMax` quedan como valor por defecto. El caudal de salida de La Voragine
   * es 1-3 l/s entre semana y 1-2 l/s sabados, domingos y festivos (cliente, 2026-08-20).
   */
  opRangeByDay?: { semana?: RangoOperativo; finde?: RangoOperativo };
  mappingStatus: 'mapped' | 'unmapped';
  confidence: 'confirmed' | 'inferred' | 'estimated';
  writable: boolean;
  /** Presente solo si writable (⇒ confidence:confirmed, garantizado por el schema). */
  write?: WriteSpec;
  /**
   * Solo en una válvula con el mando RETIRADO (`writable: false` y un `write` conservado en el JSON).
   * Nunca se usa para mandar: es lo que la limpieza de huérfanos apaga. Ver `MandoConservado`.
   */
  mandoConservado?: MandoConservado;
  /**
   * Valores literales de la palabra de estado de válvula para sitios que NO usan la máscara
   * bit14/bit0. Viaja al DTO para que el front no tenga que conocer cada planta. Ver `SignalDto`.
   */
  /** bits contains actual masks (1024 = bit10), never bit positions. */
  stateEncoding?: { closed?: number; open?: number; bits?: { open: number; close: number; fault: number } };
  /** Solo en válvulas: el caudal que corresponde a ESA válvula. Ver `SignalDto.flowDomainKey`. */
  flowDomainKey?: string;
  /** Solo en palabras de estado: `false` = se lee como diagnóstico pero NO decide el veredicto. */
  stateTrusted?: boolean;
}

export interface LoadedPlant {
  plantId: string;
  displayName: string;
  /** Ventana de liveness específica del sitio (s). null → usar el default de .env. */
  livenessWindowSec: number | null;
}

export interface LoadedMapping {
  version: string;
  protocolVersion: string;
  dtoVersion: string;
  plants: LoadedPlant[];
  targets: MonitorTarget[];
  signals: SignalMapping[];
  raw: unknown; // el documento completo, para resolveNamespaces()
}

// Canales de DATOS que se suscriben (1 MonitoredItem por buffer, regla 6).
// Se excluyen msgRead/msgWrite: son estructuras de diagnóstico, no arrays de proceso.
const DATA_CHANNELS = new Set(['realIn', 'realOut', 'intIn', 'intOut', 'bitIn', 'bitOut']);

function resolvePath(explicit?: string): string {
  const candidates = [
    explicit,
    process.env.OPC_MAPPING_PATH,
    join(process.cwd(), 'config', 'opc_mapping.json'),
    join(process.cwd(), 'apps', 'api', 'config', 'opc_mapping.json'),
    join(__dirname, '..', '..', '..', '..', 'config', 'opc_mapping.json'),
  ].filter((c): c is string => !!c);

  const found = candidates.find((c) => existsSync(c));
  if (!found) {
    throw new Error(`No se encontró opc_mapping.json. Rutas probadas: ${candidates.join(', ')}`);
  }
  return found;
}

/**
 * La ruta que `loadMapping()` cargaría con estos argumentos y este entorno. El simulador la usa para
 * comprobar que un escenario se está ejecutando contra el mapping que exige (ver sim-scenario.ts).
 */
export function resolverRutaDelMapping(explicitPath?: string): string {
  return resolvePath(explicitPath);
}

interface RawWriteSpec {
  target?: { channel?: string; sourceBuffer?: string; index?: number };
  commands?: Record<string, number | boolean>;
  sequences?: Record<string, Array<{ index?: unknown; value?: unknown }>>;
  latched?: unknown;
  sustained?: unknown;
  mode?: string;
  pulse?: {
    holdMs?: number;
    minHoldMs?: unknown;
    until?: { channel?: unknown; sourceBuffer?: unknown; index?: unknown; equals?: unknown };
    feedback?: unknown;
  };
  readBack?: {
    channel?: string;
    sourceBuffer?: string;
    index?: number;
    confirmsWrittenValue?: boolean;
    expectedValue?: number | boolean;
    expectedByCommand?: Record<string, number | boolean>;
    /** Compare only these status bits; the fault mask always takes priority. */
    mask?: number;
    faultMask?: number;
    stateVerified?: boolean;
  };
  timeoutMs?: number;
  rollbackValue?: number | boolean;
  permission?: string;
}

interface RawSignal {
  buffer?: string;
  sourceBuffer?: string;
  index?: number;
  domainKey?: string;
  label?: string;
  unit?: string;
  min?: number;
  max?: number;
  opMin?: number;
  opMax?: number;
  opRangeByDay?: { semana?: RangoOperativo; finde?: RangoOperativo };
  mappingStatus?: string;
  confidence?: string;
  writable?: boolean;
  write?: RawWriteSpec;
  stateEncoding?: { closed?: unknown; open?: unknown; bits?: { open?: unknown; close?: unknown; fault?: unknown } };
  flowDomainKey?: unknown;
  stateTrusted?: unknown;
}

/**
 * Valores literales de estado, solo si son números. Se descarta la clave que no lo sea en vez de
 * dejarla pasar: un `closed: "251"` que llegara como texto nunca casaría con el número del PLC y
 * daría una válvula eternamente "sin estado" difícil de explicar.
 */
function validMask(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 0xffff;
}

export function motivoBitsEstadoInvalido(bits: unknown): string | null {
  const b = bits as { open?: unknown; close?: unknown; fault?: unknown } | null;
  if (!b || !validMask(b.open) || !validMask(b.close) || !validMask(b.fault)
    || (b.open & b.close) !== 0 || (b.open & b.fault) !== 0 || (b.close & b.fault) !== 0) {
    return 'stateEncoding.bits requiere máscaras no solapadas de 16 bits';
  }
  return null;
}

export function motivoMascarasReadBackInvalido(raw: { readBack?: { mask?: unknown; faultMask?: unknown; expectedByCommand?: Record<string, number | boolean>; expectedValue?: number | boolean; confirmsWrittenValue?: boolean }; commands?: Record<string, number | boolean> }): string | null {
  const rb = raw.readBack;
  if (!rb) return null;
  const { mask, faultMask } = rb;
  if ((mask !== undefined && !validMask(mask)) || (faultMask !== undefined && !validMask(faultMask))
    || (validMask(faultMask) && (!validMask(mask) || (mask & faultMask) !== 0))) {
    return 'readBack.mask/faultMask deben ser máscaras de 16 bits no solapadas';
  }
  if (validMask(mask)) {
    const expected = Object.values(rb.expectedByCommand ?? {});
    if (rb.expectedValue !== undefined) expected.push(rb.expectedValue);
    for (const [command, written] of Object.entries(raw.commands ?? {})) {
      expected.push(rb.expectedByCommand?.[command] ?? (rb.confirmsWrittenValue !== false ? written : rb.expectedValue ?? written));
    }
    if (expected.length === 0 || expected.some((v) => typeof v !== 'number' || !Number.isInteger(v) || v <= 0 || (v & mask) !== v)) {
      return 'readBack esperado debe pertenecer a mask y ser distinto de cero';
    }
  }
  return null;
}

function parseStateEncoding(raw: RawSignal['stateEncoding']): SignalMapping['stateEncoding'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const enc: NonNullable<SignalMapping['stateEncoding']> = {};
  if (typeof raw.closed === 'number') enc.closed = raw.closed;
  if (typeof raw.open === 'number') enc.open = raw.open;
  if (raw.bits !== undefined) {
    const bits = raw.bits;
    if (!bits || !validMask(bits.open) || !validMask(bits.close) || !validMask(bits.fault)
      || (bits.open & bits.close) !== 0 || (bits.open & bits.fault) !== 0 || (bits.close & bits.fault) !== 0) {
      throw new Error('opc_mapping.json: stateEncoding.bits requiere máscaras no solapadas de 16 bits');
    }
    enc.bits = { open: bits.open, close: bits.close, fault: bits.fault };
  }
  return enc.closed === undefined && enc.open === undefined && enc.bits === undefined ? undefined : enc;
}

/** Normaliza `pulse.until`. Devuelve undefined si le falta algo: nunca se completa a medias. */
function parseFeedback(raw: NonNullable<RawWriteSpec['pulse']>['until']): FeedbackRef | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  if (typeof raw.channel !== 'string' || typeof raw.index !== 'number') return undefined;
  if (typeof raw.equals !== 'number' && typeof raw.equals !== 'boolean') return undefined;
  return {
    channel: raw.channel,
    sourceBuffer: typeof raw.sourceBuffer === 'string' ? raw.sourceBuffer : null,
    index: raw.index,
    equals: raw.equals,
  };
}

/** Un paso está "energizado" si su valor no es cero/false. La posición en reposo es el 0. */
function energizado(value: number | boolean): boolean {
  return value !== 0 && value !== false;
}

/**
 * Valida una orden compuesta y devuelve el motivo del rechazo, o null si es correcta.
 *
 * Esto NO es una comprobación de forma (de eso se encarga el schema): son las reglas ELÉCTRICAS.
 * Se comprueban aquí, al cargar, y no al ejecutar, porque una secuencia mal escrita es un error del
 * mapping que debe descubrirse en `validate:mapping` o en el arranque — no con el operador delante
 * del tablero y la válvula a medio recorrido.
 */
export function motivoSecuenciaInvalida(
  verb: string,
  steps: WriteStep[],
  spec: { target: BufferElementRef; commands: Record<string, number | boolean>; mode: 'absolute' | 'bitmask' },
): string | null {
  if (steps.length === 0) return `${verb}: secuencia vacía`;
  if (spec.mode === 'bitmask') {
    return `${verb}: una secuencia escribe posiciones completas, no bits — mode debe ser 'absolute'`;
  }

  const vistos = new Set<number>();
  for (const s of steps) {
    if (vistos.has(s.index)) return `${verb}: la posición ${s.index} aparece dos veces`;
    vistos.add(s.index);
  }

  // El paso que toca el target primario tiene que decir lo mismo que `commands`, o el mapping se
  // contradice y no hay forma de saber cuál de los dos valores es el que se quiso.
  const primario = steps.find((s) => s.index === spec.target.index);
  if (!primario) return `${verb}: la secuencia no toca el canal primario (posición ${spec.target.index})`;
  if (primario.value !== spec.commands[verb]) {
    return `${verb}: la secuencia escribe ${String(primario.value)} en la posición ${spec.target.index} pero commands dice ${String(spec.commands[verb])}`;
  }

  // Desenergizar SIEMPRE antes de energizar: si un paso a cero va detrás de uno energizado, existe
  // una ventana con las dos direcciones activas.
  const primeroEnergizado = steps.findIndex((s) => energizado(s.value));
  if (primeroEnergizado >= 0) {
    const ceroTardio = steps.findIndex((s, i) => i > primeroEnergizado && !energizado(s.value));
    if (ceroTardio >= 0) {
      return `${verb}: el paso ${ceroTardio} (posición ${steps[ceroTardio].index}) desenergiza DESPUÉS de energizar — hay que soltar la dirección contraria primero`;
    }
  }

  const energizados = steps.filter((s) => energizado(s.value));
  if (energizados.length > 1) {
    return `${verb}: dejaría ${energizados.length} posiciones energizadas a la vez (${energizados.map((s) => s.index).join(', ')}) — dos direcciones opuestas activas es el fallo que el protocolo prohíbe`;
  }
  return null;
}

/** Algo está declarado si está y no es `null` (un `WriteSpec` parseado lleva `pulse: null` sin pulso). */
function declarado(v: unknown): boolean {
  return v !== undefined && v !== null;
}

/**
 * Valida una orden SOSTENIDA (`sustained: true`) y devuelve el motivo del rechazo, o null si es
 * correcta.
 *
 * Igual que `motivoSecuenciaInvalida`, esto no es forma: son las reglas que hacen que la orden cumpla
 * lo que pide el integrador — siempre abrir o cerrar puesto, nunca los dos, nunca ninguno. La usan el
 * loader (que con un spec sostenido inválido NO arranca), `validate:mapping`, la edición del mapeo en
 * caliente y el WriteService justo antes de escribir.
 *
 * Sirve para el JSON crudo y para un `WriteSpec` ya parseado, y por eso mira PRESENCIA, no validez:
 * un `pulse` mal escrito al lado de `sustained` sigue siendo pedir dos cosas opuestas.
 */
export function motivoSostenidaInvalida(spec: {
  commands?: unknown;
  mode?: unknown;
  pulse?: unknown;
  rollbackValue?: unknown;
  sequences?: unknown;
  latched?: unknown;
}): string | null {
  if (spec.mode !== 'bitmask' && spec.mode !== 'absolute') {
    return `mode debe ser 'bitmask' o 'absolute' y es ${JSON.stringify(spec.mode ?? 'indefinido')}`;
  }
  if (declarado(spec.pulse)) {
    return 'sustained y pulse son excluyentes: un pulso se LIMPIA al terminar, y una señal sostenida no se suelta nunca';
  }
  if (declarado(spec.rollbackValue)) {
    return 'una orden sostenida no lleva rollbackValue: no se deshace nunca, y volver a ese valor dejaría la válvula sin señal (0/0), que es justo lo que la regla prohíbe';
  }
  if (declarado(spec.sequences)) {
    return 'sustained no admite sequences: una orden compuesta escribe posiciones enteras en absoluto, y la sostenida es un par de bits dentro de una palabra';
  }
  if (spec.latched === true) {
    return 'sustained y latched no se combinan: latched es de las órdenes compuestas, y sustained ya implica no deshacer nunca';
  }
  if (!spec.commands || typeof spec.commands !== 'object') return 'sin commands';
  const verbos = Object.entries(spec.commands as Record<string, unknown>);
  if (verbos.length < 2) {
    return `una orden sostenida necesita al menos dos verbos (abrir y cerrar), y hay ${verbos.length}: sin el contrario, la señal no se podría cambiar nunca`;
  }
  let usados = 0;
  for (const [verbo, valor] of verbos) {
    if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < 1 || valor > 0xffff) {
      return `${verbo}: en una orden sostenida cada verbo es una máscara de bits entera de 1 a 65535, y vale ${JSON.stringify(valor)}`;
    }
    if ((usados & valor) !== 0) {
      return `${verbo} (${valor}) comparte bits con otro verbo de la misma válvula: activarlo dejaría puesto parte del contrario — abrir y cerrar a la vez`;
    }
    usados |= valor;
  }
  return null;
}

/** ¿Es un entero con UN solo bit puesto, dentro de una palabra de 16 bits (1, 2, 4 … 32768)? */
export function esMascaraDeUnBit(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 0x8000 && (v & (v - 1)) === 0;
}

/** ¿El spec (crudo o parseado) declara realimentación por bits? Mira PRESENCIA, no validez. */
export function tieneRealimentacionPorBits(spec: { pulse?: unknown } | null | undefined): boolean {
  const pulse = spec?.pulse;
  return typeof pulse === 'object' && pulse !== null && declarado((pulse as { feedback?: unknown }).feedback);
}

/**
 * Valida una orden de PULSO CON REALIMENTACIÓN POR BITS (`pulse.feedback`) y devuelve el motivo del
 * rechazo, o null si es correcta (o si el spec no declara `feedback`).
 *
 * Igual que `motivoSostenidaInvalida`: no es forma, son las reglas que hacen que la orden cumpla la
 * entrega del integrador del 2026-10-23 — el bit se mantiene hasta que el PLC confirma o da falla, y
 * nunca abrir y cerrar a la vez. La usan el loader (que con un spec así inválido NO arranca),
 * `validate:mapping`, la edición del mapeo en caliente y el WriteService justo antes de escribir.
 * Sirve para el JSON crudo y para un `WriteSpec` ya parseado.
 *
 * Reglas, y por qué:
 *  - **excluyente con `sustained`, `until`, `latched`, `sequences` y `rollbackValue`**: sostenida
 *    no se suelta nunca (lo contrario); `until` compara el valor entero (otra semántica para lo
 *    mismo); las órdenes compuestas escriben posiciones en absoluto; y limpiar escribiendo un
 *    `rollbackValue` en absoluto borraría la otra válvula de la palabra.
 *  - **`mode: 'bitmask'`**: la palabra de mando la comparten varias válvulas.
 *  - **`holdMs` de 1 a 180 000 ms** (tope duro) y **`minHoldMs` obligatorio, de 0 a `holdMs`**: sin
 *    él se daría por buena la realimentación anterior a la orden (la MSG tarda ~16 s por sentido).
 *  - **verbos exactamente `open` y `close`, cada uno una máscara de UN bit y distintos**: la
 *    realimentación se casa con el verbo por su nombre (abrir → `open`, cerrar → `close`), y una
 *    máscara de varios bits es casi siempre una errata (12 = bits 2 y 3 = abrir Y cerrar).
 *  - **`feedback.open/close/fault`: máscaras de un bit, distintas entre sí y sin solaparse con las
 *    del mando**; en `intIn` y en un elemento que NO sea la propia palabra de mando, que confirmaría
 *    la orden con su propio eco.
 */
export function motivoRealimentacionInvalida(spec: {
  target?: unknown;
  commands?: unknown;
  mode?: unknown;
  pulse?: unknown;
  rollbackValue?: unknown;
  sequences?: unknown;
  latched?: unknown;
  sustained?: unknown;
}): string | null {
  if (!tieneRealimentacionPorBits(spec)) return null;
  const pulse = spec.pulse as { holdMs?: unknown; minHoldMs?: unknown; until?: unknown; feedback?: unknown };

  if (spec.sustained === true) {
    return 'pulse.feedback y sustained son excluyentes: con realimentación el bit se suelta al confirmar, y una señal sostenida no se suelta nunca';
  }
  if (declarado(pulse.until)) {
    return 'pulse.feedback y pulse.until son excluyentes: until compara el valor ENTERO de un elemento y feedback, bits; dos condiciones de suelta para la misma orden no se sabe cuál manda';
  }
  if (spec.latched === true) return 'pulse.feedback y latched son excluyentes: latched no se suelta';
  if (declarado(spec.sequences)) {
    return 'pulse.feedback no admite sequences: una orden compuesta escribe posiciones enteras en absoluto, y esta es un bit dentro de una palabra compartida';
  }
  if (declarado(spec.rollbackValue)) {
    return 'una orden con realimentación no lleva rollbackValue: se limpia apagando SOLO su bit (actual & ~verbo); escribir un valor absoluto borraría la otra válvula de la palabra';
  }
  if (spec.mode !== 'bitmask') {
    return `mode debe ser 'bitmask' y es ${JSON.stringify(spec.mode ?? 'absolute (por omisión)')}: la palabra de mando la comparten varias válvulas`;
  }

  const holdMs = pulse.holdMs;
  if (typeof holdMs !== 'number' || !Number.isInteger(holdMs) || holdMs < 1 || holdMs > HOLD_MS_MAX_CON_REALIMENTACION) {
    return `pulse.holdMs es el tope duro del sostenido y tiene que ser un entero de 1 a ${HOLD_MS_MAX_CON_REALIMENTACION} ms (180 s); vale ${JSON.stringify(holdMs)}`;
  }
  const minHoldMs = pulse.minHoldMs;
  if (typeof minHoldMs !== 'number' || !Number.isInteger(minHoldMs) || minHoldMs < 0 || minHoldMs >= holdMs) {
    return `pulse.minHoldMs es obligatorio con feedback, entero de 0 a holdMs (${holdMs}) sin llegar: sin él se daría por buena una realimentación ANTERIOR a la orden; vale ${JSON.stringify(minHoldMs)}`;
  }

  if (!spec.commands || typeof spec.commands !== 'object') return 'sin commands';
  const commands = spec.commands as Record<string, unknown>;
  const verbos = Object.keys(commands).sort();
  if (verbos.length !== 2 || verbos[0] !== 'close' || verbos[1] !== 'open') {
    return `con realimentación los verbos tienen que ser exactamente open y close (la realimentación se casa con el verbo por su nombre), y son: ${verbos.join(', ') || '(ninguno)'}`;
  }
  for (const verbo of verbos) {
    if (!esMascaraDeUnBit(commands[verbo])) {
      return `${verbo}: con realimentación cada verbo es una máscara de UN bit (1, 2, 4 … 32768), y vale ${JSON.stringify(commands[verbo])}`;
    }
  }
  const mando = (commands.open as number) | (commands.close as number);
  if (commands.open === commands.close) return 'open y close son el mismo bit: abrir sería cerrar';

  const fb = pulse.feedback as Record<string, unknown>;
  if (typeof fb !== 'object' || fb === null) return 'pulse.feedback tiene que ser un objeto';
  if (fb.channel !== 'intIn') {
    return `pulse.feedback.channel tiene que ser intIn (la palabra que escribe el PLC), y es ${JSON.stringify(fb.channel)}`;
  }
  if (typeof fb.sourceBuffer !== 'string' || fb.sourceBuffer.length === 0) return 'pulse.feedback.sourceBuffer es obligatorio';
  if (typeof fb.index !== 'number' || !Number.isInteger(fb.index) || fb.index < 0) return 'pulse.feedback.index tiene que ser un entero de 0 en adelante';
  for (const papel of ['open', 'close', 'fault'] as const) {
    if (!esMascaraDeUnBit(fb[papel])) {
      return `pulse.feedback.${papel} tiene que ser una máscara de UN bit (1, 2, 4 … 32768), y vale ${JSON.stringify(fb[papel])}`;
    }
  }
  const [abierta, cerrada, falla] = [fb.open as number, fb.close as number, fb.fault as number];
  if (abierta === cerrada || abierta === falla || cerrada === falla) {
    return `pulse.feedback: open (${abierta}), close (${cerrada}) y fault (${falla}) tienen que ser bits distintos`;
  }
  const solape = (abierta | cerrada | falla) & mando;
  if (solape !== 0) {
    return `pulse.feedback comparte bits (${solape}) con los del mando (${mando}): casi siempre es un copia-y-pega de commands`;
  }
  const t = spec.target as { channel?: unknown; sourceBuffer?: unknown; index?: unknown } | undefined;
  if (t && t.channel === fb.channel && t.sourceBuffer === fb.sourceBuffer && t.index === fb.index) {
    return 'pulse.feedback apunta a la propia palabra de mando: la orden se confirmaría con su propio eco';
  }
  return null;
}

/** Lo mínimo de una señal para saber por qué palabra manda y con qué bits. Vale para JSON crudo. */
export interface SenalConMando {
  plantId: string;
  domainKey: string;
  /** Mando RETIRADO (`writable: false` con `write` conservado): lo apaga la limpieza de huérfanos. */
  retirada?: boolean;
  write?: {
    target?: { channel?: unknown; sourceBuffer?: unknown; index?: unknown };
    mode?: unknown;
    commands?: unknown;
    sustained?: unknown;
    pulse?: unknown;
  };
}

/**
 * Válvulas que mandan por la MISMA palabra (misma planta, buffer e índice) en `bitmask` no pueden
 * compartir ni un bit: si lo compartieran, la orden de una encendería o apagaría un verbo de la otra.
 * Con dos válvulas en `INT_OUT_VORAGINE[0]` un copia-y-pega de 4096/8192 en la de entrada haría que
 * «abrir entrada» abriera la SALIDA, y ninguna regla por válvula lo vería. Y un mando RETIRADO que
 * compartiera bits con uno activo haría que la limpieza de huérfanos apagara el bit del activo.
 *
 * Devuelve un aviso por par en conflicto, con las dos válvulas. `sostenida` dice si alguna de las
 * dos es sostenida; `estricta`, si alguna es sostenida, de realimentación por bits o retirada: el
 * loader se niega a arrancar por esas; `validate:mapping` las rechaza todas.
 */
export function bitsCompartidosEntreValvulas(
  senales: SenalConMando[],
): Array<{ motivo: string; sostenida: boolean; estricta: boolean; valvulas: [string, string] }> {
  const porPalabra = new Map<string, Array<{ domainKey: string; bits: number; sostenida: boolean; estricta: boolean }>>();
  for (const s of senales) {
    const w = s.write;
    if (!w || w.mode !== 'bitmask' || !w.target || !w.commands || typeof w.commands !== 'object') continue;
    const { channel, sourceBuffer, index } = w.target;
    if (typeof sourceBuffer !== 'string' || typeof index !== 'number') continue;
    let bits = 0;
    for (const v of Object.values(w.commands as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isInteger(v)) bits |= v & 0xffff;
    }
    const palabra = `${s.plantId}/${String(channel)}/${sourceBuffer}[${index}]`;
    const lista = porPalabra.get(palabra) ?? [];
    const sostenida = w.sustained === true;
    lista.push({ domainKey: s.domainKey, bits, sostenida, estricta: sostenida || s.retirada === true || tieneRealimentacionPorBits(w) });
    porPalabra.set(palabra, lista);
  }
  const conflictos: Array<{ motivo: string; sostenida: boolean; estricta: boolean; valvulas: [string, string] }> = [];
  for (const [palabra, valvulas] of porPalabra) {
    for (let i = 0; i < valvulas.length; i++) {
      for (let j = i + 1; j < valvulas.length; j++) {
        const comun = valvulas[i].bits & valvulas[j].bits;
        if (comun === 0) continue;
        conflictos.push({
          motivo: `${valvulas[i].domainKey} y ${valvulas[j].domainKey} mandan por ${palabra} y comparten bits (${comun}): la orden de una movería a la otra`,
          sostenida: valvulas[i].sostenida || valvulas[j].sostenida,
          estricta: valvulas[i].estricta || valvulas[j].estricta,
          valvulas: [valvulas[i].domainKey, valvulas[j].domainKey],
        });
      }
    }
  }
  return conflictos;
}

/**
 * La señal sostenida RETIRADA: el integrador corrigió la especificación el 2026-10-23 — el 1 que la
 * app dejaba puesto chocaba con la HMI (si se cerraba desde la HMI, el PLC seguía viendo «abrir»
 * desde la app). Una válvula accionable (`writable: true`) ya no puede ser `sustained`; el spec
 * sostenido solo puede conservarse en una válvula con `writable: false`, para la limpieza.
 */
export const MOTIVO_SOSTENIDA_RETIRADA =
  'una válvula accionable ya no puede llevar sustained: el integrador retiró la señal sostenida el 2026-10-23 (el 1 que se quedaba puesto chocaba con la HMI). La orden se mantiene solo hasta la realimentación: pulse.feedback';

function parseSequences(
  raw: RawWriteSpec['sequences'],
  spec: { target: BufferElementRef; commands: Record<string, number | boolean>; mode: 'absolute' | 'bitmask' },
): { sequences?: Record<string, WriteStep[]>; error?: string } {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, WriteStep[]> = {};
  for (const [verb, pasos] of Object.entries(raw)) {
    if (!Array.isArray(pasos)) return { error: `${verb}: sequences debe ser una lista de pasos` };
    if (!(verb in spec.commands)) return { error: `${verb}: tiene secuencia pero no está en commands` };
    const steps: WriteStep[] = [];
    for (const p of pasos) {
      if (typeof p?.index !== 'number' || (typeof p?.value !== 'number' && typeof p?.value !== 'boolean')) {
        return { error: `${verb}: paso inválido (se espera {index: number, value: number|boolean})` };
      }
      steps.push({ index: p.index, value: p.value });
    }
    const motivo = motivoSecuenciaInvalida(verb, steps, spec);
    if (motivo) return { error: motivo };
    out[verb] = steps;
  }
  return { sequences: Object.keys(out).length > 0 ? out : undefined };
}

/**
 * Parsea el write spec. Confía en que el schema ya validó la forma (validate:mapping es el
 * gate); aquí solo se normaliza. Devuelve undefined si la señal no es writable o no lo trae.
 *
 * Dos excepciones LANZAN, y con ellas el backend no arranca:
 *  - una válvula accionable con `sustained` (la señal sostenida la retiró el integrador el
 *    2026-10-23, ver `MOTIVO_SOSTENIDA_RETIRADA`): volver a cargarla devolvería el 1 que se queda
 *    puesto y choca con la HMI;
 *  - una orden con realimentación por bits (`pulse.feedback`) que incumple sus reglas
 *    (`motivoRealimentacionInvalida`): descartarla en silencio dejaría la válvula sin mando tras un
 *    despliegue sin que nadie lo supiera hasta que un operario lo intentara, y aplicarla a medias
 *    (sin `minHoldMs`, con máscaras solapadas) confirmaría órdenes con lecturas viejas o ajenas.
 * `donde` es `planta/domainKey`, para que el mensaje diga qué corregir.
 */
function parseWriteSpec(raw: RawWriteSpec | undefined, donde: string): WriteSpec | undefined {
  if (!raw || !raw.target || !raw.commands || !raw.readBack) return undefined;
  const { channel, sourceBuffer, index } = raw.target;
  if (typeof channel !== 'string' || typeof sourceBuffer !== 'string' || typeof index !== 'number') return undefined;
  if (typeof raw.readBack.channel !== 'string' || typeof raw.readBack.index !== 'number') return undefined;
  if (typeof raw.timeoutMs !== 'number' || typeof raw.permission !== 'string') return undefined;
  const { mask, faultMask } = raw.readBack;
  const readBackError = motivoMascarasReadBackInvalido(raw);
  if (readBackError) throw new Error(`opc_mapping.json: ${donde}: ${readBackError}`);

  if (raw.sustained !== undefined && typeof raw.sustained !== 'boolean') {
    throw new Error(`opc_mapping.json: ${donde}: write.sustained tiene que ser true o false, y vale ${JSON.stringify(raw.sustained)}`);
  }
  if (raw.sustained === true) {
    const motivo = motivoSostenidaInvalida(raw);
    if (motivo) {
      throw new Error(
        `opc_mapping.json: ${donde}: orden SOSTENIDA inválida — ${motivo}. El backend no arranca con este mapping; \`npm run validate:mapping\` lo detecta antes de desplegar.`,
      );
    }
  }
  const conRealimentacion = tieneRealimentacionPorBits(raw);
  if (conRealimentacion) {
    const motivo = motivoRealimentacionInvalida(raw);
    if (motivo) {
      throw new Error(
        `opc_mapping.json: ${donde}: orden con REALIMENTACIÓN inválida — ${motivo}. El backend no arranca con este mapping; \`npm run validate:mapping\` lo detecta antes de desplegar.`,
      );
    }
  } else if (raw.sustained !== true && raw.rollbackValue === undefined) {
    return undefined;
  }

  const mode = raw.mode === 'bitmask' ? 'bitmask' : 'absolute';
  const pulse = typeof raw.pulse?.holdMs === 'number' && raw.pulse.holdMs > 0
    ? {
        holdMs: raw.pulse.holdMs,
        ...(parseFeedback(raw.pulse.until) ? { until: parseFeedback(raw.pulse.until)! } : {}),
        // Validado arriba con `motivoRealimentacionInvalida`: aquí solo se copia.
        ...(conRealimentacion
          ? { minHoldMs: raw.pulse.minHoldMs as number, feedback: parseRealimentacion(raw.pulse.feedback) }
          : {}),
      }
    : null;
  const latched = raw.latched === true;

  // Un `until` mal escrito NO puede degradar en silencio a un sostenido a ciegas de 45 s: el bit se
  // quedaría puesto tres cuartos de minuto sin que nadie lo hubiera pedido. Se descarta el spec.
  if (raw.pulse?.until !== undefined && !pulse?.until) {
    console.error(`[opc-mapping] write spec DESCARTADO en ${sourceBuffer}[${index}]: pulse.until incompleto (se esperan channel, index y equals)`);
    return undefined;
  }

  // Fallar CERRADO: un spec compuesto que no cumple las reglas eléctricas deja la señal como no
  // writable (el WriteService responderá TARGET_NOT_WRITABLE) en vez de accionar equipo con una
  // orden que el propio mapping declara contradictoria. Se grita en el log porque una válvula que
  // deja de responder sin explicación es peor que un arranque ruidoso.
  const seq = parseSequences(raw.sequences, { target: { channel, sourceBuffer, index }, commands: raw.commands, mode });
  if (seq.error) {
    console.error(`[opc-mapping] write spec DESCARTADO en ${sourceBuffer}[${index}]: ${seq.error}`);
    return undefined;
  }
  if (latched && pulse) {
    console.error(`[opc-mapping] write spec DESCARTADO en ${sourceBuffer}[${index}]: latched y pulse son excluyentes`);
    return undefined;
  }

  return {
    target: { channel, sourceBuffer, index },
    commands: raw.commands,
    ...(seq.sequences ? { sequences: seq.sequences } : {}),
    ...(latched ? { latched: true } : {}),
    ...(raw.sustained === true ? { sustained: true } : {}),
    mode,
    pulse,
    readBack: {
      channel: raw.readBack.channel,
      sourceBuffer: typeof raw.readBack.sourceBuffer === 'string' ? raw.readBack.sourceBuffer : null,
      index: raw.readBack.index,
      confirmsWrittenValue: raw.readBack.confirmsWrittenValue !== false,
      expectedValue: raw.readBack.expectedValue,
      expectedByCommand: raw.readBack.expectedByCommand,
      ...(mask !== undefined ? { mask } : {}),
      ...(faultMask !== undefined ? { faultMask } : {}),
      // Default true: un canal se presume verificado salvo que el mapping diga lo contrario. Así,
      // omitir la clave conserva el comportamiento estricto de siempre.
      stateVerified: raw.readBack.stateVerified !== false,
    },
    timeoutMs: raw.timeoutMs,
    // Ausente solo en una orden con realimentación por bits (arriba se comprobó): la clave ni
    // aparece, para que nadie pueda leer un `undefined` como «limpiar a 0».
    ...(raw.rollbackValue !== undefined ? { rollbackValue: raw.rollbackValue } : {}),
    permission: raw.permission,
  };
}

/** `pulse.feedback` ya validado por `motivoRealimentacionInvalida`: solo se copia, campo a campo. */
function parseRealimentacion(raw: unknown): RealimentacionPorBits {
  const f = raw as RealimentacionPorBits;
  return { channel: f.channel, sourceBuffer: f.sourceBuffer, index: f.index, open: f.open, close: f.close, fault: f.fault };
}

/**
 * El `write` que conserva una válvula con el mando RETIRADO (`writable: false`), reducido a lo que
 * necesita la limpieza de huérfanos: la palabra y los bits. Nunca lanza: si no sirve (no es bitmask,
 * máscaras que no son enteros de 16 bits), se dice en el log y la limpieza NO cubre esa válvula —
 * apagar «a ojo» en una palabra compartida puede borrar el mando de otra.
 */
function parseMandoConservado(raw: RawWriteSpec | undefined, donde: string): MandoConservado | undefined {
  if (!raw) return undefined;
  const t = raw.target;
  if (!t || typeof t.channel !== 'string' || typeof t.sourceBuffer !== 'string' || typeof t.index !== 'number') {
    console.error(`[opc-mapping] ${donde}: el mando conservado no tiene target válido; la limpieza de huérfanos NO lo cubre`);
    return undefined;
  }
  if (raw.mode !== 'bitmask' || !raw.commands || typeof raw.commands !== 'object') {
    console.error(`[opc-mapping] ${donde}: el mando conservado no es bitmask; la limpieza de huérfanos NO lo cubre (apagarlo en absoluto pisaría la palabra)`);
    return undefined;
  }
  const commands: Record<string, number> = {};
  let bits = 0;
  for (const [verbo, v] of Object.entries(raw.commands)) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 0xffff) {
      console.error(`[opc-mapping] ${donde}: el verbo ${verbo} del mando conservado no es una máscara de 16 bits (${JSON.stringify(v)}); la limpieza de huérfanos NO lo cubre`);
      return undefined;
    }
    commands[verbo] = v;
    bits |= v;
  }
  return { target: { channel: t.channel, sourceBuffer: t.sourceBuffer, index: t.index }, bits, commands };
}

/**
 * Cache por ruta resuelta: el mapping es INMUTABLE en runtime (no hay hot-reload), así que
 * releer + re-parsear 80 KB en cada llamada es desperdicio (reports.service lo invocaba por
 * request). Ahora todos los consumidores comparten el mismo objeto parseado.
 * `clearMappingCache()` existe para los tests.
 */
const mappingCache = new Map<string, LoadedMapping>();
export function clearMappingCache(): void {
  mappingCache.clear();
}

export function loadMapping(explicitPath?: string): LoadedMapping {
  const path = resolvePath(explicitPath);
  const cached = mappingCache.get(path);
  if (cached) return cached;
  const doc = JSON.parse(readFileSync(path, 'utf8')) as {
    version?: string;
    protocolVersion?: string;
    dtoVersion?: string;
    plants?: Array<{
      plantId?: string;
      displayName?: string;
      livenessWindowSec?: number;
      opcBuffers?: Record<
        string,
        Array<{ browseName?: string; node?: { nsUri?: string; identifier?: string }; arrayLength?: number | null; dataType?: string | null }>
      >;
      signals?: RawSignal[];
    }>;
  };

  if (!Array.isArray(doc.plants) || doc.plants.length === 0) {
    throw new Error(`opc_mapping.json inválido (${path}): sin plants[]`);
  }

  const targets: MonitorTarget[] = [];
  const signals: SignalMapping[] = [];
  const plants: LoadedPlant[] = [];

  for (const plant of doc.plants) {
    if (!plant.plantId) throw new Error(`opc_mapping.json: planta sin plantId en ${path}`);
    plants.push({
      plantId: plant.plantId,
      displayName: plant.displayName ?? plant.plantId,
      livenessWindowSec: typeof plant.livenessWindowSec === 'number' ? plant.livenessWindowSec : null,
    });

    for (const [channel, buffers] of Object.entries(plant.opcBuffers ?? {})) {
      if (!DATA_CHANNELS.has(channel)) continue;
      for (const b of buffers ?? []) {
        if (!b.browseName || !b.node?.nsUri || !b.node?.identifier) {
          throw new Error(`opc_mapping.json: buffer inválido en ${plant.plantId}/${channel}`);
        }
        targets.push({
          plantId: plant.plantId,
          browseName: b.browseName,
          channel,
          node: { nsUri: b.node.nsUri, identifier: b.node.identifier },
          arrayLength: typeof b.arrayLength === 'number' ? b.arrayLength : null,
          dataType: typeof b.dataType === 'string' ? b.dataType : null,
        });
      }
    }

    for (const s of plant.signals ?? []) {
      if (!s.buffer || typeof s.index !== 'number' || !s.domainKey) {
        throw new Error(`opc_mapping.json: signal inválida en ${plant.plantId} (buffer/index/domainKey)`);
      }
      // Mando RETIRADO: `writable: false` con el `write` de cuando se accionaba. No da mando; solo
      // dice a la limpieza de huérfanos qué bits pudo dejar puestos.
      const mandoConservado =
        s.writable !== true && s.write ? parseMandoConservado(s.write, `${plant.plantId}/${s.domainKey}`) : undefined;
      signals.push({
        plantId: plant.plantId,
        buffer: s.buffer,
        sourceBuffer: typeof s.sourceBuffer === 'string' ? s.sourceBuffer : null,
        index: s.index,
        domainKey: s.domainKey,
        label: s.label ?? null,
        unit: s.unit ?? null,
        min: typeof s.min === 'number' ? s.min : null,
        max: typeof s.max === 'number' ? s.max : null,
        opMin: typeof s.opMin === 'number' ? s.opMin : null,
        opMax: typeof s.opMax === 'number' ? s.opMax : null,
        ...(s.opRangeByDay ? { opRangeByDay: s.opRangeByDay } : {}),
        mappingStatus: s.mappingStatus === 'unmapped' ? 'unmapped' : 'mapped',
        confidence: (s.confidence as SignalMapping['confidence']) ?? 'inferred',
        writable: s.writable === true,
        write: s.writable === true ? parseWriteSpec(s.write, `${plant.plantId}/${s.domainKey}`) : undefined,
        ...(mandoConservado ? { mandoConservado } : {}),
        stateEncoding: parseStateEncoding(s.stateEncoding),
        flowDomainKey: typeof s.flowDomainKey === 'string' ? s.flowDomainKey : undefined,
        stateTrusted: typeof s.stateTrusted === 'boolean' ? s.stateTrusted : undefined,
      });
    }
  }

  // Dos válvulas de la misma palabra que comparten un bit: si alguna es de realimentación por bits o
  // tiene el mando RETIRADO, no se arranca — la orden de una movería a la otra, o la limpieza de
  // huérfanos apagaría el bit de una orden viva. Si ninguna lo es, se avisa y sigue (validate:mapping
  // las rechaza todas antes de desplegar).
  const conMando: SenalConMando[] = signals.map((s) =>
    s.mandoConservado
      ? {
          plantId: s.plantId,
          domainKey: s.domainKey,
          retirada: true,
          write: { target: s.mandoConservado.target, mode: 'bitmask', commands: s.mandoConservado.commands },
        }
      : s,
  );
  for (const c of bitsCompartidosEntreValvulas(conMando)) {
    if (c.estricta) throw new Error(`opc_mapping.json (${path}): ${c.motivo}. El backend no arranca con este mapping.`);
    console.error(`[opc-mapping] ${c.motivo}`);
  }

  const result: LoadedMapping = {
    version: doc.version ?? '0.0.0',
    protocolVersion: doc.protocolVersion ?? 'v0',
    dtoVersion: doc.dtoVersion ?? 'v1',
    plants,
    targets,
    signals,
    raw: doc,
  };
  mappingCache.set(path, result);
  return result;
}
