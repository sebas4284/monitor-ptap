import 'reflect-metadata';
import { createPool } from 'mysql2/promise';
import { readDatabaseConfig } from '../src/infrastructure/database/database.config';
import { CommandSignatureService } from '../src/modules/commands/command-signature.service';
import type { LegacyBoundaryExpectation } from '../src/modules/commands/command-legacy-boundary';

const USAGE = 'accept-command-legacy-boundary --total=N --unsigned=N --count=N --tip=GENESIS|64_hex --facts-sha256=64_hex --accept-reviewed-legacy-boundary';
export function parseLegacyBoundaryArgs(args: string[]): LegacyBoundaryExpectation {
  const values = new Map(args.map(arg => { const at = arg.indexOf('='); return at < 0 ? [arg, ''] : [arg.slice(0, at), arg.slice(at + 1)]; }));
  const numeric = (name: string): number => { const raw = values.get(name); if (!raw || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error(USAGE); return Number(raw); };
  if (args.length !== 6 || values.size !== 6 || !args.includes('--accept-reviewed-legacy-boundary')) throw new Error(USAGE);
  const total = numeric('--total'), unsigned = numeric('--unsigned'), count = numeric('--count');
  const tip = values.get('--tip') === 'GENESIS' ? null : values.get('--tip');
  const factsSha256 = values.get('--facts-sha256');
  if (total < 1 || unsigned < 1 || count + unsigned !== total ||
    !factsSha256 || !/^[a-f0-9]{64}$/.test(factsSha256) ||
    (count === 0 ? tip !== null : typeof tip !== 'string' || !/^[a-f0-9]{64}$/.test(tip))) throw new Error(USAGE);
  return { total, unsigned, count, tip: tip ?? null, factsSha256 };
}
async function run(): Promise<void> {
  if (process.argv.slice(2).includes('--help')) { console.log(USAGE); return; }
  const expected = parseLegacyBoundaryArgs(process.argv.slice(2));
  for (const key of ['DB_HOST', 'DB_USER', 'DB_NAME', 'DB_PASSWORD', 'COMMAND_SIGNING_SECRET', 'COMMAND_CHECKPOINT_PATH']) {
    if (!process.env[key]?.trim()) throw new Error(`Falta configuración explícita: ${key}`);
  }
  // Deliberately never loads .env, rotates keys, rewrites rows, or starts producers.
  const pool = createPool({ ...readDatabaseConfig(), connectionLimit: 1 });
  try {
    await new CommandSignatureService(pool).establecerFronteraLegacy(expected, 'ACEPTO LA FRONTERA LEGACY SIN AUTENTICIDAD RETROACTIVA');
    console.log(`Frontera aceptada: ${expected.total} filas preservadas, ${expected.unsigned} sin firma histórica. No se afirma autenticidad retroactiva. Conservar manifest y checkpoint por separado de MySQL.`);
  } finally { await pool.end(); }
}
if (require.main === module) run().catch(() => {
  console.error('No se aceptó la frontera legacy. Revisar evidencia, argumentos, configuración y archivos existentes; no borrar evidencia para reintentar. Use --help.');
  process.exitCode = 1;
});
