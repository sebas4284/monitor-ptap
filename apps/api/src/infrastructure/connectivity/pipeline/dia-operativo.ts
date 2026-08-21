/**
 * Qué tipo de día es hoy en la planta. Vive en `infrastructure` y no en `modules/notifications`
 * porque lo necesitan los dos lados: el pipeline, para resolver el rango operativo que rige hoy, y
 * los detectores, para anclar la deduplicación al día.
 *
 * **Todo en hora LOCAL del servidor**, nunca UTC. La VM corre en hora de Colombia (UTC−5), y con UTC
 * el día cambiaba a las 19:00: un sábado en UTC no es un sábado en la planta, y la tanda diaria de
 * avisos llegaba de noche con la planta vacía.
 */

/** Fecha local en `YYYY-MM-DD`, rellenada con ceros para que ordene y compare como texto. */
export function diaLocal(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Festivos en los que rige el rango de fin de semana.
 *
 * Es una LISTA, no un algoritmo, y es deliberado: en Colombia la ley Emiliani traslada buena parte
 * de los festivos al lunes siguiente, y las fechas móviles (Semana Santa, Corpus Christi, Sagrado
 * Corazón) dependen de la Pascua. Calcularlo son cien líneas que fallan en silencio un martes de
 * diciembre; una lista que alguien revisa una vez al año falla de una forma que se ve y se arregla.
 *
 * Arranca vacía a propósito: sábados y domingos funcionan desde el primer día, y los festivos entran
 * en cuanto el cliente entregue el calendario. Un festivo que falte solo significa que ese día se
 * aplica el rango de entre semana, que es el más permisivo — se deja de avisar de algo, no se avisa
 * en falso.
 */
export const FESTIVOS: readonly string[] = [];

/** ¿Rige hoy el rango de fin de semana? Sábado, domingo o festivo declarado. */
export function esFinDeSemanaOFestivo(now: Date): boolean {
  const dia = now.getDay(); // 0 domingo … 6 sábado
  if (dia === 0 || dia === 6) return true;
  return FESTIVOS.includes(diaLocal(now));
}
