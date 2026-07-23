import 'reflect-metadata';
import './config/load-env';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { AppModule } from './modules/app.module';
import { readHttpHardeningConfig } from './infrastructure/http-hardening.config';
import { JsonLogger } from './infrastructure/logging/json-logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useLogger(app.get(JsonLogger));
  const hardening = readHttpHardeningConfig();

  app.use(helmet());
  app.use(compression());
  app.use(rateLimit({ windowMs: hardening.rateLimit.windowMs, max: hardening.rateLimit.max }));
  // Límite más estricto para login (mitiga fuerza bruta) y para registro (mitiga alta masiva
  // de cuentas) — ambos apilan con el global (express-rate-limit apila por path).
  //
  // `skip` OPTIONS: el navegador manda un preflight ANTES de cada POST cross-origin. Sin esto,
  // cada intento de login gasta 2 del cupo y, peor, el preflight puede recibir 429 — el
  // navegador entonces bloquea la petición real y el usuario ve un error de red inexplicable en
  // vez de "demasiados intentos". Un preflight no lleva credenciales: no hay nada que limitar.
  const authLimiter = rateLimit({
    windowMs: hardening.loginRateLimit.windowMs,
    max: hardening.loginRateLimit.max,
    skip: (req) => req.method === 'OPTIONS',
  });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);
  app.use('/api/auth/resend-verification', authLimiter);
  if (hardening.corsOrigins) {
    app.enableCors({ origin: hardening.corsOrigins, credentials: true });
  } else {
    // Sin CORS, un frontend en otro origen (la web de Expo vive en :8081) recibe el bloqueo
    // del NAVEGADOR y el login falla — pero curl sigue funcionando, así que el fallo parece
    // un misterio. Avisar en el arranque en vez de dejar que se descubra a ciegas.
    new Logger('Bootstrap').warn(
      'CORS deshabilitado (CORS_ORIGINS vacío): un frontend en otro origen NO podrá llamar a esta API. ' +
        'Para la app web de Expo define CORS_ORIGINS=http://localhost:8081 en el .env.',
    );
  }

  app.setGlobalPrefix('api', { exclude: ['metrics'] });
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 4000);
}

void bootstrap();
