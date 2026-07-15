import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { AuthenticatedRequest } from '../../modules/auth/authenticated-request';
import { AuditLogService } from './audit-log.service';

/**
 * Registra en audit_log las requests HTTP a rutas donde se aplica explícitamente
 * (no global — evita ruido de /health, /metrics, y no afecta a main.telemetry.ts,
 * que nunca importa AuditModule). No espera el INSERT (fire-and-forget); AuditLogService
 * nunca lanza, así que un fallo de auditoría no puede romper la respuesta.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(@Inject(AuditLogService) private readonly auditLog: AuditLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<{ statusCode: number }>();
    const ip = request.ip ?? request.socket?.remoteAddress ?? null;
    const user = request.user;

    return next.handle().pipe(
      tap(() => {
        void this.auditLog.record({
          eventType: 'http.request',
          userId: user?.id ?? null,
          userEmail: user?.email ?? null,
          role: user?.role ?? null,
          ip,
          method: request.method,
          path: request.originalUrl ?? request.url,
          statusCode: response.statusCode,
        });
      }),
    );
  }
}
