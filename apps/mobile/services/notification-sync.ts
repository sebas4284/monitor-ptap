import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { debeSonar } from '@ptap/shared';
import { fetchNotifications, type AppNotification } from './notifications';
import { ensureAndroidChannel, presentNotification } from './device-notifications';
import { getNotificationPrefs, loadNotificationPrefs } from './notification-prefs';

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
 * **Lo que NO se filtra aquí:** el tipo y la gravedad. Eso lo hace el servidor, que es lo que
 * mantiene de acuerdo a la campana, la bandeja y el panel del sistema. Aquí solo se aplica el
 * horario de silencio, porque depende del reloj de este teléfono.
 */

const TASK_NAME = 'ptap-notification-sync';
const LAST_NOTIFIED_KEY = 'ptap_last_notified_id';
/** Avisos que tocaron durante el "no molestar" y aún no han sonado. */
const DEFERRED_KEY = 'ptap_deferred_notifications';
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
export async function syncNotificationsToDevice(): Promise<number> {
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
  const nuevos = candidatos.filter((n) => debeSonar(n.severity, prefs, ahora));
  const aplazados = candidatos.filter((n) => !debeSonar(n.severity, prefs, ahora)).map((n) => n.id);

  // El puntero avanza SIEMPRE, incluso con la franja activa: lo aplazado se recuerda aparte, así no
  // se re-anuncia cada quince minutos lo que ya sonó.
  const tope = candidatos.length > 0 ? Math.max(previo, ...candidatos.map((n) => n.id)) : previo;
  await Promise.all([recordarDiferidos(aplazados), tope > previo ? rememberNotifiedId(tope) : Promise.resolve()]);

  if (nuevos.length === 0) return 0;

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

  return nuevos.length;
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
