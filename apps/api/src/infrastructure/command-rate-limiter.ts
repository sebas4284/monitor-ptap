import { rateLimit } from 'express-rate-limit';
import type { AuditLogService } from './audit/audit-log.service';
import { requestEvidence } from './audit/request-evidence';
import type { RateLimitConfig } from './http-hardening.config';

/** Defensa de entrada por IP; los permisos y los interlocks siguen siendo obligatorios. */
export function commandRateLimiter(config: RateLimitConfig, audit: AuditLogService) {
  return rateLimit({
    // La allowlist de Express decide la IP; ignorar XFF de clientes directos es intencional.
    validate: { xForwardedForHeader: false },
    windowMs: config.windowMs,
    max: config.max,
    skip: (req) => req.method !== 'POST',
    handler: (req, res) => {
      const evidence = requestEvidence(req, res);
      // Este middleware precede a JWT: no atribuir una identidad sin autenticarla.
      void audit.record({ eventType: 'command.rate_limited', userId: null, userEmail: null, role: null, ip: req.ip ?? null,
        method: req.method, path: req.originalUrl, statusCode: 429,
        detail: { request: evidence } });
      res.status(429).json({ statusCode: 429, message: 'Demasiadas solicitudes de mando. Espere antes de reintentar.' });
    },
  });
}
