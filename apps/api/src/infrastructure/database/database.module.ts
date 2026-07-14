import { Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { createConnection, createPool, Pool } from 'mysql2/promise';
import { readDatabaseConfig } from './database.config';
import { MYSQL_POOL } from './database.tokens';

@Module({
  providers: [
    {
      provide: MYSQL_POOL,
      useFactory: async (): Promise<Pool> => {
        const config = readDatabaseConfig();
        const logger = new Logger('DatabaseModule');

        const bootstrap = await createConnection({
          host: config.host,
          port: config.port,
          user: config.user,
          password: config.password,
        });
        await bootstrap.query(
          `CREATE DATABASE IF NOT EXISTS \`${config.database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        );
        await bootstrap.end();

        const pool = createPool({
          ...config,
          waitForConnections: true,
          connectionLimit: 10,
          connectTimeout: 10_000,
        });
        await pool.query('SELECT 1');
        logger.log(
          `Conexión MySQL establecida (${config.host}:${config.port}/${config.database})`,
        );
        return pool;
      },
    },
  ],
  exports: [MYSQL_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
