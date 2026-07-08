import { Module } from '@nestjs/common';
import { AlarmsModule } from './alarms/alarms.module';
import { AuthModule } from './auth/auth.module';
import { CommandsModule } from './commands/commands.module';
import { HealthModule } from './health/health.module';
import { PlantsModule } from './plants/plants.module';
import { PlcModule } from './plc/plc.module';
import { ReportsModule } from './reports/reports.module';
import { TelemetryModule } from './telemetry/telemetry.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    HealthModule,
    AuthModule,
    UsersModule,
    PlantsModule,
    TelemetryModule,
    PlcModule,
    AlarmsModule,
    CommandsModule,
    ReportsModule,
  ],
})
export class AppModule {}
