import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Role, UserSummary } from '@ptap/shared';
import { AuditLogService } from '../../infrastructure/audit/audit-log.service';
import { UsersRepository, type UserListFilter, type UserListResult } from './users.repository';

/** Quién ejecuta la acción (del JWT + IP), para la trazabilidad. */
export interface AdminActor {
  userId: string | null;
  userEmail: string | null;
  role: string | null;
  ip: string | null;
}

/**
 * Administración de usuarios (solo Admin — matriz oficial: "Crear, editar y eliminar
 * usuarios" y "Asignar roles a los usuarios" son exclusivas del Administrador).
 *
 * Guard rails deliberados (los administradores son MUTUAMENTE intocables):
 *  1. Nadie puede cambiar su PROPIO rol ni desactivarse a sí mismo (evita dejarse fuera).
 *  2. Ningún admin puede cambiar el rol NI desactivar a OTRO admin. Los administradores no se
 *     eliminan entre sí desde la app: un admin comprometido no puede desmantelar al resto, y
 *     nadie pierde el acceso por un clic ajeno. La membresía de admin se gestiona fuera de la
 *     app (scripts/seed-admin-user.ts o la BD) — es una decisión de seguridad, no una omisión.
 *  SÍ se permite PROMOVER a admin (el objetivo aún no es admin), solo se bloquea actuar sobre
 *  uno ya existente.
 *
 * Todo cambio queda auditado con quién, a quién y de qué → a qué.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(UsersRepository) private readonly users: UsersRepository,
    @Inject(AuditLogService) private readonly auditLog: AuditLogService,
  ) {}

  async list(filter: UserListFilter = {}): Promise<UserListResult> {
    return this.users.list(filter);
  }

  async changeRole(targetId: string, role: Role, actor: AdminActor): Promise<UserSummary> {
    const target = await this.requireUser(targetId);

    if (actor.userId === targetId) {
      throw new BadRequestException('No puedes cambiar tu propio rol (evita perder el acceso de administrador).');
    }
    // Los admins son mutuamente intocables: no se puede degradar a otro administrador.
    if (target.role === 'admin') {
      throw new ForbiddenException(
        'No puedes cambiar el rol de otro administrador. La gestión de administradores se hace fuera de la app.',
      );
    }
    if (target.role === role) return target; // no-op: no ensucia la auditoría

    await this.users.updateRole(targetId, role);
    await this.auditLog.record({
      eventType: 'user.role_changed',
      userId: actor.userId,
      userEmail: actor.userEmail,
      role: actor.role,
      ip: actor.ip,
      method: 'PATCH',
      path: `/api/users/${targetId}/role`,
      statusCode: 200,
      detail: { targetUserId: targetId, targetEmail: target.email, from: target.role, to: role },
    });

    return { ...target, role };
  }

  async changeActive(targetId: string, isActive: boolean, actor: AdminActor): Promise<UserSummary> {
    const target = await this.requireUser(targetId);

    if (actor.userId === targetId) {
      throw new BadRequestException('No puedes desactivar tu propia cuenta.');
    }
    // Los admins son mutuamente intocables: no se puede desactivar a otro administrador.
    if (!isActive && target.role === 'admin') {
      throw new ForbiddenException(
        'No puedes desactivar a otro administrador. La gestión de administradores se hace fuera de la app.',
      );
    }
    // Nudo anti-bot: no se puede ACTIVAR una cuenta cuyo correo no fue verificado. Así ninguna
    // cuenta con correo inventado llega a iniciar sesión, aunque un admin se distraiga.
    if (isActive && !target.emailVerified) {
      throw new BadRequestException(
        'No puedes activar esta cuenta: el correo aún no ha sido verificado por el usuario.',
      );
    }
    if (target.isActive === isActive) return target;

    await this.users.setActive(targetId, isActive);
    await this.auditLog.record({
      eventType: 'user.active_changed',
      userId: actor.userId,
      userEmail: actor.userEmail,
      role: actor.role,
      ip: actor.ip,
      method: 'PATCH',
      path: `/api/users/${targetId}/active`,
      statusCode: 200,
      detail: { targetUserId: targetId, targetEmail: target.email, from: target.isActive, to: isActive },
    });

    return { ...target, isActive };
  }

  private async requireUser(id: string): Promise<UserSummary> {
    const user = await this.users.findSummaryById(id);
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }
}
