/**
 * Prepara cuentas de planta y entrega sus credenciales: asigna rol y planta a cuentas que ya
 * existen, crea las que falten, y pone una contraseña nueva que se imprime UNA sola vez.
 *
 * Nació de repetir lo mismo a mano cinco veces (Km 18, Montebello, La Sirena, Cascajal, y ahora
 * Soledad y Carbonero) con `node -e` sobre la base de producción. Un one-liner improvisado que
 * escribe en la tabla de usuarios es justo lo que no conviene repetir: no deja rastro de qué se
 * hizo, no valida nada y no se puede ensayar antes.
 *
 * Uso:
 *   npm run db:credenciales -w @ptap/api -- --archivo cuentas.json            # SIMULACRO
 *   npm run db:credenciales -w @ptap/api -- --archivo cuentas.json --aplicar  # lo hace de verdad
 *
 * El archivo es una lista de `{ email, rol, planta, nombre? }`.
 *
 * Decisiones deliberadas:
 *
 *  - **Simulacro por defecto.** Sin `--aplicar` no escribe nada, solo dice qué haría. Repartir
 *    credenciales es irreversible en la práctica: una vez entregadas, hay que darlas por conocidas.
 *  - **Reutiliza antes que crear.** Si el correo ya existe, se le ajusta rol/planta y se le pone
 *    contraseña nueva. Solo crea cuando no hay nada — el motivo por el que existe este script es
 *    dejar de inflar la tabla de usuarios.
 *  - **Avisa si la cuenta YA SE USÓ.** Cambiarle la contraseña a alguien que entra a diario lo deja
 *    fuera sin avisarle. Esas exigen `--forzar`, para que no ocurra por descuido.
 *  - **Valida la planta contra el mapping**, no contra una lista escrita a mano: una planta
 *    inexistente deja al usuario mirando un 404.
 *  - **La contraseña no se guarda en ninguna parte.** Se imprime al generarla y en la base queda
 *    hasheada con argon2 + pepper, igual que en el registro normal.
 */
import '../src/config/load-env';
import { randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createPool, type RowDataPacket } from 'mysql2/promise';
import { ROLES, type Role } from '@ptap/shared';
import { readDatabaseConfig } from '../src/infrastructure/database/database.config';
import { PasswordHashingService } from '../src/modules/auth/password-hashing.service';
import { loadMapping } from '../src/infrastructure/connectivity/mapping/opc-mapping.loader';

interface Peticion {
  email: string;
  rol: string;
  planta: string;
  nombre?: string;
}

/**
 * Contraseñas MEMORABLES que cumplen la política del registro (≥8, minúscula, mayúscula, dígito y
 * símbolo). Mismo criterio que `migrate-users.ts`: dos palabras con guion se dictan por teléfono sin
 * errores y resisten más que diez dígitos. Sin tildes ni eñes, que se teclean mal en campo.
 */
const PALABRAS_A = [
  'Cauca', 'Pance', 'Andes', 'Rio', 'Valle', 'Cerro', 'Lago', 'Nube', 'Selva', 'Cumbre',
  'Puente', 'Piedra', 'Bosque', 'Llano', 'Costa', 'Palma', 'Ceiba', 'Guadua', 'Colina', 'Vega',
];
const PALABRAS_B = [
  'Clara', 'Verde', 'Limpia', 'Fresca', 'Pura', 'Firme', 'Serena', 'Viva', 'Alta', 'Nueva',
  'Fuerte', 'Sana', 'Amplia', 'Noble', 'Plena', 'Libre', 'Digna', 'Solida', 'Justa', 'Buena',
];

export function generarPassword(): string {
  const a = PALABRAS_A[randomInt(PALABRAS_A.length)];
  const b = PALABRAS_B[randomInt(PALABRAS_B.length)];
  return `${a}-${b}${randomInt(10, 100)}`;
}

interface Existente extends RowDataPacket {
  id: string;
  email: string;
  name: string;
  role: string;
  plant: string;
  is_active: number;
  last_login_at: Date | null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const archivo = argv[argv.indexOf('--archivo') + 1];
  const aplicar = argv.includes('--aplicar');
  const forzar = argv.includes('--forzar');
  if (!archivo || archivo.startsWith('--')) {
    console.error('Falta --archivo <ruta.json> con una lista de { email, rol, planta, nombre? }');
    process.exit(1);
  }

  const peticiones = JSON.parse(readFileSync(archivo, 'utf8')) as Peticion[];
  const plantasValidas = new Set(loadMapping().plants.map((p) => p.plantId));

  const errores: string[] = [];
  for (const p of peticiones) {
    if (!plantasValidas.has(p.planta)) errores.push(`${p.email}: planta "${p.planta}" no existe`);
    if (!ROLES.includes(p.rol as Role)) errores.push(`${p.email}: rol "${p.rol}" inválido (${ROLES.join(', ')})`);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) errores.push(`${p.email}: correo mal formado`);
  }
  if (errores.length > 0) {
    console.error('✗ No se hace nada:\n  ' + errores.join('\n  '));
    process.exit(1);
  }

  const pool = createPool({ ...readDatabaseConfig(), connectionLimit: 3 });
  const hashing = new PasswordHashingService();
  const entregas: Array<{ email: string; password: string; rol: string; planta: string; nombre: string; accion: string }> = [];

  try {
    for (const p of peticiones) {
      const email = p.email.toLowerCase();
      const [filas] = await pool.query<Existente[]>(
        'SELECT id, email, name, role, plant, is_active, last_login_at FROM users WHERE email = ?',
        [email],
      );
      const actual = filas[0];
      const password = generarPassword();

      if (actual && actual.last_login_at && !forzar) {
        console.error(
          `✗ ${email} YA SE USÓ (último acceso ${new Date(actual.last_login_at).toISOString().slice(0, 10)}). ` +
            'Cambiarle la contraseña deja fuera a quien la esté usando. Repite con --forzar si es lo que quieres.',
        );
        process.exit(1);
      }

      const nombre = p.nombre ?? actual?.name ?? email.split('@')[0];
      const accion = actual
        ? `reutiliza (era ${actual.role}/${actual.plant}${actual.name ? `, ${actual.name}` : ''})`
        : 'CREA cuenta nueva';
      entregas.push({ email, password, rol: p.rol, planta: p.planta, nombre, accion });

      if (!aplicar) continue;

      const { passwordHash, pepperVersion } = await hashing.hashPassword(password);
      if (actual) {
        await pool.query(
          'UPDATE users SET name = ?, role = ?, plant = ?, password_hash = ?, pepper_version = ?, is_active = 1 WHERE id = ?',
          [nombre, p.rol, p.planta, passwordHash, pepperVersion, actual.id],
        );
      } else {
        await pool.query(
          'INSERT INTO users (id, email, name, role, plant, password_hash, pepper_version, is_active, email_verified) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0)',
          [randomUUID(), email, nombre, p.rol, p.planta, passwordHash, pepperVersion],
        );
      }
    }
  } finally {
    await pool.end();
  }

  console.log(`\n${aplicar ? '✓ APLICADO' : '· SIMULACRO (nada se escribió; añade --aplicar)'}\n`);
  for (const e of entregas) {
    console.log(`planta      : ${e.planta}`);
    console.log(`rol         : ${e.rol}`);
    console.log(`nombre      : ${e.nombre}`);
    console.log(`correo      : ${e.email}`);
    console.log(`contraseña  : ${aplicar ? e.password : '(se generará al aplicar)'}`);
    console.log(`acción      : ${e.accion}\n`);
  }
  if (aplicar) console.log('Estas contraseñas NO se guardan en ningún sitio. Cópialas ahora.\n');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
