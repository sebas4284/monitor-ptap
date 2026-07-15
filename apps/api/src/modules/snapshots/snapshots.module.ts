import { Module } from '@nestjs/common';
import { ConnectivityModule } from '../../infrastructure/connectivity/connectivity.module';
import { AuditModule } from '../../infrastructure/audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { SnapshotsController } from './snapshots.controller';

@Module({
  imports: [ConnectivityModule, AuthModule, AuditModule],
  controllers: [SnapshotsController],
})
export class SnapshotsModule {}
