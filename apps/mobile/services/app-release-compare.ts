/**
 * Comparación de versiones de la app. **Sin dependencias de plataforma a propósito**: `expo-constants`
 * y `react-native` no cargan fuera del runtime de Expo, y meterlos aquí dejaría esta lógica —que es
 * la que decide si se molesta al usuario— sin poder probarse.
 *
 * La comparación va por **`versionCode`**, no por el semver: es el entero que Android usa para
 * decidir si una instalación es más vieja, y no depende de que nadie interprete bien si "1.10.0"
 * va después de "1.9.0".
 */

export interface AppRelease {
  version: string | null;
  versionCode: number | null;
  publishedAt: string | null;
  sizeBytes: number | null;
  downloadUrl: string;
  notes: string | null;
}

/**
 * ¿La app instalada se quedó atrás?
 *
 * `false` si falta cualquiera de los dos datos. Sin certeza NO se molesta al usuario: un aviso de
 * actualización que no existe erosiona la confianza en todos los demás avisos de la app. En web
 * `instalada` es `null` y por eso siempre devuelve `false` — ahí no hay nada que actualizar a mano.
 */
export function hayActualizacion(release: AppRelease | null, instalada: number | null): boolean {
  if (!release || release.versionCode === null || instalada === null) return false;
  return release.versionCode > instalada;
}

/** Tamaño legible, para no mandar a nadie a una descarga de 35 MB sin avisar. */
export function tamanoLegible(bytes: number | null): string | null {
  if (bytes === null || bytes <= 0) return null;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

/** Lo que hay que publicar en el panel del teléfono, ya redactado. */
export interface AvisoActualizacion {
  titulo: string;
  cuerpo: string;
  /** El `versionCode` anunciado. Se guarda para no repetir el aviso de ESTA versión. */
  versionCode: number;
  downloadUrl: string;
}

/**
 * ¿Hay que avisar en el panel del teléfono de que existe una versión nueva? Devuelve el aviso ya
 * redactado, o `null` si no toca.
 *
 * Vive aquí, junto a la comparación y sin dependencias de plataforma, porque es la decisión de
 * **molestar a alguien fuera de la app** y eso hay que poder probarlo sin arrancar Expo.
 *
 * `ultimoAvisado` es la clave de todo: la tarea de fondo corre cada ~15 minutos, así que sin
 * recordar de qué versión ya se avisó el panel se llenaría del mismo aviso una y otra vez. Se
 * compara por `versionCode` y no por fecha ni por "ya avisé hoy": si mañana se publica la 10, hay
 * que volver a avisar aunque ya se hubiera avisado de la 9.
 *
 * Casos en los que NO se avisa, todos deliberados:
 *  - No hay actualización (o no se puede saber: `release` nulo, o web sin `versionCode` instalado).
 *    `hayActualizacion` ya cubre eso, y sin certeza no se molesta a nadie.
 *  - Ya se avisó de esa misma versión, o de una posterior.
 */
export function decidirAvisoActualizacion(
  release: AppRelease | null,
  instalada: number | null,
  ultimoAvisado: number | null,
): AvisoActualizacion | null {
  if (!hayActualizacion(release, instalada)) return null;
  // `hayActualizacion` ya garantizó que ambos existen; esto es para el compilador.
  if (!release || release.versionCode === null) return null;
  if (ultimoAvisado !== null && ultimoAvisado >= release.versionCode) return null;

  const tamano = tamanoLegible(release.sizeBytes);
  const titulo = release.version ? `Hay una versión nueva (${release.version})` : 'Hay una versión nueva';
  // Las notas primero: es lo que responde "¿y a mí qué me cambia?". El cómo va al final, porque
  // quien ya sabe instalar no necesita leerlo dos veces.
  const notas = release.notes?.trim();
  const cuerpo = [notas, `▸ Toca para descargarla e instalarla${tamano ? ` (${tamano})` : ''}.`]
    .filter(Boolean)
    .join('\n\n');

  return { titulo, cuerpo, versionCode: release.versionCode, downloadUrl: release.downloadUrl };
}
