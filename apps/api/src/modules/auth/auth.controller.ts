import { Body, Controller, Get, Header, HttpCode, Inject, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import type { Request } from 'express';
import { AuthService, type LoginResult, type RegisterResult } from './auth.service';
import { Public } from './decorators/public.decorator';
import { LoginDto, loginSchema } from './dto/login.dto';
import { RegisterDto, registerSchema } from './dto/register.dto';
import { ZodValidationPipe } from '../../infrastructure/validation/zod-validation.pipe';

/** Body de reenvío: solo el correo (normalizado). Respuesta siempre genérica (anti-enumeración). */
const resendSchema = z.object({ email: z.string().trim().toLowerCase().email().max(255) }).strict();
type ResendDto = z.infer<typeof resendSchema>;

/** Página HTML mínima de resultado de verificación (se abre en el navegador desde el correo). */
function verifyPage(ok: boolean): string {
  const title = ok ? 'Correo verificado' : 'Enlace no válido';
  const msg = ok
    ? 'Tu correo quedó verificado. Un administrador aprobará tu cuenta antes de que puedas iniciar sesión.'
    : 'Este enlace de verificación no es válido o ya venció. Solicita uno nuevo desde la app.';
  const color = ok ? '#1565C0' : '#B71C1C';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Monitor PTAP</title></head>
<body style="font-family: system-ui, sans-serif; background:#F3F4F6; margin:0; padding:0;">
<div style="max-width:440px; margin:15vh auto; background:#fff; border-radius:12px; padding:32px; text-align:center; box-shadow:0 1px 3px rgba(0,0,0,.1);">
<h1 style="color:${color}; font-size:20px; margin:0 0 12px;">${title}</h1>
<p style="color:#374151; font-size:14px; line-height:1.5; margin:0;">${msg}</p>
</div></body></html>`;
}

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

  /**
   * Verificación del correo. Se abre desde el enlace del correo EN EL NAVEGADOR, así que
   * devuelve una página HTML (no JSON). El token viaja en la query. Respuesta genérica ante
   * token inválido/vencido (no revela nada). Un token sin `?token=` → página de enlace inválido.
   */
  @Public()
  @Get('verify-email')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async verifyEmail(@Query('token') token?: string): Promise<string> {
    if (!token) return verifyPage(false);
    const { verified } = await this.authService.verifyEmail(token);
    return verifyPage(verified);
  }

  /**
   * Reenvío del correo de verificación. Respuesta SIEMPRE genérica (200), exista o no el correo:
   * revelar la diferencia permitiría enumerar cuentas. Rate-limitado en main.ts.
   */
  @Public()
  @Post('resend-verification')
  @HttpCode(200)
  async resendVerification(
    @Body(new ZodValidationPipe(resendSchema)) dto: ResendDto,
  ): Promise<{ status: 'ok'; message: string }> {
    await this.authService.resendVerification(dto.email);
    return {
      status: 'ok',
      message: 'Si el correo está registrado y sin verificar, te enviamos un nuevo enlace.',
    };
  }
}
