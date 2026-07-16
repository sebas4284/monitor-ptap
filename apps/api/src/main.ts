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
  // Límite más estricto para login (mitiga fuerza bruta) y para registro (mitiga alta masiva
  // de cuentas) — ambos apilan con el global (express-rate-limit apila por path).
  const authLimiter = rateLimit({ windowMs: hardening.loginRateLimit.windowMs, max: hardening.loginRateLimit.max });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);
  if (hardening.corsOrigins) {
    app.enableCors({ origin: hardening.corsOrigins, credentials: true });
  }

  app.setGlobalPrefix('api', { exclude: ['metrics'] });
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 4000);
}

void bootstrap();
