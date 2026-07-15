import { Module } from '@nestjs/common';
import { ConnectivityModule } from '../../infrastructure/connectivity/connectivity.module';
import { AuditModule } from '../../infrastructure/audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { PlantsController } from './plants.controller';

@Module({
  imports: [ConnectivityModule, AuthModule, AuditModule],
  controllers: [PlantsController],
})
export class PlantsModule {}
