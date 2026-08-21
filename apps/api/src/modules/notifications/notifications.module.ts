import { Module } from '@nestjs/common';
import { AuditModule } from '../../infrastructure/audit/audit.module';
import { ConnectivityModule } from '../../infrastructure/connectivity/connectivity.module';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuthModule } from '../auth/auth.module';
import { FlowHourlyRepository } from './flow-hourly.repository';
import { NotificationRepository } from './notification.repository';
import { NotificationPrefsRepository } from './notification-prefs.repository';
import { NotificationsController } from './notifications.controller';
import { StaleDataDetector } from './stale-data.detector';
import { TankAutonomyDetector } from './tank-autonomy.detector';
import { TankOverflowDetector } from './tank-overflow.detector';
import { ValveStateObserver } from './valve-state.observer';

/**
 * Bandeja de notificaciones persistente + el detector que la alimenta.
 *
 * Requiere BD (el historial y el estado de visto por usuario) y Auth (RBAC), así que vive solo en
 * el arranque completo (`main.ts`). `main.telemetry.ts` no lo importa: la demo sin MySQL sigue
 * arrancando.
 */
@Module({
  // AuditModule lo necesita ValveStateObserver: el registro de palabras de estado va a `audit_log`
  // (material de diagnóstico), no a la bandeja. Sin este import Nest no arranca — y `tsc` no lo
  // detecta, porque la inyección se resuelve en runtime.
  imports: [ConnectivityModule, DatabaseModule, AuthModule, AuditModule],
  controllers: [NotificationsController],
  providers: [
    NotificationRepository,
    NotificationPrefsRepository,
    FlowHourlyRepository,
    StaleDataDetector,
    TankOverflowDetector,
    TankAutonomyDetector,
    ValveStateObserver,
  ],
  exports: [NotificationRepository],
})
export class NotificationsModule {}
