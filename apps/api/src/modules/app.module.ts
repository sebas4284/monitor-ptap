import { Module } from '@nestjs/common';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { LoggingModule } from '../infrastructure/logging/logging.module';
import { MetricsModule } from '../infrastructure/metrics/metrics.module';
import { OpcObservabilityModule } from '../infrastructure/connectivity/opc-observability.module';
import { AlarmsModule } from './alarms/alarms.module';
import { AuthModule } from './auth/auth.module';
import { CommandsModule } from './commands/commands.module';
import { HealthModule } from './health/health.module';
import { PlantsModule } from './plants/plants.module';
import { ReportsModule } from './reports/reports.module';
import { SnapshotsModule } from './snapshots/snapshots.module';
import { TelemetryModule } from './telemetry/telemetry.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    DatabaseModule,
    LoggingModule,
    MetricsModule,
    OpcObservabilityModule,
    HealthModule,
    AuthModule,
    UsersModule,
    PlantsModule,
    TelemetryModule,
    SnapshotsModule,
    AlarmsModule,
    CommandsModule,
    ReportsModule,
  ],
})
export class AppModule {}
