import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedRequest } from '../../modules/auth/authenticated-request';
import { AuditLogService } from './audit-log.service';

/** Prefijos de rutas protegidas que se auditan (permitidas Y denegadas). */
const AUDITED_PREFIXES = ['/api/opc', '/api/plants', '/api/users'];

/**
 * Audita cada request a rutas protegidas enganchando `res.on('finish')`, que se dispara
 * DESPUÉS de enviar la respuesta y para CUALQUIER resultado (200, 401, 403, 500) sin
 * importar que un guard haya cortado antes — al contrario que un interceptor, que en
 * NestJS ni se instancia cuando un guard rechaza. Así se registran también los accesos
 * denegados (lo más relevante de auditar en un gateway industrial), con el usuario que
 * `JwtAuthGuard` haya seteado (presente en un 403, nulo en un 401).
 *
 * NO audita /api/auth/login (AuthService lo registra con más detalle: motivo del fallo),
 * ni /api/health* ni /metrics (ruido de orquestador/scraper). No altera la respuesta.
 */
@Injectable()
export class AuditMiddleware implements NestMiddleware {
  constructor(@Inject(AuditLogService) private readonly auditLog: AuditLogService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const path = req.originalUrl ?? req.url;
    if (!AUDITED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      next();
      return;
    }

    const ip = req.ip ?? req.socket?.remoteAddress ?? null;
    res.on('finish', () => {
      const user = (req as AuthenticatedRequest).user;
      void this.auditLog.record({
        eventType: 'http.request',
        userId: user?.id ?? null,
        userEmail: user?.email ?? null,
        role: user?.role ?? null,
        ip,
        method: req.method,
        path,
        statusCode: res.statusCode,
      });
    });

    next();
  }
}
