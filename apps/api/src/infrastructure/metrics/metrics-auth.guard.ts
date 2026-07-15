import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Protección opcional de /metrics vía METRICS_AUTH_TOKEN (Bearer). Si la variable está
 * vacía, /metrics queda abierto (comportamiento estándar de scraping de Prometheus).
 */
@Injectable()
export class MetricsAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const token = process.env.METRICS_AUTH_TOKEN;
    if (!token) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;
    if (authHeader !== `Bearer ${token}`) {
      throw new UnauthorizedException('Token de métricas inválido');
    }
    return true;
  }
}
