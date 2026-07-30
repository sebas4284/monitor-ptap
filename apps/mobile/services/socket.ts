import { io, type Socket } from 'socket.io-client';
import { API_BASE_URL, getAuthToken, type LivenessChange, type PlantSnapshotDto } from './api';

/**
 * Cliente Socket.IO REAL. El backend empuja opc:snapshot (por planta, solo en cambios)
 * y opc:liveness (broadcast). El front NO hace polling: escucha el push.
 *
 * SEGURIDAD: el JWT del login viaja en `auth.token` y el gateway lo VALIDA en el handshake
 * (SRV-04): sin token válido, el backend corta la conexión. El token se captura al CREAR el
 * socket, así que la sesión debe reiniciarlo en cada cambio de identidad — de eso se encarga
 * `resetSocket()`, llamado por AuthContext en login y logout. Sin ese reinicio, el socket
 * seguiría vivo tras cerrar sesión (fuga del stream) o reusaría el token de otro usuario.
 */
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(API_BASE_URL, {
      // Con `websocket` a secas, cualquier proxy/túnel que no negocie el upgrade deja el socket
      // MUERTO en silencio (y antes eso hacía que la app declarara la planta "congelada" aunque el
      // REST funcionara). Se permite el fallback a polling: peor latencia, pero datos que llegan.
      transports: ['websocket', 'polling'],
      reconnection: true,
      auth: { token: getAuthToken() },
    });
  }
  return socket;
}

/**
 * Cierra el socket y lo olvida. El próximo `getSocket()` abre una conexión nueva con el token
 * VIGENTE en ese momento. Debe llamarse al iniciar y al cerrar sesión: al salir, corta el stream
 * de datos del usuario que se va; al entrar, evita reutilizar el socket (y el JWT) de la sesión
 * anterior.
 */
export function resetSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export interface PlantStreamHandlers {
  onSnapshot: (snapshot: PlantSnapshotDto) => void;
  onLiveness: (change: LivenessChange) => void;
  /**
   * Cambia el estado del transporte del socket: `false` = socket caído o handshake rechazado
   * (JWT vencido/revocado) → los datos dejan de llegar y ya NO son fiables (marcar frozen);
   * `true` = (re)conectado → conviene resincronizar por REST. Sin esto, un socket muerto dejaba
   * las tarjetas "EN VIVO" para siempre con datos viejos.
   */
  onConnectionChange?: (connected: boolean) => void;
}

/**
 * Suscribe a una planta: entra a su room, recibe su snapshot actual y los cambios.
 * Devuelve una función de limpieza.
 */
export function subscribePlant(plantId: string, handlers: PlantStreamHandlers): () => void {
  const s = getSocket();

  const onSnapshot = (snapshot: PlantSnapshotDto | null) => {
    if (snapshot && snapshot.plantId === plantId) handlers.onSnapshot(snapshot);
  };
  const onLiveness = (change: LivenessChange) => handlers.onLiveness(change);
  const join = () => {
    s.emit('opc:subscribe', { plantId });
    handlers.onConnectionChange?.(true);
  };
  const onDown = () => handlers.onConnectionChange?.(false);

  s.on('opc:snapshot', onSnapshot);
  s.on('opc:liveness', onLiveness);
  s.on('connect', join);
  s.on('disconnect', onDown);
  s.on('connect_error', onDown);
  if (s.connected) join();
  else handlers.onConnectionChange?.(false);

  return () => {
    if (s.connected) s.emit('opc:unsubscribe', { plantId }); // salir de la room en el servidor
    s.off('opc:snapshot', onSnapshot);
    s.off('opc:liveness', onLiveness);
    s.off('connect', join);
    s.off('disconnect', onDown);
    s.off('connect_error', onDown);
  };
}
