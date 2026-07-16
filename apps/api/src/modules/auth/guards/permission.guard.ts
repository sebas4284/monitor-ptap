import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission, type Permission } from '@ptap/shared';
import type { AuthenticatedRequest } from '../authenticated-request';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';

/**
 * Debe registrarse DESPUÉS de JwtAuthGuard (lee request.user, que ese guard setea).
 * Sin @RequirePermission() declarado en la ruta, este guard es un no-op (allow): la ruta
 * solo exige un JWT válido (equivale al antiguo tier `viewer` = "cualquier autenticado").
 * Con permiso declarado, exige que el rol lo tenga según ROLE_PERMISSIONS de @ptap/shared.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new UnauthorizedException('Falta autenticación');
    }
    if (!hasPermission(request.user.role, required)) {
      throw new ForbiddenException('Permiso insuficiente');
    }
    return true;
  }
}
