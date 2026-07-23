import { z } from 'zod';
import { ROLES } from '@ptap/shared';

/** Cambio de rol (solo Admin, permiso `assign_roles`). */
export const updateRoleSchema = z
  .object({
    role: z.enum(ROLES as [string, ...string[]]),
  })
  .strict();

export type UpdateRoleDto = z.infer<typeof updateRoleSchema>;

/** Activar/desactivar una cuenta (solo Admin, permiso `manage_users`). */
export const updateActiveSchema = z
  .object({
    isActive: z.boolean(),
  })
  .strict();

export type UpdateActiveDto = z.infer<typeof updateActiveSchema>;

/**
 * Filtros del listado de administración (query string). Todo opcional: sin parámetros, el
 * listado sale completo. `isActive` llega como texto en la URL, de ahí la coerción explícita
 * a booleano — `?isActive=false` debe filtrar los pendientes, no interpretarse como "truthy".
 */
export const listUsersQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(120).optional(),
    role: z.enum(ROLES as [string, ...string[]]).optional(),
    isActive: z.enum(['true', 'false']).optional(),
    // Sin page/limit: comportamiento previo (lista completa) para no romper otros consumidores.
    // limit tiene tope de 100 — evita que alguien pida la tabla entera con ?limit=999999.
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export type ListUsersQueryDto = z.infer<typeof listUsersQuerySchema>;
