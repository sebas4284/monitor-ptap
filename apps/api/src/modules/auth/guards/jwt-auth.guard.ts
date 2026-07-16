import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@ptap/shared';
import type { AuthenticatedRequest } from '../authenticated-request';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtService } from '../jwt.service';
import { UsersRepository } from '../../users/users.repository';

/**
 * Autenticación de cada petición. El JWT es una **credencial, no una autorización**: prueba
 * quién firmó el login, pero no que la cuenta siga vigente. Por eso, tras verificar la firma,
 * se relee al usuario en la base y `request.user` se puebla con la FILA, nunca con el payload.
 *
 * Sin esa relectura, el token (8 h de vida) congela dos cosas que un admin necesita poder
 * cambiar de inmediato:
 *  - `is_active`: desactivar a alguien no lo expulsaría — seguiría entrando hasta que caducara.
 *  - `role`: un admin degradado conservaría permisos de admin durante horas.
 *
 * `findById` ya filtra `is_active = 1`, así que una cuenta desactivada (o borrada) devuelve
 * null → 401. Cuesta una consulta por clave primaria por petición: barato frente a que
 * "desactivar" signifique de verdad desactivar.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(UsersRepository) private readonly usersRepository: UsersRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Antes de tocar la base: login y register son públicos y no deben pagar la consulta.
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Falta o es inválido el token JWT');
    }

    const token = authHeader.slice('Bearer '.length);
    const payload = this.jwtService.verify(token);

    const user = await this.usersRepository.findById(payload.sub);
    if (!user) {
      // Firma válida, cuenta no. El token puede seguir vivo horas: la última palabra es la base.
      throw new UnauthorizedException('Tu sesión ya no es válida: la cuenta fue desactivada o eliminada');
    }

    request.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as Role,
      plant: user.plant,
    };
    return true;
  }
}
