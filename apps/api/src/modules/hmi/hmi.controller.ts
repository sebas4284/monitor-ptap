import { Controller, Get, Inject, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { hasPermission, type Permission, type Role } from '@ptap/shared';
import { AuditLogService } from '../../infrastructure/audit/audit-log.service';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { readJwtConfig } from '../auth/jwt.config';

/**
 * Gate de acceso al HMI (WinCC Unified) que nginx reexpone en `/hmi/`.
 *
 * EL PROBLEMA QUE RESUELVE. `/hmi/` no puede protegerse con nuestro JWT: el HMI se muestra en un
 * `<iframe>`, y un iframe es una navegación del navegador — no envía la cabecera `Authorization`
 * que usa el resto de la app. Sin este gate, `/hmi/` quedaba accesible para CUALQUIERA en Internet
 * que conociera la URL: el runtime de la planta, su consola de usuarios (`/UMC`) y la de
 * configuración (`/WebES`). Verificado el 2026-08-03: respondían 200/301 sin sesión alguna.
 *
 * CÓMO LO RESUELVE. Lo único que un iframe SÍ envía al mismo origen son las **cookies**:
 *
 *   1. La pantalla HMI, ya autenticada con JWT, llama a `POST /api/hmi/session`.
 *   2. Aquí se comprueba el permiso y se emite una cookie `hmi_session` **httpOnly** y de vida
 *      corta, firmada con el mismo secreto del JWT.
 *   3. nginx, con `auth_request /api/hmi/verify`, consulta este controlador ANTES de servir nada
 *      bajo `/hmi/`. Sin cookie válida, ni un byte del HMI sale a Internet.
 *
 * La cookie dura poco a propósito: es una llave de visualización, no una sesión. Si se filtra,
 * caduca sola. El front la renueva mientras la pantalla siga abierta.
 */

/** Vida de la cookie. Corta: es una llave de visualización, no una sesión de trabajo. */
const HMI_SESSION_SECONDS = 30 * 60;
const COOKIE = 'hmi_session';
/** Permiso exigido: el mismo que para ver el tablero. */
const REQUIRED: Permission = 'view_dashboard';

/** Contenido de la cookie. `scope` impide que un JWT normal sirva de llave del HMI. */
interface HmiTokenPayload {
  sub: string;
  role: Role;
  scope: 'hmi';
}

/**
 * Lee una cookie del encabezado a mano. El proyecto no usa `cookie-parser` (toda la auth va por
 * cabecera `Authorization`), y sumar una dependencia y un middleware global para leer un único
 * valor sería desproporcionado.
 */
function leerCookie(req: Request, nombre: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const parte of raw.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    if (parte.slice(0, i).trim() === nombre) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}

@Controller('hmi')
export class HmiController {
  private readonly config = readJwtConfig();

  constructor(@Inject(AuditLogService) private readonly auditLog: AuditLogService) {}

  /**
   * Abre la sesión de visualización. Exige JWT válido + permiso y responde con la cookie que nginx
   * va a pedir. Se audita: abrir el HMI de una planta debe dejar rastro de quién y cuándo.
   */
  @Post('session')
  @UseGuards(JwtAuthGuard)
  async abrir(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    const rol = req.user?.role;
    if (!rol || !hasPermission(rol as Role, REQUIRED)) {
      throw new UnauthorizedException('rol sin permiso para ver el HMI');
    }

    const payload: HmiTokenPayload = { sub: req.user?.id ?? '', role: rol as Role, scope: 'hmi' };
    const token = jwt.sign(payload, this.config.secret, { expiresIn: HMI_SESSION_SECONDS });

    res.cookie(COOKIE, token, {
      httpOnly: true, // invisible para JavaScript: un XSS no puede robarla
      secure: true, // solo por HTTPS
      sameSite: 'strict', // no viaja desde sitios ajenos
      path: '/', // nginx la necesita en /hmi/ y el backend en /api/hmi/
      maxAge: HMI_SESSION_SECONDS * 1000,
    });

    await this.auditLog.record({
      eventType: 'hmi.session.open',
      userId: req.user?.id ?? null,
      userEmail: req.user?.email ?? null,
      role: rol,
      ip: req.ip ?? null,
      method: 'POST',
      path: '/api/hmi/session',
      statusCode: 204,
      detail: { vigenciaSegundos: HMI_SESSION_SECONDS },
    });

    res.status(204).send();
  }

  /**
   * Lo consulta nginx con `auth_request` antes de servir `/hmi/`. Responde solo 204 o 401: nginx
   * únicamente mira el código y descarta el cuerpo.
   *
   * Sin `JwtAuthGuard` a propósito: la subpetición la origina nginx y no lleva `Authorization`.
   * La credencial aquí es la cookie.
   */
  @Get('verify')
  verificar(@Req() req: Request, @Res() res: Response): void {
    const raw = leerCookie(req, COOKIE);
    if (!raw) {
      res.status(401).send();
      return;
    }
    try {
      const payload = jwt.verify(raw, this.config.secret) as Partial<HmiTokenPayload>;
      // Un JWT de la app NO debe servir de llave del HMI: se exige el scope específico.
      if (payload.scope !== 'hmi' || !payload.role || !hasPermission(payload.role, REQUIRED)) {
        res.status(401).send();
        return;
      }
      res.status(204).send();
    } catch {
      res.status(401).send(); // firma inválida o expirada
    }
  }

  /** Cierra la sesión de visualización al salir de la pantalla. */
  @Post('logout')
  cerrar(@Res() res: Response): void {
    res.clearCookie(COOKIE, { httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
    res.status(204).send();
  }
}
