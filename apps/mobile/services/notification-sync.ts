import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { fetchNotifications, type AppNotification } from './notifications';
import { ensureAndroidChannel, presentNotification } from './device-notifications';

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
 */

const TASK_NAME = 'ptap-notification-sync';
const LAST_NOTIFIED_KEY = 'ptap_last_notified_id';
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

/**
 * Consulta la bandeja y lleva al panel lo que sea nuevo. Devuelve cuántos avisos mostró.
 *
 * Se exporta aparte de la tarea porque también se llama con la app abierta (al volver a primer
 * plano): así el aviso aparece aunque Android nunca llegue a ejecutar la tarea en segundo plano.
 */
export async function syncNotificationsToDevice(): Promise<number> {
  const previo = await lastNotifiedId();
  const { notifications } = await fetchNotifications();

  // Solo lo NO VISTO y más nuevo que lo ya anunciado. Orden ascendente para que, si hay varios,
  // el más reciente quede arriba en el panel.
  const nuevos = notifications
    .filter((n) => !n.seen && n.id > previo)
    .sort((a, b) => a.id - b.id);

  if (nuevos.length === 0) return 0;

  await ensureAndroidChannel();

  // Más de dos avisos de golpe se resumen: llenar el panel con doce tarjetas es peor que una.
  if (nuevos.length > 2) {
    const plantas = [...new Set(nuevos.map((n) => n.plantId))].length;
    await presentNotification(
      `${nuevos.length} avisos nuevos`,
      `${plantas} planta${plantas === 1 ? '' : 's'} requieren atención. Abre la aplicación para ver el detalle.`,
      { tag: 'resumen' },
    );
  } else {
    for (const n of nuevos) {
      await presentNotification(n.title, n.message, { tag: `n-${n.id}`, plantId: n.plantId, subject: n.subject });
    }
  }

  await rememberNotifiedId(Math.max(...nuevos.map((n) => n.id)));
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
