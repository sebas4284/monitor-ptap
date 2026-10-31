import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import {
  fetchNotifications,
  fetchUnseenCount,
  markNotificationsSeen,
  type AppNotification,
} from '../services/notifications';

/** Cada cuánto se refresca el contador de la campana. Los avisos son diarios: no urge más. */
const COUNT_POLL_MS = 60_000;

/**
 * Contador de la campana: solo el número de NO VISTOS.
 *
 * Se separa del listado a propósito — la campana está montada en toda la app, y bajar el historial
 * completo cada minuto para pintar un número sería tráfico regalado.
 */
export function useUnseenNotifications(): number {
  const { user, token, hasPermission } = useAuth();
  const listKey = ['notifications', user?.id, user?.role, user?.plant];
  const countKey = [...listKey, 'unseen'];
  const { data } = useQuery({
    queryKey: countKey,
    queryFn: fetchUnseenCount,
    // El Civil no recibe avisos de proceso (el backend responde 403): ni se pregunta.
    enabled: !!token && hasPermission('view_dashboard'),
    refetchInterval: COUNT_POLL_MS,
    staleTime: 30_000,
  });
  return token && hasPermission('view_dashboard') ? (data ?? 0) : 0;
}

/**
 * Historial completo para la bandeja.
 *
 * `markSeen` NO borra nada: escribe la marca de visto de este usuario. Se invoca al abrir la
 * pantalla, que es lo que el requisito define como "verlas".
 */
export function useNotifications(): {
  notifications: AppNotification[];
  unseen: number;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  markSeen: () => void;
} {
  const queryClient = useQueryClient();
  const { user, token, hasPermission } = useAuth();
  const listKey = ['notifications', user?.id, user?.role, user?.plant];
  const countKey = [...listKey, 'unseen'];
  const canSee = !!token && hasPermission('view_dashboard');

  const query = useQuery({
    queryKey: listKey,
    queryFn: fetchNotifications,
    enabled: canSee,
    staleTime: 15_000,
  });

  const seenMutation = useMutation({
    mutationFn: markNotificationsSeen,
    onSuccess: () => {
      // El contador de la campana debe apagarse de inmediato; el listado se re-pide para que las
      // filas pierdan el resalte de "nuevo".
      void queryClient.invalidateQueries({ queryKey: countKey });
      void queryClient.invalidateQueries({ queryKey: listKey });
    },
  });

  const markSeen = useCallback(() => {
    if (!canSee) return;
    seenMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSee]);

  return {
    notifications: canSee ? (query.data?.notifications ?? []) : [],
    unseen: canSee ? (query.data?.unseen ?? 0) : 0,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => {
      if (canSee) void query.refetch();
    },
    markSeen,
  };
}
