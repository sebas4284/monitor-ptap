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
