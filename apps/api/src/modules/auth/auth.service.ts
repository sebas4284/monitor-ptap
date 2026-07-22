import { ConflictException, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '@ptap/shared';
import { AuditLogService } from '../../infrastructure/audit/audit-log.service';
import { EmailService } from '../email/email.service';
import { DUPLICATE_ENTRY, UsersRepository } from '../users/users.repository';
import { toAuthUser } from '../users/user.mapper';
import type { RegisterDto } from './dto/register.dto';
import { EmailVerificationRepository } from './email-verification.repository';
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

/** Base pública para los enlaces del correo (la URL por la que se llega al backend). */
function appPublicUrl(): string {
  return (process.env.APP_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4000}`).replace(/\/+$/, '');
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
    @Inject(EmailVerificationRepository) private readonly emailVerification: EmailVerificationRepository,
    @Inject(EmailService) private readonly email: EmailService,
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
   * Auto-registro. TRES barreras, todas del lado del servidor:
   *  1. El rol se fuerza a 'civil' (el schema `.strict()` además rechaza el campo si lo mandan).
   *  2. Se envía un correo de VERIFICACIÓN: la cuenta debe probar que el correo es real/propio
   *     (frena bots con correos inventados). Sin verificar, un admin no la puede activar.
   *  3. La cuenta nace **INACTIVA**: aunque verifique el correo, un administrador debe aprobarla
   *     (filtro humano contra impostores). Por eso NO se devuelve token aquí.
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

    // Emitir el token de verificación y "enviar" el correo. Un fallo del envío NO cae el registro
    // (la cuenta ya existe; el usuario puede pedir reenvío) — solo se anota.
    let emailSent = false;
    try {
      await this.sendVerification(id, dto.email);
      emailSent = true;
    } catch {
      /* el reenvío queda disponible; se refleja en el audit */
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
      detail: { plant: dto.plant, status: 'pending_approval', emailSent },
    });

    return {
      status: 'pending_approval',
      email: dto.email,
      message:
        'Tu cuenta fue creada. Te enviamos un correo para verificar tu cuenta: ábrelo para ' +
        'confirmar. Después, un administrador la aprobará antes de que puedas iniciar sesión.',
    };
  }

  /** Emite un token nuevo y "envía" el enlace de verificación. */
  private async sendVerification(userId: string, email: string): Promise<void> {
    const { raw } = await this.emailVerification.issue(userId);
    const link = `${appPublicUrl()}/api/auth/verify-email?token=${raw}`;
    await this.email.sendVerificationEmail(email, link);
  }

  /**
   * Verifica el correo a partir del token del enlace. Genérico ante token inválido/vencido/usado
   * (no revela nada). Idempotente: un token ya consumido devuelve `verified:false`.
   */
  async verifyEmail(token: string): Promise<{ verified: boolean }> {
    const userId = await this.emailVerification.consume(token);
    if (!userId) return { verified: false };
    await this.usersRepository.setEmailVerified(userId);
    await this.auditLog.record({
      eventType: 'auth.email_verified',
      userId,
      userEmail: null,
      role: null,
      ip: null,
      method: 'GET',
      path: '/api/auth/verify-email',
      statusCode: 200,
    });
    return { verified: true };
  }

  /**
   * Reenvía el correo de verificación. SIEMPRE responde igual (void), exista o no el correo y esté
   * o no verificado — así no se puede enumerar qué correos están registrados. Solo hace trabajo si
   * la cuenta existe y aún no está verificada; invalida tokens previos para que solo el último sirva.
   */
  async resendVerification(email: string): Promise<void> {
    const record = await this.usersRepository.findByEmail(email);
    if (!record || record.emailVerified) return;
    await this.emailVerification.invalidateForUser(record.id);
    await this.sendVerification(record.id, record.email);
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
