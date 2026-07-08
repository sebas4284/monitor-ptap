import { Controller, Get, Param } from '@nestjs/common';
import { ConnectivityService } from '../../infrastructure/connectivity/connectivity.service';

@Controller('snapshots')
export class SnapshotsController {
  constructor(private readonly connectivity: ConnectivityService) {}

  @Get(':plantId')
  getSnapshot(@Param('plantId') plantId: string) {
    return this.connectivity.getSnapshot(plantId);
  }
}
