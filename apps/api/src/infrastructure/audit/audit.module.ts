import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuditLogService } from './audit-log.service';
import { AuditMiddleware } from './audit.middleware';
import { AuditRetentionService } from './audit-retention.service';

@Module({
  imports: [DatabaseModule],
  providers: [AuditLogService, AuditMiddleware, AuditRetentionService],
  exports: [AuditLogService, AuditMiddleware],
})
export class AuditModule {}
