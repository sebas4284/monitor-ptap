/**
 * Siembra un usuario de prueba por cada rol (civil, operador, jefe, admin) para poder
 * demostrar login real + RBAC + persistencia de sesión. Idempotente: si el email ya
 * existe, no lo toca. No forma parte del runtime — paso explícito (`npm run db:seed-users`),
 * igual que `db:migrate`/`db:seed-admin`.
 *
 * Contraseña común desde SEED_USERS_PASSWORD — OBLIGATORIA, sin default. Antes existía el
 * default público `Demo1234!`: cualquiera que leyera el repo conocía las credenciales de las
 * 4 cuentas. Ahora quien siembra elige la contraseña de forma explícita, y antes de exponer
 * el backend las cuentas demo se cortan con `npm run db:disable-demo-users`.
 *
 * Todos en la planta `montebello`. Los emails NO codifican el rol para el backend (el rol
 * real vive en la BD); son solo etiquetas legibles para la demo.
 */
import '../src/config/load-env';
import { randomUUID } from 'node:crypto';
import { createPool } from 'mysql2/promise';
import type { Role } from '@ptap/shared';
import { readDatabaseConfig } from '../src/infrastructure/database/database.config';
import { PasswordHashingService } from '../src/modules/auth/password-hashing.service';

const DEMO_USERS: Array<{ email: string; name: string; role: Role }> = [
  { email: 'civil@ptap.co', name: 'Civil Demo', role: 'civil' },
  { email: 'operador@ptap.co', name: 'Operador Demo', role: 'operador' },
  { email: 'jefe@ptap.co', name: 'Jefe Demo', role: 'jefe' },
  { email: 'admin@ptap.co', name: 'Admin Demo', role: 'admin' },
];

const PLANT = 'montebello';

async function runCli(): Promise<void> {
  const password = process.env.SEED_USERS_PASSWORD;
  if (!password) {
    console.error(
      '✗ Falta SEED_USERS_PASSWORD. Ya no hay contraseña por defecto (era pública en el repo):\n' +
        '  SEED_USERS_PASSWORD="<tu contraseña>" npm run db:seed-users',
    );
    process.exit(1);
  }
  const config = readDatabaseConfig();
  const pool = createPool({ ...config, waitForConnections: true, connectionLimit: 5 });
  const hashing = new PasswordHashingService();

  try {
    for (const u of DEMO_USERS) {
      const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [u.email]);
      if (Array.isArray(existing) && existing.length > 0) {
        console.log(`• ${u.email} (${u.role}) ya existe — sin cambios.`);
        continue;
      }
      const { passwordHash, pepperVersion } = await hashing.hashPassword(password);
      await pool.query(
        `INSERT INTO users (id, email, name, role, plant, password_hash, pepper_version, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [randomUUID(), u.email, u.name, u.role, PLANT, passwordHash, pepperVersion],
      );
      console.log(`✓ ${u.email} (${u.role}) creado.`);
    }
    console.log(`\nContraseña de todos: "${password}" (SEED_USERS_PASSWORD).`);
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
