import AsyncStorage from '@react-native-async-storage/async-storage';
import { getJson } from './api';
import { versionMasReciente, type Novedad } from './novedades-compare';

/**
 * El changelog de la app, para la pestaña «Novedades» de la bandeja.
 *
 * **No es una notificación.** No entra en `FAMILIAS`, no tiene `NotificationKind`, no pasa por
 * `markSeen` ni por la deduplicación, y no toca la tabla `notification` — cuyo `plant_id` es NOT
 * NULL y no admitiría un aviso global sin inventarse una planta falsa. Fuente propia, render propio
 * y marca de leído propia. Comparte pantalla con los avisos porque es donde el usuario va a buscar
 * «qué hay de nuevo», y nada más.
 */

export type { Novedad } from './novedades-compare';
export { hayNovedadNueva, versionMasReciente, compararVersiones } from './novedades-compare';

/** Última versión cuyo changelog ya vio ESTE dispositivo. */
const ULTIMA_VISTA_KEY = 'ptap_ultima_novedad_vista';

export async function fetchNovedades(): Promise<Novedad[]> {
  const { novedades } = await getJson<{ novedades: Novedad[] }>('/api/app/novedades');
  return novedades ?? [];
}

export async function ultimaNovedadVista(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(ULTIMA_VISTA_KEY);
  } catch {
    // Si el almacenamiento falla, a lo sumo la marca de «nuevo» se queda encendida.
    return null;
  }
}

/**
 * Recuerda que ya se leyó hasta aquí. Se llama al ABRIR la pestaña, no al recibir el listado: la
 * marca dice «lo vio», y bajar los datos en segundo plano no es verlos.
 */
export async function marcarNovedadesVistas(novedades: Novedad[]): Promise<void> {
  const reciente = versionMasReciente(novedades);
  if (!reciente) return;
  try {
    await AsyncStorage.setItem(ULTIMA_VISTA_KEY, reciente);
  } catch {
    /* sin persistencia, el punto de «nuevo» volverá a aparecer: molesto, no grave */
  }
}
