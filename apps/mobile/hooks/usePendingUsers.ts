import { useQuery } from '@tanstack/react-query';
import { fetchUsers } from '../services/users';
import { useAuth } from '../context/AuthContext';

/**
 * Conteo de cuentas PENDIENTES de aprobación (`is_active=false`). Es el "aviso en la app" para
 * el administrador: si hay solicitudes nuevas (posibles usuarios reales o bots a filtrar), lo ve
 * sin entrar a la pantalla de Usuarios. Solo corre para quien tiene `manage_users` (el backend
 * responde 403 al resto). Refetch moderado (60 s) para no golpear la API — coherente con la
 * auditoría de consumo previa. Reutiliza `fetchUsers` con `limit:1` (solo necesitamos el total).
 */
export function usePendingUsers(): { count: number } {
  const { hasPermission } = useAuth();
  const enabled = hasPermission('manage_users');
  const query = useQuery({
    queryKey: ['pending-users-count'],
    queryFn: () => fetchUsers({ isActive: false, limit: 1 }),
    enabled,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return { count: enabled ? query.data?.total ?? 0 : 0 };
}
