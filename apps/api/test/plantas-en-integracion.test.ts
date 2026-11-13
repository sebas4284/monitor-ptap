/**
 * Alta de las 4 plantas nuevas: Cabuyo, La Luisa, La Leonera y Gloria (2026-10-19).
 *
 * El cliente las pidió y TODAVÍA NO ESTÁN EN EL PLC maestro: el browse del 2026-07-12 no trae ningún tag
 * suyo, y sin buffer, NodeId ni índice no hay señal que mapear sin inventarla. Se dan de alta SIN
 * señales —`opcBuffers: {}`, `connection` unmapped con DN/ER/TO en null, `signals: []`— para que la app
 * las muestre como lo que son, y para que conectarlas el día que el integrador las suba sea un cambio
 * solo de datos (docs/plc/PLANTAS_NUEVAS_CABUYO_LUISA_LEONERA_GLORIA.md).
 *
 * 2026-11-10: Cabuyo SALIÓ de integración con la ficha del integrador (Brayan Grueso, Telcobras): ya
 * tiene buffers, señales y la válvula de entrada, y command-mapping.test.ts cuenta 11 plantas con canal.
 * La Luisa, La Leonera y Gloria siguen pendientes (`PENDIENTES`), y este archivo fija para ellas lo
 * mismo que antes; para Cabuyo, que dejó de estarlo sin romper nada.
 *
 * Ninguna planta tenía antes `opcBuffers: {}`, así que este archivo fija dos cosas:
 *  1. el mapping de producción declara así a las pendientes —ni buffers, ni señales, ni válvulas
 *     inventadas— y a Cabuyo con los datos del integrador;
 *  2. una planta sin buffers recorre el sistema entero sin romperlo y sin mentir: validador, loader,
 *     namespaces, adaptador OPC UA (contra un servidor LOCAL, nunca contra el PLC), simulador, pipeline,
 *     detectores de avisos, /api/plants y el registro.
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { DataType, MessageSecurityMode, OPCUAServer, SecurityPolicy, VariantArrayType } from 'node-opcua';
import { loadJson, validateMapping } from '../scripts/validate-mapping';
import { loadMapping, type MonitorTarget } from '../src/infrastructure/connectivity/mapping/opc-mapping.loader';
import { collectNsUris, resolveNamespaces } from '../src/infrastructure/connectivity/opcua/namespace-resolver';
import { OpcUaConnectivityAdapter } from '../src/infrastructure/connectivity/adapters/opcua/opcua-connectivity.adapter';
import { SimulatorBridgeAdapter } from '../src/infrastructure/connectivity/adapters/simulator/simulator-bridge.adapter';
import { opcionesPorDefecto } from '../src/infrastructure/connectivity/adapters/simulator/sim-scenario';
import { PlantPipelineService } from '../src/infrastructure/connectivity/pipeline/plant-pipeline.service';
import { PlantCache } from '../src/infrastructure/connectivity/pipeline/plant-cache';
import { TankAutonomyStore } from '../src/infrastructure/connectivity/pipeline/tank-autonomy.store';
import type { ConnectivityConfig, OpcUaConfig } from '../src/infrastructure/connectivity/connectivity.config';
import type { BridgeStatus, ConnectivityAdapter } from '../src/infrastructure/connectivity/ports/connectivity-adapter.port';
import type { PlantSnapshotDto } from '../src/infrastructure/connectivity/pipeline/plant-snapshot.dto';
import { StaleDataDetector } from '../src/modules/notifications/stale-data.detector';
import { TankOverflowDetector } from '../src/modules/notifications/tank-overflow.detector';
import { TankAutonomyDetector } from '../src/modules/notifications/tank-autonomy.detector';
import { ValveStateObserver } from '../src/modules/notifications/valve-state.observer';
import type { NewNotification, NotificationRepository } from '../src/modules/notifications/notification.repository';
import type { FlowHourlyRepository } from '../src/modules/notifications/flow-hourly.repository';
import type { AuditLogService } from '../src/infrastructure/audit/audit-log.service';
import type { CommandLogRepository } from '../src/modules/commands/command-log.repository';
import { PlantsController } from '../src/modules/plants/plants.controller';
import type { AuthenticatedRequest } from '../src/modules/auth/authenticated-request';
import { registerSchema } from '../src/modules/auth/dto/register.dto';

Logger.overrideLogger(false);

const RUTA_MAPPING = join(__dirname, '..', 'config', 'opc_mapping.json');
const RUTA_SCHEMA = join(__dirname, '..', 'config', 'opc_mapping.schema.json');
const RUTA_FICHA = join(__dirname, '..', '..', '..', 'docs', 'plc', 'PLANTAS_NUEVAS_CABUYO_LUISA_LEONERA_GLORIA.md');

/** Slug → nombre provisional, en el orden en que el cliente las nombró. El slug va sin artículo. */
const NUEVAS: Record<string, string> = { cabuyo: 'Cabuyo', luisa: 'La Luisa', leonera: 'La Leonera', gloria: 'Gloria' };
const IDS = Object.keys(NUEVAS);
/** Las que ya salieron de integración: tienen buffers y señales del integrador. */
const INTEGRADAS = ['cabuyo'];
/** Las que siguen EN INTEGRACIÓN: sin buffers ni señales. */
const PENDIENTES = IDS.filter((id) => !INTEGRADAS.includes(id));

/** Las 12 que ya estaban, en su orden. El slug es identidad permanente: users.plant, command_log, avisos. */
const EN_OPERACION = [
  'voragine', 'soledad', 'montebello', 'cascajal', 'km18', 'alto-los-mangos',
  'campoalegre', 'pichinde', 'carbonero', 'sirena', 'san-antonio', 'quijote',
];
/** Todas las que tienen buffers de datos: las 12 de siempre y las ya integradas. */
const CON_BUFFERS = [...EN_OPERACION, ...INTEGRADAS];

/** 48414 y 48433 son de otros tests de servidor local, y los archivos de test corren en paralelo. */
const PUERTO = 48447;

interface PlantaCruda {
  plantId: string;
  displayName: string;
  displayNameProvisional?: boolean;
  topologyVerified?: boolean;
  opcBuffers?: Record<string, { browseName?: string }[]>;
  connection?: Record<string, unknown>;
  signals?: { domainKey?: string; writable?: boolean }[];
}

function produccion(): { notes: string[]; plants: PlantaCruda[]; generatedFrom: { namespaces: string[] } } {
  return loadJson(RUTA_MAPPING) as { notes: string[]; plants: PlantaCruda[]; generatedFrom: { namespaces: string[] } };
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, timeoutMs = 10_000, stepMs = 20): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await delay(stepMs);
  }
  return pred();
}

// ── 1. El mapping de producción ─────────────────────────────────────────────────────────────────

test('mapping de PRODUCCIÓN: las 4 plantas nuevas existen, al final y en el orden en que el cliente las nombró', () => {
  const prod = produccion();
  assert.equal(prod.plants.length, 16, '12 en operación + 4 en integración');
  assert.deepEqual(prod.plants.slice(0, 12).map((p) => p.plantId), EN_OPERACION, 'las de siempre no se movieron');
  assert.deepEqual(prod.plants.slice(-4).map((p) => p.plantId), IDS);
  for (const p of prod.plants.slice(-4)) {
    assert.equal(p.displayName, NUEVAS[p.plantId]);
    assert.equal(p.displayNameProvisional, true, `${p.plantId}: el nombre es provisional hasta que la planta lo confirme por escrito`);
  }
});

test('mapping de PRODUCCIÓN: las pendientes, sin buffers, sin señales, sin válvulas y con connection unmapped — nada inventado', () => {
  const prod = produccion();
  for (const id of PENDIENTES) {
    const p = prod.plants.find((x) => x.plantId === id);
    assert.ok(p, `${id} debe existir`);
    assert.deepEqual(p.opcBuffers, {}, `${id}: sin tags en el PLC no hay buffer que declarar`);
    assert.deepEqual(p.signals, [], `${id}: sin índice no hay señal`);
    assert.deepEqual(
      p.connection,
      { done: null, error: null, timeout: null, mappingStatus: 'unmapped', confidence: 'estimated' },
      `${id}: sin MSG_READ no hay DN/ER/TO que leer`,
    );
    assert.equal(p.topologyVerified, undefined, `${id}: nadie ha hecho browse de su topología`);
  }
  // La nota del mapping cuenta por qué y remite a la ficha del integrador, que tiene que existir.
  const nota = prod.notes.find((n) => IDS.every((id) => n.includes(id)));
  assert.ok(nota, 'una nota del mapping explica el alta de las 4');
  assert.match(nota, /docs\/plc\/PLANTAS_NUEVAS_CABUYO_LUISA_LEONERA_GLORIA\.md/);
  assert.match(nota, /cabuyo \(Cabuyo\) quedó INTEGRADA el 2026-11-10/, 'la nota dice que Cabuyo ya salió de integración');
  assert.ok(existsSync(RUTA_FICHA), 'la ficha a la que remite la nota existe');
});

test('mapping de PRODUCCIÓN: Cabuyo salió de integración con los 6 tags del integrador y connection aún unmapped (DN/ER/TO pendientes)', () => {
  const cabuyo = produccion().plants.find((p) => p.plantId === 'cabuyo');
  assert.ok(cabuyo);
  const nombres = Object.fromEntries(
    Object.entries(cabuyo.opcBuffers ?? {}).map(([canal, bufs]) => [canal, bufs.map((b) => b.browseName)]),
  );
  assert.deepEqual(nombres, {
    realIn: ['REAL_IN_CABUYO'],
    intIn: ['INT_IN_CABUYO'],
    intOut: ['INT_OUT_CABUYO'],
    msgRead: ['MSG_READ_CABUYO', 'MSG_READ_INT_CABUYO'],
    msgWrite: ['MSG_WRITE_INT_CABUYO'],
  });
  // Sin lectura del PLC no hay GUID de DN/ER/TO: la MSG primaria se nombra, pero no se inventa su estado.
  assert.deepEqual(cabuyo.connection, {
    sourceBuffer: 'MSG_READ_CABUYO', done: null, error: null, timeout: null, mappingStatus: 'unmapped', confidence: 'estimated',
  });
  assert.deepEqual(
    (cabuyo.signals ?? []).map((s) => s.domainKey).sort(),
    ['inletFlow1', 'inletPressure1', 'outletFlow1', 'valve1Position', 'valve2', 'valve2State'],
  );
});

test('mapping de PRODUCCIÓN: conCanal en 11 — Cabuyo tiene intOut/intIn y su válvula de entrada; las pendientes, ni canal ni válvula', () => {
  // La misma cuenta que command-mapping.test.ts: solo una planta con buffers intOut e intIn puede tener
  // válvula. Darles una a las pendientes antes de que existan sus tags escribiría en un buffer que no
  // existe. Al integrar Cabuyo (2026-11-10) las listas fijas de allí se actualizaron a mano.
  const prod = produccion();
  const conCanal = prod.plants.filter((p) => p.opcBuffers?.intOut?.[0] && p.opcBuffers?.intIn?.[0]).map((p) => p.plantId);
  assert.equal(conCanal.length, 11);
  const writables = prod.plants.flatMap((p) =>
    (p.signals ?? []).filter((s) => s.writable === true).map((s) => `${p.plantId}/${s.domainKey}`),
  );
  for (const id of PENDIENTES) {
    assert.ok(!conCanal.includes(id), `${id}: sin canal de comando`);
    assert.ok(!writables.some((w) => w.startsWith(`${id}/`)), `${id}: ninguna válvula escribible`);
  }
  assert.ok(conCanal.includes('cabuyo'), 'cabuyo: con canal de comando');
  assert.deepEqual(writables.filter((w) => w.startsWith('cabuyo/')), ['cabuyo/valve2'], 'cabuyo: solo la de entrada; la salida es Fase 4');
});

// ── 2. De punta a punta: una planta sin buffers no rompe nada ni dice lo que no es ───────────────

test('validate:mapping, loadMapping() y la resolución de namespaces aceptan una planta sin buffers', () => {
  const schema = loadJson(RUTA_SCHEMA) as object;
  const prod = produccion();
  assert.deepEqual(validateMapping(schema, prod).errors, [], 'opcBuffers: {} y connection en null son válidos');

  const cargado = loadMapping(RUTA_MAPPING);
  assert.equal(cargado.plants.length, 16);
  for (const id of PENDIENTES) {
    assert.deepEqual(cargado.plants.find((p) => p.plantId === id), { plantId: id, displayName: NUEVAS[id], livenessWindowSec: null });
    assert.equal(cargado.targets.filter((t) => t.plantId === id).length, 0, `${id}: nada que suscribir`);
    assert.equal(cargado.signals.filter((s) => s.plantId === id).length, 0, `${id}: nada que extraer`);
  }
  // Cabuyo: sus 3 buffers de datos (las MSG no se suscriben) y sus 6 señales.
  assert.deepEqual(cargado.targets.filter((t) => t.plantId === 'cabuyo').map((t) => t.browseName).sort(), ['INT_IN_CABUYO', 'INT_OUT_CABUYO', 'REAL_IN_CABUYO']);
  assert.equal(cargado.signals.filter((s) => s.plantId === 'cabuyo').length, 6);
  // Las que tienen buffers: la regla de liveness de las plantas sin buffers no las toca.
  for (const id of CON_BUFFERS) {
    assert.ok(cargado.targets.some((t) => t.plantId === id), `${id} tiene al menos un buffer de datos`);
  }
  // Una referencia en null no aporta namespace: el servidor sigue necesitando solo AQUATECH4.
  assert.deepEqual(collectNsUris(prod as never), ['AQUATECH4']);
  assert.deepEqual([...resolveNamespaces(prod.generatedFrom.namespaces, prod as never).keys()], ['AQUATECH4']);
});

/** Lo que el servidor local publica en cada buffer del mapping: su tipo y su tamaño, a cero. */
function variableDe(t: MonitorTarget): { dataType: DataType; nombreTipo: 'Float' | 'Int16' | 'Boolean'; largo: number; valor: Float32Array | Int16Array | boolean[] } {
  const largo = t.arrayLength ?? 16;
  if (t.dataType === 'Float') return { dataType: DataType.Float, nombreTipo: 'Float', largo, valor: new Float32Array(largo) };
  if (t.dataType === 'Boolean') return { dataType: DataType.Boolean, nombreTipo: 'Boolean', largo, valor: new Array<boolean>(largo).fill(false) };
  return { dataType: DataType.Int16, nombreTipo: 'Int16', largo, valor: new Int16Array(largo) };
}

function opcuaLocal(): OpcUaConfig {
  return {
    endpoint: `opc.tcp://127.0.0.1:${PUERTO}`,
    endpointMustExist: false,
    securityMode: 'None',
    securityPolicy: 'None',
    identity: { type: 'anonymous' },
    autoAcceptUnknownCertificate: true,
    publishingIntervalMs: 100,
    samplingIntervalMs: 100,
    subscriptionLifetimeCount: 100,
    subscriptionMaxKeepAliveCount: 10,
    coalesceWindowMs: 50,
    watchdogTimeoutMs: 30_000,
    heartbeatIntervalMs: 10_000,
    heartbeatMaxFailures: 3,
    reconnectInitialDelayMs: 100,
    reconnectMaxDelayMs: 500,
    reconnectMaxRetry: 1,
    subscriptionRecycleMaxAttempts: 2,
    staleThresholdMs: 300_000,
    writesEnabled: false,
    allowInsecureWrites: false,
  };
}

function conectividad(opcua: OpcUaConfig): ConnectivityConfig {
  return { provider: 'opcua', opcua, liveness: { liveSec: 10, windowSec: 300, sweepMs: 50 }, deadLetterCapacity: 500 } as ConnectivityConfig;
}

/** Los cuatro detectores de avisos con repositorios en memoria, y sus `logger.error` espiados. */
function detectores(pipeline: PlantPipelineService, cache: PlantCache) {
  const avisos: NewNotification[] = [];
  const auditoria: { detail?: Record<string, unknown> }[] = [];
  const repo = {
    create: async (n: NewNotification) => {
      avisos.push(n);
      return true;
    },
    purgeOlderThan: async () => 0,
  } as unknown as NotificationRepository;
  const flujo = { upsert: async () => undefined, promedio: async () => null, purgeOlderThan: async () => 0 } as unknown as FlowHourlyRepository;
  const audit = {
    record: async (e: { detail?: Record<string, unknown> }) => {
      auditoria.push(e);
    },
    listByEventType: async () => [],
  } as unknown as AuditLogService;
  const comandos = { huboOrdenReciente: async () => false } as unknown as CommandLogRepository;
  const store = new TankAutonomyStore();
  const todos = {
    frescura: new StaleDataDetector(pipeline, cache, repo),
    tanques: new TankOverflowDetector(pipeline, cache, repo),
    autonomia: new TankAutonomyDetector(pipeline, cache, repo, flujo, store),
    valvulas: new ValveStateObserver(pipeline, cache, audit, repo, comandos),
  };
  // Cada barrido atrapa sus excepciones y solo las registra (un fallo no puede tumbar el backend). Sin
  // espiar el log, un barrido que reventara al llegar a una planta nueva pasaría este test en verde.
  const errores: string[] = [];
  for (const d of Object.values(todos)) {
    (d as unknown as { logger: { error: (m: unknown) => void } }).logger.error = (m: unknown) => {
      errores.push(String(m));
    };
  }
  return { ...todos, avisos, auditoria, store, errores };
}

function peticionDe(role: 'admin' | 'operador', plant: string): AuthenticatedRequest {
  return { user: { id: 'u-test', name: 'TEST', email: 'test@ptap.co', role, plant } } as unknown as AuthenticatedRequest;
}

test(
  'adaptador OPC UA contra un servidor LOCAL con los buffers de producción: conecta, no suscribe nada de las pendientes, Cabuyo llega como las demás, y pipeline, avisos y /api/plants las tratan bien',
  { timeout: 90_000 },
  async () => {
    const mapping = loadMapping(RUTA_MAPPING);

    // Servidor LOCAL (127.0.0.1) que emula el maestro: cada buffer de datos del mapping de producción,
    // con su GUID, tipo y tamaño. Nunca el PLC.
    const server = new OPCUAServer({
      port: PUERTO,
      hostname: '127.0.0.1',
      securityModes: [MessageSecurityMode.None],
      securityPolicies: [SecurityPolicy.None],
      allowAnonymous: true,
    });
    await server.initialize();
    const espacio = server.engine.addressSpace!;
    const ns = espacio.registerNamespace('AQUATECH4');
    for (const t of mapping.targets) {
      const v = variableDe(t);
      ns.addVariable({
        organizedBy: espacio.rootFolder.objects,
        browseName: t.browseName,
        nodeId: t.node.identifier,
        dataType: v.nombreTipo,
        valueRank: 1,
        arrayDimensions: [v.largo],
        accessLevel: 'CurrentRead',
        userAccessLevel: 'CurrentRead',
        value: { dataType: v.dataType, arrayType: VariantArrayType.Array, value: v.valor },
      });
    }
    await server.start();

    const opcua = opcuaLocal();
    const adapter = new OpcUaConnectivityAdapter(opcua, mapping);
    const conFrame = new Set<string>();
    adapter.onFrame((f) => conFrame.add(f.plantId));
    const cache = new PlantCache();
    const pipeline = new PlantPipelineService(adapter, conectividad(opcua), cache, new TankAutonomyStore());
    pipeline.onModuleInit();

    try {
      await adapter.start();
      assert.equal(adapter.getBridgeStatus(), 'Connected');
      assert.equal(await waitFor(() => CON_BUFFERS.every((id) => conFrame.has(id)), 20_000), true, 'llegan frames de todas las plantas con buffers, Cabuyo incluida');

      // El adaptador: un MonitoredItem por buffer de datos —ni uno para las pendientes— y ninguno roto.
      const diag = adapter.getDiagnostics();
      assert.equal(diag.monitoredItemCount, mapping.targets.length);
      assert.equal(diag.buffersFaulted, 0);
      assert.equal(diag.perPlant.find((p) => p.plantId === 'cabuyo')?.buffersTotal, 3, 'cabuyo: sus 3 buffers de datos suscritos');
      for (const id of PENDIENTES) {
        assert.deepEqual(diag.perPlant.find((p) => p.plantId === id), { plantId: id, lastFrameAt: null, buffersTotal: 0, buffersFaulted: 0 });
        assert.equal(conFrame.has(id), false, `${id}: ningún frame`);
        assert.deepEqual(adapter.getBufferHealth().filter((b) => b.plantId === id), []);
      }

      // El pipeline: un snapshot por planta, vacío y en frozen — nunca ESTABLE, que diría «enviando datos».
      assert.equal(await waitFor(() => IDS.every((id) => cache.get(id))), true, 'el barrido de liveness les crea snapshot');
      for (const id of PENDIENTES) {
        const s = cache.get(id)!;
        assert.equal(s.displayName, NUEVAS[id]);
        assert.deepEqual(s.signals, {});
        assert.equal(s.bridgeStatus, 'Connected');
        assert.equal(s.liveness.state, 'frozen', `${id}: sin buffers no llega nada, y el tablero no puede decir otra cosa`);
        assert.equal(s.integrationPending, true, `${id}: frozen POR integración, no por caída`);
      }
      for (const p of pipeline.listPlants().filter((x) => CON_BUFFERS.includes(x.plantId))) {
        assert.notEqual(p.liveness.state, 'frozen', `${p.plantId}: con buffers conserva el beneficio de la duda del arranque`);
        assert.equal('integrationPending' in p, false, `${p.plantId}: conectada, el campo ni viaja`);
        assert.equal('integrationPending' in cache.get(p.plantId)!, false);
      }
      // Cabuyo: su snapshot trae sus señales, ya no un cascarón vacío.
      assert.deepEqual(
        Object.keys(cache.get('cabuyo')!.signals).sort(),
        ['inletFlow1', 'inletPressure1', 'outletFlow1', 'valve1Position', 'valve2', 'valve2State'],
      );
      assert.equal(pipeline.getDeadLetter().recent.filter((e) => PENDIENTES.includes(e.plantId)).length, 0, 'sin señales no hay dead-letters');

      // Los avisos: los cuatro detectores recorren listPlants() y no dicen nada de las nuevas.
      const d = detectores(pipeline, cache);
      await d.frescura.sweep();
      await d.tanques.sweep();
      await d.autonomia.sweep();
      await d.valvulas.sweep();
      assert.deepEqual(d.errores, [], 'ningún barrido reventó');
      for (const id of PENDIENTES) {
        assert.deepEqual(d.avisos.filter((n) => n.plantId === id), [], `${id}: ningún aviso`);
        assert.equal(d.auditoria.filter((e) => String(e.detail?.clave ?? '').startsWith(`${id}/`)).length, 0);
        assert.deepEqual(d.store.get(id), [], `${id}: sin tanque no hay autonomía`);
      }

      // /api/plants: el admin las ve con las demás; un operador de Gloria, solo la suya.
      const rest = new PlantsController(pipeline, cache);
      const todas = rest.list(peticionDe('admin', 'montebello')).plants;
      assert.deepEqual(todas.map((p) => p.plantId), [...EN_OPERACION, ...IDS]);
      assert.deepEqual(rest.list(peticionDe('operador', 'gloria')).plants.map((p) => p.plantId), ['gloria']);
      for (const id of PENDIENTES) {
        const basico = rest.basicStatus(id);
        assert.equal(basico.waterAvailable, null, `${id}: sin tanque mapeado, nunca un falso «hay agua»`);
        assert.equal(basico.liveness.state, 'frozen');
        assert.equal(basico.integrationPending, true);
        assert.deepEqual(rest.snapshot(id).signals, {});
      }
      const basicoCabuyo = rest.basicStatus('cabuyo');
      assert.equal('integrationPending' in basicoCabuyo, false, 'cabuyo: ya no está en integración');
      assert.equal(basicoCabuyo.waterAvailable, null, 'cabuyo: sin tanque mapeado, nunca un falso «hay agua»');
    } finally {
      pipeline.onModuleDestroy();
      await adapter.stop();
      await server.shutdown();
    }
  },
);

test('simulador (lo que arranca CONNECTIVITY_PROVIDER=simulator): las pendientes no reciben frames ni entran al modelo de válvulas; Cabuyo sí', { timeout: 30_000 }, async () => {
  const mapping = loadMapping(RUTA_MAPPING);
  const opcua = { ...opcuaLocal(), endpoint: 'simulator://in-memory', publishingIntervalMs: 20, coalesceWindowMs: 20 };
  const config = { ...conectividad(opcua), provider: 'simulator' } as ConnectivityConfig;
  // Las mismas opciones que connectivity.module.ts sin SIM_SCENARIO.
  const adapter = new SimulatorBridgeAdapter(opcua, mapping, opcionesPorDefecto());
  const conFrame = new Set<string>();
  adapter.onFrame((f) => conFrame.add(f.plantId));
  const cache = new PlantCache();
  const pipeline = new PlantPipelineService(adapter, config, cache, new TankAutonomyStore());
  pipeline.onModuleInit();
  try {
    await adapter.start();
    assert.equal(
      await waitFor(() => CON_BUFFERS.every((id) => conFrame.has(id)) && IDS.every((id) => cache.get(id))),
      true,
      'llegan frames de todas las que tienen buffers y el pipeline crea el snapshot de las 4 nuevas',
    );
    const informe = adapter.getSimulationReport();
    const diag = adapter.getDiagnostics();
    assert.deepEqual(
      informe.valves.filter((v) => v.plantId === 'cabuyo').map((v) => v.domainKey),
      ['valve2'],
      'cabuyo: su válvula de entrada entra al modelo de válvulas (la salida no tiene mando)',
    );
    for (const id of PENDIENTES) {
      assert.equal(conFrame.has(id), false, `${id}: ningún frame`);
      assert.deepEqual(diag.perPlant.find((p) => p.plantId === id), { plantId: id, lastFrameAt: null, buffersTotal: 0, buffersFaulted: 0 });
      assert.equal(informe.plants.some((p) => p.plantId === id), false, `${id}: sin válvulas no tiene ciclo MSG simulado`);
      assert.equal(informe.valves.some((v) => v.plantId === id), false);
      const s = cache.get(id)!;
      assert.deepEqual(s.signals, {});
      assert.equal(s.liveness.state, 'frozen');
    }
    assert.ok(informe.valves.length > 0, 'el modelo de válvulas de las demás sigue en pie');
  } finally {
    pipeline.onModuleDestroy();
    await adapter.stop();
  }
});

// ── 3. integrationPending: «todavía no conectada» no se puede leer como «caída» ──────────────────
//
// Con liveness `frozen` y nada más, la app pintaba «CONGELADO · SIN CONEXIÓN» y la vista Civil
// «Reintentando automáticamente». El campo sale del MISMO criterio que la liveness (el mapping no les
// declara ningún buffer), viaja solo cuando es true y desaparece solo al declararles buffers.

/** Adaptador mínimo: solo lo que el pipeline consulta. El estado del puente lo cambia el test. */
function adaptadorFalso(inicial: BridgeStatus) {
  let estado = inicial;
  let alCambiar: (() => void) | null = null;
  const adapter = {
    onFrame: () => undefined,
    onStatusChange: (cb: () => void) => {
      alCambiar = cb;
    },
    getBridgeStatus: () => estado,
  } as unknown as ConnectivityAdapter;
  return {
    adapter,
    /** Lo que hace el puente real al cambiar de estado: avisa, y el pipeline reconstruye las 16. */
    cambiar(nuevo: BridgeStatus): void {
      estado = nuevo;
      alCambiar?.();
    },
  };
}

/** Sin barrido periódico: cada reconstrucción la provoca el test, así que las emisiones se pueden contar. */
function configSinBarrido(): ConnectivityConfig {
  return { ...conectividad(opcuaLocal()), liveness: { liveSec: 10, windowSec: 300, sweepMs: 3_600_000 } } as ConnectivityConfig;
}

test('integrationPending ANTES del primer snapshot: lista, estado básico y respuesta de espera lo traen las pendientes y ninguna con buffers', () => {
  const cache = new PlantCache();
  // Sin onModuleInit: la cache sigue vacía y el controlador responde por su camino de espera.
  const pipeline = new PlantPipelineService(adaptadorFalso('Connected').adapter, configSinBarrido(), cache, new TankAutonomyStore());
  const rest = new PlantsController(pipeline, cache);

  const lista = rest.list(peticionDe('admin', 'montebello')).plants;
  assert.deepEqual(lista.filter((p) => p.integrationPending === true).map((p) => p.plantId), PENDIENTES);
  for (const p of lista.filter((x) => CON_BUFFERS.includes(x.plantId))) {
    assert.equal('integrationPending' in p, false, `${p.plantId}: conectada, el campo ni viaja`);
  }
  // El alcance por planta no lo pierde: un operador de La Leonera ve su planta en integración.
  assert.deepEqual(rest.list(peticionDe('operador', 'leonera')).plants.map((p) => p.integrationPending), [true]);

  for (const id of PENDIENTES) {
    const espera = rest.snapshot(id);
    assert.equal(espera.pending, true, `${id}: aún sin snapshot en cache`);
    assert.equal(espera.integrationPending, true, `${id}: la respuesta de espera también lo dice`);
    const basico = rest.basicStatus(id);
    assert.equal(basico.integrationPending, true);
    assert.equal(basico.liveness.state, 'frozen', 'la liveness no cambia de semántica');
  }
  for (const id of CON_BUFFERS) {
    assert.equal('integrationPending' in rest.snapshot(id), false, `${id}: snapshot de espera sin el campo`);
    assert.equal('integrationPending' in rest.basicStatus(id), false, `${id}: estado básico sin el campo`);
  }
});

test('integrationPending EN EL SNAPSHOT: lo lleva el primero que se emite y el diff no lo pierde (es estático, fuera de la firma)', () => {
  const puente = adaptadorFalso('Connected');
  const cache = new PlantCache();
  const pipeline = new PlantPipelineService(puente.adapter, configSinBarrido(), cache, new TankAutonomyStore());
  const emitidos: PlantSnapshotDto[] = [];
  const sub = pipeline.snapshot$.subscribe((s) => emitidos.push(s));
  pipeline.onModuleInit();
  try {
    // Primera reconstrucción de las 16 (la que dispara un aviso del puente).
    puente.cambiar('Connected');
    assert.equal(emitidos.length, 16, 'un snapshot por planta');
    assert.deepEqual(emitidos.filter((s) => s.integrationPending === true).map((s) => s.plantId), PENDIENTES);
    for (const id of PENDIENTES) {
      const s = cache.get(id)!;
      assert.equal(s.integrationPending, true, `${id}: el snapshot de la cache (REST y socket) lo lleva`);
      assert.equal(s.liveness.state, 'frozen', `${id}: la liveness sigue siendo frozen`);
    }
    for (const id of CON_BUFFERS) {
      const s = cache.get(id)!;
      assert.equal('integrationPending' in s, false, `${id}: conectada, el campo ni viaja`);
      assert.notEqual(s.liveness.state, 'frozen', `${id}: con buffers, beneficio de la duda del arranque`);
    }

    // El estado básico desde la cache (toBasicStatus), que es el camino normal del Civil.
    const rest = new PlantsController(pipeline, cache);
    for (const id of PENDIENTES) assert.equal(rest.basicStatus(id).integrationPending, true);
    for (const id of CON_BUFFERS) assert.equal('integrationPending' in rest.basicStatus(id), false);

    // Cambia el puente: cambia la firma, se re-emite todo, y el campo estático sigue ahí.
    const secuenciaAntes = cache.get('leonera')!.sequence;
    emitidos.length = 0;
    puente.cambiar('Stale');
    assert.equal(emitidos.length, 16);
    assert.deepEqual(emitidos.filter((s) => s.integrationPending === true).map((s) => s.plantId), PENDIENTES);
    assert.equal(cache.get('leonera')!.sequence, secuenciaAntes + 1, 'es un snapshot NUEVO, no el de antes');

    // Mismo estado otra vez: el diff lo suprime, y la cache conserva el campo.
    emitidos.length = 0;
    puente.cambiar('Stale');
    assert.equal(emitidos.length, 0, 'sin cambios no se emite nada');
    for (const id of PENDIENTES) assert.equal(cache.get(id)!.integrationPending, true);
  } finally {
    sub.unsubscribe();
    pipeline.onModuleDestroy();
  }
});

test('registro: las 4 son plantas conocidas (isKnownPlant sale del mapping) y el slug va sin artículo', () => {
  const valido = { name: 'Ana Ruiz', email: 'ana@ptap.co', phone: '3001234567', password: 'Secreta123!' };
  for (const id of IDS) {
    assert.equal(registerSchema.safeParse({ ...valido, plant: id }).success, true, `${id} debe poder elegirse al registrarse`);
  }
  for (const inventado of ['la-luisa', 'la-leonera', 'el-cabuyo']) {
    assert.equal(registerSchema.safeParse({ ...valido, plant: inventado }).success, false, `${inventado} no es un slug del mapping`);
  }
});
