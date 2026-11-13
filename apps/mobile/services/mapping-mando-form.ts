import { comoTexto, parsearNumero, type Cambio, type MappingPatch } from './mapping-edit-form';

/**
 * El formulario del CANAL DE MANDO de una válvula: qué valor abre y cuál cierra.
 *
 * Vive aparte de `mapping-edit-form.ts` por lo mismo que el backend separa `CAMPOS_DE_MANDO` de
 * `CAMPOS_EDITABLES`: no son campos planos que se puedan recorrer con el mismo bucle, y la regla que
 * los gobierna es distinta — en una señal de lectura no significan nada.
 *
 * **Sin dependencias de plataforma**, para poder probarlo sin abrir la app. El servidor vuelve a
 * validar todo esto y es él quien decide; lo de aquí existe para que la persona vea el error
 * mientras escribe.
 *
 * Contexto de por qué importa: 8 de las 10 plantas con válvula llevan `open: 4096` heredado de La
 * Vorágine y jamás verificado allí, y ninguna declara `close`. Este formulario es donde aterriza lo
 * que el probador de canales descubra.
 */

export type ModoEscritura = 'absolute' | 'bitmask';

/** Lo que rige hoy en el canal de mando, tal como lo sirve el backend. */
export interface ValoresMando {
  index: number;
  commands: Record<string, number | boolean>;
  mode: string;
  compuesta: boolean;
  stateOpen: number | null;
  stateClosed: number | null;
}

/** Una fila del editor de verbos. Se escribe como texto; se convierte al validar. */
export interface FilaComando {
  verbo: string;
  valor: string;
}

export interface BorradorMando {
  writeIndex: string;
  writeMode: ModoEscritura;
  stateOpen: string;
  stateClosed: string;
  comandos: FilaComando[];
}

export type ErroresMando = Partial<Record<'writeIndex' | 'writeMode' | 'stateOpen' | 'stateClosed' | 'comandos', string>>;

/** Los verbos actuales como filas editables, en orden estable para que no bailen al escribir. */
export function filasDesde(commands: Record<string, number | boolean>): FilaComando[] {
  return Object.keys(commands)
    .sort()
    .map((verbo) => ({ verbo, valor: comoTexto(typeof commands[verbo] === 'boolean' ? String(commands[verbo]) : (commands[verbo] as number)) }));
}

export function borradorMandoDesde(m: ValoresMando): BorradorMando {
  return {
    writeIndex: String(m.index),
    writeMode: m.mode === 'bitmask' ? 'bitmask' : 'absolute',
    stateOpen: comoTexto(m.stateOpen),
    stateClosed: comoTexto(m.stateClosed),
    comandos: filasDesde(m.commands),
  };
}

/**
 * Un valor de comando: número (con coma decimal admitida) o booleano.
 *
 * `true`/`false` se aceptan porque el mapeo los admite: hay canales de bit donde el valor no es un
 * número sino un booleano, y obligar a escribir 1 o 0 ahí produciría un write spec que el schema
 * rechaza.
 */
export function parsearValorComando(texto: string): number | boolean | 'error' {
  const t = texto.trim().toLowerCase();
  if (t === 'true') return true;
  if (t === 'false') return false;
  const n = parsearNumero(texto);
  if (n === null || n === 'error') return 'error';
  return n;
}

/** Las filas convertidas a mapa, o el primer motivo por el que no se puede. */
export function comandosDesdeFilas(filas: FilaComando[]): { commands: Record<string, number | boolean> } | { error: string } {
  const commands: Record<string, number | boolean> = {};
  const vistos = new Set<string>();

  for (const fila of filas) {
    const verbo = fila.verbo.trim();
    if (verbo === '' && fila.valor.trim() === '') continue; // fila recién añadida y vacía: se ignora
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(verbo)) {
      return { error: `«${verbo || '(vacío)'}» no sirve como nombre de verbo: empieza por letra y sigue con letras, números o guion bajo.` };
    }
    if (vistos.has(verbo)) return { error: `El verbo «${verbo}» está dos veces.` };
    vistos.add(verbo);

    const valor = parsearValorComando(fila.valor);
    if (valor === 'error') return { error: `El valor de «${verbo}» tiene que ser un número o true/false.` };
    commands[verbo] = valor;
  }

  if (Object.keys(commands).length === 0) {
    return { error: 'Una válvula sin ningún verbo no se puede accionar. Deja al menos uno.' };
  }

  // Dos verbos con el MISMO valor: el equipo no podría distinguir una orden de la otra, y una de las
  // dos haría lo contrario de lo que dice su botón mientras el registro afirma que se hizo lo pedido.
  const valores = Object.values(commands).map((v) => String(v));
  if (new Set(valores).size !== valores.length) {
    return { error: 'Dos verbos con el mismo valor: el equipo no podría distinguir una orden de la otra.' };
  }

  return { commands };
}

export function mismosComandos(a: Record<string, number | boolean>, b: Record<string, number | boolean>): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  return ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}

/**
 * Del borrador del mando al parche, con los errores que se pueden ver sin preguntar al servidor.
 *
 * En una orden COMPUESTA no se devuelve parche de verbos ni de índice: sus reglas de secuencia son
 * las que impiden energizar dos direcciones a la vez, y el servidor las rechazaría igualmente. Mejor
 * no ofrecerlo que ofrecerlo y que falle.
 */
export function parsearMando(b: BorradorMando, actual: ValoresMando): { patch: MappingPatch; errores: ErroresMando } {
  const patch: MappingPatch = {};
  const errores: ErroresMando = {};

  if (!actual.compuesta) {
    const idx = b.writeIndex.trim();
    if (idx === '') errores.writeIndex = 'La orden sale por una posición concreta: el índice no puede quedar vacío.';
    else if (!/^\d+$/.test(idx)) errores.writeIndex = 'El índice es un entero de 0 en adelante.';
    else if (Number(idx) !== actual.index) patch.writeIndex = Number(idx);

    const comandos = comandosDesdeFilas(b.comandos);
    if ('error' in comandos) errores.comandos = comandos.error;
    else if (!mismosComandos(comandos.commands, actual.commands)) patch.writeCommands = comandos.commands;
  }

  if (b.writeMode !== actual.mode) patch.writeMode = b.writeMode;

  for (const [campo, clave] of [
    ['stateOpen', 'stateOpen'],
    ['stateClosed', 'stateClosed'],
  ] as const) {
    const v = parsearNumero(b[campo]);
    if (v === 'error') {
      errores[campo] = 'No es un número.';
      continue;
    }
    if (v !== actual[clave]) patch[clave] = v;
  }

  // Abierta y cerrada con el mismo valor: entonces la palabra de estado no distingue nada, y el
  // tablero afirmaría una posición u otra a cara o cruz.
  const open = 'stateOpen' in patch ? patch.stateOpen : actual.stateOpen;
  const closed = 'stateClosed' in patch ? patch.stateClosed : actual.stateClosed;
  if (open !== null && open !== undefined && closed !== null && closed !== undefined && open === closed) {
    errores.stateOpen = `Abierta y cerrada no pueden leerse con el mismo valor (${comoTexto(open)}).`;
  }

  return { patch, errores };
}

/** El «de → a» del mando para la pantalla de revisión. */
export function resumenMando(actual: ValoresMando, patch: MappingPatch): Cambio[] {
  const out: Cambio[] = [];

  if (patch.writeIndex !== undefined) {
    out.push({
      campo: 'index',
      etiqueta: 'Índice de mando',
      ingles: 'write.target.index',
      de: String(actual.index),
      a: String(patch.writeIndex),
    });
  }
  if (patch.writeCommands !== undefined) {
    out.push({
      campo: 'unit',
      etiqueta: 'Verbos de mando',
      ingles: 'write.commands',
      de: comandosComoTexto(actual.commands),
      a: comandosComoTexto(patch.writeCommands),
    });
  }
  if (patch.writeMode !== undefined) {
    out.push({ campo: 'unit', etiqueta: 'Modo de escritura', ingles: 'write.mode', de: actual.mode, a: patch.writeMode });
  }
  if (patch.stateOpen !== undefined) {
    out.push({
      campo: 'opMin',
      etiqueta: 'Valor de «abierta»',
      ingles: 'stateEncoding.open',
      de: comoTexto(actual.stateOpen) || '(vacío)',
      a: comoTexto(patch.stateOpen ?? null) || '(vacío)',
    });
  }
  if (patch.stateClosed !== undefined) {
    out.push({
      campo: 'opMax',
      etiqueta: 'Valor de «cerrada»',
      ingles: 'stateEncoding.closed',
      de: comoTexto(actual.stateClosed) || '(vacío)',
      a: comoTexto(patch.stateClosed ?? null) || '(vacío)',
    });
  }

  return out;
}

/** `open=4096 · close=8192`, que es como se lee de un vistazo. */
export function comandosComoTexto(commands: Record<string, number | boolean>): string {
  const partes = Object.keys(commands)
    .sort()
    .map((k) => `${k}=${String(commands[k])}`);
  return partes.length > 0 ? partes.join(' · ') : '(ninguno)';
}
