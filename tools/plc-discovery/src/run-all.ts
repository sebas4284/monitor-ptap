/**
 * Orquestador: ejecuta las 5 etapas en orden.
 * Las etapas 00–02 tocan el servidor (solo lectura); 03–04 son offline.
 * Pensado para un entorno limpio; cada etapa también puede correrse por separado.
 */
import { runEndpoints } from './steps/00-endpoints';
import { runBrowse } from './steps/01-browse';
import { runRead } from './steps/02-read';
import { runAnalyze } from './steps/03-analyze';
import { runGenerate } from './steps/04-generate';

async function main(): Promise<void> {
  console.log('=== plc-discovery: descubrimiento OPC UA de solo lectura ===\n');
  await runEndpoints();
  console.log('');
  await runBrowse();
  console.log('');
  await runRead();
  console.log('');
  runAnalyze();
  console.log('');
  runGenerate();
  console.log('\n=== completado ===');
}

main().catch((err) => {
  console.error(`\nFALLÓ: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
