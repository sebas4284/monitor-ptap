/**
 * Prueba de campo (válvula de Sirena, 2026-07-29): firma un JWT válido para una cuenta REAL ya
 * existente en la BD, sin pedir su contraseña. Lee el registro real (id/email/name/role/plant) y lo
 * firma con `JwtService` (mismo JWT_SECRET que usará el backend de esta prueba) — el token resultante
 * es indistinguible de uno emitido por /api/auth/login real. Uso puntual de prueba, no para producción.
 *
 * Requiere que la cuenta esté ACTIVA (is_active=1): igual que exige JwtAuthGuard.findById() en cada
 * request autenticada.
 *
 * Uso:  npm exec -w @ptap/api -- tsx scripts/mint-test-jwt.ts correo@ejemplo.com
 */
import '../src/config/load-env';
import { createPool, type RowDataPacket } from 'mysql2/promise';
import { readDatabaseConfig } from '../src/infrastructure/database/database.config';
import { JwtService } from '../src/modules/auth/jwt.service';

interface UserRow extends RowDataPacket {
  id: string;
  email: string;
  name: string;
  role: string;
  plant: string;
  is_active: number;
}

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) {
    console.error('Uso: tsx scripts/mint-test-jwt.ts correo@ejemplo.com');
    process.exit(2);
  }

  const config = readDatabaseConfig();
  const pool = createPool({ ...config, waitForConnections: true, connectionLimit: 3 });
  try {
    const [rows] = await pool.query<UserRow[]>(
      'SELECT id, email, name, role, plant, is_active FROM users WHERE email = ? LIMIT 1',
      [email],
    );
    if (rows.length === 0) {
      console.error(`No existe ningún usuario con email "${email}".`);
      process.exit(1);
    }
    const u = rows[0];
    if (u.is_active !== 1) {
      console.error(`La cuenta "${email}" existe pero NO está activa (is_active=0) — JwtAuthGuard la rechazaría igual.`);
      process.exit(1);
    }

    const token = new JwtService().sign({
      sub: u.id,
      email: u.email,
      name: u.name,
      role: u.role as import('@ptap/shared').Role,
      plant: u.plant,
    });

    console.log(`Usuario: ${u.email}  ·  rol: ${u.role}  ·  planta: ${u.plant}  ·  id: ${u.id}`);
    console.log(`\nJWT (usar como  Authorization: Bearer <token>):\n`);
    console.log(token);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('mint-test-jwt falló:', err instanceof Error ? err.message : err);
  process.exit(1);
});
