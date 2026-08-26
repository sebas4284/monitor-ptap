import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { debeSonar } from '@ptap/shared';
import { fetchNotifications, type AppNotification } from './notifications';
import { ensureAndroidChannel, presentNotification } from './device-notifications';
import { getNotificationPrefs, loadNotificationPrefs } from './notification-prefs';
import { fetchAppRelease, runningVersionCode } from './app-release';
import { decidirAvisoActualizacion } from './app-release-compare';

/**
 * Lleva los avisos del servidor al panel de notificaciones del dispositivo.
 *
 * **Sin servidor de push, a propósito.** No hay Firebase ni FCM: el dispositivo pregunta cada
 * ~15 min y levanta la notificación por su cuenta (`expo-background-task`, que por debajo usa
 * WorkManager en Android). A cambio de no depender de terceros, la entrega es **"lo mejor
 * posible"**: Android agrupa y retrasa estas tareas, y algunos fabricantes (Xiaomi, Huawei) matan
 * el proceso de forma agresiva. Para un aviso diario de "este sensor lleva días caído" es
 * suficiente; para una alarma de seguridad en segundos NO lo sería.
 *
 * Idempotencia: se recuerda el id más alto ya notificado. Un aviso solo salta al panel una vez,
 * aunque la tarea corra veinte veces con él en la lista.
 *
 * **Aquí se decide qué SUENA, no qué existe.** La bandeja y la campana las sirve el servidor sin
 * filtrar: lo silenciado sigue estando ahí. Lo que se aplica en este punto son las preferencias del
 * usuario —tipos y señales callados, gravedad mínima y franja de «no molestar»—, porque dependen
 * del reloj de este teléfono y porque el silencio no debe borrarle el historial a nadie.
 *
 * Las maniobras de válvula atraviesan todo eso: son el registro que sustituye a la confirmación
 * eléctrica que estas plantas no dan, y no se pueden callar.
 */

const TASK_NAME = 'ptap-notification-sync';
const LAST_NOTIFIED_KEY = 'ptap_last_notified_id';
/** Avisos que tocaron durante el "no molestar" y aún no han sonado. */
const DEFERRED_KEY = 'ptap_deferred_notifications';
/** Último `versionCode` del que ya se avisó en el panel. Ver `avisarSiHayActualizacion`. */
const UPDATE_NOTIFIED_KEY = 'ptap_last_update_notified';
/** Marca que llevan los datos del aviso de actualización, para reconocerlo al tocarlo. */
export const UPDATE_TAG = 'app-update';
/** Tope de diferidos que se arrastran. Una noche entera de avisos no puede crecer sin límite. */
const MAX_DIFERIDOS = 30;
/** Mínimo que Android respeta de verdad; pedir menos no lo acelera. */
const INTERVAL_MINUTES = 15;

async function lastNotifiedId(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(LAST_NOTIFIED_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

async function rememberNotifiedId(id: number): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_NOTIFIED_KEY, String(id));
  } catch {
    /* si el storage falla, a lo sumo se repite un aviso */
  }
}

async function diferidos(): Promise<number[]> {
  try {
    const raw = await AsyncStorage.getItem(DEFERRED_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : [];
  } catch {
    return [];
  }
}

async function recordarDiferidos(ids: number[]): Promise<void> {
  try {
    await AsyncStorage.setItem(DEFERRED_KEY, JSON.stringify(ids.slice(-MAX_DIFERIDOS)));
  } catch {
    /* si el storage falla, a lo sumo un aviso diferido no vuelve a intentarse */
  }
}

/**
 * Consulta la bandeja y lleva al panel lo que sea nuevo. Devuelve cuántos avisos mostró.
 *
 * Se exporta aparte de la tarea porque también se llama con la app abierta (al volver a primer
 * plano): así el aviso aparece aunque Android nunca llegue a ejecutar la tarea en segundo plano.
 */
/**
 * Avisa en el panel del teléfono de que hay una versión nueva de la app.
 *
 * Existe porque el aviso de actualización solo vivía DENTRO de la app, y quien no la abre es
 * precisamente quien más desactualizado está: sin tienda ni `expo-updates`, no había forma de
 * alcanzarle. Esto le llega al panel como cualquier otro aviso.
 *
 * **Va por el canal normal, no el crítico.** Una actualización disponible no es un tanque
 * rebosando: el canal crítico es persistente y suena a las cuatro de la mañana.
 *
 * **No se le aplican las preferencias de silencio ni el «no molestar».** Esas son preferencias
 * sobre avisos DE PLANTA (`NotificationKind`), y esto no es uno: es un aviso sobre la propia
 * aplicación. El permiso del sistema sí se respeta — lo comprueba `presentNotification` por dentro.
 *
 * Devuelve 1 si avisó, 0 si no. Nunca lanza: que no se pueda saber si hay actualización no puede
 * tumbar el barrido de avisos de planta, que es lo que de verdad importa.
 */
async function avisarSiHayActualizacion(): Promise<number> {
  try {
    const [release, ultimo] = await Promise.all([fetchAppRelease(), ultimoAvisoActualizacion()]);
    const aviso = decidirAvisoActualizacion(release, runningVersionCode(), ultimo);
    if (!aviso) return 0;

    await ensureAndroidChannel();
    await presentNotification(aviso.titulo, aviso.cuerpo, {
      tag: UPDATE_TAG,
      downloadUrl: aviso.downloadUrl,
    });
    // Se recuerda DESPUÉS de publicar: si `presentNotification` falla, el próximo ciclo reintenta
    // en vez de dar el aviso por entregado.
    await recordarAvisoActualizacion(aviso.versionCode);
    return 1;
  } catch {
    return 0;
  }
}

async function ultimoAvisoActualizacion(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(UPDATE_NOTIFIED_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function recordarAvisoActualizacion(versionCode: number): Promise<void> {
  try {
    await AsyncStorage.setItem(UPDATE_NOTIFIED_KEY, String(versionCode));
  } catch {
    /* si el storage falla, a lo sumo el aviso se repite en el próximo ciclo */
  }
}

export async function syncNotificationsToDevice(): Promise<number> {
  // La actualización se comprueba PRIMERO y por separado: es independiente de los avisos de planta
  // y no comparte ni su idempotencia ni sus preferencias de silencio. Va con su propio try/catch
  // dentro, así que si el endpoint de versión falla, lo de abajo sigue igual.
  const avisosActualizacion = await avisarSiHayActualizacion();

  const [previo, pendientes] = await Promise.all([lastNotifiedId(), diferidos()]);
  const [{ notifications }] = await Promise.all([fetchNotifications(), loadNotificationPrefs()]);
  const prefs = getNotificationPrefs();

  // Solo lo NO VISTO y más nuevo que lo ya anunciado, MÁS lo que quedó pendiente de una franja de
  // silencio anterior. Orden ascendente para que, si hay varios, el más reciente quede arriba.
  const candidatos = notifications
    .filter((n) => !n.seen && (n.id > previo || pendientes.includes(n.id)))
    .sort((a, b) => a.id - b.id);

  // El "no molestar" no oculta nada: aplaza. Lo crítico lo atraviesa —un tanque rebosando suena a
  // las cuatro de la mañana— y el resto espera a que termine la franja, sin perderse por el camino.
  const ahora = new Date();
  const suena = (n: AppNotification): boolean => debeSonar(n, prefs, ahora);
  const nuevos = candidatos.filter(suena);
  const aplazados = candidatos.filter((n) => !suena(n)).map((n) => n.id);

  // El puntero avanza SIEMPRE, incluso con la franja activa: lo aplazado se recuerda aparte, así no
  // se re-anuncia cada quince minutos lo que ya sonó.
  const tope = candidatos.length > 0 ? Math.max(previo, ...candidatos.map((n) => n.id)) : previo;
  await Promise.all([recordarDiferidos(aplazados), tope > previo ? rememberNotifiedId(tope) : Promise.resolve()]);

  if (nuevos.length === 0) return avisosActualizacion;

  await ensureAndroidChannel();

  // LO CRÍTICO NUNCA SE RESUME. Antes, tres avisos de golpe se colapsaban en «3 avisos nuevos» sin
  // severidad ni planta, y un tanque rebosando se leía igual que tres sensores parados. Ahora lo
  // crítico sale siempre con su título completo, por el canal de importancia máxima y persistente;
  // solo se agrupa el resto.
  const criticos = nuevos.filter((n) => n.severity === 'critical');
  const resto = nuevos.filter((n) => n.severity !== 'critical');

  for (const n of criticos) {
    await presentNotification(
      n.title,
      n.action ? `${n.message}

▸ ${n.action}` : n.message,
      { tag: `n-${n.id}`, plantId: n.plantId, subject: n.subject },
      true,
    );
  }

  // Más de dos avisos de golpe se resumen: llenar el panel con doce tarjetas es peor que una.
  if (resto.length > 2) {
    const plantas = [...new Set(resto.map((n) => n.plantId))].length;
    await presentNotification(
      `${resto.length} avisos nuevos`,
      `${plantas} planta${plantas === 1 ? '' : 's'} requieren atención. Abre la aplicación para ver el detalle.`,
      { tag: 'resumen' },
    );
  } else {
    for (const n of resto) {
      await presentNotification(n.title, n.message, { tag: `n-${n.id}`, plantId: n.plantId, subject: n.subject });
    }
  }

  return nuevos.length + avisosActualizacion;
}

/**
 * Registra la tarea periódica. Solo en nativo: en web no existe WorkManager, y el equivalente
 * (Periodic Background Sync) exige una PWA instalada y solo lo admite Chromium — la web recibe
 * sus avisos mientras la pestaña está abierta, vía `syncNotificationsToDevice()`.
 *
 * Silencioso ante fallos: que no se pueda registrar la tarea no debe impedir arrancar la app.
 */
export async function registerBackgroundSync(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const TaskManager = await import('expo-task-manager');
    const BackgroundTask = await import('expo-background-task');

    if (!TaskManager.isTaskDefined(TASK_NAME)) {
      TaskManager.defineTask(TASK_NAME, async () => {
        try {
          await syncNotificationsToDevice();
          return BackgroundTask.BackgroundTaskResult.Success;
        } catch {
          return BackgroundTask.BackgroundTaskResult.Failed;
        }
      });
    }

    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) return false;

    await BackgroundTask.registerTaskAsync(TASK_NAME, { minimumInterval: INTERVAL_MINUTES });
    return true;
  } catch {
    return false;
  }
}
