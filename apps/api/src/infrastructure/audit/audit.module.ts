import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuditLogService } from './audit-log.service';
import { AuditMiddleware } from './audit.middleware';

@Module({
  imports: [DatabaseModule],
  providers: [AuditLogService, AuditMiddleware],
  exports: [AuditLogService, AuditMiddleware],
})
export class AuditModule {}
