import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Firma encadenada de las maniobras de válvula: la parte PURA, sin base de datos.
 *
 * Está separada del servicio porque es la única pieza que hay que poder probar exhaustivamente y
 * volver a ejecutar años después sobre un volcado de la tabla. Si el cálculo viviera dentro de una
 * consulta, verificar un histórico exigiría levantar medio backend.
 */

/** Campos que quedan sellados. Cambiar esta lista invalida las firmas anteriores: no se toca. */
export interface CommandFacts {
  id: number;
  at: string;
  plantId: string;
  target: string;
  command: string;
  status: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  role: string | null;
  writtenValue: string | null;
  confirmedValue: string | null;
}

/**
 * Texto canónico que se firma.
 *
 * Orden fijo y separador de control (`U+001F`, "unit separator"), que no puede aparecer en un
 * nombre de planta ni en un correo. Sin un separador imposible, dos maniobras distintas podrían
 * producir el mismo texto —«abrir» + «valvula-1» y «abrir-valvula» + «1»— y una se podría hacer
 * pasar por la otra. `null` se marca con `U+0000` por lo mismo: distinguirlo de la cadena vacía.
 */
const SEP = '\u001f';
const NULO = '\u0000';

export function textoCanonico(f: CommandFacts): string {
  const campo = (v: string | number | null): string => (v === null ? NULO : String(v));
  return [
    campo(f.id),
    campo(f.at),
    campo(f.plantId),
    campo(f.target),
    campo(f.command),
    campo(f.status),
    campo(f.userId),
    campo(f.userName),
    campo(f.userEmail),
    campo(f.role),
    campo(f.writtenValue),
    campo(f.confirmedValue),
  ].join(SEP);
}

/**
 * Sello de una maniobra: HMAC del texto canónico ENCADENADO al sello anterior.
 *
 * Lo del encadenado es lo que aporta el valor: con un sello independiente por fila, cualquiera con
 * acceso a la base podría borrar una maniobra entera sin dejar rastro. Encadenada, la fila
 * siguiente ya no verifica y la verificación señala exactamente dónde se rompió.
 */
export function sellar(hechos: CommandFacts, selloPrevio: string | null, secreto: string): string {
  return createHmac('sha256', secreto)
    .update(`${selloPrevio ?? 'GENESIS'}${SEP}${textoCanonico(hechos)}`)
    .digest('hex');
}

/** Comparación en tiempo constante: comparar sellos con `===` filtra información por el tiempo. */
export function selloCoincide(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export interface EslabonRoto {
  id: number;
  motivo: 'firma_no_coincide' | 'eslabon_no_encaja';
}

/**
 * Recorre la cadena completa y devuelve los eslabones rotos, en orden.
 *
 * Distingue dos averías distintas, y la diferencia importa para saber qué pasó:
 *  - `firma_no_coincide`: los datos de esa fila cambiaron después de firmarse.
 *  - `eslabon_no_encaja`: la fila apunta a un sello anterior que no es el que le corresponde —
 *    típico de una fila borrada o insertada en medio.
 */
export function verificarCadena(
  filas: (CommandFacts & { signature: string; prevSignature: string | null })[],
  secreto: string,
): EslabonRoto[] {
  const rotos: EslabonRoto[] = [];
  let esperado: string | null = null;

  for (const fila of filas) {
    if ((fila.prevSignature ?? null) !== esperado) {
      rotos.push({ id: fila.id, motivo: 'eslabon_no_encaja' });
    }
    const recalculado = sellar(fila, fila.prevSignature ?? null, secreto);
    if (!selloCoincide(recalculado, fila.signature)) {
      rotos.push({ id: fila.id, motivo: 'firma_no_coincide' });
    }
    // Se sigue con el sello GUARDADO, no con el recalculado: así un fallo no arrastra al resto de
    // la cadena y se ve exactamente qué filas están mal, en vez de "todas a partir de la 40".
    esperado = fila.signature;
  }
  return rotos;
}

/** Lo que se enseña a una persona. El sello entero son 64 caracteres que nadie va a leer. */
export function firmaCorta(signature: string | null): string | null {
  return signature ? signature.slice(0, 12) : null;
}
