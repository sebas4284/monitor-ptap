/**
 * Alta masiva de usuarios desde un CSV (migración desde el sistema anterior).
 *
 * Uso:
 *   npm run db:migrate-users -w @ptap/api -- --file <ruta.csv>            # simulacro
 *   npm run db:migrate-users -w @ptap/api -- --file <ruta.csv> --aplicar  # crea de verdad
 *
 * CSV: `usuario,nombre,email,planta,rol[,...]`. Se ignoran líneas vacías y las que empiezan con `#`.
 *
 * Decisiones que conviene no revertir sin pensarlo:
 *
 *  - **Simulacro por defecto.** Sin `--aplicar` no escribe nada. Crear cuentas reales con
 *    credenciales es irreversible en la práctica (hay que repartirlas), así que el modo seguro
 *    es el que no hace nada.
 *  - **Idempotente por email.** Si la cuenta ya existe NO se toca: ni la contraseña, ni el rol,
 *    ni la planta. Volver a correrlo tras corregir el CSV solo crea lo que falta.
 *  - **Valida planta y rol contra el sistema**, no contra una lista escrita a mano. Una planta
 *    inexistente dejaría al usuario viendo un 404, y un rol inválido lo rechaza la propia BD.
 *  - **Las contraseñas se imprimen UNA sola vez**, al crearlas. No se guardan en ningún archivo:
 *    quedan hasheadas con argon2 + pepper, igual que las del registro normal.
 */
import '../src/config/load-env';
import { randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createPool, type RowDataPacket } from 'mysql2/promise';
import { ROLES, type Role } from '@ptap/shared';
import { readDatabaseConfig } from '../src/infrastructure/database/database.config';
import { PasswordHashingService } from '../src/modules/auth/password-hashing.service';
import { loadMapping } from '../src/infrastructure/connectivity/mapping/opc-mapping.loader';

interface Fila {
  usuario: string;
  nombre: string;
  email: string;
  planta: string;
  rol: string;
  /**
   * `si` = puede entrar desde el primer día. `no` = queda PENDIENTE de aprobación.
   *
   * Existe por un caso real de la migración: de los 22 usuarios del sistema anterior, 13 no traían
   * ningún dato que permitiera saber su planta. Inventarla haría que vieran un sitio que no es el
   * suyo. Creándolos pendientes quedan migrados pero sin acceso, y aparecen en la pestaña
   * "Pendientes" de la pantalla Usuarios para que un admin les asigne planta y rol al verificarlos
   * — que es justo el flujo que la aplicación ya tiene.
   */
  activo: boolean;
  linea: number;
}

/**
 * Contraseñas MEMORABLES que cumplen la política del registro (≥8, minúscula, mayúscula, dígito
 * y símbolo). Se descartó "10 dígitos" porque una clave puramente numérica no pasa esa política y
 * además es débil: dos palabras separadas por un guion se recuerdan mejor y resisten más.
 *
 * Palabras de la región y del dominio, sin tildes ni ñ para que nadie falle al teclearlas.
 */
const PALABRAS_A = [
  'Cauca', 'Pance', 'Andes', 'Rio', 'Valle', 'Cerro', 'Lago', 'Nube', 'Selva', 'Cumbre',
  'Puente', 'Piedra', 'Bosque', 'Llano', 'Costa', 'Palma', 'Ceiba', 'Guadua', 'Colina', 'Vega',
];
const PALABRAS_B = [
  'Clara', 'Verde', 'Limpia', 'Fresca', 'Pura', 'Firme', 'Serena', 'Viva', 'Alta', 'Nueva',
  'Fuerte', 'Sana', 'Amplia', 'Noble', 'Plena', 'Libre', 'Digna', 'Solida', 'Justa', 'Buena',
];

function generarPassword(): string {
  const a = PALABRAS_A[randomInt(PALABRAS_A.length)];
  const b = PALABRAS_B[randomInt(PALABRAS_B.length)];
  const n = String(randomInt(10, 100)); // 2 dígitos
  return `${a}-${b}${n}`; // p. ej. Cauca-Verde47 → 13 chars, cumple los 4 requisitos
}

function parseCsv(ruta: string): Fila[] {
  const filas: Fila[] = [];
  const lineas = readFileSync(ruta, 'utf8').split(/\r?\n/);
  lineas.forEach((cruda, i) => {
    const linea = cruda.trim();
    if (!linea || linea.startsWith('#')) return;
    const campos = linea.split(',').map((c) => c.trim());
    if (campos[0]?.toLowerCase() === 'usuario') return; // cabecera
    const [usuario, nombre, email, planta, rol, activo] = campos;
    if (!usuario || !nombre || !email || !planta || !rol) {
      throw new Error(`Línea ${i + 1}: faltan columnas (se esperan usuario,nombre,email,planta,rol[,activo])`);
    }
    filas.push({
      usuario,
      nombre,
      email: email.toLowerCase(),
      planta,
      rol,
      // Sin columna `activo` se asume activo, para no romper CSV existentes.
      activo: (activo ?? 'si').toLowerCase() !== 'no',
      linea: i + 1,
    });
  });
  return filas;
}

function validar(filas: Fila[], plantasValidas: Set<string>): string[] {
  const errores: string[] = [];
  const vistos = new Set<string>();
  for (const f of filas) {
    if (!plantasValidas.has(f.planta)) {
      errores.push(`Línea ${f.linea} (${f.usuario}): planta "${f.planta}" no existe. Válidas: ${[...plantasValidas].join(', ')}`);
    }
    if (!ROLES.includes(f.rol as Role)) {
      errores.push(`Línea ${f.linea} (${f.usuario}): rol "${f.rol}" inválido. Válidos: ${ROLES.join(', ')}`);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) {
      errores.push(`Línea ${f.linea} (${f.usuario}): correo con formato inválido`);
    }
    if (vistos.has(f.email)) errores.push(`Línea ${f.linea}: el correo ${f.email} está repetido en el CSV`);
    vistos.add(f.email);
  }
  return errores;
}

async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const iFile = args.indexOf('--file');
  const ruta = iFile >= 0 ? args[iFile + 1] : undefined;
  const aplicar = args.includes('--aplicar');

  if (!ruta) {
    console.error('Uso: npm run db:migrate-users -w @ptap/api -- --file <ruta.csv> [--aplicar]');
    process.exit(1);
  }

  const filas = parseCsv(ruta);
  // Misma fuente de verdad que usa el registro para validar la planta (`isKnownPlant`).
  const plantasValidas = new Set(loadMapping().plants.map((p) => p.plantId));

  const errores = validar(filas, plantasValidas);
  if (errores.length > 0) {
    console.error(`\n✗ ${errores.length} problema(s) en el CSV; no se creó nada:\n`);
    errores.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  const pool = createPool({ ...readDatabaseConfig(), connectionLimit: 4 });
  const hashing = new PasswordHashingService();
  const creados: {
    usuario: string;
    email: string;
    planta: string;
    rol: string;
    password: string;
    activo: boolean;
  }[] = [];
  let existentes = 0;

  try {
    for (const f of filas) {
      const [rows] = await pool.query<RowDataPacket[]>('SELECT id FROM users WHERE email = ? LIMIT 1', [f.email]);
      if (rows.length > 0) {
        console.log(`  = ya existe, sin tocar: ${f.email}`);
        existentes++;
        continue;
      }
      const password = generarPassword();
      if (aplicar) {
        const { passwordHash, pepperVersion } = await hashing.hashPassword(password);
        await pool.query(
          `INSERT INTO users (id, email, name, role, plant, password_hash, pepper_version, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [randomUUID(), f.email, f.nombre, f.rol, f.planta, passwordHash, pepperVersion, f.activo ? 1 : 0],
        );
      }
      creados.push({
        usuario: f.usuario,
        email: f.email,
        planta: f.planta,
        rol: f.rol,
        password,
        activo: f.activo,
      });
    }

    console.log('');
    console.log(aplicar ? '=== CUENTAS CREADAS ===' : '=== SIMULACRO (no se escribió nada) ===');
    console.log('');
    console.log('usuario                    | correo                                | planta          | rol      | estado     | contraseña');
    console.log('-'.repeat(135));
    for (const c of creados) {
      console.log(
        `${c.usuario.padEnd(26)} | ${c.email.padEnd(37)} | ${c.planta.padEnd(15)} | ${c.rol.padEnd(8)} | ` +
          `${(c.activo ? 'activo' : 'PENDIENTE').padEnd(10)} | ${c.password}`,
      );
    }
    const pendientes = creados.filter((c) => !c.activo).length;
    console.log('');
    console.log(
      `  ${creados.length} ${aplicar ? 'creadas' : 'por crear'} ` +
        `(${creados.length - pendientes} activas, ${pendientes} pendientes), ${existentes} ya existían.`,
    );
    if (pendientes > 0) {
      console.log(
        `  Las ${pendientes} pendientes NO pueden entrar hasta que un admin las apruebe en\n` +
          '  Usuarios → pestaña "Pendientes", donde además se les asigna planta y rol.',
      );
    }
    if (aplicar) {
      console.log('');
      console.log('  ⚠️ Estas contraseñas se muestran UNA sola vez: en la base quedan hasheadas.');
      console.log('     Guárdalas ahora y entrégalas por un canal seguro.');
      console.log('     ⚠️ Hoy NO hay flujo de cambio de contraseña: hasta que exista, estas son fijas.');
    } else {
      console.log('  Para crearlas de verdad, repite el comando con --aplicar');
    }
  } finally {
    await pool.end();
  }
}

void runCli();
