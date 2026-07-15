import { Module } from '@nestjs/common';
import { Registry } from 'prom-client';
import { MetricsAuthGuard } from './metrics-auth.guard';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { PROM_REGISTRY } from './metrics.tokens';

@Module({
  controllers: [MetricsController],
  providers: [
    { provide: PROM_REGISTRY, useFactory: (): Registry => new Registry() },
    MetricsService,
    MetricsAuthGuard,
  ],
  exports: [MetricsService, PROM_REGISTRY],
})
export class MetricsModule {}
