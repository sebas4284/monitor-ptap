import { Module } from '@nestjs/common';
import { AuditModule } from '../../infrastructure/audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { HmiController } from './hmi.controller';

/**
 * Gate de acceso al HMI que nginx reexpone en `/hmi/`.
 *
 * Necesita Auth (para exigir JWT + permiso al abrir la sesión) y Audit (abrir el HMI de una planta
 * deja rastro). Como todo módulo con auditoría en MySQL, vive solo en el arranque completo
 * (`main.ts`); `main.telemetry.ts` no lo importa, así que la demo sin BD tampoco expone el HMI.
 */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [HmiController],
})
export class HmiModule {}
