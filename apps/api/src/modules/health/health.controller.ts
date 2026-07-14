import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ROLES } from '@ptap/shared';
import { Pool } from 'mysql2/promise';
import { MYSQL_POOL } from '../../infrastructure/database/database.tokens';

@Controller('health')
export class HealthController {
  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}

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
    const database = process.env.DB_NAME ?? 'monitor_ptap';
    const startedAt = Date.now();
    try {
      await this.pool.query('SELECT 1');
      return {
        status: 'ok',
        database,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      throw new ServiceUnavailableException({
        status: 'error',
        database,
        message: error instanceof Error ? error.message : 'Error desconocido de MySQL',
      });
    }
  }
}
