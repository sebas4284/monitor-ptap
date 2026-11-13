import 'reflect-metadata';
import { createPool } from 'mysql2/promise';
import { readDatabaseConfig } from '../src/infrastructure/database/database.config';
import { CommandSignatureService } from '../src/modules/commands/command-signature.service';

const USAGE = 'accept-command-ledger-baseline --count=N --tip=GENESIS|64_hex --accept-reviewed-history';

export function parseBaselineArgs(args: string[]): { count: number; tip: string | null } {
  const countArg = args.find((arg) => arg.startsWith('--count='))?.slice(8);
  const tipArg = args.find((arg) => arg.startsWith('--tip='))?.slice(6);
  const count = Number(countArg);
  const tip = tipArg === 'GENESIS' ? null : tipArg;
  if (args.length !== 3 || !args.includes('--accept-reviewed-history') ||
    !countArg || !/^\d+$/.test(countArg) || !Number.isSafeInteger(count) || count < 0 ||
    (count === 0 ? tip !== null : typeof tip !== 'string' || !/^[a-f0-9]{64}$/.test(tip))) throw new Error(USAGE);
  return { count, tip: tip ?? null };
}

async function run(): Promise<void> {
  if (process.argv.slice(2).includes('--help')) { console.log(USAGE); return; }
  const expected = parseBaselineArgs(process.argv.slice(2));
  // Explicit injected environment only: this tool never loads .env or guesses a destination.
  for (const key of ['DB_HOST', 'DB_USER', 'DB_NAME', 'DB_PASSWORD', 'COMMAND_SIGNING_SECRET', 'COMMAND_CHECKPOINT_PATH']) {
    if (!process.env[key]?.trim()) throw new Error(`Falta configuración explícita: ${key}`);
  }
  const pool = createPool({ ...readDatabaseConfig(), connectionLimit: 1 });
  try {
    await new CommandSignatureService(pool).establecerBaseline(expected.count, expected.tip, 'ACEPTO EL HISTORICO REVISADO');
    console.log(`Checkpoint inicial aceptado para ${expected.count} maniobra(s). Conservar la evidencia de revisión por separado.`);
  } finally { await pool.end(); }
}

if (require.main === module) {
  run().catch(() => {
    console.error('No se aceptó el baseline. Revisar argumentos, evidencia, configuración y checkpoint existente; no borrar evidencia para reintentar. Use --help.');
    process.exitCode = 1;
  });
}
