import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { AuthUser } from '@ptap/shared';
import { AuditLogService } from '../../infrastructure/audit/audit-log.service';
import { UsersRepository } from '../users/users.repository';
import { toAuthUser } from '../users/user.mapper';
import { JwtService } from './jwt.service';
import { PasswordHashingService } from './password-hashing.service';

export interface LoginResult {
  token: string;
  user: AuthUser;
}

interface LoginContext {
  ip: string | null;
}

/**
 * Login: mismo shape de respuesta { token, user: AuthUser } que ya espera
 * apps/mobile/services/auth.ts — cero cambios en el móvil necesarios.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(UsersRepository) private readonly usersRepository: UsersRepository,
    @Inject(PasswordHashingService) private readonly passwordHashing: PasswordHashingService,
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(AuditLogService) private readonly auditLog: AuditLogService,
  ) {}

  async login(email: string, password: string, ctx: LoginContext): Promise<LoginResult> {
    const record = await this.usersRepository.findByEmail(email);
    if (!record) {
      await this.logLoginFailed(email, ctx, 'usuario no encontrado o inactivo');
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const valid = await this.passwordHashing.verifyPassword(password, record.passwordHash, record.pepperVersion);
    if (!valid) {
      await this.logLoginFailed(email, ctx, 'contraseña incorrecta');
      throw new UnauthorizedException('Credenciales inválidas');
    }

    await this.usersRepository.touchLastLogin(record.id);
    const user = toAuthUser(record);
    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      plant: user.plant,
    });

    await this.auditLog.record({
      eventType: 'auth.login_success',
      userId: user.id,
      userEmail: user.email,
      role: user.role,
      ip: ctx.ip,
      method: 'POST',
      path: '/api/auth/login',
      statusCode: 200,
    });

    return { token, user };
  }

  private async logLoginFailed(email: string, ctx: LoginContext, reason: string): Promise<void> {
    await this.auditLog.record({
      eventType: 'auth.login_failed',
      userId: null,
      userEmail: email,
      role: null,
      ip: ctx.ip,
      method: 'POST',
      path: '/api/auth/login',
      statusCode: 401,
      detail: { reason },
    });
  }
}
