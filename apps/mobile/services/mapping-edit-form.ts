/**
 * El formulario de corrección del mapeo: de texto escrito a mano a un parche válido, y de ahí al
 * resumen que se enseña ANTES de guardar.
 *
 * **Sin dependencias de plataforma**, igual que `app-release-compare.ts` y `novedades-compare.ts`:
 * convertir «1,5» en 1.5 y decidir qué cambió es exactamente lo que hay que poder probar sin abrir
 * la app.
 *
 * El servidor vuelve a validar todo esto y es él quien decide. Lo de aquí existe para que la persona
 * vea el error mientras escribe, no para autorizar nada.
 */

export type CampoEditable = 'index' | 'sourceBuffer' | 'unit' | 'min' | 'max' | 'opMin' | 'opMax';

export interface CampoDef {
  campo: CampoEditable;
  /** Cómo se llama en la app. */
  etiqueta: string;
  /** Cómo se llama en el mapeo y en la API — el nombre en inglés, que es el que hay que reconocer. */
  ingles: string;
  tipo: 'entero' | 'numero' | 'texto' | 'buffer';
  ayuda: string;
}

/**
 * Los siete campos editables, en el orden en que se piensan: primero DÓNDE se lee, después CÓMO se
 * interpreta.
 */
export const CAMPOS: CampoDef[] = [
  {
    campo: 'index',
    etiqueta: 'Índice',
    ingles: 'index',
    tipo: 'entero',
    ayuda: 'Posición dentro del array que entrega el PLC. Es lo que se corrige cuando el valor sale de otro sitio.',
  },
  {
    campo: 'sourceBuffer',
    etiqueta: 'Buffer de origen',
    ingles: 'sourceBuffer',
    tipo: 'buffer',
    ayuda: 'Qué array concreto del mismo canal la alimenta. Vacío = el principal de la planta.',
  },
  { campo: 'unit', etiqueta: 'Unidad', ingles: 'unit', tipo: 'texto', ayuda: 'Como sale en el tablero: l/s, m, psi, m³.' },
  {
    campo: 'min',
    etiqueta: 'Mínimo físico',
    ingles: 'min',
    tipo: 'numero',
    ayuda: 'Validez de la lectura. Fuera de [min, max] el dato se marca inutilizable.',
  },
  { campo: 'max', etiqueta: 'Máximo físico', ingles: 'max', tipo: 'numero', ayuda: 'Ídem, por arriba.' },
  {
    campo: 'opMin',
    etiqueta: 'Mínimo operativo',
    ingles: 'opMin',
    tipo: 'numero',
    ayuda: 'Rango normal de operación. Fuera de él el dato sigue siendo válido, pero avisa.',
  },
  { campo: 'opMax', etiqueta: 'Máximo operativo', ingles: 'opMax', tipo: 'numero', ayuda: 'Ídem, por arriba.' },
];

/** Lo que rige para esos campos. Las claves llegan del backend con el nombre en inglés. */
export interface ValoresSenal {
  index: number;
  sourceBuffer: string | null;
  unit: string | null;
  min: number | null;
  max: number | null;
  opMin: number | null;
  opMax: number | null;
}

export type Borrador = Record<CampoEditable, string>;

export interface MappingPatch {
  index?: number;
  sourceBuffer?: string | null;
  unit?: string | null;
  min?: number | null;
  max?: number | null;
  opMin?: number | null;
  opMax?: number | null;
}

/** Texto tal como se enseña en el campo. `null` se escribe como vacío. */
export function comoTexto(valor: number | string | null): string {
  if (valor === null) return '';
  if (typeof valor === 'number') return String(valor).replace('.', ',');
  return valor;
}

export function borradorDesde(v: ValoresSenal): Borrador {
  return {
    index: comoTexto(v.index),
    sourceBuffer: comoTexto(v.sourceBuffer),
    unit: comoTexto(v.unit),
    min: comoTexto(v.min),
    max: comoTexto(v.max),
    opMin: comoTexto(v.opMin),
    opMax: comoTexto(v.opMax),
  };
}

/**
 * Un número escrito a mano.
 *
 * **Acepta coma decimal**, y no es un detalle: la app está en español, el tablero pinta «8,32» y
 * quien corrige un rango escribe «1,5». Exigir punto habría convertido cada corrección de rango en
 * un error de validación incomprensible.
 *
 * Vacío devuelve `null`, que significa «déjalo sin valor» — quitar un rango mal puesto es una
 * corrección legítima.
 */
export function parsearNumero(texto: string): number | null | 'error' {
  const t = texto.trim();
  if (t === '') return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : 'error';
}

export interface ParseoBorrador {
  patch: MappingPatch;
  /** Mensaje por campo, para pintarlo debajo del input. Vacío = todo bien. */
  errores: Partial<Record<CampoEditable, string>>;
}

/**
 * Del borrador al parche, con los errores de forma que se pueden ver sin preguntar al servidor.
 *
 * Solo entran los campos que CAMBIAN respecto a lo que rige: mandar los siete en cada guardado
 * dejaría en el registro «cambió unit de l/s a l/s», y el histórico de quién tocó qué dejaría de
 * poder leerse.
 */
export function parsearBorrador(borrador: Borrador, actual: ValoresSenal): ParseoBorrador {
  const patch: MappingPatch = {};
  const errores: Partial<Record<CampoEditable, string>> = {};

  const idxTexto = borrador.index.trim();
  if (idxTexto === '') {
    errores.index = 'Toda señal se lee en una posición concreta: el índice no puede quedar vacío.';
  } else if (!/^\d+$/.test(idxTexto)) {
    errores.index = 'El índice es un entero de 0 en adelante.';
  } else {
    const n = Number(idxTexto);
    if (n !== actual.index) patch.index = n;
  }

  const sb = borrador.sourceBuffer.trim();
  const sbNuevo = sb === '' ? null : sb;
  if (sbNuevo !== actual.sourceBuffer) patch.sourceBuffer = sbNuevo;

  const u = borrador.unit.trim();
  const uNuevo = u === '' ? null : u;
  if (uNuevo !== null && uNuevo.length > 16) errores.unit = 'Demasiado larga: la unidad es algo como l/s o psi.';
  else if (uNuevo !== actual.unit) patch.unit = uNuevo;

  for (const campo of ['min', 'max', 'opMin', 'opMax'] as const) {
    const v = parsearNumero(borrador[campo]);
    if (v === 'error') {
      errores[campo] = 'No es un número.';
      continue;
    }
    if (v !== actual[campo]) patch[campo] = v;
  }

  // Coherencia CRUZANDO lo que ya rige: si solo se toca `min`, hay que compararlo con el `max`
  // guardado. Validar el parche aislado dejaría pasar un min mayor que el max de la señal.
  const min = 'min' in patch ? patch.min : actual.min;
  const max = 'max' in patch ? patch.max : actual.max;
  if (min !== null && min !== undefined && max !== null && max !== undefined && min > max) {
    errores.min = `El mínimo no puede ser mayor que el máximo (${comoTexto(max)}).`;
  }
  const opMin = 'opMin' in patch ? patch.opMin : actual.opMin;
  const opMax = 'opMax' in patch ? patch.opMax : actual.opMax;
  if (opMin !== null && opMin !== undefined && opMax !== null && opMax !== undefined && opMin > opMax) {
    errores.opMin = `El mínimo operativo no puede ser mayor que el máximo (${comoTexto(opMax)}).`;
  }

  return { patch, errores };
}

export interface Cambio {
  campo: CampoEditable;
  etiqueta: string;
  ingles: string;
  de: string;
  a: string;
}

/**
 * El «de → a» que se enseña en la revisión.
 *
 * Existe porque guardar a ciegas es cómo se colaron los 409,50 psi de Cascajal: el cambio parecía
 * razonable y nadie lo contrastó. Un resumen explícito antes de aplicar convierte el guardado en
 * una decisión y no en un reflejo.
 */
export function resumenCambios(actual: ValoresSenal, patch: MappingPatch): Cambio[] {
  const out: Cambio[] = [];
  for (const def of CAMPOS) {
    if (!(def.campo in patch)) continue;
    const nuevo = patch[def.campo];
    if (nuevo === undefined) continue;
    out.push({
      campo: def.campo,
      etiqueta: def.etiqueta,
      ingles: def.ingles,
      de: pinta(actual[def.campo]),
      a: pinta(nuevo),
    });
  }
  return out;
}

function pinta(valor: number | string | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '(vacío)';
  if (typeof valor === 'number') return String(valor).replace('.', ',');
  return valor;
}

/**
 * Una muestra de buffer, en lo mínimo que hace falta para mirar dentro. Es la forma que ya tiene
 * `RawBufferView`, declarada estructuralmente para no arrastrar aquí el cliente HTTP.
 */
export interface MuestraBuffer {
  receivedLength: number | null;
  channels: { index: number; value: number | boolean | null }[];
}

/**
 * Qué se está leyendo AHORA en ese índice del buffer.
 *
 * Es la pieza que convierte la revisión en una verificación de verdad: antes de guardar, la
 * pantalla puede decir «en el índice 21 hay ahora 2,4» en vez de pedir un acto de fe. Sin esto,
 * comprobar un reapuntado obligaba a guardar primero y mirar el tablero después — que es
 * exactamente cómo se colaron los 409,50 psi de Cascajal.
 *
 * `oculto` distingue un cero real de la falta de dato: la vista de buffers crudos esconde los ceros
 * sin mapear para que la tabla sea legible, así que un índice ausente de `channels` que cae dentro
 * de lo recibido vale 0 — no es que no haya llegado nada.
 */
export function valorEnIndice(
  buffer: MuestraBuffer | undefined,
  index: number,
): { value: number | boolean | null; oculto: boolean } | null {
  if (!buffer) return null;
  const canal = buffer.channels.find((c) => c.index === index);
  if (canal) return { value: canal.value, oculto: false };
  if (buffer.receivedLength !== null && index < buffer.receivedLength) return { value: 0, oculto: true };
  return null;
}
export function hayCambios(patch: MappingPatch): boolean {
  return Object.keys(patch).length > 0;
}

export function hayErrores(errores: ParseoBorrador['errores']): boolean {
  return Object.keys(errores).length > 0;
}
