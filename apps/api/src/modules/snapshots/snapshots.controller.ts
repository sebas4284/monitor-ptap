import { Controller, Get, Inject, Param } from '@nestjs/common';
import { ConnectivityService } from '../../infrastructure/connectivity/connectivity.service';

@Controller('snapshots')
export class SnapshotsController {
  // @Inject explícito: tsx (esbuild) no emite design:paramtypes, la inyección por tipo falla en dev
  constructor(@Inject(ConnectivityService) private readonly connectivity: ConnectivityService) {}

  @Get(':plantId')
  getSnapshot(@Param('plantId') plantId: string) {
    return this.connectivity.getSnapshot(plantId);
  }
}
