import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { tierAtLeast, type RoleTier } from '@ptap/shared';
import type { AuthenticatedRequest } from '../authenticated-request';
import { MIN_TIER_KEY } from '../decorators/min-tier.decorator';

/**
 * Debe registrarse DESPUÉS de JwtAuthGuard (lee request.user, que ese guard setea).
 * Sin @MinTier() declarado en la ruta, este guard es un no-op (allow) — toda ruta
 * protegida debe declarar su tier explícitamente.
 */
@Injectable()
export class MinTierGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const minTier = this.reflector.getAllAndOverride<RoleTier | undefined>(MIN_TIER_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!minTier) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new UnauthorizedException('Falta autenticación');
    }
    if (!tierAtLeast(request.user.role, minTier)) {
      throw new ForbiddenException('Rol insuficiente');
    }
    return true;
  }
}
