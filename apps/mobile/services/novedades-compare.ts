/**
 * Qué es «nuevo» en el changelog de la app.
 *
 * **Sin dependencias de plataforma, a propósito**, igual que `app-release-compare.ts`: la decisión
 * de si hay algo nuevo que enseñar se puede probar sin AsyncStorage ni el runtime de Expo. Lo que
 * toca el dispositivo vive en `novedades.ts`.
 */

/** Una entrada del changelog, tal como la sirve `GET /api/app/novedades`. */
export interface Novedad {
  version: string;
  /** Puede venir vacía: el encabezado del changelog no obliga a fecha. */
  fecha: string;
  puntos: string[];
}

function tupla(version: string): number[] {
  return version.split('.').map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/** > 0 si `a` es más nueva que `b`. Compara por número, así que 1.10.0 gana a 1.9.0. */
export function compararVersiones(a: string, b: string): number {
  const ta = tupla(a);
  const tb = tupla(b);
  for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
    const diff = (ta[i] ?? 0) - (tb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * La versión más alta del listado.
 *
 * Se calcula aquí en vez de fiarse de que el servidor lo mande ordenado —que lo manda—: el punto de
 * la marca de «nuevo» es no mentir, y un backend más viejo o un archivo mal editado no deberían
 * poder apagarla.
 */
export function versionMasReciente(novedades: Novedad[]): string | null {
  let max: string | null = null;
  for (const n of novedades) {
    if (!n.version) continue;
    if (max === null || compararVersiones(n.version, max) > 0) max = n.version;
  }
  return max;
}

/**
 * ¿Hay algo que el usuario de este dispositivo no haya visto?
 *
 * `ultimaVista === null` (nunca abrió la pestaña) cuenta como novedad: es la primera vez que se le
 * puede contar lo que cambió, y callarlo justo entonces vaciaría la función de sentido.
 *
 * La marca es **por dispositivo**, no por cuenta: se guarda en AsyncStorage y no en MySQL. Es una
 * conveniencia de visor —como el punto de un correo sin leer—, no un dato del sistema que haya que
 * auditar ni compartir entre teléfonos.
 */
export function hayNovedadNueva(novedades: Novedad[], ultimaVista: string | null): boolean {
  const reciente = versionMasReciente(novedades);
  if (reciente === null) return false;
  if (ultimaVista === null) return true;
  return compararVersiones(reciente, ultimaVista) > 0;
}
