import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ConnectivityModule } from '../../infrastructure/connectivity/connectivity.module';
import { HealthController } from './health.controller';

@Module({
  imports: [DatabaseModule, ConnectivityModule],
  controllers: [HealthController],
})
export class HealthModule {}
