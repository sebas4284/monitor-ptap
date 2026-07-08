import { Controller, Get } from '@nestjs/common';
import { ConnectivityService } from '../../infrastructure/connectivity/connectivity.service';

@Controller('plants')
export class PlantsController {
  constructor(private readonly connectivity: ConnectivityService) {}

  @Get()
  getPlants() {
    return this.connectivity.listPlants();
  }
}
