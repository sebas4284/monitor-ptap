/**
 * Trazado SVG de una ola periódica, en un viewBox de `periods * 100` × 100.
 *
 * Cada periodo mide 100 unidades: una cresta y un valle hechos con curvas cuadráticas (`Q` y luego
 * `T`, que refleja el punto de control y alterna cresta/valle). Como el trazado empieza y termina a
 * la misma altura y cada periodo es idéntico, desplazar la capa exactamente media anchura (la mitad
 * de los periodos) deja la imagen igual: el bucle de la animación no tiene saltos.
 *
 * Está aparte del componente para poder probarlo sin React Native.
 */
export const WAVE_PERIOD = 100;
export const WAVE_MID = 50;

/** @param periods periodos en TODO el trazado (par, para que la mitad sea un número entero de olas). */
export function wavePath(periods: number, amplitude: number): string {
  if (!Number.isInteger(periods) || periods < 2 || periods % 2 !== 0) {
    throw new Error(`periods debe ser un entero par >= 2 (llegó ${periods})`);
  }
  if (amplitude <= 0 || amplitude > WAVE_MID) {
    throw new Error(`amplitude debe estar entre 0 y ${WAVE_MID} (llegó ${amplitude})`);
  }
  const half = WAVE_PERIOD / 2;
  // El pico de una cuadrática llega a la mitad de su punto de control: se pide el doble.
  const segments = [`M0 ${WAVE_MID}`, `Q${half / 2} ${WAVE_MID - 2 * amplitude} ${half} ${WAVE_MID}`];
  for (let x = WAVE_PERIOD; x <= periods * WAVE_PERIOD; x += half) segments.push(`T${x} ${WAVE_MID}`);
  const end = periods * WAVE_PERIOD;
  segments.push(`L${end} 100`, 'L0 100', 'Z');
  return segments.join(' ');
}
