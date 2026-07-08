import { Module } from '@nestjs/common';
import { ConnectivityModule } from '../../infrastructure/connectivity/connectivity.module';
import { PlantsController } from './plants.controller';

@Module({
  imports: [ConnectivityModule],
  controllers: [PlantsController],
})
export class PlantsModule {}
