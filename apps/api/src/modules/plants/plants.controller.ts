import { Controller, Get, Inject } from '@nestjs/common';
import { ConnectivityService } from '../../infrastructure/connectivity/connectivity.service';

@Controller('plants')
export class PlantsController {
  // @Inject explícito: tsx (esbuild) no emite design:paramtypes, la inyección por tipo falla en dev
  constructor(@Inject(ConnectivityService) private readonly connectivity: ConnectivityService) {}

  @Get()
  getPlants() {
    return this.connectivity.listPlants();
  }
}
