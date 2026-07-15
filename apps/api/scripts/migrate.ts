/**
 * Runner de migraciones SQL — mínimo, sin ORM (coherente con el uso de mysql2 crudo
 * en el resto del backend). Lee apps/api/src/infrastructure/database/migrations/*.sql
 * en orden lexicográfico (numeración 000N_* garantiza el orden), aplica solo las que
 * no están registradas en `schema_migrations`, cada una dentro de una transacción.
 *
 * No corre automático en el arranque del backend (database.module.ts no lo invoca):
 * es un paso explícito de despliegue/desarrollo, igual que `npm run db:migrate`.
 */
import '../src/config/load-env';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPool } from 'mysql2/promise';
import { readDatabaseConfig } from '../src/infrastructure/database/database.config';

const MIGRATIONS_DIR = join(__dirname, '..', 'src', 'infrastructure', 'database', 'migrations');

async function runCli(): Promise<void> {
  const config = readDatabaseConfig();
  const pool = createPool({ ...config, waitForConnections: true, connectionLimit: 5 });

  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        filename VARCHAR(255) NOT NULL PRIMARY KEY,
        applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    );

    const [rows] = await pool.query('SELECT filename FROM schema_migrations');
    const applied = new Set((rows as Array<{ filename: string }>).map((r) => r.filename));

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let ranCount = 0;
    for (const filename of files) {
      if (applied.has(filename)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf8');
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.query(sql);
        await connection.query('INSERT INTO schema_migrations (filename) VALUES (?)', [filename]);
        await connection.commit();
        console.log(`✓ ${filename}`);
        ranCount++;
      } catch (err) {
        await connection.rollback();
        throw new Error(`Migración "${filename}" falló: ${err instanceof Error ? err.message : err}`);
      } finally {
        connection.release();
      }
    }

    console.log(ranCount === 0 ? 'Sin migraciones pendientes.' : `${ranCount} migración(es) aplicada(s).`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runCli().catch((err) => {
    console.error(`✗ ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
