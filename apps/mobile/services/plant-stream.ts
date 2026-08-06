import { subscribePlant, type PlantStreamHandlers as SocketHandlers } from './socket';

/**
 * Suscripción COMPARTIDA por planta, con refcount.
 *
 * El problema que resuelve: React Query deduplica la *query* por `queryKey`, pero no los listeners
 * del socket. Cada `useSnapshot(plantId)` montado abre su propia `subscribePlant()`, así que dos
 * pantallas sobre la misma planta registraban **dos** juegos de listeners y emitían **dos**
 * `opc:subscribe`.
 *
 * Aquí se abre **una sola** suscripción real por `plantId`, sin importar cuántos consumidores haya,
 * y se reparte a todos. El último en desmontarse la cierra.
 *
 * Lo que NO cambia: cada consumidor conserva sus propios callbacks, así que la detección de huecos
 * de `sequence` y el estado `socketDown` siguen siendo por-hook. Eso significa que con dos hooks
 * montados sobre la misma planta el `setQueryData` sí se ejecuta dos veces por push — es barato
 * (React Query corta por identidad) y es el precio de que cada hook mantenga su propio estado.
 */

/** Igual que el del socket, pero con `onConnectionChange` obligatorio: aquí siempre se entrega. */
export type PlantStreamHandlers = Required<SocketHandlers>;

interface Entry {
  handlers: Set<PlantStreamHandlers>;
  unsubscribe: () => void;
  /** Último estado de conexión visto, para que un consumidor que llega tarde no arranque a ciegas. */
  connected: boolean;
}

const streams = new Map<string, Entry>();

function createStream(plantId: string): Entry {
  const entry: Entry = { handlers: new Set(), unsubscribe: () => {}, connected: false };
  entry.unsubscribe = subscribePlant(plantId, {
    onSnapshot: (snapshot) => fanOut(entry.handlers, (h) => h.onSnapshot(snapshot)),
    onLiveness: (change) => fanOut(entry.handlers, (h) => h.onLiveness(change)),
    onConnectionChange: (connected) => {
      entry.connected = connected;
      fanOut(entry.handlers, (h) => h.onConnectionChange(connected));
    },
  });
  streams.set(plantId, entry);
  return entry;
}

/**
 * Une a un consumidor al stream de una planta. Devuelve la función de baja.
 *
 * Los errores de un handler se aíslan: si uno lanza, los demás siguen recibiendo el frame. Sin esto
 * un fallo en una pantalla dejaría muda a la otra, que es justo lo contrario de lo que se busca.
 */
export function joinPlantStream(plantId: string, handlers: PlantStreamHandlers): () => void {
  const entry = streams.get(plantId) ?? createStream(plantId);

  entry.handlers.add(handlers);
  // Un consumidor que se une con el socket ya caído tiene que enterarse ahora, no en el próximo
  // cambio de estado (que podría no llegar nunca).
  if (!entry.connected) handlers.onConnectionChange(false);

  return () => {
    entry.handlers.delete(handlers);
    if (entry.handlers.size === 0) {
      entry.unsubscribe();
      streams.delete(plantId);
    }
  };
}

function fanOut(
  handlers: Set<PlantStreamHandlers>,
  deliver: (h: PlantStreamHandlers) => void,
): void {
  // Copia obligatoria: `onConnectionChange` provoca un `setState` que puede desmontar una pantalla
  // y darla de baja en plena entrega; mutar el Set mientras se itera se saltaría un handler.
  for (const handler of [...handlers]) {
    try {
      deliver(handler);
    } catch (err) {
      console.warn('[plant-stream] un consumidor falló al procesar el evento', err);
    }
  }
}

/** Solo para pruebas/diagnóstico: cuántas suscripciones reales hay abiertas. */
export function activeStreamCount(): number {
  return streams.size;
}
