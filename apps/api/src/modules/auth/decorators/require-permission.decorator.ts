import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@ptap/shared';

export const PERMISSION_KEY = 'requiredPermission';

/**
 * Permiso granular requerido por PermissionGuard para esta ruta. Usa el modelo de
 * @ptap/shared (ROLE_PERMISSIONS/hasPermission), fuente única compartida con el móvil,
 * en vez de un tier lineal. Sin @RequirePermission(), la ruta solo exige un JWT válido.
 */
export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION_KEY, permission);
