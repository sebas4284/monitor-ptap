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
          // 10 → 20: había una sola cifra compitiendo entre lecturas (JwtAuthGuard hace un
          // findById por request autenticado), auditoría (un INSERT fire-and-forget por request
          // a /api/opc, /api/plants, /api/users) y el resto de la app.
          connectionLimit: 20,
          // Sin límite (default 0) la cola crece sin fin bajo carga alta y las respuestas se
          // vuelven cada vez más lentas en vez de fallar rápido. Con tope, una ráfaga que supere
          // la capacidad real del pool rechaza el exceso (ER_DEADLOCK-like) en vez de acumular
          // latencia de cola indefinidamente.
          queueLimit: 50,
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
