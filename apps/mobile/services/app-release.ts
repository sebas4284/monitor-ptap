import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { API_BASE_URL } from './api';
import { hayActualizacion, type AppRelease } from './app-release-compare';

/**
 * Qué versión de la APK está publicada, y si la que corre aquí se quedó atrás.
 *
 * El problema que resuelve: la APK se reparte por descarga directa, sin tienda ni `expo-updates`,
 * así que **nadie se entera de que hay una versión nueva**. El 2026-08-15 se descubrió que la APK
 * servida llevaba días por detrás del backend, con una pestaña que llamaba a un endpoint ya
 * retirado, y no había forma de avisar a quien la tuviera instalada.
 *
 * La comparación vive en `app-release-compare.ts`, sin dependencias de plataforma, para poder
 * probarla. Aquí queda solo lo que necesita el runtime de Expo.
 */

export type { AppRelease } from './app-release-compare';
export { hayActualizacion, tamanoLegible } from './app-release-compare';

/** Versión que corre AHORA. En web no aplica: la web se sirve siempre fresca del servidor. */
export function runningVersionCode(): number | null {
  if (Platform.OS === 'web') return null;
  const v = Constants.expoConfig?.android?.versionCode;
  return typeof v === 'number' ? v : null;
}

export function runningVersion(): string | null {
  return Constants.expoConfig?.version ?? null;
}

/**
 * Consulta la versión publicada. Silencioso ante fallos **a propósito**: que no se pueda saber si
 * hay actualización no puede impedir usar la app ni ensuciar la pantalla de login con un error.
 */
export async function fetchAppRelease(): Promise<AppRelease | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/app/version`);
    if (!res.ok) return null;
    return (await res.json()) as AppRelease;
  } catch {
    return null;
  }
}

/** Atajo para la UI: compara lo publicado contra lo instalado en este dispositivo. */
export function hayActualizacionInstalada(release: AppRelease | null): boolean {
  return hayActualizacion(release, runningVersionCode());
}
