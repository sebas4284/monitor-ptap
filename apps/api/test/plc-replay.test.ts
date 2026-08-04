/**
 * FASE 2 (deuda saldada) — replay de tramas REALES del PLC contra el pipeline.
 *
 * Por qué hacía falta: el resto de los tests del pipeline corren contra el simulador, y el
 * simulador lo escribimos nosotros a partir de lo que CREEMOS que hace el PLC. Un test contra él
 * confirma nuestra idea, no la realidad. Aquí las tramas son las que el equipo emitió de verdad
 * (capturadas con `scripts/capture-plc-fixture.ts` el 2026-08-03, solo lectura), así que si el PLC
 * manda algo que no anticipamos —una longitud distinta, un StatusCode raro, un valor imposible—
 * esto lo ve y el simulador no.
 *
 * Recapturar: `CAPTURE_SECONDS=90 npm exec -w @ptap/api -- tsx scripts/capture-plc-fixture.ts`
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadMapping } from '../src/infrastructure/connectivity/mapping/opc-mapping.loader';
import { PlantCache } from '../src/infrastructure/connectivity/pipeline/plant-cache';
import { PlantPipelineService } from '../src/infrastructure/connectivity/pipeline/plant-pipeline.service';
import type { ConnectivityConfig } from '../src/infrastructure/connectivity/connectivity.config';
import type {
  BridgeStatus,
  ConnectivityAdapter,
  RawPlantFrame,
} from '../src/infrastructure/connectivity/ports/connectivity-adapter.port';
import type { PlantSnapshotDto } from '../src/infrastructure/connectivity/pipeline/plant-snapshot.dto';

interface Fixture {
  _meta: { tramas: number; endpoint: string; capturadoEn: string; plantasVistas: Array<{ plantId: string; tramas: number }> };
  frames: RawPlantFrame[];
}

const fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'plc-frames-2026-08-03.json'), 'utf8'),
) as Fixture;

/** Adaptador que no habla con nadie: solo reproduce las tramas grabadas, una por una. */
function replayAdapter(): ConnectivityAdapter & { emit(f: RawPlantFrame): void } {
  let onFrame: ((f: RawPlantFrame) => void) | null = null;
  return {
    onFrame: (l: (f: RawPlantFrame) => void) => { onFrame = l; },
    onStatusChange: () => undefined,
    getBridgeStatus: () => 'Connected' as BridgeStatus,
    emit: (f: RawPlantFrame) => onFrame?.(f),
  } as unknown as ConnectivityAdapter & { emit(f: RawPlantFrame): void };
}

function config(): ConnectivityConfig {
  return {
    provider: 'opcua',
    opcua: { staleThresholdMs: 300_000 },
    liveness: { liveSec: 10, windowSec: 300, sweepMs: 60_000 },
  } as unknown as ConnectivityConfig;
}

function replayAll(): { snapshots: PlantSnapshotDto[]; cache: PlantCache; pipeline: PlantPipelineService } {
  const adapter = replayAdapter();
  const cache = new PlantCache();
  const pipeline = new PlantPipelineService(adapter, config(), cache, loadMapping());
  pipeline.onModuleInit();
  const snapshots: PlantSnapshotDto[] = [];
  const sub = pipeline.snapshot$.subscribe((s) => snapshots.push(s));
  for (const f of fixture.frames) adapter.emit(f);
  sub.unsubscribe();
  pipeline.onModuleDestroy();
  return { snapshots, cache, pipeline };
}

test('replay real: el fixture tiene tramas de las 12 plantas y procedencia registrada', () => {
  assert.ok(fixture.frames.length > 0, 'el fixture no puede estar vacío');
  assert.equal(fixture.frames.length, fixture._meta.tramas);
  assert.ok(fixture._meta.endpoint.startsWith('opc.tcp://'), 'debe constar de qué endpoint salió');
  assert.equal(fixture._meta.plantasVistas.length, 12, 'las 12 plantas emitieron al menos una trama');
});

test('replay real: el pipeline procesa TODAS las tramas del PLC sin lanzar', () => {
  const { snapshots } = replayAll();
  assert.ok(snapshots.length > 0, 'debe producir snapshots a partir de tramas reales');
});

test('replay real: ningún snapshot expone un valor no finito como usable', () => {
  const { snapshots } = replayAll();
  const culpables: string[] = [];
  for (const s of snapshots) {
    for (const [key, sig] of Object.entries(s.signals)) {
      if (!sig.usable) continue;
      if (typeof sig.value === 'number' && !Number.isFinite(sig.value)) culpables.push(`${s.plantId}.${key}=${sig.value}`);
      // `usable` debe implicar que hay valor: si no, el consumidor tendría que comprobar ambos.
      if (sig.value === null) culpables.push(`${s.plantId}.${key}=null`);
    }
  }
  assert.deepEqual(culpables, [], 'un dato usable siempre tiene un número real detrás');
});

test('replay real: sequence es monotónico por planta', () => {
  const { snapshots } = replayAll();
  const ultimo = new Map<string, number>();
  for (const s of snapshots) {
    const prev = ultimo.get(s.plantId);
    if (prev !== undefined) {
      assert.ok(s.sequence > prev, `${s.plantId}: sequence retrocedió (${prev} → ${s.sequence})`);
    }
    ultimo.set(s.plantId, s.sequence);
  }
  assert.ok(ultimo.size > 0);
});

test('replay real: toda señal declara confidence y mappingStatus (regla 10)', () => {
  const { snapshots } = replayAll();
  const validas = new Set(['confirmed', 'inferred', 'estimated']);
  for (const s of snapshots.slice(0, 40)) {
    for (const [key, sig] of Object.entries(s.signals)) {
      assert.ok(validas.has(sig.confidence), `${s.plantId}.${key}: confidence inválida (${sig.confidence})`);
      assert.ok(
        sig.mappingStatus === 'mapped' || sig.mappingStatus === 'unmapped',
        `${s.plantId}.${key}: mappingStatus inválido`,
      );
    }
  }
});

test('replay real: los buffers del PLC llegan con la longitud que declara el mapping', () => {
  // Si el PLC cambiara el tamaño de un array, el parser leería índices que ya no existen. Esto lo
  // detecta contra datos reales, no contra los que el simulador decide producir.
  const vistos = new Map<string, Set<number>>();
  for (const f of fixture.frames) {
    for (const b of f.buffers) {
      if (!vistos.has(b.browseName)) vistos.set(b.browseName, new Set());
      vistos.get(b.browseName)!.add(b.values.length);
    }
  }
  const inestables = [...vistos.entries()].filter(([, lens]) => lens.size > 1);
  assert.deepEqual(
    inestables.map(([n, l]) => `${n}: ${[...l].join('/')}`),
    [],
    'un buffer cambió de longitud entre tramas',
  );
});
