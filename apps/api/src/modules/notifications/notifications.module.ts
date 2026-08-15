import { Module } from '@nestjs/common';
import { ConnectivityModule } from '../../infrastructure/connectivity/connectivity.module';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationRepository } from './notification.repository';
import { NotificationsController } from './notifications.controller';
import { StaleDataDetector } from './stale-data.detector';
import { TankOverflowDetector } from './tank-overflow.detector';

/**
 * Bandeja de notificaciones persistente + el detector que la alimenta.
 *
 * Requiere BD (el historial y el estado de visto por usuario) y Auth (RBAC), así que vive solo en
 * el arranque completo (`main.ts`). `main.telemetry.ts` no lo importa: la demo sin MySQL sigue
 * arrancando.
 */
@Module({
  imports: [ConnectivityModule, DatabaseModule, AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationRepository, StaleDataDetector, TankOverflowDetector],
  exports: [NotificationRepository],
})
export class NotificationsModule {}
