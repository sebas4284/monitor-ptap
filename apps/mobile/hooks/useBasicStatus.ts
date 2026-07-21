import { useQuery } from '@tanstack/react-query';
import { fetchBasicStatus } from '../services/api';

/** Cada cuánto se refresca el estado básico. No es telemetría de operación: para responder
 *  "¿opera?" y "¿hay agua?" un refresco cada 15 s es de sobra. */
const REFRESH_MS = 15_000;

/**
 * Estado básico de una planta para el rol Civil.
 *
 * A diferencia de `useSnapshot`, esto es **solo REST**: NO abre suscripción a Socket.IO.
 * Es deliberado — el canal `opc:snapshot` empuja el snapshot COMPLETO y el gateway todavía
 * no valida permisos (gap conocido, ver docs/SECURITY_FINDING_P0.md §6), así que suscribir
 * al Civil ahí le entregaría por push exactamente los datos detallados que este endpoint
 * evita. Al no suscribirse, esa vía queda cerrada por construcción.
 */
export function useBasicStatus(plantId: string) {
  return useQuery({
    queryKey: ['basic-status', plantId],
    queryFn: () => fetchBasicStatus(plantId),
    refetchInterval: REFRESH_MS,
  });
}
