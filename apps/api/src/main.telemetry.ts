import 'reflect-metadata';
import './config/load-env';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConnectivityModule } from './infrastructure/connectivity/connectivity.module';
import { PlantsController } from './modules/plants/plants.controller';

/**
 * Entrypoint de TELEMETRÍA: levanta solo el puente OPC UA + pipeline de dominio + REST
 * (/api/plants, /api/plants/:id/snapshot, /api/opc/*) + Socket.IO, SIN la base de datos.
 * Sirve todo lo que el frontend necesita para el caudal en tiempo real sin requerir MySQL
 * (que solo hace falta para auth/usuarios/auditoría — main.ts es el arranque completo).
 *
 * Ejecutar: npm run start:telemetry  (CONNECTIVITY_PROVIDER=opcua para PLC real)
 */
@Module({ imports: [ConnectivityModule], controllers: [PlantsController] })
class TelemetryModule {}

async function bootstrap() {
  const app = await NestFactory.create(TelemetryModule);
  app.enableCors({ origin: '*' }); // el front (Expo web) vive en otro origen
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 4000);
}

void bootstrap();
