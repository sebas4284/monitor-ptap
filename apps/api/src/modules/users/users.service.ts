import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Role, UserSummary } from '@ptap/shared';
import { AuditLogService } from '../../infrastructure/audit/audit-log.service';
import { UsersRepository } from './users.repository';

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
 * Guard rails deliberados: un admin NO puede cambiar su propio rol ni desactivarse a sí
 * mismo. Sin esto, un admin puede dejarse fuera del sistema con un clic y quedarse sin
 * forma de volver a entrar (no hay otra vía de recuperación en la app).
 *
 * Todo cambio queda auditado con quién, a quién y de qué → a qué.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(UsersRepository) private readonly users: UsersRepository,
    @Inject(AuditLogService) private readonly auditLog: AuditLogService,
  ) {}

  async list(): Promise<UserSummary[]> {
    return this.users.list();
  }

  async changeRole(targetId: string, role: Role, actor: AdminActor): Promise<UserSummary> {
    const target = await this.requireUser(targetId);

    if (actor.userId === targetId) {
      throw new BadRequestException('No puedes cambiar tu propio rol (evita perder el acceso de administrador).');
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
