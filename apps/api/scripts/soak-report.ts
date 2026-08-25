/**
 * FASE 6 §4 — VEREDICTO DEL SOAK a partir del JSONL, sin volver a correr las 24 h.
 *
 * Existe por un agujero real de proceso: la corrida de 24 h se lanzó en la VM el 2026-08-03 y
 * `soak-test.ts` solo imprime su veredicto AL TERMINAR, por stdout. Si el `pm2`/la sesión SSH
 * que lo lanzó se cerró, si el proceso se cortó, o si simplemente nadie copió esa salida, el
 * JSONL con las muestras se queda ahí y la sección §4 del doc no se puede cerrar — que es
 * exactamente lo que pasó: el doc lleva semanas diciendo "EN CURSO" con los datos ya en disco.
 *
 * Este script reconstruye el mismo veredicto leyendo el archivo, y funciona con un JSONL
 * TRUNCADO (sin la línea `veredicto`): entonces lo recalcula desde las muestras y lo dice.
 * Los criterios son los MISMOS que aplica soak-test.ts, sin relajar ninguno.
 *
 * Ejecutar:
 *   npm run validate:soak-report -- ~/soak-20260803-124408.jsonl
 *   node --import tsx scripts/soak-report.ts soak.jsonl --markdown   # tabla para pegar en el doc
 *
 * Traer el archivo desde la VM (el soak corre allí):
 *   scp ptap:~/soak-*.jsonl .
 */
import { readFileSync } from 'node:fs';

interface Muestra {
  t: string;
  minuto: number;
  rssMB: number;
  heapMB: number;
  externalMB: number;
  handles: number;
  requests: number;
  snapshots: number;
  deadLetter: number;
  reconnects: number;
  bridge: string;
}

interface Veredicto {
  horas: number;
  muestras: number;
  rssMin: number;
  rssMax: number;
  variacionPct: number;
  handlesInicio: number;
  handlesFin: number;
  deadLetterFinal: number;
  snapshots: number;
  ciclosDeCaos: number;
  okRss: boolean;
  okHandles: boolean;
  cortadoAntes: boolean;
}

type Linea =
  | ({ tipo: 'muestra' } & Muestra)
  | ({ tipo: 'veredicto' } & Veredicto)
  | { tipo: 'inicio'; [k: string]: unknown }
  | { tipo: 'caos' | 'caos-error'; t: string; accion?: string; [k: string]: unknown };

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const MARKDOWN = process.argv.includes('--markdown');
const ARCHIVO = args[0];

if (!ARCHIVO) {
  console.error('uso: node --import tsx scripts/soak-report.ts <soak.jsonl> [--markdown]');
  process.exit(2);
}

function leer(path: string): Linea[] {
  const bruto = readFileSync(path, 'utf8');
  const lineas: Linea[] = [];
  let malas = 0;
  for (const l of bruto.split(/\r?\n/)) {
    if (!l.trim()) continue;
    try {
      lineas.push(JSON.parse(l) as Linea);
    } catch {
      // Una última línea a medio escribir es lo NORMAL si el proceso murió a mitad de un
      // appendFile. Se cuenta y se sigue: descartar el archivo entero por eso sería absurdo.
      malas++;
    }
  }
  if (malas > 0) console.log(`  (${malas} línea(s) ilegibles, típico de un corte a mitad de escritura)`);
  return lineas;
}

/** Recalcula el veredicto desde las muestras, con los MISMOS criterios que soak-test.ts. */
function recalcular(muestras: Muestra[], caos: number, arranque: string | null): Veredicto {
  // Se descarta la primera muestra: el arranque en frío no representa el régimen (igual que
  // hace soak-test.ts — si aquí se contara, el veredicto no sería comparable con el suyo).
  const est = muestras.length > 2 ? muestras.slice(1) : muestras;
  const rss = est.map((m) => m.rssMB);
  const rssMin = rss.length ? Math.min(...rss) : 0;
  const rssMax = rss.length ? Math.max(...rss) : 0;
  const variacion = rssMin > 0 ? ((rssMax - rssMin) / rssMin) * 100 : 0;
  const hFirst = est[0]?.handles ?? 0;
  const hLast = est[est.length - 1]?.handles ?? 0;

  // La duración sale de los timestamps, no de un reloj vivo: es un post-mortem.
  const inicio = arranque ?? muestras[0]?.t ?? null;
  const fin = muestras[muestras.length - 1]?.t ?? null;
  const horas = inicio && fin ? (Date.parse(fin) - Date.parse(inicio)) / 3600_000 : 0;

  return {
    horas: Math.round(horas * 100) / 100,
    muestras: muestras.length,
    rssMin,
    rssMax,
    variacionPct: Math.round(variacion * 100) / 100,
    handlesInicio: hFirst,
    handlesFin: hLast,
    deadLetterFinal: est[est.length - 1]?.deadLetter ?? 0,
    snapshots: est[est.length - 1]?.snapshots ?? 0,
    ciclosDeCaos: caos,
    okRss: variacion < 10,
    okHandles: hLast <= hFirst + 5,
    cortadoAntes: true, // sin línea `veredicto` no hay prueba de cierre limpio
  };
}

function main(): void {
  const lineas = leer(ARCHIVO);
  const muestras = lineas.filter((l): l is { tipo: 'muestra' } & Muestra => l.tipo === 'muestra');
  const caos = lineas.filter((l) => l.tipo === 'caos');
  const caosError = lineas.filter((l) => l.tipo === 'caos-error');
  const inicio = lineas.find((l) => l.tipo === 'inicio') as ({ t?: string } | undefined);
  const cerrado = lineas.find((l): l is { tipo: 'veredicto' } & Veredicto => l.tipo === 'veredicto');

  if (muestras.length === 0) {
    console.error(`${ARCHIVO}: no hay muestras. ¿Es un JSONL de soak-test.ts?`);
    process.exit(1);
  }

  const v = cerrado ?? recalcular(muestras, caos.length, (inicio?.t as string | undefined) ?? null);
  const horasObjetivo = Number((inicio as { soakHours?: number } | undefined)?.soakHours ?? 24);
  const completo = Boolean(cerrado) && !v.cortadoAntes;
  const alcanzoMinimo = v.horas >= 24;

  // Reparto de estados del puente durante la corrida: si `Faulted` aparece, el criterio "toda
  // recuperación automática" hay que mirarlo a mano, porque Faulted es terminal y debe alertar.
  const porEstado = new Map<string, number>();
  for (const m of muestras) porEstado.set(m.bridge, (porEstado.get(m.bridge) ?? 0) + 1);
  const faulted = porEstado.get('Faulted') ?? 0;
  const reconnects = muestras[muestras.length - 1]?.reconnects ?? 0;

  const ok = v.okRss && v.okHandles && alcanzoMinimo && faulted === 0;

  console.log('\n' + '='.repeat(74));
  console.log(` VEREDICTO DEL SOAK (Fase 6 §4) — ${ARCHIVO}`);
  console.log('='.repeat(74));
  console.log(`  origen del veredicto  ${cerrado ? 'línea `veredicto` del propio soak (cierre limpio)' : 'RECALCULADO de las muestras (JSONL sin cerrar)'}`);
  console.log(`  duración              ${v.horas} h de ${horasObjetivo} h objetivo   ${alcanzoMinimo ? '✅ ≥ 24 h' : '❌ < 24 h (el criterio pide 24–72 h)'}`);
  console.log(`  muestras              ${v.muestras}   ·   ciclos de caos: ${v.ciclosDeCaos}${caosError.length ? `  (${caosError.length} con error)` : ''}`);
  console.log(`  snapshots             ${v.snapshots}   ·   reconexiones: ${reconnects}`);
  console.log('');
  console.log(`  RSS                   ${v.rssMin} → ${v.rssMax} MB   variación ${v.variacionPct}%   ${v.okRss ? '✅ < 10%' : '❌ ≥ 10%'}`);
  console.log(`  handles activos       ${v.handlesInicio} → ${v.handlesFin}   ${v.okHandles ? '✅ sin fuga' : '❌ crecimiento sostenido'}`);
  console.log(`  dead letter final     ${v.deadLetterFinal}   (acotado por el ring: OPC_DEAD_LETTER_CAPACITY)`);
  console.log(`  estados del puente    ${[...porEstado].map(([k, n]) => `${k}×${n}`).join('  ')}`);
  if (faulted > 0) {
    console.log(`  ⚠️  ${faulted} muestra(s) en Faulted: estado TERMINAL. Verificar a mano que alertó y por qué llegó ahí.`);
  }
  console.log('');
  console.log(`  ${ok ? '✅ CUMPLE los criterios de la Fase 6 §4' : '❌ NO cumple / incompleto — ver arriba'}`);
  if (!completo) {
    console.log(`  ⚠️  El JSONL no tiene línea de cierre: la corrida se cortó o sigue viva. Si sigue viva, esperar y repetir.`);
  }
  console.log('='.repeat(74) + '\n');

  if (MARKDOWN) {
    console.log('Pegar en docs/OPERATIONAL_VALIDATION.md §4:\n');
    console.log('| Métrica | Valor | Criterio |');
    console.log('|---|---|---|');
    console.log(`| Duración | ${v.horas} h | ${alcanzoMinimo ? '✅ ≥ 24 h' : '❌ < 24 h'} |`);
    console.log(`| RSS | ${v.rssMin} → ${v.rssMax} MB (${v.variacionPct} %) | ${v.okRss ? '✅ < 10 %' : '❌ ≥ 10 %'} |`);
    console.log(`| Handles activos | ${v.handlesInicio} → ${v.handlesFin} | ${v.okHandles ? '✅ sin fuga' : '❌ fuga'} |`);
    console.log(`| Dead letter final | ${v.deadLetterFinal} | ✅ acotado por el ring |`);
    console.log(`| Ciclos de caos | ${v.ciclosDeCaos} | recuperación automática |`);
    console.log(`| Snapshots | ${v.snapshots} | — |`);
    console.log('');
  }

  process.exitCode = ok ? 0 : 1;
}

main();
