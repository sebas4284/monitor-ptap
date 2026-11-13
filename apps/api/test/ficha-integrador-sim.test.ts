import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { PlantPipelineService } from '../src/infrastructure/connectivity/pipeline/plant-pipeline.service';
import { PlantCache } from '../src/infrastructure/connectivity/pipeline/plant-cache';
import { TankAutonomyStore } from '../src/infrastructure/connectivity/pipeline/tank-autonomy.store';
import { Logger } from '@nestjs/common';
import type { OpcUaConfig, ConnectivityConfig } from '../src/infrastructure/connectivity/connectivity.config';
import { SimulatorBridgeAdapter } from '../src/infrastructure/connectivity/adapters/simulator/simulator-bridge.adapter';
import { leerEscenario, opcionesDesdeEscenario, resolverRutaEscenario, validarEscenarioContraMapping } from '../src/infrastructure/connectivity/adapters/simulator/sim-scenario';
import { loadMapping } from '../src/infrastructure/connectivity/mapping/opc-mapping.loader';
import type { RawPlantFrame } from '../src/infrastructure/connectivity/ports/connectivity-adapter.port';
import { CommandMappingResolver } from '../src/modules/commands/command-mapping.resolver';
import type { CommandLogRepository, StoredCommand } from '../src/modules/commands/command-log.repository';
import type { AuditLogService } from '../src/infrastructure/audit/audit-log.service';
import type { CommandSignatureService } from '../src/modules/commands/command-signature.service';
import type { NotificationRepository } from '../src/modules/notifications/notification.repository';
import type { CommandActor } from '../src/modules/commands/command.dto';
import { WriteService } from '../src/modules/commands/write.service';

const API = join(__dirname, '..');
const MAPPING_PATH = join(API, 'config', 'opc_mapping.json');
process.env.OPC_MAPPING_PATH = MAPPING_PATH;
const MAPPING = loadMapping(MAPPING_PATH);
Logger.overrideLogger(false);

function opcuaConfig(): OpcUaConfig {
  return {
    endpoint: 'simulator://in-memory', endpointMustExist: false,
    securityMode: 'SignAndEncrypt', securityPolicy: 'Basic256Sha256',
    identity: { type: 'username', userName: 'simulator-test', password: 'simulator-test' },
    autoAcceptUnknownCertificate: false, publishingIntervalMs: 50, samplingIntervalMs: 50,
    subscriptionLifetimeCount: 100, subscriptionMaxKeepAliveCount: 10, coalesceWindowMs: 5,
    watchdogTimeoutMs: 5_000, heartbeatIntervalMs: 5_000, heartbeatMaxFailures: 2,
    reconnectInitialDelayMs: 10, reconnectMaxDelayMs: 50, reconnectMaxRetry: 2,
    subscriptionRecycleMaxAttempts: 2, staleThresholdMs: 60_000,
    writesEnabled: true, allowInsecureWrites: false,
  };
}

const config: ConnectivityConfig = {
  provider: 'simulator', opcua: opcuaConfig(),
  liveness: { liveSec: 10, windowSec: 60, sweepMs: 1_000 }, deadLetterCapacity: 20,
};

const operatorConfig: ConnectivityConfig = {
  ...config,
  liveness: { liveSec: 10, windowSec: 300, sweepMs: 100 },
};

function opcionesProduccionPrueba() {
  const scenario = leerEscenario(resolverRutaEscenario('produccion'));
  const options = opcionesDesdeEscenario(scenario);
  // Retain the production mapping/scenario semantics but shorten clocks for this in-memory test only.
  return {
    ...options,
    ioLatencyMs: 0,
    defaults: { ...options.defaults, travelMs: 0, msgCycleMs: 0, msgPhaseMs: 0, feedbackCycleMs: 0, feedbackPhaseMs: 0 },
    plants: Object.fromEntries(Object.keys(options.plants).map((plantId) => [plantId, { msgCycleMs: 0, msgPhaseMs: 0, feedbackCycleMs: 0, feedbackPhaseMs: 0 }])),
    initialValues: { ...options.initialValues, 'cabuyo/INT_OUT_CABUYO[0]': 512 },
  };
}

function writableSignals() {
  return MAPPING.signals.filter((signal) => signal.writable && signal.write);
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return predicate();
}

test('scenario produccion emite todos los buffers mapeados y deja sin telemetría las plantas sin integración', async (t) => {
  const scenario = leerEscenario(resolverRutaEscenario('produccion'));
  const options = opcionesProduccionPrueba();
  assert.equal(scenario.escenario.name, 'produccion');
  assert.equal(scenario.rutaMapping, MAPPING_PATH);
  assert.deepEqual(validarEscenarioContraMapping(options, MAPPING), []);
  assert.equal(MAPPING.plants.length, 16);

  const targetPlants = new Set(MAPPING.targets.map((target) => target.plantId));
  const expectedFramePlants = [...targetPlants].sort();
  const pendingPlants = MAPPING.plants.filter((plant) => !targetPlants.has(plant.plantId)).map((plant) => plant.plantId).sort();
  assert.deepEqual(pendingPlants, ['gloria', 'leonera', 'luisa']);
  const frames = new Map<string, RawPlantFrame>();
  const adapter = new SimulatorBridgeAdapter(opcuaConfig(), MAPPING, options);
  const cache = new PlantCache();
  const pipeline = new PlantPipelineService(adapter, operatorConfig, cache, new TankAutonomyStore());
  pipeline.onModuleInit();
  adapter.onFrame((frame) => frames.set(frame.plantId, frame));
  t.after(async () => { pipeline.onModuleDestroy(); await adapter.stop(); });
  await adapter.start();

  assert.equal(await waitFor(() => expectedFramePlants.every((plantId) => frames.has(plantId))), true,
    `deben llegar frames por todas las plantas con buffers: ${expectedFramePlants.join(', ')}`);
  assert.deepEqual([...frames.keys()].sort(), expectedFramePlants);
  for (const plantId of expectedFramePlants) {
    const frame = frames.get(plantId)!;
    const expected = MAPPING.targets.filter((target) => target.plantId === plantId).map((target) => target.browseName).sort();
    assert.deepEqual(frame.buffers.map((buffer) => buffer.browseName).sort(), expected, `${plantId}: buffers de su mapping`);
    assert.ok(frame.buffers.every((buffer) => buffer.quality === 'Good' && buffer.sourceTimestamp), `${plantId}: muestras simuladas completas`);
  }
  assert.equal(await waitFor(() => MAPPING.plants.every((plant) => cache.get(plant.plantId) !== null)), true,
    'el pipeline procesa muestras del simulador para el catálogo');
  const bufferOnlyPlants = ['san-antonio', 'quijote'];
  for (const plant of MAPPING.plants) {
    const snapshot = cache.get(plant.plantId)!;
    const expectedSignals = MAPPING.signals.filter((signal) => signal.plantId === plant.plantId).map((signal) => signal.domainKey).sort();
    assert.deepEqual(Object.keys(snapshot.signals).sort(), expectedSignals, `${plant.plantId}: signals derivadas de su mapping`);
    if (pendingPlants.includes(plant.plantId)) {
      assert.equal(frames.has(plant.plantId), false, `${plant.plantId}: no fabricar frames ni datos`);
      assert.equal(snapshot.integrationPending, true);
      assert.equal(snapshot.liveness.state, 'frozen');
      assert.deepEqual(snapshot.signals, {});
    }
    if (bufferOnlyPlants.includes(plant.plantId)) assert.deepEqual(snapshot.signals, {}, `${plant.plantId}: los buffers sin señales declaradas no inventan telemetría`);
  }

  const cabuyoRaw = frames.get('cabuyo')!.buffers.find((buffer) => buffer.browseName === 'REAL_IN_CABUYO')!;
  const cabuyoSnapshot = cache.get('cabuyo')!;
  // Índices de lectura entregados en la ficha, independientes del orden de señales del mapping.
  for (const [domainKey, index] of [['inletFlow1', 0], ['outletFlow1', 7], ['inletPressure1', 12], ['valve1Position', 16]] as const) {
    assert.equal(cabuyoSnapshot.signals[domainKey].value, cabuyoRaw.values[index], `${domainKey}: conserva el valor del índice entregado`);
  }

  const report = adapter.getSimulationReport();
  assert.deepEqual(report.valves.map(({ plantId, domainKey }) => `${plantId}/${domainKey}`).sort(),
    writableSignals().map(({ plantId, domainKey }) => `${plantId}/${domainKey}`).sort(),
    'el simulador cubre todas y solo las válvulas que el mapping permite accionar');
  assert.equal(report.valves.some((valve) => valve.plantId === 'cabuyo' && valve.domainKey === 'valve1Position'), false,
    'la válvula proporcional de salida no tiene consigna y permanece bloqueada');
});

test('WriteService acciona en el simulador la válvula de entrada de Cabuyo y conserva bits ajenos; rechaza la salida', async (t) => {
  const options = opcionesProduccionPrueba();
  const adapter = new SimulatorBridgeAdapter(opcuaConfig(), MAPPING, options);
  const cache = new PlantCache();
  const pipeline = new PlantPipelineService(adapter, operatorConfig, cache, new TankAutonomyStore());
  pipeline.onModuleInit();
  const frames: RawPlantFrame[] = [];
  adapter.onFrame((frame) => frames.push(frame));
  t.after(async () => { pipeline.onModuleDestroy(); await adapter.stop(); });
  await adapter.start();
  assert.equal(await waitFor(() => frames.some((frame) => frame.plantId === 'cabuyo')), true, 'llega telemetría simulada de Cabuyo');
  assert.equal(await waitFor(() => cache.get('cabuyo')?.liveness.state === 'live'), true, 'la muestra simulada habilita el interlock por datos frescos');
  let id = 1;
  const repository = {
    reserve: async () => ({ reserved: true, id: id++ }),
    finalize: async () => undefined,
    findByIdempotencyKey: async () => null as StoredCommand | null,
  } as unknown as CommandLogRepository;
  const audit = { record: async () => undefined } as unknown as AuditLogService;
  const signature = { firmar: async (_id: number, _name: string | null, finalize?: () => Promise<void>) => { await finalize?.(); return 'test-signature'; } } as unknown as CommandSignatureService;
  const notifications = { create: async () => true } as unknown as NotificationRepository;

  const oldMappingPath = process.env.OPC_MAPPING_PATH;
  process.env.OPC_MAPPING_PATH = MAPPING_PATH;
  try {
    const service = new WriteService(adapter, config, cache, new CommandMappingResolver(), repository, audit, signature, notifications);
    const actor: CommandActor = { userId: 'sim-user', userName: 'Simulación', userEmail: 'sim@example.test', role: 'operador', ip: '127.0.0.1' };
    const blocked = await service.execute('cabuyo', { command: 'open', target: 'valve1Position' }, actor);
    assert.equal(blocked.status, 'rejected');
    assert.equal(adapter.getWriteHistory().length, 0, 'la válvula proporcional no genera escritura');

    const open = await service.execute('cabuyo', { command: 'open', target: 'valve2' }, actor);
    assert.equal(open.status, 'sent', 'el código envía la orden pero no afirma que la posición real quedó verificada');
    const opened = adapter.getSimulatedValve('cabuyo', 'valve2');
    assert.equal(opened?.state, 'open');

    const close = await service.execute('cabuyo', { command: 'close', target: 'valve2' }, actor);
    assert.equal(close.status, 'sent');
    assert.equal(adapter.getSimulatedValve('cabuyo', 'valve2')?.state, 'closed');

    const writes = adapter.getWriteHistory().filter((write) => write.plantId === 'cabuyo' && write.sourceBuffer === 'INT_OUT_CABUYO' && write.index === 0);
    assert.ok(writes.some((write) => write.value === 516), 'abre con bit 2 y preserva bit ajeno 9');
    assert.ok(writes.some((write) => write.value === 520), 'cierra con bit 3 y preserva bit ajeno 9');
    assert.ok(writes.every((write) => (Number(write.value) & 12) !== 12), 'nunca activa abrir y cerrar simultáneamente');
    assert.equal(adapter.getViolations().length, 0);
    const cabuyoFrame = frames.filter((frame) => frame.plantId === 'cabuyo').at(-1)!;
    const readBack = cabuyoFrame.buffers.find((buffer) => buffer.browseName === 'INT_IN_CABUYO')!;
    assert.equal((Number(readBack.values[1]) & 3), 2, 'el cierre simulado vuelve al estado cerrado del read-back');
  } finally {
    if (oldMappingPath === undefined) delete process.env.OPC_MAPPING_PATH;
    else process.env.OPC_MAPPING_PATH = oldMappingPath;
  }
});
