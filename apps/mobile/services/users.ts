import type { Role, UserSummary } from '@ptap/shared';
import { getJson, patchJson } from './api';

export type { UserSummary };

/**
 * Administración de usuarios (solo Admin). El backend exige los permisos `manage_users` /
 * `assign_roles`: si otro rol llama a esto, responde 403 y aquí se propaga el mensaje.
 */

/** Criterios de búsqueda. Se resuelven en el SERVIDOR (SQL), no filtrando en memoria. */
export interface UserFilter {
  /** Coincidencia parcial contra nombre, correo o teléfono. */
  search?: string;
  role?: Role;
  /** `false` = pendientes de aprobación. */
  isActive?: boolean;
}

export async function fetchUsers(filter: UserFilter = {}): Promise<UserSummary[]> {
  const params = new URLSearchParams();
  if (filter.search?.trim()) params.set('search', filter.search.trim());
  if (filter.role) params.set('role', filter.role);
  if (filter.isActive !== undefined) params.set('isActive', String(filter.isActive));

  const qs = params.toString();
  const body = await getJson<{ users: UserSummary[] }>(`/api/users${qs ? `?${qs}` : ''}`);
  return body.users;
}

/** Eleva o degrada a un usuario. El backend audita el cambio (quién, a quién, de qué a qué). */
export async function updateUserRole(id: string, role: Role): Promise<UserSummary> {
  return patchJson<UserSummary>(`/api/users/${id}/role`, { role });
}

/** Activa/desactiva una cuenta (un usuario inactivo no puede iniciar sesión). */
export async function setUserActive(id: string, isActive: boolean): Promise<UserSummary> {
  return patchJson<UserSummary>(`/api/users/${id}/active`, { isActive });
}
