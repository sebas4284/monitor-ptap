import 'reflect-metadata';
import './config/load-env';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { AppModule } from './modules/app.module';
import { readHttpHardeningConfig } from './infrastructure/http-hardening.config';
import { JsonLogger } from './infrastructure/logging/json-logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useLogger(app.get(JsonLogger));
  const hardening = readHttpHardeningConfig();

  app.use(helmet());
  app.use(rateLimit({ windowMs: hardening.rateLimit.windowMs, max: hardening.rateLimit.max }));
  // Límite más estricto solo para login (mitiga fuerza bruta) — se registra antes del
  // global para /api/auth/login; ambos aplican (express-rate-limit apila por path).
  app.use('/api/auth/login', rateLimit({ windowMs: hardening.loginRateLimit.windowMs, max: hardening.loginRateLimit.max }));
  if (hardening.corsOrigins) {
    app.enableCors({ origin: hardening.corsOrigins, credentials: true });
  }

  app.setGlobalPrefix('api', { exclude: ['metrics'] });
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 4000);
}

void bootstrap();
