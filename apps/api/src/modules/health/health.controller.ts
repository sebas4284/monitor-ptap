import { Controller, Get, Inject, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ROLES } from '@ptap/shared';
import { Pool } from 'mysql2/promise';
import { MYSQL_POOL } from '../../infrastructure/database/database.tokens';
import { CONNECTIVITY_ADAPTER } from '../../infrastructure/connectivity/connectivity.tokens';
import { PlantPipelineService } from '../../infrastructure/connectivity/pipeline/plant-pipeline.service';
import type { ConnectivityAdapter } from '../../infrastructure/connectivity/ports/connectivity-adapter.port';
import { computeOpcHealth } from './opc-health';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger('HealthController');

  constructor(
    @Inject(MYSQL_POOL) private readonly pool: Pool,
    @Inject(CONNECTIVITY_ADAPTER) private readonly adapter: ConnectivityAdapter,
    @Inject(PlantPipelineService) private readonly pipeline: PlantPipelineService,
  ) {}

  @Get()
  getHealth() {
    return {
      status: 'ok',
      service: 'ptap-api',
      sharedRoles: ROLES.length,
    };
  }

  @Get('db')
  async getDatabaseHealth() {
    const startedAt = Date.now();
    try {
      await this.pool.query('SELECT 1');
      // No se expone el nombre de la BD ni detalles: /health/db es público (healthcheck).
      return { status: 'ok', latencyMs: Date.now() - startedAt };
    } catch (error) {
      // El detalle real (nombre de BD, mensaje de MySQL) se registra en el servidor, NUNCA
      // se devuelve al cliente anónimo (evita fuga de topología / mensajes internos).
      this.logger.error(
        `health/db falló: ${error instanceof Error ? error.message : 'error desconocido de MySQL'}`,
      );
      throw new ServiceUnavailableException({ status: 'error' });
    }
  }

  /**
   * Health industrial (Fase 4): liveness/readiness para orquestadores. 503 cuando el
   * bridge está Stale o Faulted. Público a propósito — un healthcheck no debe requerir JWT.
   */
  @Get('opc')
  getOpcHealth() {
    const diagnostics = this.adapter.getDiagnostics();
    const deadLetterTotal = this.pipeline.getDeadLetter().total;
    const { report, httpStatus } = computeOpcHealth(diagnostics, deadLetterTotal);
    if (httpStatus === 503) {
      throw new ServiceUnavailableException(report);
    }
    return report;
  }
}
