import { ConflictException, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
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

/** Resultado del auto-registro: NO hay token, la cuenta nace pendiente de aprobación. */
export interface RegisterResult {
  status: 'pending_approval';
  email: string;
  message: string;
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
      await this.logLoginFailed(email, ctx, 'usuario no encontrado');
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const valid = await this.passwordHashing.verifyPassword(password, record.passwordHash, record.pepperVersion);
    if (!valid) {
      await this.logLoginFailed(email, ctx, 'contraseña incorrecta');
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // La contraseña ya se verificó: solo a esta altura es seguro revelar que la cuenta existe
    // pero está pendiente. Al revés (comprobar antes) permitiría enumerar correos registrados.
    if (!record.isActive) {
      await this.logLoginFailed(email, ctx, 'cuenta pendiente de aprobación o desactivada');
      throw new ForbiddenException(
        'Tu cuenta está pendiente de aprobación por un administrador. Te avisaremos cuando esté lista.',
      );
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
   * Auto-registro. Dos garantías, ambas del lado del servidor:
   *  1. El rol se fuerza a 'civil' (el schema `.strict()` además rechaza el campo si lo mandan).
   *  2. La cuenta nace **INACTIVA**: no puede iniciar sesión hasta que un administrador la
   *     apruebe. Es la defensa contra cuentas falsas/fantasma — verificar el correo no sirve
   *     (cualquiera crea uno en 30 segundos); lo que frena a un impostor es que un humano lo
   *     reconozca. Por eso NO se devuelve token aquí.
   */
  async register(dto: RegisterDto, ctx: LoginContext): Promise<RegisterResult> {
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

    await this.auditLog.record({
      eventType: 'auth.register',
      userId: id,
      userEmail: dto.email,
      role: SELF_REGISTRATION_ROLE,
      ip: ctx.ip,
      method: 'POST',
      path: '/api/auth/register',
      statusCode: 201,
      detail: { plant: dto.plant, status: 'pending_approval' },
    });

    return {
      status: 'pending_approval',
      email: dto.email,
      message:
        'Tu cuenta fue creada y está pendiente de aprobación por un administrador. ' +
        'Podrás iniciar sesión cuando la habiliten.',
    };
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
