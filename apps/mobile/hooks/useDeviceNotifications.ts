import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import {
  getPermission,
  isSupported,
  requestPermission,
  unsupportedReason,
  type PermissionState,
} from '../services/device-notifications';
import { registerBackgroundSync, syncNotificationsToDevice } from '../services/notification-sync';

/**
 * Notificaciones del sistema operativo: permiso + sincronización.
 *
 * Se monta una sola vez, en la cáscara de `(app)` (o sea, ya con sesión: sin token la consulta a la
 * bandeja daría 401).
 *
 * **No pide el permiso solo.** Un `requestPermission()` automático al arrancar lo rechazan los
 * navegadores y Android lo cuenta como denegado — y una vez denegado, volver a pedirlo ya no
 * muestra el diálogo. El permiso se pide desde el botón de Ajustes, con un gesto del usuario.
 */

/** Cada cuánto consulta la bandeja la versión web mientras la pestaña esté abierta. */
const WEB_POLL_MS = 5 * 60 * 1000;
export function useDeviceNotifications(): {
  supported: boolean;
  reason: string | null;
  permission: PermissionState;
  ask: () => Promise<void>;
} {
  const [permission, setPermission] = useState<PermissionState>('undetermined');
  const supported = isSupported();

  useEffect(() => {
    void getPermission().then(setPermission);
  }, []);

  // Con permiso concedido: registrar la tarea periódica y sincronizar ya, para no esperar a que
  // Android decida ejecutarla por primera vez.
  useEffect(() => {
    if (permission !== 'granted') return;
    void registerBackgroundSync();
    void syncNotificationsToDevice();
  }, [permission]);

  // Al volver a primer plano se sincroniza también: es el camino FIABLE. La tarea en segundo plano
  // es "lo mejor posible" y algunos fabricantes no la ejecutan nunca; esto garantiza que, al menos
  // cuando la persona abre la app, el panel refleje lo que hay.
  useEffect(() => {
    if (permission !== 'granted') return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncNotificationsToDevice();
    });
    return () => sub.remove();
  }, [permission]);

  // En WEB no hay tarea en segundo plano —WorkManager no existe y el equivalente exige una PWA
  // instalada—, así que la pestaña abierta es el único canal. Sin esto, quien deja la web abierta en
  // otra pestaña no recibía nada hasta volver a mirarla, que es justo cuando ya no hace falta.
  useEffect(() => {
    if (permission !== 'granted' || Platform.OS !== 'web') return;
    const id = setInterval(() => void syncNotificationsToDevice(), WEB_POLL_MS);
    return () => clearInterval(id);
  }, [permission]);

  const ask = useCallback(async () => {
    setPermission(await requestPermission());
  }, []);

  return { supported, reason: unsupportedReason(), permission, ask };
}
