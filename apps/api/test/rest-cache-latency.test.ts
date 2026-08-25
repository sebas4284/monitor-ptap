/**
 * FASE 2 — criterio de aceptación pendiente: "REST responde < 50 ms (cache), sin tocar el PLC".
 *
 * Los otros criterios de la Fase 2 (sequence monotónico, dead letter, diff) ya tenían test;
 * este no, y era el único que afirmaba algo sobre el CAMINO HTTP completo. Se prueba con
 * peticiones HTTP REALES (@nestjs/testing + supertest) contra el mismo cableado de producción
 * (SimulatorBridgeAdapter → PlantPipelineService → PlantCache), y comprueba las DOS mitades
 * del criterio, que son independientes:
 *
 *   1. LATENCIA: p95 < 50 ms sobre una ráfaga de peticiones.
 *   2. CERO LECTURAS OPC: la petición NO dispara ninguna llamada al PLC. Esto es lo que de
 *      verdad protege el criterio — un REST rápido que por debajo hiciera un read() seguiría
 *      violando el diseño (regla: "GET /api/plants/:plantId/snapshot responde desde cache,
 *      nunca dispara una lectura OPC"), y con el simulador en memoria la latencia sola no lo
 *      delataría. Se cuentan las llamadas a readBufferElement/writeBufferElement/getServerInfo,
 *      que son los ÚNICOS caminos del puerto que hablan con el servidor bajo demanda.
 *
 * El controlador de prueba replica el camino de cache de PlantsController sin sus guards: lo
 * que se mide aquí es cache vs. PLC y el coste de serializar el DTO, no el RBAC (eso vive en
 * rbac-e2e.test.ts). Meter JwtAuthGuard solo añadiría al número el coste de verificar un JWT.
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Controller,
  Get,
  INestApplication,
  Inject,
  Module,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SimulatorBridgeAdapter } from '../src/infrastructure/connectivity/adapters/simulator/simulator-bridge.adapter';
import { PlantPipelineService } from '../src/infrastructure/connectivity/pipeline/plant-pipeline.service';
import { PlantCache } from '../src/infrastructure/connectivity/pipeline/plant-cache';
import { TankAutonomyStore } from '../src/infrastructure/connectivity/pipeline/tank-autonomy.store';
import { loadMapping } from '../src/infrastructure/connectivity/mapping/opc-mapping.loader';
import {
  CONNECTIVITY_ADAPTER,
  CONNECTIVITY_CONFIG,
} from '../src/infrastructure/connectivity/connectivity.tokens';
import type {
  ConnectivityConfig,
  OpcUaConfig,
} from '../src/infrastructure/connectivity/connectivity.config';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, timeoutMs = 4000, stepMs = 10): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await delay(stepMs);
  }
  return pred();
}

function makeConfig(): ConnectivityConfig {
  const opcua: OpcUaConfig = {
    endpoint: 'simulator://in-memory',
    endpointMustExist: false,
    securityMode: 'None',
    securityPolicy: 'None',
    identity: { type: 'anonymous' },
    autoAcceptUnknownCertificate: false,
    publishingIntervalMs: 20,
    samplingIntervalMs: 20,
    subscriptionLifetimeCount: 100,
    subscriptionMaxKeepAliveCount: 10,
    coalesceWindowMs: 20,
    watchdogTimeoutMs: 5000,
    heartbeatIntervalMs: 1000,
    heartbeatMaxFailures: 2,
    reconnectInitialDelayMs: 10,
    reconnectMaxDelayMs: 50,
    reconnectMaxRetry: 1000,
    subscriptionRecycleMaxAttempts: 2,
    staleThresholdMs: 300000,
    writesEnabled: false,
    allowInsecureWrites: false,
  };
  return {
    provider: 'simulator',
    opcua,
    liveness: { liveSec: 10, windowSec: 300, sweepMs: 1000 },
    deadLetterCapacity: 500,
  };
}

/** Contadores de todo camino del puerto que habla con el servidor bajo demanda. */
interface PlcCallCounters {
  readBufferElement: number;
  writeBufferElement: number;
  getServerInfo: number;
}

/**
 * Envuelve el adaptador real contando las llamadas que irían al PLC. No sustituye nada del
 * pipeline: el frame, el mapping y el DTO son los de producción; solo se observa el puerto.
 */
function countingAdapter(adapter: SimulatorBridgeAdapter): {
  adapter: SimulatorBridgeAdapter;
  calls: PlcCallCounters;
} {
  const calls: PlcCallCounters = { readBufferElement: 0, writeBufferElement: 0, getServerInfo: 0 };
  const proxy = new Proxy(adapter, {
    get(target, prop, receiver) {
      if (prop === 'readBufferElement' || prop === 'writeBufferElement' || prop === 'getServerInfo') {
        calls[prop as keyof PlcCallCounters]++;
        const fn = Reflect.get(target, prop, receiver) as (...a: unknown[]) => unknown;
        return (...args: unknown[]) => fn.apply(target, args);
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { adapter: proxy as SimulatorBridgeAdapter, calls };
}

/** Camino de cache de PlantsController, sin guards (ver cabecera del archivo). */
@Controller('plants')
class CacheReadController {
  constructor(
    @Inject(PlantCache) private readonly cache: PlantCache,
    @Inject(PlantPipelineService) private readonly pipeline: PlantPipelineService,
  ) {}

  @Get(':plantId/snapshot')
  snapshot(@Param('plantId') plantId: string) {
    const snapshot = this.cache.get(plantId);
    if (snapshot) return snapshot;
    const known = this.pipeline.listPlants().find((p) => p.plantId === plantId);
    if (!known) throw new NotFoundException(`planta desconocida: ${plantId}`);
    return { plantId, sequence: 0, signals: {}, pending: true };
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

test('REST /plants/:id/snapshot responde desde cache en < 50 ms y sin UNA sola lectura al PLC', async () => {
  const config = makeConfig();
  const mapping = loadMapping();
  const { adapter, calls } = countingAdapter(new SimulatorBridgeAdapter(config.opcua, mapping));
  const cache = new PlantCache();
  const pipeline = new PlantPipelineService(adapter, config, cache, new TankAutonomyStore());

  @Module({
    controllers: [CacheReadController],
    providers: [
      { provide: CONNECTIVITY_CONFIG, useValue: config },
      { provide: CONNECTIVITY_ADAPTER, useValue: adapter },
      { provide: PlantCache, useValue: cache },
      { provide: PlantPipelineService, useValue: pipeline },
    ],
  })
  class TestModule {}

  let app: INestApplication | null = null;
  try {
    app = (await Test.createTestingModule({ imports: [TestModule] }).compile()).createNestApplication();
    await app.init();

    pipeline.onModuleInit();
    await adapter.start();

    const plantId = mapping.plants[0].plantId;
    const cached = await waitFor(() => cache.get(plantId) !== undefined, 4000);
    assert.equal(cached, true, 'el pipeline debe haber poblado la cache antes de medir');

    // Una petición de calentamiento: la primera paga el arranque perezoso de Express/Nest y
    // mediría el framework, no el camino de cache.
    await request(app.getHttpServer()).get(`/plants/${plantId}/snapshot`).expect(200);

    const callsBefore = { ...calls };
    const N = 60;
    const samples: number[] = [];
    for (let i = 0; i < N; i++) {
      const t0 = process.hrtime.bigint();
      const res = await request(app.getHttpServer()).get(`/plants/${plantId}/snapshot`).expect(200);
      samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
      assert.equal(res.body.plantId, plantId);
      assert.equal(typeof res.body.sequence, 'number');
    }

    samples.sort((a, b) => a - b);
    const p95 = percentile(samples, 95);
    assert.ok(p95 < 50, `p95 = ${p95.toFixed(2)} ms (presupuesto de la Fase 2: < 50 ms)`);

    // La mitad importante: ni una lectura, escritura o consulta de metadata al PLC.
    assert.deepEqual(
      calls,
      callsBefore,
      `REST tocó el PLC: ${JSON.stringify(calls)} vs ${JSON.stringify(callsBefore)}`,
    );
    assert.equal(calls.readBufferElement, 0, 'ninguna petición REST debe leer del PLC');
  } finally {
    pipeline.onModuleDestroy();
    await adapter.stop();
    if (app) await app.close();
  }
});

test('REST desde cache NO consulta el PLC ni cuando la planta aún no tiene snapshot', async () => {
  const config = makeConfig();
  const mapping = loadMapping();
  const { adapter, calls } = countingAdapter(new SimulatorBridgeAdapter(config.opcua, mapping));
  const cache = new PlantCache();
  const pipeline = new PlantPipelineService(adapter, config, cache, new TankAutonomyStore());

  @Module({
    controllers: [CacheReadController],
    providers: [
      { provide: CONNECTIVITY_CONFIG, useValue: config },
      { provide: CONNECTIVITY_ADAPTER, useValue: adapter },
      { provide: PlantCache, useValue: cache },
      { provide: PlantPipelineService, useValue: pipeline },
    ],
  })
  class TestModule {}

  let app: INestApplication | null = null;
  try {
    app = (await Test.createTestingModule({ imports: [TestModule] }).compile()).createNestApplication();
    await app.init();
    // A propósito SIN adapter.start(): cache vacía. El endpoint debe contestar con el
    // placeholder `pending`, nunca ir a buscar el dato al PLC para rellenar el hueco.
    pipeline.onModuleInit();

    const plantId = mapping.plants[0].plantId;
    const res = await request(app.getHttpServer()).get(`/plants/${plantId}/snapshot`).expect(200);
    assert.equal(res.body.pending, true);
    assert.equal(calls.readBufferElement, 0);
    assert.equal(calls.getServerInfo, 0);

    await request(app.getHttpServer()).get('/plants/no-existe/snapshot').expect(404);
    assert.equal(calls.readBufferElement, 0);
  } finally {
    pipeline.onModuleDestroy();
    await adapter.stop();
    if (app) await app.close();
  }
});
