/**
 * FASE 6 §4 — SOAK TEST (24–72 h). Es el último entregable del plan sin ejecutar.
 *
 * Qué valida (y por qué no lo cubre ninguna otra prueba): que el gateway sobreviva a la
 * operación CONTINUA. Los escenarios de §1–§3 duran segundos; una fuga de memoria, de
 * listeners o de sockets solo se manifiesta después de horas. Aquí se busca exactamente eso.
 *
 * Se arma el pipeline REAL en memoria (SimulatorBridgeAdapter → PlantPipelineService →
 * PlantCache), igual que `operational-validation.ts`. NO toca producción, NO usa MySQL, NO
 * abre puertos y NO necesita sudo: es un proceso aislado que se puede matar en cualquier
 * momento sin consecuencias.
 *
 * Caos periódico (por defecto cada 30 min, rotando):
 *   1. freeze()            → congela notificaciones → watchdog → Stale → reciclaje
 *   2. faultBuffer()       → degrada UN buffer, el resto debe seguir operando
 *   3. recuperación        → limpia el fallo y verifica que vuelve a Connected
 *
 * Muestreo periódico a JSONL (por defecto cada 60 s), para poder graficar después:
 *   rss, heapUsed, external, activeHandles, activeRequests, deadLetter, reconnects,
 *   snapshots, bridgeStatus.
 *
 * Uso:
 *   SOAK_HOURS=24 node --import tsx scripts/soak-test.ts
 *   SOAK_HOURS=0.05 SAMPLE_MS=5000 CHAOS_MS=15000 node --import tsx scripts/soak-test.ts   # ensayo
 *
 * Salida: `soak-<inicio>.jsonl` + un resumen final con el veredicto de los criterios de
 * aceptación de la Fase 6 §4 (RSS < 10 % de variación, dead letter acotado, sin fuga de handles).
 */
import 'reflect-metadata';
import { appendFileSync, writeFileSync } from 'node:fs';
import { SimulatorBridgeAdapter } from '../src/infrastructure/connectivity/adapters/simulator/simulator-bridge.adapter';
import { PlantPipelineService } from '../src/infrastructure/connectivity/pipeline/plant-pipeline.service';
import { TankAutonomyStore } from '../src/infrastructure/connectivity/pipeline/tank-autonomy.store';
import { PlantCache } from '../src/infrastructure/connectivity/pipeline/plant-cache';
import { loadMapping } from '../src/infrastructure/connectivity/mapping/opc-mapping.loader';
import type { ConnectivityConfig, OpcUaConfig } from '../src/infrastructure/connectivity/connectivity.config';

const SOAK_HOURS = Number(process.env.SOAK_HOURS ?? 24);
const SAMPLE_MS = Number(process.env.SAMPLE_MS ?? 60_000);
const CHAOS_MS = Number(process.env.CHAOS_MS ?? 30 * 60_000);
const PUBLISHING_MS = Number(process.env.PUBLISHING_MS ?? 2000); // cadencia real de PTAP
const OUT = process.env.SOAK_OUT ?? `soak-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function makeConfig(): ConnectivityConfig {
  const opcua: OpcUaConfig = {
    endpoint: 'simulator://in-memory',
    endpointMustExist: false,
    securityMode: 'None',
    securityPolicy: 'None',
    identity: { type: 'anonymous' },
    autoAcceptUnknownCertificate: false,
    publishingIntervalMs: PUBLISHING_MS,
    samplingIntervalMs: PUBLISHING_MS,
    subscriptionLifetimeCount: 100,
    subscriptionMaxKeepAliveCount: 10,
    coalesceWindowMs: PUBLISHING_MS,
    // A diferencia de la prueba de carga, aquí el watchdog SÍ debe dispararse: es parte del caos.
    watchdogTimeoutMs: 30_000,
    heartbeatIntervalMs: 60_000,
    heartbeatMaxFailures: 2,
    reconnectInitialDelayMs: 1000,
    reconnectMaxDelayMs: 30_000,
    reconnectMaxRetry: 1_000_000,
    subscriptionRecycleMaxAttempts: 3,
    staleThresholdMs: 300_000,
    writesEnabled: false,
    allowInsecureWrites: false,
  };
  return {
    provider: 'simulator',
    opcua,
    liveness: { liveSec: 10, windowSec: 300, sweepMs: 1000 },
    // El soak vigila que el dead letter quede ACOTADO: el tope tiene que ser el de produccion
    // (OPC_DEAD_LETTER_CAPACITY), no uno inventado, o el criterio no probaria nada.
    deadLetterCapacity: Number(process.env.OPC_DEAD_LETTER_CAPACITY ?? 500),
  };
}

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

async function main(): Promise<void> {
  const mapping = loadMapping();
  const config = makeConfig();
  const adapter = new SimulatorBridgeAdapter(config.opcua, mapping);
  const cache = new PlantCache();
  // El 4.o argumento (TankAutonomyStore) NO es opcional: sin el, el barrido de liveness muere
  // en el primer tick con `Cannot read properties of undefined (reading 'get')`. Faltaba desde
  // que el pipeline gano ese parametro, y es lo que tumbaba la corrida de 24 h a los pocos
  // minutos dejando el JSONL sin linea de veredicto.
  const pipeline = new PlantPipelineService(adapter, config, cache, new TankAutonomyStore());

  let snapshots = 0;
  // El pipeline es un provider de Nest: su ciclo de vida son onModuleInit/onModuleDestroy, y los
  // snapshots salen por el observable `snapshot$` (mismo camino que usa el gateway en producción).
  pipeline.onModuleInit();
  const sub = pipeline.snapshot$.subscribe(() => { snapshots += 1; });
  await adapter.start();

  const t0 = Date.now();
  const finMs = t0 + SOAK_HOURS * 3600_000;
  const muestras: Muestra[] = [];

  const cab = {
    tipo: 'inicio',
    t: new Date(t0).toISOString(),
    soakHours: SOAK_HOURS,
    sampleMs: SAMPLE_MS,
    chaosMs: CHAOS_MS,
    publishingMs: PUBLISHING_MS,
    plantas: mapping.plants.length,
    node: process.version,
  };
  writeFileSync(OUT, JSON.stringify(cab) + '\n');

  console.log('='.repeat(74));
  console.log(` SOAK TEST — Fase 6 §4`);
  console.log('='.repeat(74));
  console.log(`  duración      ${SOAK_HOURS} h  (fin ~${new Date(finMs).toISOString()})`);
  console.log(`  muestreo      cada ${SAMPLE_MS / 1000}s   ·   caos cada ${CHAOS_MS / 60000} min`);
  console.log(`  plantas       ${mapping.plants.length}   ·   publishing ${PUBLISHING_MS}ms`);
  console.log(`  salida        ${OUT}`);
  console.log('='.repeat(74) + '\n');

  const mb = (n: number): number => Math.round((n / 1048576) * 100) / 100;
  // Node no tipa estos internos, pero son la única vía para detectar fuga de handles/sockets.
  const cuenta = (k: '_getActiveHandles' | '_getActiveRequests'): number => {
    const fn = (process as unknown as Record<string, undefined | (() => unknown[])>)[k];
    return typeof fn === 'function' ? fn.call(process).length : -1;
  };

  const muestrear = (): void => {
    const m = process.memoryUsage();
    const st = adapter.getDiagnostics();
    const dl = pipeline.getDeadLetter();
    const fila: Muestra = {
      t: new Date().toISOString(),
      minuto: Math.round((Date.now() - t0) / 60000),
      rssMB: mb(m.rss),
      heapMB: mb(m.heapUsed),
      externalMB: mb(m.external),
      handles: cuenta('_getActiveHandles'),
      requests: cuenta('_getActiveRequests'),
      snapshots,
      deadLetter: dl.total,
      reconnects: st.reconnectCount,
      bridge: String(st.bridgeStatus),
    };
    muestras.push(fila);
    appendFileSync(OUT, JSON.stringify({ tipo: 'muestra', ...fila }) + '\n');
    console.log(
      `  [${String(fila.minuto).padStart(5)} min]  rss=${String(fila.rssMB).padStart(7)}MB  ` +
        `heap=${String(fila.heapMB).padStart(7)}MB  handles=${String(fila.handles).padStart(3)}  ` +
        `snaps=${String(fila.snapshots).padStart(7)}  dl=${fila.deadLetter}  rec=${fila.reconnects}  ${fila.bridge}`,
    );
  };

  let ciclo = 0;
  const caos = async (): Promise<void> => {
    const paso = ciclo % 3;
    ciclo += 1;
    try {
      if (paso === 0) {
        console.log(`  ⚡ caos #${ciclo}: freeze() → se espera Stale + reciclaje automático`);
        adapter.freeze();
        appendFileSync(OUT, JSON.stringify({ tipo: 'caos', t: new Date().toISOString(), accion: 'freeze' }) + '\n');
      } else if (paso === 1) {
        // El mapping YA cargado no expone los buffers (el loader los aplana hacia el adaptador),
        // así que el objetivo se toma de getBufferHealth(), que es la vista real de lo suscrito.
        const sanos = adapter.getBufferHealth().filter((b) => !b.faulted);
        const obj = sanos[0];
        if (obj) {
          console.log(`  ⚡ caos #${ciclo}: faultBuffer(${obj.plantId}/${obj.browseName}) → degradación aislada`);
          adapter.faultBuffer(obj.plantId, obj.browseName);
          appendFileSync(OUT, JSON.stringify({ tipo: 'caos', t: new Date().toISOString(), accion: 'faultBuffer', plantId: obj.plantId, buffer: obj.browseName }) + '\n');
        } else {
          console.log(`  ⚡ caos #${ciclo}: faultBuffer omitido (no hay buffers sanos que degradar)`);
        }
      } else {
        console.log(`  ⚡ caos #${ciclo}: recuperación → ciclo completo de parada y arranque del adaptador`);
        await adapter.stop();
        await delay(2000);
        await adapter.start();
        appendFileSync(OUT, JSON.stringify({ tipo: 'caos', t: new Date().toISOString(), accion: 'recuperacion' }) + '\n');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ⚠️  el caos #${ciclo} lanzó: ${msg}`);
      appendFileSync(OUT, JSON.stringify({ tipo: 'caos-error', t: new Date().toISOString(), error: msg }) + '\n');
    }
  };

  const idMuestra = setInterval(muestrear, SAMPLE_MS);
  const idCaos = setInterval(() => void caos(), CHAOS_MS);
  muestrear();

  let cortado = false;
  let motivoCorte: string | null = null;
  const cortar = (): void => { cortado = true; };
  process.on('SIGINT', cortar);
  process.on('SIGTERM', cortar);
  // Una excepcion suelta (un timer, una promesa sin catch) mataba el proceso dejando el JSONL
  // sin veredicto y sin rastro de POR QUE. Ahora se anota en el archivo y se cierra el informe:
  // un soak que se cae es un resultado, pero solo si queda escrito.
  const fatal = (err: unknown): void => {
    motivoCorte = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    appendFileSync(OUT, JSON.stringify({ tipo: 'fatal', t: new Date().toISOString(), error: motivoCorte, stack: err instanceof Error ? err.stack : null }) + '\n');
    console.error(`\n  FATAL: ${motivoCorte}\n  Se cierra el informe con lo medido hasta aqui.`);
    cortado = true;
  };
  process.on('uncaughtException', fatal);
  process.on('unhandledRejection', fatal);

  while (Date.now() < finMs && !cortado) await delay(1000);

  clearInterval(idMuestra);
  clearInterval(idCaos);
  muestrear();
  sub.unsubscribe();
  pipeline.onModuleDestroy();
  await adapter.stop().catch(() => undefined);

  // ── Veredicto contra los criterios de aceptación de la Fase 6 §4 ──────────────────
  // Se descarta la primera muestra: el arranque en frío no representa el régimen.
  const est = muestras.length > 2 ? muestras.slice(1) : muestras;
  const rss = est.map((m) => m.rssMB);
  const rssMin = Math.min(...rss);
  const rssMax = Math.max(...rss);
  const variacion = rssMin > 0 ? ((rssMax - rssMin) / rssMin) * 100 : 0;
  const hFirst = est[0]?.handles ?? 0;
  const hLast = est[est.length - 1]?.handles ?? 0;
  const dlLast = est[est.length - 1]?.deadLetter ?? 0;
  const horas = (Date.now() - t0) / 3600_000;

  // CRECIMIENTO, no dispersión (ver el razonamiento largo en soak-report.ts). La corrida del
  // 2026-08-03 estuvo plana en 106,2 MB durante 18 h y este criterio la reprobaba por un valle de
  // arranque a 96,4 MB. Un rojo falso cuesta relanzar 24 h, o salir a buscar una fuga que no está.
  const q = Math.floor(rss.length / 4);
  const media = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const baseline = q > 0 ? media(rss.slice(q, 2 * q)) : media(rss);
  const finalTramo = q > 0 ? media(rss.slice(3 * q)) : media(rss);
  const crecimiento = baseline > 0 ? ((finalTramo - baseline) / baseline) * 100 : 0;
  const okRss = crecimiento < 2;
  const okHandles = hLast <= hFirst + 5;
  // El criterio de la Fase 6 dice "soak de MINIMO 24 h". Sin esta comprobacion un ensayo de
  // 2 minutos imprimia 'CUMPLE' con las mismas letras que una corrida real, y ese verde es
  // justo el que termina copiado en el doc como si valiera.
  const okDuracion = horas >= 24;
  const veredicto = { horas: Math.round(horas * 100) / 100, muestras: muestras.length, rssMin, rssMax, variacionPct: Math.round(variacion * 100) / 100, crecimientoPct: Math.round(crecimiento * 100) / 100, handlesInicio: hFirst, handlesFin: hLast, deadLetterFinal: dlLast, snapshots, ciclosDeCaos: ciclo, okRss, okHandles, okDuracion, cortadoAntes: cortado, motivoCorte };
  appendFileSync(OUT, JSON.stringify({ tipo: 'veredicto', ...veredicto }) + '\n');

  console.log('\n' + '='.repeat(74));
  console.log(' VEREDICTO — Fase 6 §4');
  console.log('='.repeat(74));
  console.log(`  duración real      ${veredicto.horas} h ${cortado ? '(CORTADO antes de tiempo)' : ''}`);
  if (motivoCorte) console.log(`  motivo del corte   ${motivoCorte}`);
  console.log(`  muestras           ${muestras.length}   ·   ciclos de caos: ${ciclo}`);
  console.log(`  snapshots totales  ${snapshots}`);
  console.log('');
  console.log(`  RSS                ${rssMin} → ${rssMax} MB   (dispersión ${veredicto.variacionPct}%, incluye el arranque)`);
  console.log(`  crecimiento RSS    ${veredicto.crecimientoPct}%   ${okRss ? '✅ estable (< 2%)' : '❌ crece: posible fuga'}`);
  console.log(`  handles activos    ${hFirst} → ${hLast}   ${okHandles ? '✅ sin fuga' : '❌ crecimiento sostenido'}`);
  console.log(`  dead letter final  ${dlLast}   (debe estar acotado por el ring buffer)`);
  console.log('');
  console.log(`  duración >= 24 h   ${veredicto.horas} h   ${okDuracion ? '✅' : '❌ ensayo, NO vale como soak (el criterio pide 24-72 h)'}`);
  console.log('');
  console.log(`  ${okRss && okHandles && okDuracion ? '✅ CUMPLE los criterios de la Fase 6 §4' : '❌ NO cumple / incompleto — revisar el JSONL'}`);
  console.log(`  detalle: ${OUT}`);
  console.log('='.repeat(74));
}

main().catch((err) => {
  console.error('soak-test falló:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
