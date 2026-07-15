/**
 * Siembra el primer usuario admin desde SEED_ADMIN_* (.env). Idempotente: si el email
 * ya existe, no hace nada. No forma parte del runtime del backend — paso explícito de
 * despliegue (`npm run db:seed-admin`), como `npm run db:migrate`.
 */
import '../src/config/load-env';
import { randomUUID } from 'node:crypto';
import { createPool } from 'mysql2/promise';
import { readDatabaseConfig } from '../src/infrastructure/database/database.config';
import { PasswordHashingService } from '../src/modules/auth/password-hashing.service';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name} (requerida por seed-admin-user).`);
  return value;
}

async function runCli(): Promise<void> {
  const email = requiredEnv('SEED_ADMIN_EMAIL');
  const password = requiredEnv('SEED_ADMIN_PASSWORD');
  const name = requiredEnv('SEED_ADMIN_NAME');
  const plant = requiredEnv('SEED_ADMIN_PLANT');

  const config = readDatabaseConfig();
  const pool = createPool({ ...config, waitForConnections: true, connectionLimit: 5 });

  try {
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (Array.isArray(existing) && existing.length > 0) {
      console.log(`Usuario admin "${email}" ya existe — sin cambios.`);
      return;
    }

    const hashing = new PasswordHashingService();
    const { passwordHash, pepperVersion } = await hashing.hashPassword(password);
    const id = randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, name, role, plant, password_hash, pepper_version, is_active)
       VALUES (?, ?, ?, 'admin', ?, ?, ?, 1)`,
      [id, email, name, plant, passwordHash, pepperVersion],
    );

    console.log(`✓ Usuario admin "${email}" creado (id=${id}).`);
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
