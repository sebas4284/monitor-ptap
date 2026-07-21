import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { hasPermission } from '@ptap/shared';
import type { AuthenticatedRequest } from '../authenticated-request';

/**
 * Ámbito por planta: cada cuenta está vinculada a UNA planta (`user.plant`), así que pedir otra
 * es un 403 — salvo con el permiso `view_all_plants` (hoy solo el Admin, que por la matriz
 * oficial supervisa las 12).
 *
 * Debe registrarse DESPUÉS de JwtAuthGuard (lee `request.user`). Es un guard y no un `if` en
 * cada controlador para que la regla viva en un solo sitio: aplica igual a la LECTURA
 * (`/plants/:plantId/...`) y a la ESCRITURA (`/plants/:plantId/commands`), que es el caso
 * grave — sin esto, un operador de una planta podría accionar una válvula de otra.
 *
 * En rutas sin `:plantId` (p. ej. el listado de plantas) es un no-op: no hay ámbito que validar.
 */
@Injectable()
export class PlantScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const plantId = (request.params as Record<string, string> | undefined)?.plantId;
    if (!plantId) return true; // la ruta no tiene ámbito de planta

    if (!request.user) {
      throw new UnauthorizedException('Falta autenticación');
    }
    if (hasPermission(request.user.role, 'view_all_plants')) return true;
    if (plantId === request.user.plant) return true;

    // Mensaje deliberadamente concreto: no revela nada que el usuario no sepa ya (su propia
    // planta) y evita que un operador pierda tiempo creyendo que es un fallo del sistema.
    throw new ForbiddenException('Tu cuenta solo tiene acceso a la planta asignada');
  }
}
