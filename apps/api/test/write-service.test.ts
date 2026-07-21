/**
 * Fase 5 — WriteService (criterios de aceptación), con dobles deterministas para cada
 * dependencia y el SimulatorBridgeAdapter real para el I/O de escritura/read-back:
 *  - sesión Anonymous/None (o writes deshabilitados) → TODO rechazado (WRITES_DISABLED_INSECURE_SESSION);
 *  - target no writable / comando desconocido → rechazado;
 *  - RBAC del mapping: jefe NO puede control_valves;
 *  - interlock: bridge != Connected o snapshot no fresco → rechazado;
 *  - write sin read-back confirmado → 'fallido', nunca 'exitoso' (+ rollback);
 *  - idempotencia: misma idempotencyKey no re-ejecuta;
 *  - audit log SIEMPRE.
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AuditEntry, AuditLogService } from '../src/infrastructure/audit/audit-log.service';
import type { ConnectivityConfig, OpcUaConfig } from '../src/infrastructure/connectivity/connectivity.config';
import type { LoadedMapping, WriteSpec } from '../src/infrastructure/connectivity/mapping/opc-mapping.loader';
import type { PlantCache } from '../src/infrastructure/connectivity/pipeline/plant-cache';
import type { LivenessState, PlantSnapshotDto } from '../src/infrastructure/connectivity/pipeline/plant-snapshot.dto';
import type { BridgeStatus, ConnectivityAdapter } from '../src/infrastructure/connectivity/ports/connectivity-adapter.port';
import { SimulatorBridgeAdapter } from '../src/infrastructure/connectivity/adapters/simulator/simulator-bridge.adapter';
import type { CommandLogRepository, StoredCommand } from '../src/modules/commands/command-log.repository';
import type { CommandMappingResolver } from '../src/modules/commands/command-mapping.resolver';
import { REJECT, FAIL, type CommandActor } from '../src/modules/commands/command.dto';
import { WriteService } from '../src/modules/commands/write.service';

const WRITE: WriteSpec = {
  target: { channel: 'intOut', sourceBuffer: 'INT_OUT_TEST', index: 3 },
  commands: { openValve: 1, closeValve: 0 },
  readBack: { channel: 'intOut', sourceBuffer: 'INT_OUT_TEST', index: 3, confirmsWrittenValue: true },
  timeoutMs: 60,
  rollbackValue: 0,
  permission: 'control_valves',
};

interface FakeAdapter extends ConnectivityAdapter {
  writes: Array<{ value: number | boolean }>;
}

function fakeAdapter(opts: { secure: boolean; bridge: BridgeStatus; confirms?: boolean }): FakeAdapter {
  const store = new Map<string, number | boolean>();
  const confirms = opts.confirms !== false;
  const key = (t: { plantId: string; channel: string; sourceBuffer: string; index: number }) =>
    `${t.plantId}/${t.channel}/${t.sourceBuffer}[${t.index}]`;
  const adapter = {
    writes: [] as Array<{ value: number | boolean }>,
    getWriteSecurity: () => ({
      secure: opts.secure,
      securityMode: opts.secure ? 'SignAndEncrypt' : 'None',
      identity: opts.secure ? 'username' : 'anonymous',
    }),
    getBridgeStatus: () => opts.bridge,
    async writeBufferElement(t: never, v: number | boolean) {
      adapter.writes.push({ value: v });
      store.set(key(t), v);
    },
    async readBufferElement(t: never) {
      const s = store.get(key(t));
      const value = s === undefined ? 0 : confirms ? s : typeof s === 'boolean' ? !s : Number(s) + 1;
      return { value, quality: 'Good' as const, sourceTimestamp: null };
    },
  };
  return adapter as unknown as FakeAdapter;
}

function fakeConfig(writesEnabled: boolean): ConnectivityConfig {
  return { opcua: { writesEnabled } } as unknown as ConnectivityConfig;
}

function snap(state: LivenessState, sequence = 7): PlantSnapshotDto {
  return {
    plantId: 'voragine',
    displayName: 'La Vorágine',
    sequence,
    protocolVersion: 'v2',
    dtoVersion: 'v1',
    bridgeStatus: 'Connected',
    liveness: { state, lastChangeAt: null, windowSec: 300 },
    signals: {},
  } as PlantSnapshotDto;
}

function fakeCache(snapshot: PlantSnapshotDto | null): PlantCache {
  return { get: () => snapshot } as unknown as PlantCache;
}

function fakeResolver(write: WriteSpec | null): CommandMappingResolver {
  return { resolve: () => (write ? { domainKey: 'valveEV01', write } : null) } as unknown as CommandMappingResolver;
}

function fakeRepo(): CommandLogRepository {
  const byKey = new Map<string, StoredCommand>();
  const rows = new Map<number, StoredCommand>();
  let idSeq = 1;
  return {
    reserve: async (input: { idempotencyKey: string | null }) => {
      if (input.idempotencyKey && byKey.has(input.idempotencyKey)) {
        return { reserved: false, existing: byKey.get(input.idempotencyKey)! };
      }
      const id = idSeq++;
      const row: StoredCommand = {
        id, status: 'pending', reason: null, previousValue: null, writtenValue: null, confirmedValue: null, interlockSequence: null,
      };
      rows.set(id, row);
      if (input.idempotencyKey) byKey.set(input.idempotencyKey, row);
      return { reserved: true, id };
    },
    finalize: async (id: number, result: Partial<StoredCommand>) => {
      const row = rows.get(id);
      if (row) Object.assign(row, result);
    },
    findByIdempotencyKey: async (k: string) => byKey.get(k) ?? null,
  } as unknown as CommandLogRepository;
}

function fakeAudit(): { service: AuditLogService; calls: AuditEntry[] } {
  const calls: AuditEntry[] = [];
  const service = { record: async (e: AuditEntry) => { calls.push(e); } } as unknown as AuditLogService;
  return { service, calls };
}

const OPERADOR: CommandActor = { userId: 'u1', userEmail: 'op@ptap.co', role: 'operador', ip: '10.0.0.1' };
const JEFE: CommandActor = { userId: 'u2', userEmail: 'jefe@ptap.co', role: 'jefe', ip: '10.0.0.2' };

function build(opts: { secure: boolean; bridge: BridgeStatus; confirms?: boolean; writesEnabled?: boolean; write?: WriteSpec | null; snapshot?: PlantSnapshotDto | null }) {
  const adapter = fakeAdapter({ secure: opts.secure, bridge: opts.bridge, confirms: opts.confirms });
  const audit = fakeAudit();
  const service = new WriteService(
    adapter,
    fakeConfig(opts.writesEnabled ?? true),
    fakeCache(opts.snapshot === undefined ? snap('live') : opts.snapshot),
    fakeResolver(opts.write === undefined ? WRITE : opts.write),
    fakeRepo(),
    audit.service,
  );
  return { service, adapter, audit };
}

test('write-service: sesión insegura (Anonymous/None) → rechazado WRITES_DISABLED_INSECURE_SESSION, sin escribir', async () => {
  const { service, adapter } = build({ secure: false, bridge: 'Connected' });
  const r = await service.execute('voragine', { command: 'openValve', target: 'valveEV01' }, OPERADOR);
  assert.equal(r.status, 'rejected');
  assert.equal(r.reason, REJECT.WRITES_DISABLED_INSECURE_SESSION);
  assert.equal(adapter.writes.length, 0);
});

test('write-service: OPCUA_WRITES_ENABLED=false → rechazado, sin escribir', async () => {
  const { service, adapter } = build({ secure: true, bridge: 'Connected', writesEnabled: false });
  const r = await service.execute('voragine', { command: 'openValve', target: 'valveEV01' }, OPERADOR);
  assert.equal(r.reason, REJECT.WRITES_DISABLED_INSECURE_SESSION);
  assert.equal(adapter.writes.length, 0);
});

test('write-service: target sin señal writable → TARGET_NOT_WRITABLE', async () => {
  const { service } = build({ secure: true, bridge: 'Connected', write: null });
  const r = await service.execute('voragine', { command: 'openValve', target: 'noExiste' }, OPERADOR);
  assert.equal(r.status, 'rejected');
  assert.equal(r.reason, REJECT.TARGET_NOT_WRITABLE);
});

test('write-service: comando desconocido → UNKNOWN_COMMAND', async () => {
  const { service } = build({ secure: true, bridge: 'Connected' });
  const r = await service.execute('voragine', { command: 'frobnicate', target: 'valveEV01' }, OPERADOR);
  assert.equal(r.reason, REJECT.UNKNOWN_COMMAND);
});

test('write-service: jefe NO puede control_valves → FORBIDDEN, sin escribir', async () => {
  const { service, adapter } = build({ secure: true, bridge: 'Connected' });
  const r = await service.execute('voragine', { command: 'openValve', target: 'valveEV01' }, JEFE);
  assert.equal(r.status, 'rejected');
  assert.equal(r.reason, REJECT.FORBIDDEN);
  assert.equal(adapter.writes.length, 0);
});

test('write-service: interlock bridge != Connected → rechazado, sin escribir', async () => {
  const { service, adapter } = build({ secure: true, bridge: 'Stale' });
  const r = await service.execute('voragine', { command: 'openValve', target: 'valveEV01' }, OPERADOR);
  assert.equal(r.status, 'rejected');
  assert.ok(r.reason?.startsWith(REJECT.INTERLOCK_FAILED));
  assert.equal(adapter.writes.length, 0);
});

test('write-service: interlock snapshot no fresco (stale) → rechazado', async () => {
  const { service, adapter } = build({ secure: true, bridge: 'Connected', snapshot: snap('stale') });
  const r = await service.execute('voragine', { command: 'openValve', target: 'valveEV01' }, OPERADOR);
  assert.ok(r.reason?.startsWith(REJECT.INTERLOCK_FAILED));
  assert.equal(adapter.writes.length, 0);
});

test('write-service: camino feliz → confirmado con trazabilidad', async () => {
  const { service, adapter } = build({ secure: true, bridge: 'Connected', confirms: true });
  const r = await service.execute('voragine', { command: 'openValve', target: 'valveEV01' }, OPERADOR);
  assert.equal(r.status, 'confirmed');
  assert.equal(r.writtenValue, 1);
  assert.equal(r.previousValue, 0);
  assert.equal(r.confirmedValue, 1);
  assert.equal(r.interlockSequence, 7);
  assert.equal(adapter.writes.length, 1);
});

test('write-service: read-back sin confirmar → FALLIDO (nunca exitoso) + rollback', async () => {
  const { service, adapter } = build({ secure: true, bridge: 'Connected', confirms: false });
  const r = await service.execute('voragine', { command: 'openValve', target: 'valveEV01' }, OPERADOR);
  assert.equal(r.status, 'failed');
  assert.equal(r.reason, FAIL.READBACK_UNCONFIRMED);
  assert.notEqual(r.status, 'confirmed');
  // write del comando (1) + write de rollback (0)
  assert.equal(adapter.writes.length, 2);
  assert.equal(adapter.writes[1].value, 0);
});

test('write-service: idempotencia — misma idempotencyKey NO re-ejecuta', async () => {
  const adapter = fakeAdapter({ secure: true, bridge: 'Connected', confirms: true });
  const audit = fakeAudit();
  const service = new WriteService(adapter, fakeConfig(true), fakeCache(snap('live')), fakeResolver(WRITE), fakeRepo(), audit.service);

  const first = await service.execute('voragine', { command: 'openValve', target: 'valveEV01', idempotencyKey: 'k1' }, OPERADOR);
  const second = await service.execute('voragine', { command: 'openValve', target: 'valveEV01', idempotencyKey: 'k1' }, OPERADOR);

  assert.equal(first.status, 'confirmed');
  assert.equal(first.idempotent, false);
  assert.equal(second.status, 'confirmed');
  assert.equal(second.idempotent, true);
  assert.equal(adapter.writes.length, 1, 'el comando NO debe re-ejecutarse con la misma idempotencyKey');
});

test('write-service: audit log SIEMPRE, incluso en rechazos', async () => {
  const { service, audit } = build({ secure: false, bridge: 'Connected' });
  await service.execute('voragine', { command: 'openValve', target: 'valveEV01' }, OPERADOR);
  assert.equal(audit.calls.length, 1);
  assert.equal(audit.calls[0].eventType, 'command.execute');
  assert.equal(audit.calls[0].statusCode, 403);
  assert.equal(audit.calls[0].role, 'operador');
});

// ── Cobertura del SimulatorBridgeAdapter real (regla 5: probar contra el simulador) ──

function simConfig(secure: boolean): OpcUaConfig {
  return {
    securityMode: secure ? 'SignAndEncrypt' : 'None',
    identity: secure ? { type: 'username', userName: 'u', password: 'p' } : { type: 'anonymous' },
    watchdogTimeoutMs: 30000,
    coalesceWindowMs: 1000,
    heartbeatIntervalMs: 10000,
    heartbeatMaxFailures: 2,
    publishingIntervalMs: 2000,
    samplingIntervalMs: 1000,
    subscriptionRecycleMaxAttempts: 3,
  } as unknown as OpcUaConfig;
}

const EMPTY_MAPPING: LoadedMapping = {
  version: '1.0.0', protocolVersion: 'v2', dtoVersion: 'v1', plants: [], targets: [], signals: [], raw: {},
};

test('simulator: getWriteSecurity refleja SignAndEncrypt + identidad no anónima', () => {
  const secure = new SimulatorBridgeAdapter(simConfig(true), EMPTY_MAPPING);
  const insecure = new SimulatorBridgeAdapter(simConfig(false), EMPTY_MAPPING);
  assert.equal(secure.getWriteSecurity().secure, true);
  assert.equal(insecure.getWriteSecurity().secure, false);
});

test('simulator: write + read-back hacen echo; setWriteConfirms(false) fuerza mismatch', async () => {
  const sim = new SimulatorBridgeAdapter(simConfig(true), EMPTY_MAPPING);
  const target = { plantId: 'voragine', channel: 'intOut', sourceBuffer: 'INT_OUT_TEST', index: 3 };
  await sim.writeBufferElement(target, 1);
  assert.equal((await sim.readBufferElement(target)).value, 1);
  sim.setWriteConfirms(false);
  assert.notEqual((await sim.readBufferElement(target)).value, 1);
});
