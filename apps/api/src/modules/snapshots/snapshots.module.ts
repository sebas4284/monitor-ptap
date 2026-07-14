import { Module } from '@nestjs/common';
import { ConnectivityModule } from '../../infrastructure/connectivity/connectivity.module';
import { SnapshotsController } from './snapshots.controller';

@Module({
  imports: [ConnectivityModule],
  controllers: [SnapshotsController],
})
export class SnapshotsModule {}
