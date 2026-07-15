import { Module } from '@nestjs/common';
import { JsonLogger } from './json-logger.service';

@Module({
  providers: [JsonLogger],
  exports: [JsonLogger],
})
export class LoggingModule {}
