import { Module } from '@nestjs/common';
import { LoggingModule } from '../../infrastructure/logging/logging.module';
import { EmailService } from './email.service';

/** Envío de correo (transporte pluggable por EMAIL_TRANSPORT). DB-free. */
@Module({
  imports: [LoggingModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
