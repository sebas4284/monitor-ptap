import { io, type Socket } from 'socket.io-client';
import { API_BASE_URL, getAuthToken, type LivenessChange, type PlantSnapshotDto } from './api';

/**
 * Cliente Socket.IO REAL. El backend empuja opc:snapshot (por planta, solo en cambios)
 * y opc:liveness (broadcast). El front NO hace polling: escucha el push.
 *
 * El JWT viaja en el handshake por compatibilidad hacia adelante. OJO: hoy el gateway
 * del backend NO lo valida — autenticar el socket es un gap conocido y documentado
 * (ver docs/SECURITY_FINDING_P0.md §6). No asumir que este canal está protegido.
 */
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(API_BASE_URL, {
      transports: ['websocket'],
      reconnection: true,
      auth: { token: getAuthToken() },
    });
  }
  return socket;
}

export interface PlantStreamHandlers {
  onSnapshot: (snapshot: PlantSnapshotDto) => void;
  onLiveness: (change: LivenessChange) => void;
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
  const join = () => s.emit('opc:subscribe', { plantId });

  s.on('opc:snapshot', onSnapshot);
  s.on('opc:liveness', onLiveness);
  s.on('connect', join);
  if (s.connected) join();

  return () => {
    s.off('opc:snapshot', onSnapshot);
    s.off('opc:liveness', onLiveness);
    s.off('connect', join);
  };
}

/** Escucha SOLO los cambios de liveness (broadcast) para el tablero de plantas. */
export function subscribeLiveness(onLiveness: (change: LivenessChange) => void): () => void {
  const s = getSocket();
  s.on('opc:liveness', onLiveness);
  return () => s.off('opc:liveness', onLiveness);
}
