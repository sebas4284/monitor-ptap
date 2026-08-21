import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import {
  fetchNotifications,
  fetchUnseenCount,
  markNotificationsSeen,
  type AppNotification,
} from '../services/notifications';

const LIST_KEY = ['notifications'];
const COUNT_KEY = ['notifications', 'unseen'];

/** Cada cuánto se refresca el contador de la campana. Los avisos son diarios: no urge más. */
const COUNT_POLL_MS = 60_000;

/**
 * Contador de la campana: solo el número de NO VISTOS.
 *
 * Se separa del listado a propósito — la campana está montada en toda la app, y bajar el historial
 * completo cada minuto para pintar un número sería tráfico regalado.
 */
export function useUnseenNotifications(): number {
  const { hasPermission } = useAuth();
  const { data } = useQuery({
    queryKey: COUNT_KEY,
    queryFn: fetchUnseenCount,
    // El Civil no recibe avisos de proceso (el backend responde 403): ni se pregunta.
    enabled: hasPermission('view_dashboard'),
    refetchInterval: COUNT_POLL_MS,
    staleTime: 30_000,
  });
  return data ?? 0;
}

/**
 * Historial completo para la bandeja.
 *
 * `markSeen` NO borra nada: escribe la marca de visto de este usuario. Se invoca al abrir la
 * pantalla, que es lo que el requisito define como "verlas".
 */
export function useNotifications(incluirSilenciados = false): {
  notifications: AppNotification[];
  unseen: number;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  markSeen: () => void;
} {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const canSee = hasPermission('view_dashboard');

  const query = useQuery({
    // El ámbito forma parte de la clave: si no, ver los silenciados serviría la lista cacheada de
    // los no silenciados y el interruptor parecería no hacer nada.
    queryKey: [...LIST_KEY, incluirSilenciados],
    queryFn: () => fetchNotifications(incluirSilenciados),
    enabled: canSee,
    staleTime: 15_000,
  });

  const seenMutation = useMutation({
    mutationFn: () => markNotificationsSeen(incluirSilenciados),
    onSuccess: () => {
      // El contador de la campana debe apagarse de inmediato; el listado se re-pide para que las
      // filas pierdan el resalte de "nuevo".
      void queryClient.invalidateQueries({ queryKey: COUNT_KEY });
      void queryClient.invalidateQueries({ queryKey: LIST_KEY });
    },
  });

  const markSeen = useCallback(() => {
    if (!canSee) return;
    seenMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSee, incluirSilenciados]);

  return {
    notifications: query.data?.notifications ?? [],
    unseen: query.data?.unseen ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
    markSeen,
  };
}
