import { Platform } from 'react-native';

/**
 * Notificaciones del SISTEMA OPERATIVO (panel de Android / centro de notificaciones del navegador).
 *
 * No confundir con `toast-store.ts` (avisos efímeros dentro de la app) ni con la bandeja del
 * servidor (`services/notifications.ts`). Esto es lo que aparece **fuera** de la aplicación.
 *
 * Dos implementaciones, porque no hay una que sirva para ambas:
 *  - **Nativo (APK)**: `expo-notifications` con notificaciones LOCALES. No hay servidor de push
 *    (nada de Firebase): el propio dispositivo consulta y levanta el aviso. Ver `notification-sync.ts`.
 *  - **Web**: la API `Notification` del navegador. `expo-notifications` no soporta web.
 *
 * ⚠️ **En web esto solo funciona sobre HTTPS.** La API exige un *contexto seguro*; sobre
 * `http://192.168.30.50` el navegador ni siquiera deja pedir el permiso. `isSupported()` lo
 * detecta y devuelve false, para que la interfaz no ofrezca algo que no puede cumplir.
 */

export type PermissionState = 'granted' | 'denied' | 'unsupported' | 'undetermined';

const isWeb = Platform.OS === 'web';

/** Carga perezosa: importar expo-notifications en web revienta, así que solo se toca en nativo. */
async function nativeModule() {
  return import('expo-notifications');
}

/**
 * ¿Puede esta plataforma mostrar notificaciones del sistema AHORA MISMO?
 * En web incluye la comprobación de contexto seguro, que es el motivo #1 de fallo silencioso.
 */
export function isSupported(): boolean {
  if (!isWeb) return true;
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  // `isSecureContext` es false sobre http:// salvo en localhost.
  return window.isSecureContext === true;
}

/** Motivo por el que no se puede, en lenguaje del usuario (para explicarlo en Ajustes). */
export function unsupportedReason(): string | null {
  if (isSupported()) return null;
  if (!isWeb) return 'Esta plataforma no admite notificaciones del sistema.';
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'El navegador solo permite notificaciones en sitios HTTPS. Entrando por http:// no se pueden activar.';
  }
  return 'Este navegador no admite notificaciones.';
}

export async function getPermission(): Promise<PermissionState> {
  if (!isSupported()) return 'unsupported';
  if (isWeb) return window.Notification.permission as PermissionState;
  const { getPermissionsAsync } = await nativeModule();
  const { status } = await getPermissionsAsync();
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
}

/**
 * Pide el permiso. Debe llamarse desde un gesto del usuario (un botón), no al arrancar: los
 * navegadores rechazan las peticiones automáticas y Android las cuenta como denegadas.
 */
export async function requestPermission(): Promise<PermissionState> {
  if (!isSupported()) return 'unsupported';
  if (isWeb) {
    const result = await window.Notification.requestPermission();
    return result as PermissionState;
  }
  const { requestPermissionsAsync } = await nativeModule();
  const { status } = await requestPermissionsAsync();
  return status === 'granted' ? 'granted' : 'denied';
}

/**
 * Canal de Android. Obligatorio desde Android 8: sin canal, el sistema descarta la notificación
 * sin avisar. Importancia alta para que aparezca como aviso emergente, no solo en la lista.
 */
export const CANAL_NORMAL = 'ptap-alertas';
/**
 * Canal aparte para lo crítico. Los canales de Android son INMUTABLES una vez creados —cambiarle la
 * importancia a uno existente no surte efecto—, así que separar la urgencia exige un id nuevo.
 *
 * Existe porque hasta ahora un rebose real y un «el máximo está mal medido» sonaban y vibraban
 * exactamente igual. Cuando todo suena igual, el operario aprende a ignorarlo todo.
 */
export const CANAL_CRITICO = 'ptap-criticas';

export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const Notifications = await nativeModule();
  await Notifications.setNotificationChannelAsync(CANAL_NORMAL, {
    name: 'Avisos de planta',
    description: 'Sensores sin refrescar, señales fuera de rango y niveles de tanque.',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250],
    enableVibrate: true,
  });
  await Notifications.setNotificationChannelAsync(CANAL_CRITICO, {
    name: 'Alertas críticas',
    description: 'Tanque rebosando, sin autonomía o planta sin datos. Requieren actuar.',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 400, 200, 400, 200, 400],
    enableVibrate: true,
  });
}

/**
 * Muestra un aviso en el panel del sistema. Silencioso si no hay permiso: nunca lanza.
 *
 * `critica` cambia dos cosas, y las dos importan:
 *  - va por el canal de importancia MÁXIMA, con su propia vibración;
 *  - es PERSISTENTE (`sticky` en Android, `requireInteraction` en web): no se descarta sola. Un
 *    tanque rebosando no puede desaparecer del panel porque el operario tardara en mirar el móvil.
 */
export async function presentNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>,
  critica = false,
): Promise<void> {
  try {
    if (!isSupported()) return;
    if ((await getPermission()) !== 'granted') return;

    if (isWeb) {
      new window.Notification(title, {
        body,
        tag: String(data?.tag ?? title),
        data,
        // Persistente en el escritorio: se queda hasta que alguien la cierra.
        requireInteraction: critica,
      });
      return;
    }
    const Notifications = await nativeModule();
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data,
        sound: true,
        sticky: critica,
        autoDismiss: !critica,
        ...(Platform.OS === 'android' ? { channelId: critica ? CANAL_CRITICO : CANAL_NORMAL } : {}),
      },
      trigger: null, // null = inmediata
    });
  } catch {
    // Una notificación que no se puede mostrar no debe romper nada de lo que la invocó.
  }
}
