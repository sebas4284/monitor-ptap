import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '@ptap/shared';
import { AuditLogService } from '../../infrastructure/audit/audit-log.service';
import { DUPLICATE_ENTRY, UsersRepository } from '../users/users.repository';
import { toAuthUser } from '../users/user.mapper';
import type { RegisterDto } from './dto/register.dto';
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
 * Rol con el que nace TODA cuenta creada por auto-registro. No es configurable a propósito:
 * la matriz oficial reserva la asignación de roles al Administrador, así que un usuario nuevo
 * solo puede observar (vista básica) hasta que un admin lo eleve.
 */
const SELF_REGISTRATION_ROLE = 'civil' as const;

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

  /**
   * Auto-registro. El rol NO se acepta del cliente: se fuerza a 'civil' aquí (el schema
   * `.strict()` además rechaza el campo si lo mandan). Devuelve token+user para entrar directo.
   */
  async register(dto: RegisterDto, ctx: LoginContext): Promise<LoginResult> {
    const { passwordHash, pepperVersion } = await this.passwordHashing.hashPassword(dto.password);
    const id = randomUUID();

    try {
      await this.usersRepository.create({
        id,
        email: dto.email,
        phone: dto.phone ?? null,
        name: dto.name,
        role: SELF_REGISTRATION_ROLE, // impuesto por el servidor, jamás por el cliente
        plant: dto.plant,
        passwordHash,
        pepperVersion,
      });
    } catch (err) {
      if ((err as { code?: string }).code === DUPLICATE_ENTRY) {
        await this.auditLog.record({
          eventType: 'auth.register_rejected',
          userId: null,
          userEmail: dto.email,
          role: null,
          ip: ctx.ip,
          method: 'POST',
          path: '/api/auth/register',
          statusCode: 409,
          detail: { reason: 'email ya registrado' },
        });
        throw new ConflictException('Ese correo ya está registrado');
      }
      throw err;
    }

    const user: AuthUser = { id, name: dto.name, email: dto.email, role: SELF_REGISTRATION_ROLE, plant: dto.plant };
    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      plant: user.plant,
    });

    await this.auditLog.record({
      eventType: 'auth.register',
      userId: user.id,
      userEmail: user.email,
      role: user.role,
      ip: ctx.ip,
      method: 'POST',
      path: '/api/auth/register',
      statusCode: 201,
      detail: { plant: user.plant },
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
