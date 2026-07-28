/**
 * FASE 6 — Validación operacional: CARGA + LATENCIA extremo a extremo.
 *
 * Maneja el pipeline REAL (SimulatorBridgeAdapter → PlantPipelineService → PlantCache) y lo
 * expone por un servidor Socket.IO real en un puerto efímero, tal como en producción. Luego
 * conecta N clientes Socket.IO reales (socket.io-client) repartidos por las 12 plantas y mide:
 *
 *   - Latencia extremo a extremo: frame del "PLC" (simulado) llega al backend → parser →
 *     mapping → quality → snapshot builder → Socket.IO → cliente. Se estampa el instante de
 *     llegada del frame (listener registrado ANTES del pipeline) y se compara al recibirlo el
 *     cliente. Percentiles p50/p95/p99.  (No incluye la espera del publishingInterval, que es
 *     la cadencia de push determinista, no latencia de proceso.)
 *   - Integridad de sequence: por planta, saltos (huecos) y regresiones vistos por los clientes.
 *   - Lag del event loop durante la ráfaga (drift de un timer de 50 ms).
 *   - Throughput de entregas y cadencia de emisión.
 *
 * Uso:  CLIENTS=60 DURATION_MS=15000 PUBLISHING_MS=100 node --import tsx scripts/operational-validation.ts
 * Salida: resumen humano + un bloque JSON (para pegar en docs/OPERATIONAL_VALIDATION.md).
 *
 * NO destructivo, NO toca el PLC real ni MySQL. Correlación: docs/OPERATIONAL_VALIDATION.md §2 y §3.
 */
import 'reflect-metadata';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { SimulatorBridgeAdapter } from '../src/infrastructure/connectivity/adapters/simulator/simulator-bridge.adapter';
import { PlantPipelineService } from '../src/infrastructure/connectivity/pipeline/plant-pipeline.service';
import { PlantCache } from '../src/infrastructure/connectivity/pipeline/plant-cache';
import { loadMapping } from '../src/infrastructure/connectivity/mapping/opc-mapping.loader';
import type { ConnectivityConfig, OpcUaConfig } from '../src/infrastructure/connectivity/connectivity.config';

const CLIENTS = Number(process.env.CLIENTS ?? 60);
const DURATION_MS = Number(process.env.DURATION_MS ?? 15000);
const PUBLISHING_MS = Number(process.env.PUBLISHING_MS ?? 100);
const SETTLE_MS = 1500; // se ignoran las muestras de este arranque (rampa de conexiones)

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
    watchdogTimeoutMs: 600000, // no debe dispararse durante la carga
    heartbeatIntervalMs: 600000,
    heartbeatMaxFailures: 2,
    reconnectInitialDelayMs: 1000,
    reconnectMaxDelayMs: 30000,
    reconnectMaxRetry: 1000000,
    subscriptionRecycleMaxAttempts: 3,
    staleThresholdMs: 300000,
    writesEnabled: false,
  };
  return { provider: 'simulator', opcua, liveness: { liveSec: 10, windowSec: 300, sweepMs: 1000 } };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

interface SnapshotWire {
  plantId: string;
  sequence: number;
  __frameHrt: number; // instante (performance.now) de llegada del frame al backend
}

async function main(): Promise<void> {
  const mapping = loadMapping();
  const plantIds = mapping.plants.map((p) => p.plantId);
  const config = makeConfig();

  const adapter = new SimulatorBridgeAdapter(config.opcua, mapping);
  const cache = new PlantCache();
  const pipeline = new PlantPipelineService(adapter, config, cache);

  // Estampa de llegada del frame al backend, ANTES de que el pipeline lo procese (mismo tick sync).
  const frameHrt = new Map<string, number>();
  adapter.onFrame((f) => frameHrt.set(f.plantId, performance.now()));

  // Servidor Socket.IO real (idéntico transporte a producción; el gateway hace exactamente esto).
  const httpServer = createServer();
  const io = new Server(httpServer, { cors: { origin: '*' } });
  io.on('connection', (sock) => {
    sock.on('opc:subscribe', (payload: { plantId?: string }) => {
      if (payload?.plantId) void sock.join(payload.plantId);
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const port = (httpServer.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;

  // Puente pipeline → Socket.IO: emitir el snapshot real a la room de su planta (como el gateway),
  // adjuntando el instante de llegada del frame para medir la latencia extremo a extremo.
  pipeline.onModuleInit();
  const bridgeSub = pipeline.snapshot$.subscribe((snap) => {
    const wire: SnapshotWire = { ...snap, __frameHrt: frameHrt.get(snap.plantId) ?? performance.now() };
    io.to(snap.plantId).emit('opc:snapshot', wire);
  });

  await adapter.start();

  // Métricas
  const latencies: number[] = [];
  let delivered = 0;
  let measuring = false;
  const lastSeqByClientPlant = new Map<string, number>();
  let gaps = 0;
  let regressions = 0;

  // Clientes reales repartidos round-robin por planta.
  const clients: ClientSocket[] = [];
  const connectAll = plantIds.length
    ? Array.from({ length: CLIENTS }, (_, i) => {
        const plantId = plantIds[i % plantIds.length];
        return new Promise<void>((resolve) => {
          const c = ioClient(url, { transports: ['websocket'], forceNew: true, reconnection: false });
          clients.push(c);
          c.on('connect', () => {
            c.emit('opc:subscribe', { plantId });
            resolve();
          });
          c.on('opc:snapshot', (s: SnapshotWire) => {
            if (!s || s.plantId !== plantId) return;
            if (measuring) {
              latencies.push(performance.now() - s.__frameHrt);
              delivered++;
              const key = `${c.id}:${plantId}`;
              const prev = lastSeqByClientPlant.get(key);
              if (prev !== undefined) {
                if (s.sequence > prev + 1) gaps++;
                else if (s.sequence <= prev) regressions++;
              }
              lastSeqByClientPlant.set(key, s.sequence);
            }
          });
        });
      })
    : [];
  await Promise.all(connectAll);

  // Lag del event loop
  let maxLag = 0;
  const lagSamples: number[] = [];
  const expected = 50;
  let lastTick = performance.now();
  const lagTimer = setInterval(() => {
    const now = performance.now();
    const lag = now - lastTick - expected;
    lastTick = now;
    if (lag > 0) {
      lagSamples.push(lag);
      if (lag > maxLag) maxLag = lag;
    }
  }, expected);

  await delay(SETTLE_MS);
  measuring = true;
  const measureStart = performance.now();
  await delay(DURATION_MS);
  measuring = false;
  const measuredSec = (performance.now() - measureStart) / 1000;

  clearInterval(lagTimer);
  bridgeSub.unsubscribe();
  for (const c of clients) c.disconnect();
  io.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  pipeline.onModuleDestroy();
  await adapter.stop();

  latencies.sort((a, b) => a - b);
  lagSamples.sort((a, b) => a - b);
  const r2 = (n: number): number => Math.round(n * 100) / 100;

  const result = {
    config: { clients: CLIENTS, plants: plantIds.length, durationSec: r2(measuredSec), publishingIntervalMs: PUBLISHING_MS },
    delivery: {
      snapshotsDelivered: delivered,
      throughputPerSec: r2(delivered / measuredSec),
      sequenceGaps: gaps,
      sequenceRegressions: regressions,
    },
    latencyMs: {
      p50: r2(percentile(latencies, 50)),
      p95: r2(percentile(latencies, 95)),
      p99: r2(percentile(latencies, 99)),
      max: r2(latencies[latencies.length - 1] ?? NaN),
      samples: latencies.length,
    },
    eventLoopLagMs: {
      p95: r2(percentile(lagSamples, 95)),
      max: r2(maxLag),
      note: 'lag = drift de un timer de 50 ms bajo carga',
    },
    budget: {
      target: `p95 < 1 publishingInterval + 500 ms = ${PUBLISHING_MS + 500} ms`,
      p95Ms: r2(percentile(latencies, 95)),
      pass: percentile(latencies, 95) < PUBLISHING_MS + 500,
    },
  };

  console.log('\n================ FASE 6 — CARGA + LATENCIA ================');
  console.log(`Clientes Socket.IO: ${CLIENTS}  ·  Plantas: ${plantIds.length}  ·  Duración medida: ${r2(measuredSec)} s`);
  console.log(`Entregas: ${delivered}  (${r2(delivered / measuredSec)}/s)  ·  huecos: ${gaps}  ·  regresiones: ${regressions}`);
  console.log(`Latencia e2e (frame→cliente): p50=${result.latencyMs.p50}ms  p95=${result.latencyMs.p95}ms  p99=${result.latencyMs.p99}ms  max=${result.latencyMs.max}ms`);
  console.log(`Event-loop lag: p95=${result.eventLoopLagMs.p95}ms  max=${result.eventLoopLagMs.max}ms`);
  console.log(`Presupuesto (${result.budget.target}): ${result.budget.pass ? 'CUMPLE ✅' : 'NO CUMPLE ❌'}`);
  console.log('\n--- JSON ---');
  console.log(JSON.stringify(result, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error('operational-validation falló:', err);
  process.exit(1);
});
