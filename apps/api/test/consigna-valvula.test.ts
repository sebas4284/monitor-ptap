/**
 * Fase 4 — CONSIGNA de la válvula de salida proporcional (Cabuyo, ficha del integrador 2026-11-09/10).
 *
 *  - mapping: la consigna de cabuyo/valve1 se valida (schema + `motivoConsignaInvalida`) y se carga;
 *  - WriteService: escribe el valor redondeado en absoluto en INT_OUT_CABUYO[1]; rechaza fuera de
 *    límites sin escribir; RBAC (civil no; operador y jefe sí); confirmado si la apertura llega a ±2 %;
 *    `sent` / SENT_POSITION_PENDING si no llega a tiempo (sin rollback); idempotencia; auditoría;
 *  - simulador: la apertura REAL_IN_CABUYO[16] va hacia la consigna a 2 %/s y satura a [0, 100].
 *
 * Las válvulas on/off no pasan por aquí: sus tests no cambian.
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadJson, validateMapping } from '../scripts/validate-mapping';
import {
  clearMappingCache,
  loadMapping,
  motivoConsignaInvalida,
  type WriteSpec,
} from '../src/infrastructure/connectivity/mapping/opc-mapping.loader';
import type { AuditEntry, AuditLogService } from '../src/infrastructure/audit/audit-log.service';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DeadLetterBuffer } from '../src/infrastructure/connectivity/pipeline/dead-letter.buffer';
import { MappingEngine } from '../src/infrastructure/connectivity/pipeline/mapping.engine';
import { buildSnapshot } from '../src/infrastructure/connectivity/pipeline/snapshot.builder';
import type { ConnectivityConfig } from '../src/infrastructure/connectivity/connectivity.config';
import type { PlantCache } from '../src/infrastructure/connectivity/pipeline/plant-cache';
import type { LivenessState, PlantSnapshotDto } from '../src/infrastructure/connectivity/pipeline/plant-snapshot.dto';
import type { ConnectivityAdapter } from '../src/infrastructure/connectivity/ports/connectivity-adapter.port';
import { SimulatedPlc, CONSIGNA_UNIDADES_POR_S } from '../src/infrastructure/connectivity/adapters/simulator/simulated-plc';
import { encenderConsignas, opcionesPorDefecto } from '../src/infrastructure/connectivity/adapters/simulator/sim-scenario';
import type { CommandLogRepository, StoredCommand } from '../src/modules/commands/command-log.repository';
import { CommandMappingResolver } from '../src/modules/commands/command-mapping.resolver';
import type { CommandSignatureService } from '../src/modules/commands/command-signature.service';
import { FAIL, REJECT, SENT, httpStatusForCommand, type CommandActor, type CommandRequest } from '../src/modules/commands/command.dto';
import { WriteService } from '../src/modules/commands/write.service';
import type { NotificationRepository } from '../src/modules/notifications/notification.repository';

const RUTA_MAPPING = join(__dirname, '..', 'config', 'opc_mapping.json');
const RUTA_SCHEMA = join(__dirname, '..', 'config', 'opc_mapping.schema.json');

/** Spec como el de producción, con un timeout corto para que el test no espere 120 s. */
function spec(timeoutMs = 200): WriteSpec {
  return {
    target: { channel: 'intOut', sourceBuffer: 'INT_OUT_CABUYO', index: 1 },
    commands: { setpoint: true },
    mode: 'absolute',
    pulse: null,
    readBack: { channel: 'realIn', sourceBuffer: 'REAL_IN_CABUYO', index: 16, confirmsWrittenValue: false, stateVerified: false },
    timeoutMs,
    permission: 'control_valves',
    setpoint: { min: 0, max: 100, unit: '%', tolerance: 2 },
  };
}

const OPERADOR: CommandActor = { userId: 'u1', userName: 'Op', userEmail: 'op@ptap.co', role: 'operador', ip: '10.0.0.1' };
const JEFE: CommandActor = { userId: 'u2', userName: 'Jefe', userEmail: 'jefe@ptap.co', role: 'jefe', ip: '10.0.0.2' };
const CIVIL: CommandActor = { userId: 'u3', userName: 'Civil', userEmail: 'civil@ptap.co', role: 'civil', ip: '10.0.0.3' };

/**
 * Adaptador doble: guarda lo escrito y mueve la apertura `pasoPorLectura` hacia la consigna en cada
 * lectura de REAL_IN_CABUYO[16]. `pasoPorLectura: 0` = el actuador no se mueve (timeout).
 */
function adaptador(o: { pasoPorLectura: number; aperturaInicial?: number; ecoMiente?: boolean; secure?: boolean; palabra?: number }) {
  const writes: Array<{ sourceBuffer: string; index: number; value: number | boolean }> = [];
  let consigna: number | null = null;
  let apertura = o.aperturaInicial ?? 65;
  const a = {
    writes,
    getWriteSecurity: () => ({ secure: o.secure !== false, securityMode: 'SignAndEncrypt', identity: 'username' }),
    getBridgeStatus: () => 'Connected',
    async writeBufferElement(t: { sourceBuffer: string; index: number }, v: number | boolean) {
      writes.push({ sourceBuffer: t.sourceBuffer, index: t.index, value: v });
      consigna = Number(v);
    },
    async readBufferElement(t: { sourceBuffer: string; index: number }) {
      if (t.sourceBuffer === 'REAL_IN_CABUYO' && t.index === 16) {
        if (consigna !== null) {
          const d = consigna - apertura;
          apertura += Math.abs(d) <= o.pasoPorLectura ? d : Math.sign(d) * o.pasoPorLectura;
        }
        return { value: apertura, quality: 'Good' as const, sourceTimestamp: null };
      }
      const v = consigna ?? o.palabra ?? 0;
      return { value: o.ecoMiente && consigna !== null ? v + 7 : v, quality: 'Good' as const, sourceTimestamp: null };
    },
  };
  return a;
}

function repo(): CommandLogRepository {
  const byKey = new Map<string, StoredCommand>();
  const rows = new Map<number, StoredCommand>();
  let id = 1;
  return {
    reserve: async (input: { idempotencyKey: string | null }) => {
      if (input.idempotencyKey && byKey.has(input.idempotencyKey)) return { reserved: false, existing: byKey.get(input.idempotencyKey)! };
      const row: StoredCommand = { id: id++, status: 'pending', reason: null, previousValue: null, writtenValue: null, confirmedValue: null, interlockSequence: null };
      rows.set(row.id, row);
      if (input.idempotencyKey) byKey.set(input.idempotencyKey, row);
      return { reserved: true, id: row.id };
    },
    finalize: async (rid: number, r: Partial<StoredCommand>) => { Object.assign(rows.get(rid) ?? {}, r); },
  } as unknown as CommandLogRepository;
}

function build(o: { pasoPorLectura?: number; ecoMiente?: boolean; secure?: boolean; liveness?: LivenessState; timeoutMs?: number; palabra?: number } = {}) {
  const adapter = adaptador({ pasoPorLectura: o.pasoPorLectura ?? 10, ecoMiente: o.ecoMiente, secure: o.secure, palabra: o.palabra });
  const audit: AuditEntry[] = [];
  const avisos: Array<{ title: string }> = [];
  const snapshot = {
    plantId: 'cabuyo', displayName: 'Cabuyo', sequence: 3, protocolVersion: 'v2', dtoVersion: 'v1', bridgeStatus: 'Connected',
    liveness: { state: o.liveness ?? 'live', lastChangeAt: null, windowSec: 300 },
    signals: { valve1: { label: 'Válvula de salida' } },
  } as unknown as PlantSnapshotDto;
  const w = spec(o.timeoutMs);
  const service = new WriteService(
    adapter as unknown as ConnectivityAdapter,
    { opcua: { writesEnabled: true } } as unknown as ConnectivityConfig,
    { get: () => snapshot } as unknown as PlantCache,
    { resolve: () => ({ domainKey: 'valve1', write: w }) } as unknown as CommandMappingResolver,
    repo(),
    { record: async (e: AuditEntry) => { audit.push(e); } } as unknown as AuditLogService,
    { firmar: async (_i: number, _n: string | null, fin?: () => Promise<void>) => { await fin?.(); return 'firma'; } } as unknown as CommandSignatureService,
    { create: async (a: { title: string }) => { avisos.push(a); return true; } } as unknown as NotificationRepository,
  );
  return { service, adapter, audit, avisos };
}

const pedir = (value: number | undefined, extra: Partial<CommandRequest> = {}): CommandRequest =>
  ({ command: 'setpoint', target: 'valve1', ...(value === undefined ? {} : { value }), ...extra });

// ── Mapping ────────────────────────────────────────────────────────────────────────────────────

type DocMapping = { plants: Array<{ plantId: string; signals: Array<{ domainKey: string; writable?: boolean; _nota?: string; write?: { setpoint?: unknown } }> }> };

/**
 * El mapping de producción con la consigna de Cabuyo APAGADA (writable: false), solo en memoria. En
 * producción está encendida desde el 2026-11-13; la apagada se sigue probando porque es el estado al
 * que vuelve con un solo cambio, y el de las próximas proporcionales.
 */
function produccionConConsignaApagada(): DocMapping {
  const doc = loadJson(RUTA_MAPPING) as DocMapping;
  doc.plants.find((p) => p.plantId === 'cabuyo')!.signals.find((s) => s.domainKey === 'valve1')!.writable = false;
  return doc;
}

/** La copia apagada en un archivo temporal, para el loader y el resolver. */
function rutaConConsignaApagada(): string {
  const ruta = join(tmpdir(), `consigna-apagada-${process.pid}.json`);
  writeFileSync(ruta, JSON.stringify(produccionConConsignaApagada()));
  return ruta;
}

test('consigna: encenderConsignas enciende solo consignas APAGADAS y no modifica el documento original', () => {
  const original = produccionConConsignaApagada();
  const antes = JSON.stringify(original);
  const copia = encenderConsignas(original, ['cabuyo/valve1']) as { plants: Array<{ plantId: string; signals: Array<{ domainKey: string; writable?: boolean }> }> };
  assert.equal(JSON.stringify(original), antes, 'el documento original no se modifica');
  const cabuyo = copia.plants.find((p) => p.plantId === 'cabuyo')!.signals;
  assert.equal(cabuyo.find((s) => s.domainKey === 'valve1')!.writable, true);
  assert.equal(cabuyo.find((s) => s.domainKey === 'valve2')!.writable, true, 'el resto, igual');
  assert.deepEqual(validateMapping(loadJson(RUTA_SCHEMA) as object, copia).errors, []);
  // Solo enciende consignas APAGADAS: nada de inventar mandos.
  assert.throws(() => encenderConsignas(original, ['cabuyo/valve1Position']), /no es una consigna APAGADA/);
  assert.throws(() => encenderConsignas(original, ['cabuyo/valve2']), /no es una consigna APAGADA/);
  assert.throws(() => encenderConsignas(original, ['cabuyo/valve9']), /no existe/);
});

test('consigna ENCENDIDA en producción: cabuyo/valve1 con writable: true, autorizada por Operación el 2026-11-13, y el WriteService la resuelve', () => {
  const doc = loadJson(RUTA_MAPPING) as DocMapping;
  const json = doc.plants.find((p) => p.plantId === 'cabuyo')!.signals.find((s) => s.domainKey === 'valve1')!;
  assert.equal(json.writable, true);
  assert.match(String(json._nota), /^Consigna AUTORIZADA por Operación el 2026-11-13 \(writable: true\)\. Para apagarla: writable: false/);
  assert.deepEqual(validateMapping(loadJson(RUTA_SCHEMA) as object, doc).errors, []);

  clearMappingCache();
  const s = loadMapping(RUTA_MAPPING).signals.find((x) => x.plantId === 'cabuyo' && x.domainKey === 'valve1');
  assert.equal(s?.writable, true);
  assert.equal(s?.consignaApagada, undefined);
  assert.deepEqual(s?.write?.setpoint, { min: 0, max: 100, unit: '%', tolerance: 2 });
  assert.ok(new CommandMappingResolver().resolve('cabuyo', 'valve1'), 'el WriteService la resuelve');
});

test('consigna APAGADA (writable: false): validate:mapping la acepta y el loader arranca sin mando', () => {
  const doc = produccionConConsignaApagada();
  assert.ok(doc.plants.find((p) => p.plantId === 'cabuyo')!.signals.find((s) => s.domainKey === 'valve1')!.write?.setpoint, 'el spec se conserva: apagarla es cambiar UN campo');
  assert.deepEqual(validateMapping(loadJson(RUTA_SCHEMA) as object, doc).errors, []);

  clearMappingCache();
  const s = loadMapping(rutaConConsignaApagada()).signals.find((x) => x.plantId === 'cabuyo' && x.domainKey === 'valve1');
  assert.equal(s?.writable, false);
  assert.equal(s?.write, undefined, 'sin write spec: no hay mando');
  assert.equal(s?.mandoConservado, undefined, 'no es un mando retirado: no hay bits huérfanos que limpiar');
  assert.deepEqual(s?.consignaApagada, { min: 0, max: 100, unit: '%', tolerance: 2 });
});

test('consigna APAGADA: el WriteService rechaza cualquier setpoint a cabuyo/valve1 sin escribir, y queda auditado', async () => {
  // El resolver lee el mapping al construirse: se le da la copia apagada y se restaura el entorno.
  const previa = process.env.OPC_MAPPING_PATH;
  process.env.OPC_MAPPING_PATH = rutaConConsignaApagada();
  clearMappingCache();
  let resolver: CommandMappingResolver;
  try {
    resolver = new CommandMappingResolver();
  } finally {
    if (previa === undefined) delete process.env.OPC_MAPPING_PATH;
    else process.env.OPC_MAPPING_PATH = previa;
    clearMappingCache();
  }
  assert.equal(resolver.resolve('cabuyo', 'valve1'), null, 'el WriteService no la resuelve');
  assert.ok(!resolver.mandosParaLimpieza().some((m) => m.plantId === 'cabuyo' && m.domainKey === 'valve1'));
  const adapter = adaptador({ pasoPorLectura: 50 });
  const audit: AuditEntry[] = [];
  const snapshot = {
    plantId: 'cabuyo', displayName: 'Cabuyo', sequence: 3, protocolVersion: 'v2', dtoVersion: 'v1', bridgeStatus: 'Connected',
    liveness: { state: 'live', lastChangeAt: null, windowSec: 300 }, signals: {},
  } as unknown as PlantSnapshotDto;
  const service = new WriteService(
    adapter as unknown as ConnectivityAdapter,
    { opcua: { writesEnabled: true } } as unknown as ConnectivityConfig,
    { get: () => snapshot } as unknown as PlantCache,
    resolver, // el resolver REAL, sobre la copia apagada del mapping de producción
    repo(),
    { record: async (e: AuditEntry) => { audit.push(e); } } as unknown as AuditLogService,
    { firmar: async () => null } as unknown as CommandSignatureService,
    { create: async () => true } as unknown as NotificationRepository,
  );
  for (const value of [0, 40, 100]) {
    const r = await service.execute('cabuyo', pedir(value), OPERADOR);
    assert.equal(r.status, 'rejected', String(value));
    assert.equal(r.reason, REJECT.TARGET_NOT_WRITABLE, String(value));
  }
  assert.equal(adapter.writes.length, 0, 'nada escrito');
  assert.equal(audit.length, 3, 'cada intento queda auditado');
  assert.ok(audit.every((e) => (e.detail as Record<string, unknown>).command === 'setpoint'));
});

test('consigna APAGADA: el snapshot publica la apertura y los límites de la consigna con commandable: false', () => {
  clearMappingCache();
  const dl = new DeadLetterBuffer();
  const ahora = new Date().toISOString();
  const latest = new Map([
    ['REAL_IN_CABUYO', { browseName: 'REAL_IN_CABUYO', channel: 'realIn', values: Array.from({ length: 30 }, (_, i) => (i === 16 ? 37.5 : 1)), quality: 'Good', statusCode: 'Good', sourceTimestamp: ahora, serverTimestamp: ahora }],
    ['INT_OUT_CABUYO', { browseName: 'INT_OUT_CABUYO', channel: 'intOut', values: [257, 0, 0, 0, 0, 0, 0, 0, 0, 0], quality: 'Good', statusCode: 'Good', sourceTimestamp: ahora, serverTimestamp: ahora }],
  ]) as never;
  const extracted = new MappingEngine(loadMapping(rutaConConsignaApagada())).extract('cabuyo', latest, dl);
  const snapshot = buildSnapshot({
    plantId: 'cabuyo', displayName: 'Cabuyo', protocolVersion: 'v2', dtoVersion: 'v1', sequence: 1, bridgeStatus: 'Connected',
    liveness: { state: 'live', lastChangeAt: null, windowSec: 300 }, extracted, deadLetter: dl,
  });
  assert.equal(snapshot.signals.valve1Position?.value, 37.5, 'la apertura se sigue viendo');
  assert.equal(snapshot.signals.valve1?.commandable, false);
  assert.deepEqual(snapshot.signals.valve1?.setpoint, { min: 0, max: 100, unit: '%' }, 'la app sabe que la consigna existe');
  assert.equal(snapshot.signals.valve1?.commands, undefined, 'sin verbos');
});

test('consigna: validate:mapping y el loader RECHAZAN una consigna mal declarada', () => {
  const ok = { ...spec(), setpoint: { min: 0, max: 100, tolerance: 2 } };
  assert.equal(motivoConsignaInvalida(ok), null);
  const malas: Array<[string, object]> = [
    ['bitmask', { ...ok, mode: 'bitmask' }],
    ['rollback', { ...ok, rollbackValue: 0 }],
    ['pulso', { ...ok, pulse: { holdMs: 300 } }],
    ['dos verbos', { ...ok, commands: { setpoint: true, open: 4 } }],
    ['min >= max', { ...ok, setpoint: { min: 100, max: 0, tolerance: 2 } }],
    ['tolerancia 0', { ...ok, setpoint: { min: 0, max: 100, tolerance: 0 } }],
    ['read-back con máscara', { ...ok, readBack: { ...ok.readBack, mask: 3 } }],
    ['destino de entrada', { ...ok, target: { ...ok.target, channel: 'intIn' } }],
    ['sostenida', { ...ok, sustained: true }],
  ];
  for (const [que, mala] of malas) assert.ok(motivoConsignaInvalida(mala), `${que}: debe rechazarse`);

  // Y el schema: una consigna con rollbackValue no pasa validate:mapping.
  const prod = loadJson(RUTA_MAPPING) as { plants: Array<{ plantId: string; signals: Array<{ domainKey: string; write?: Record<string, unknown> }> }> };
  const v1 = prod.plants.find((p) => p.plantId === 'cabuyo')!.signals.find((s) => s.domainKey === 'valve1')!;
  v1.write!.rollbackValue = 0;
  assert.ok(validateMapping(loadJson(RUTA_SCHEMA) as object, prod).errors.length > 0);
});

// ── WriteService ───────────────────────────────────────────────────────────────────────────────

test('consigna: escribe el valor en ABSOLUTO en INT_OUT_CABUYO[1] y confirma cuando la apertura llega a ±2 %', async () => {
  const { service, adapter, audit, avisos } = build({ pasoPorLectura: 10, timeoutMs: 2000 });
  const r = await service.execute('cabuyo', pedir(40), OPERADOR);
  assert.equal(r.status, 'confirmed');
  assert.equal(httpStatusForCommand(r), 200);
  assert.deepEqual(adapter.writes, [{ sourceBuffer: 'INT_OUT_CABUYO', index: 1, value: 40 }], 'una sola escritura, sin rollback');
  assert.equal(r.writtenValue, 40);
  assert.equal(r.writeVerified, true);
  assert.ok(typeof r.confirmedValue === 'number' && Math.abs(r.confirmedValue - 40) <= 2);
  const d = audit.at(-1)!.detail as Record<string, unknown>;
  assert.equal(d.status, 'confirmed');
  assert.equal(d.writtenValue, 40);
  assert.equal(d.requestedValue, 40);
  assert.equal(d.firma, 'firma', 'registro firmado');
  assert.match(avisos.at(-1)!.title, /consigna de Válvula de salida a 40 %/);
});

test('consigna: redondea a entero lo que escribe (40,6 → 41) y audita lo pedido', async () => {
  const { service, adapter, audit } = build({ pasoPorLectura: 50 });
  const r = await service.execute('cabuyo', pedir(40.6), OPERADOR);
  assert.equal(adapter.writes[0]?.value, 41);
  assert.equal(r.writtenValue, 41);
  assert.equal((audit.at(-1)!.detail as Record<string, unknown>).requestedValue, 40.6);
});

test('consigna: fuera de límites (o no finita) se RECHAZA sin escribir — Aquora no depende de que el PLC sature', async () => {
  for (const v of [-1, 100.5, 101, 1e9, Number.NaN, Number.POSITIVE_INFINITY]) {
    const { service, adapter, audit } = build();
    const r = await service.execute('cabuyo', pedir(v), OPERADOR);
    assert.equal(r.status, 'rejected', String(v));
    assert.equal(r.reason, REJECT.VALUE_OUT_OF_RANGE, String(v));
    assert.equal(httpStatusForCommand(r), 400);
    assert.equal(adapter.writes.length, 0, `${v}: nada escrito`);
    assert.equal(audit.length, 1, `${v}: el intento queda auditado`);
  }
  // Los bordes sí valen.
  for (const v of [0, 100]) {
    const { service, adapter } = build({ pasoPorLectura: 100 });
    assert.equal((await service.execute('cabuyo', pedir(v), OPERADOR)).status, 'confirmed', String(v));
    assert.equal(adapter.writes[0]?.value, v);
  }
});

test('consigna: sin `value` → VALUE_REQUIRED; abrir/cerrar no existen en una consigna', async () => {
  const { service, adapter } = build();
  assert.equal((await service.execute('cabuyo', pedir(undefined), OPERADOR)).reason, REJECT.VALUE_REQUIRED);
  assert.equal((await service.execute('cabuyo', { command: 'open', target: 'valve1' }, OPERADOR)).reason, REJECT.UNKNOWN_COMMAND);
  assert.equal(adapter.writes.length, 0);
});

test('consigna: RBAC — civil recibe 403 sin escribir; operador y jefe sí pueden (matriz vigente desde el 2026-10-31)', async () => {
  const civil = build();
  const r = await civil.service.execute('cabuyo', pedir(40), CIVIL);
  assert.equal(r.reason, REJECT.FORBIDDEN);
  assert.equal(httpStatusForCommand(r), 403);
  assert.equal(civil.adapter.writes.length, 0);
  for (const actor of [OPERADOR, JEFE]) {
    const b = build({ pasoPorLectura: 50 });
    assert.equal((await b.service.execute('cabuyo', pedir(40), actor)).status, 'confirmed', String(actor.role));
  }
});

test('consigna: la apertura no llega dentro del timeout → sent / SENT_POSITION_PENDING (202), la consigna se queda puesta', async () => {
  const { service, adapter } = build({ pasoPorLectura: 0, timeoutMs: 120 });
  const r = await service.execute('cabuyo', pedir(40), OPERADOR);
  assert.equal(r.status, 'sent');
  assert.equal(r.reason, SENT.SENT_POSITION_PENDING);
  assert.equal(httpStatusForCommand(r), 202);
  assert.deepEqual(adapter.writes.map((w) => w.value), [40], 'sin rollback');
  assert.equal(r.confirmedValue, 65, 'la última apertura leída');
});

test('consigna: si el eco no cuadra y la apertura no llega → failed / READBACK_UNCONFIRMED (no se afirma nada)', async () => {
  const { service } = build({ pasoPorLectura: 0, ecoMiente: true, timeoutMs: 60 });
  const r = await service.execute('cabuyo', pedir(40), OPERADOR);
  assert.equal(r.status, 'failed');
  assert.equal(r.reason, FAIL.READBACK_UNCONFIRMED);
  assert.equal(r.writeVerified, false);
});

test('consigna: idempotencia — la misma idempotencyKey no vuelve a escribir', async () => {
  const { service, adapter } = build({ pasoPorLectura: 50 });
  const a = await service.execute('cabuyo', pedir(40, { idempotencyKey: 'k-1' }), OPERADOR);
  const b = await service.execute('cabuyo', pedir(40, { idempotencyKey: 'k-1' }), OPERADOR);
  assert.equal(a.idempotent, false);
  assert.equal(b.idempotent, true);
  assert.equal(b.status, a.status);
  assert.equal(adapter.writes.length, 1);
});

test('consigna: interlocks y precondición segura intactos (planta congelada, sesión sin cifrar) → sin escribir', async () => {
  const congelada = build({ liveness: 'frozen' });
  const r1 = await congelada.service.execute('cabuyo', pedir(40), OPERADOR);
  assert.ok(r1.reason?.startsWith(REJECT.INTERLOCK_FAILED));
  assert.equal(congelada.adapter.writes.length, 0);
  const insegura = build({ secure: false });
  const r2 = await insegura.service.execute('cabuyo', pedir(40), OPERADOR);
  assert.equal(r2.reason, REJECT.WRITES_DISABLED_INSECURE_SESSION);
  assert.equal(insegura.adapter.writes.length, 0);
});

test('consigna: la palabra de consigna con un valor fuera de rango (257) → 409 SETPOINT_WORD_IN_USE, sin escribir y auditado', async () => {
  const { service, adapter, audit } = build({ palabra: 257 });
  const r = await service.execute('cabuyo', pedir(40), OPERADOR);
  assert.equal(r.status, 'rejected');
  assert.ok(r.reason?.startsWith(REJECT.SETPOINT_WORD_IN_USE));
  assert.match(String(r.reason), /posible uso por otro equipo; verificar con el integrador/);
  assert.equal(httpStatusForCommand(r), 409);
  assert.equal(r.previousValue, 257, 'el valor encontrado queda en el resultado');
  assert.equal(adapter.writes.length, 0, 'no se escribe nada');
  assert.equal(audit.length, 1, 'el rechazo queda auditado');
  assert.equal((audit[0].detail as Record<string, unknown>).status, 'rejected');
});

test('consigna: la palabra con una consigna previa (40) → escribe normal', async () => {
  const { service, adapter } = build({ palabra: 40, pasoPorLectura: 50 });
  const r = await service.execute('cabuyo', pedir(80), OPERADOR);
  assert.equal(r.status, 'confirmed');
  assert.equal(r.previousValue, 40);
  assert.deepEqual(adapter.writes.map((w) => w.value), [80]);
});

// ── Simulador ──────────────────────────────────────────────────────────────────────────────────

test(`consigna: el PLC simulado lleva REAL_IN_CABUYO[16] hacia la consigna a ${CONSIGNA_UNIDADES_POR_S} %/s y satura a [0, 100]`, () => {
  // Con el mapping de producción, que la trae ENCENDIDA desde el 2026-11-13.
  clearMappingCache();
  const plc = new SimulatedPlc(loadMapping(RUTA_MAPPING), opcionesPorDefecto(), 0);
  const mando = { plantId: 'cabuyo', channel: 'intOut', sourceBuffer: 'INT_OUT_CABUYO', index: 1 };
  const apertura = { plantId: 'cabuyo', channel: 'realIn', sourceBuffer: 'REAL_IN_CABUYO', index: 16 };
  assert.equal(plc.leer(apertura, 0), 0, 'arranca sincronizada con la consigna (0) y sin ruido');

  plc.escribir(mando, 40, 0);
  assert.ok(Math.abs(Number(plc.leer(apertura, 10_000)) - 20) < 1e-6, 'a 2 %/s, 20 % a los 10 s');
  assert.equal(plc.leer(apertura, 25_000), 40, 'llega y se queda');
  plc.escribir(mando, 150, 25_000);
  assert.equal(plc.leer(apertura, 100_000), 100, 'el PLC satura al máximo');
  assert.ok(plc.escrituras().some((w) => w.sourceBuffer === 'INT_OUT_CABUYO' && w.index === 1 && w.value === 40));
  // No es una válvula on/off del modelo: no aparece en el informe de válvulas.
  assert.ok(!plc.informe(100_000).valves.some((v) => v.plantId === 'cabuyo' && v.domainKey === 'valve1'));
});
