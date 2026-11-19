import 'reflect-metadata';
import './config/load-env';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';
import { AppModule } from './modules/app.module';
import { readHttpHardeningConfig } from './infrastructure/http-hardening.config';
import { JsonLogger } from './infrastructure/logging/json-logger.service';
import { AuditLogService } from './infrastructure/audit/audit-log.service';
import { commandRateLimiter } from './infrastructure/command-rate-limiter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useLogger(app.get(JsonLogger));
  const hardening = readHttpHardeningConfig();
  app.getHttpAdapter().getInstance().set('trust proxy', hardening.trustedProxies);

  app.use(helmet());
  app.use(compression());
  app.use(rateLimit({ windowMs: hardening.rateLimit.windowMs, max: hardening.rateLimit.max,
    validate: { xForwardedForHeader: false } }));
  // Límite más estricto para login (mitiga fuerza bruta) y para registro (mitiga alta masiva
  // de cuentas) — ambos apilan con el global (express-rate-limit apila por path).
  //
  // `skip` OPTIONS: el navegador manda un preflight ANTES de cada POST cross-origin. Sin esto,
  // cada intento de login gasta 2 del cupo y, peor, el preflight puede recibir 429 — el
  // navegador entonces bloquea la petición real y el usuario ve un error de red inexplicable en
  // vez de "demasiados intentos". Un preflight no lleva credenciales: no hay nada que limitar.
  const authLimiter = rateLimit({
    validate: { xForwardedForHeader: false },
    windowMs: hardening.loginRateLimit.windowMs,
    max: hardening.loginRateLimit.max,
    skip: (req) => req.method === 'OPTIONS',
  });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);
  app.use('/api/auth/resend-verification', authLimiter);
  app.use('/api/plants/:plantId/commands', commandRateLimiter(hardening.commandRateLimit, app.get(AuditLogService)));
  if (hardening.corsOrigins) {
    app.enableCors({ origin: hardening.corsOrigins, credentials: true });
  } else {
    // Sin CORS, un frontend en otro origen (la web local vive en :8082) recibe el bloqueo
    // del NAVEGADOR y el login falla — pero curl sigue funcionando, así que el fallo parece
    // un misterio. Avisar en el arranque en vez de dejar que se descubra a ciegas.
    new Logger('Bootstrap').warn(
      'CORS deshabilitado (CORS_ORIGINS vacío): un frontend en otro origen NO podrá llamar a esta API. ' +
        'Para la app web de Expo define CORS_ORIGINS=http://localhost:8082 en el .env.',
    );
  }

  app.setGlobalPrefix('api', { exclude: ['metrics'] });
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 4000);
}

void bootstrap();
