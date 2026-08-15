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
