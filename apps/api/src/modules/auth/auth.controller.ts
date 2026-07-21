import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, type LoginResult, type RegisterResult } from './auth.service';
import { Public } from './decorators/public.decorator';
import { LoginDto, loginSchema } from './dto/login.dto';
import { RegisterDto, registerSchema } from './dto/register.dto';
import { ZodValidationPipe } from '../../infrastructure/validation/zod-validation.pipe';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body(new ZodValidationPipe(loginSchema)) dto: LoginDto, @Req() request: Request): Promise<LoginResult> {
    const ip = request.ip ?? request.socket.remoteAddress ?? null;
    return this.authService.login(dto.email, dto.password, { ip });
  }

  /**
   * Auto-registro público. Dos cosas las fija el servidor y no el cliente:
   *  - el rol es SIEMPRE 'civil' (solo lectura) — el schema es `.strict()`, así que mandar
   *    `role` en el body → 400. Elevarlo es potestad del Admin (PATCH /api/users/:id/role).
   *  - la cuenta queda PENDIENTE de aprobación → no devuelve token; hasta que un admin la
   *    habilite, el login responde 403.
   */
  @Public()
  @Post('register')
  @HttpCode(201)
  async register(
    @Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto,
    @Req() request: Request,
  ): Promise<RegisterResult> {
    const ip = request.ip ?? request.socket.remoteAddress ?? null;
    return this.authService.register(dto, { ip });
  }
}
