import type { ValveFeedback } from '@ptap/shared';
import type { RealimentacionPorBits } from '../mapping/opc-mapping.loader';

/**
 * Lectura de la palabra de REALIMENTACIÓN por bits de una válvula (`pulse.feedback`, integrador de La
 * Vorágine, 2026-10-23). Pura: sin red, sin reloj. La usan el motor de mapeo (estado derivado del
 * DTO) y el WriteService (cuándo soltar la orden), y tienen que leer lo mismo.
 */

/**
 * Valor de un elemento Int16 → 16 bits SIN signo, o null si no es un entero de 16 bits.
 *
 * Con el bit15 puesto el servidor lo entrega NEGATIVO (-32768…-1): se aceptan las dos
 * representaciones y nada más. Un decimal, un valor fuera de rango o algo que no es un número es que
 * se está leyendo otra cosa, y de eso no se afirma ningún estado.
 */
export function palabra16(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < -0x8000 || v > 0xffff) return null;
  return v & 0xffff;
}

/**
 * 16 bits sin signo → lo que cabe en el elemento Int16 (el bit15 sale negativo). Es lo que se escribe:
 * Optix convierte el Int32 de la escritura a Int16 y un 36 864 no cabe.
 */
export function comoInt16(u: number): number {
  const v = u & 0xffff;
  return v >= 0x8000 ? v - 0x10000 : v;
}

/**
 * Estado de UNA válvula según su palabra de realimentación:
 *  - `fault`: su bit de falla está puesto. Manda sobre todo lo demás: el 16/10 la entrada de La
 *    Vorágine tenía abierta Y falla (1041 = {0,4,10}), y lo que había que saber es la falla.
 *  - `open` / `closed`: solo el bit de abierta / solo el de cerrada.
 *  - `moving`: los dos o ninguno — en recorrido, o a medias.
 *  - `undefined`: la palabra no se puede leer (ver `palabra16`): no se afirma nada.
 */
export function estadoPorRealimentacion(
  valor: unknown,
  fb: Pick<RealimentacionPorBits, 'open' | 'close' | 'fault'>,
): ValveFeedback | undefined {
  const u = palabra16(valor);
  if (u === null) return undefined;
  if ((u & fb.fault) !== 0) return 'fault';
  const abierta = (u & fb.open) !== 0;
  const cerrada = (u & fb.close) !== 0;
  if (abierta && !cerrada) return 'open';
  if (cerrada && !abierta) return 'closed';
  return 'moving';
}
