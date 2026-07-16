import { Body, Controller, Get, Inject, Param, Patch, Req, UseGuards } from '@nestjs/common';
import type { Role, UserSummary } from '@ptap/shared';
import { ZodValidationPipe } from '../../infrastructure/validation/zod-validation.pipe';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { updateActiveSchema, updateRoleSchema, type UpdateActiveDto, type UpdateRoleDto } from './user.dto';
import { UsersService, type AdminActor } from './users.service';

/**
 * Administración de usuarios. Reservada al Administrador por la matriz oficial, expresada
 * con los permisos granulares de @ptap/shared: `manage_users` (ver/activar) y `assign_roles`
 * (cambiar rol). Ningún otro rol los tiene → civil/operador/jefe reciben 403.
 * Los accesos (permitidos y denegados) los audita AuditMiddleware; los cambios de rol/estado
 * los audita UsersService con el detalle from→to.
 */
@Controller('users')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class UsersController {
  constructor(@Inject(UsersService) private readonly usersService: UsersService) {}

  @Get()
  @RequirePermission('manage_users')
  async list(): Promise<{ users: UserSummary[] }> {
    return { users: await this.usersService.list() };
  }

  @Patch(':id/role')
  @RequirePermission('assign_roles')
  async changeRole(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRoleSchema)) dto: UpdateRoleDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<UserSummary> {
    return this.usersService.changeRole(id, dto.role as Role, actorOf(request));
  }

  @Patch(':id/active')
  @RequirePermission('manage_users')
  async changeActive(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateActiveSchema)) dto: UpdateActiveDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<UserSummary> {
    return this.usersService.changeActive(id, dto.isActive, actorOf(request));
  }
}

function actorOf(request: AuthenticatedRequest): AdminActor {
  return {
    userId: request.user?.id ?? null,
    userEmail: request.user?.email ?? null,
    role: request.user?.role ?? null,
    ip: request.ip ?? request.socket?.remoteAddress ?? null,
  };
}
