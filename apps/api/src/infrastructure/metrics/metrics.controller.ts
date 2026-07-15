import { Controller, Get, Inject, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { MetricsAuthGuard } from './metrics-auth.guard';
import { MetricsService } from './metrics.service';

/**
 * GET /metrics — fuera del prefijo global /api (convención estándar de Prometheus).
 * Ver main.ts: app.setGlobalPrefix('api', { exclude: ['metrics'] }).
 */
@Controller()
@UseGuards(MetricsAuthGuard)
export class MetricsController {
  constructor(@Inject(MetricsService) private readonly metrics: MetricsService) {}

  @Get('metrics')
  async getMetrics(@Res() res: Response): Promise<void> {
    res.set('Content-Type', this.metrics.registry.contentType);
    res.send(await this.metrics.registry.metrics());
  }
}
