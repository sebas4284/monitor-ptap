/**
 * Corta las 4 cuentas demo (civil@/operador@/jefe@/admin@ptap.co) poniendo is_active=0.
 * OBLIGATORIO antes de exponer el backend fuera del entorno de desarrollo: esas cuentas
 * circularon con una contraseña pública (`Demo1234!`), así que se consideran comprometidas
 * por definición.
 *
 * Desactivar (y no borrar) es deliberado:
 *  - el guard relee al usuario en la BD en cada petición, así que una sesión demo viva se
 *    corta en su SIGUIENTE petición (401), sin esperar a que caduque el token;
 *  - conserva el rastro en audit_log (borrar el usuario rompería la trazabilidad);
 *  - es reversible: un admin puede reactivar una cuenta puntual vía PATCH /api/users/:id/active.
 *
 * Ejecutar: npm run db:disable-demo-users
 */
import '../src/config/load-env';
import { createPool } from 'mysql2/promise';
import { readDatabaseConfig } from '../src/infrastructure/database/database.config';

const DEMO_EMAILS = ['civil@ptap.co', 'operador@ptap.co', 'jefe@ptap.co', 'admin@ptap.co'];

async function runCli(): Promise<void> {
  const config = readDatabaseConfig();
  const pool = createPool({ ...config, waitForConnections: true, connectionLimit: 2 });

  try {
    const [result] = await pool.query(
      `UPDATE users SET is_active = 0 WHERE email IN (?) AND is_active = 1`,
      [DEMO_EMAILS],
    );
    const changed = (result as { affectedRows?: number }).affectedRows ?? 0;
    console.log(`✓ Cuentas demo desactivadas: ${changed} (de ${DEMO_EMAILS.length} posibles).`);
    if (changed === 0) {
      console.log('  Ninguna estaba activa (o no existen): nada que cortar.');
    }
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
