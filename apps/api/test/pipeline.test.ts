/**
 * Tests del pipeline de dominio (PASO 3): liveness, quality, mapping engine, cache/sequence.
 * Node built-in test runner vía tsx. Sin PLC ni red.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LivenessTracker } from '../src/infrastructure/connectivity/pipeline/liveness.tracker';
import { evaluateQuality } from '../src/infrastructure/connectivity/pipeline/quality.evaluator';
import { MappingEngine } from '../src/infrastructure/connectivity/pipeline/mapping.engine';
import { DeadLetterBuffer } from '../src/infrastructure/connectivity/pipeline/dead-letter.buffer';
import { PlantCache } from '../src/infrastructure/connectivity/pipeline/plant-cache';
import type { LoadedMapping } from '../src/infrastructure/connectivity/mapping/opc-mapping.loader';
import type { RawBufferSample, RawPlantFrame } from '../src/infrastructure/connectivity/ports/connectivity-adapter.port';

function buf(browseName: string, channel: string, values: Array<number | boolean>, sourceTimestamp = new Date().toISOString()): RawBufferSample {
  return { browseName, channel, values, quality: 'Good', statusCode: 'Good', sourceTimestamp, serverTimestamp: sourceTimestamp };
}
function frame(plantId: string, buffers: RawBufferSample[]): RawPlantFrame {
  return { plantId, buffers, receivedAt: new Date().toISOString() };
}

// ── QualityService (PASO 3.5) ────────────────────────────────────────────────

test('quality: Good + en rango + live → usable', () => {
  assert.deepEqual(evaluateQuality({ value: 14.2, quality: 'Good', min: 0, max: 1000, livenessState: 'live' }), { usable: true });
});

test('quality: caudal negativo llega Good pero NO es usable (OUT_OF_RANGE)', () => {
  const v = evaluateQuality({ value: -5, quality: 'Good', min: 0, max: 1000, livenessState: 'live' });
  assert.equal(v.usable, false);
  assert.equal(v.reason, 'OUT_OF_RANGE');
});

test('quality: fuera del máximo → OUT_OF_RANGE', () => {
  assert.equal(evaluateQuality({ value: 262144, quality: 'Good', min: 0, max: 1000, livenessState: 'live' }).reason, 'OUT_OF_RANGE');
});

test('quality: NaN/Infinity → INVALID_NUMBER', () => {
  assert.equal(evaluateQuality({ value: NaN, quality: 'Good', min: 0, max: 1000, livenessState: 'live' }).reason, 'INVALID_NUMBER');
  assert.equal(evaluateQuality({ value: Infinity, quality: 'Good', min: 0, max: 1000, livenessState: 'live' }).reason, 'INVALID_NUMBER');
});

test('quality: StatusCode != Good → BAD_QUALITY', () => {
  assert.equal(evaluateQuality({ value: 10, quality: 'Bad', min: 0, max: 1000, livenessState: 'live' }).reason, 'BAD_QUALITY');
});

test('quality: liveness stale/unknown → BRIDGE_STALE (dato puede ser viejo)', () => {
  assert.equal(evaluateQuality({ value: 10, quality: 'Good', min: 0, max: 1000, livenessState: 'stale' }).reason, 'BRIDGE_STALE');
  assert.equal(evaluateQuality({ value: 10, quality: 'Good', min: 0, max: 1000, livenessState: 'unknown' }).reason, 'BRIDGE_STALE');
});

// ── LivenessTracker (PASO 3.3) ───────────────────────────────────────────────

test('liveness: sin frames → unknown', () => {
  const lt = new LivenessTracker(10, 300);
  assert.equal(lt.get('voragine').state, 'unknown');
});

test('liveness: primer frame NO es un cambio → sigue unknown (sitio congelado)', () => {
  const lt = new LivenessTracker(10, 300);
  const changed = lt.ingest(frame('voragine', [buf('REAL_IN_VORAGINE', 'realIn', [7.6, 395811])]));
  assert.equal(changed, false);
  assert.equal(lt.get('voragine').state, 'unknown');
});

test('liveness: segundo frame con valor distinto → cambio → live', () => {
  const lt = new LivenessTracker(10, 300);
  lt.ingest(frame('montebello', [buf('REAL_IN_MONTEBELLO', 'realIn', [14.1])]));
  const changed = lt.ingest(frame('montebello', [buf('REAL_IN_MONTEBELLO', 'realIn', [14.2])]));
  assert.equal(changed, true);
  assert.equal(lt.get('montebello').state, 'live');
});

test('liveness: cambio viejo → idle y luego stale por edad', () => {
  const lt = new LivenessTracker(10, 300);
  const old = new Date(Date.now() - 60_000).toISOString(); // hace 60 s
  lt.ingest(frame('m', [buf('B', 'realIn', [1], old)]));
  lt.ingest(frame('m', [buf('B', 'realIn', [2], old)])); // cambio con ts de hace 60 s
  assert.equal(lt.get('m').state, 'idle'); // >10s, <300s
  const veryOld = new Date(Date.now() - 400_000).toISOString();
  lt.ingest(frame('m', [buf('B', 'realIn', [3], veryOld)]));
  assert.equal(lt.get('m').state, 'stale'); // >300s
});

test('liveness: windowSec por planta desde el mapping', () => {
  const lt = new LivenessTracker(2, 300); // liveSec 2s
  lt.configurePlant('slow', 5); // ventana corta específica del sitio
  const old = new Date(Date.now() - 8_000).toISOString();
  lt.ingest(frame('slow', [buf('B', 'realIn', [1], old)]));
  lt.ingest(frame('slow', [buf('B', 'realIn', [2], old)]));
  assert.equal(lt.get('slow').state, 'stale'); // 8s > windowSec 5s (default 300s la dejaría idle)
});

// ── MappingEngine (PASO 3.4) ─────────────────────────────────────────────────

function montebelloMapping(): LoadedMapping {
  return {
    version: '0.3.0', protocolVersion: 'v2', dtoVersion: 'v1',
    plants: [{ plantId: 'montebello', displayName: 'Montebello', livenessWindowSec: null }],
    targets: [],
    signals: [
      { plantId: 'montebello', buffer: 'realIn', index: 0, domainKey: 'inletFlow1', label: 'Caudal 1', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
      { plantId: 'montebello', buffer: 'realIn', index: 5, domainKey: 'inletFlow2', label: 'Caudal 2', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    ],
    raw: {},
  };
}

test('mapping: extrae realIn[0]→inletFlow1 y realIn[5]→inletFlow2 del buffer primario', () => {
  const engine = new MappingEngine(montebelloMapping());
  const dl = new DeadLetterBuffer();
  const latest = new Map<string, RawBufferSample>();
  // buffer primario (50 elementos) + un buffer de tanque (10 elementos) del mismo canal
  latest.set('REAL_IN_MONTEBELLO', buf('REAL_IN_MONTEBELLO', 'realIn', Array.from({ length: 50 }, (_, i) => i)));
  latest.set('REAL_IN_TK1_MONTEBELLO', buf('REAL_IN_TK1_MONTEBELLO', 'realIn', Array.from({ length: 10 }, () => 99)));
  const ex = engine.extract('montebello', latest, dl);
  const f1 = ex.find((e) => e.domainKey === 'inletFlow1');
  const f5 = ex.find((e) => e.domainKey === 'inletFlow2');
  assert.equal(f1?.value, 0); // primario[0], no el tanque
  assert.equal(f5?.value, 5); // primario[5]
  assert.equal(dl.snapshot().total, 0);
});

test('mapping: sourceBuffer explícito gana sobre el empate de tamaño del canal', () => {
  const mapping: LoadedMapping = {
    version: '0.8.0', protocolVersion: 'v2', dtoVersion: 'v1',
    plants: [{ plantId: 'soledad', displayName: 'Soledad', livenessWindowSec: null }],
    targets: [],
    signals: [
      { plantId: 'soledad', buffer: 'realIn', sourceBuffer: 'REAL_IN_SOLEDAD', index: 0, domainKey: 'inletFlow1', label: 'Caudal de entrada', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    ],
    raw: {},
  };
  const engine = new MappingEngine(mapping);
  const dl = new DeadLetterBuffer();
  const latest = new Map<string, RawBufferSample>();
  // dos buffers realIn del MISMO tamaño: sin sourceBuffer la elección sería no determinista
  latest.set('DATOS_IN_PTAP_SOLEDAD', buf('DATOS_IN_PTAP_SOLEDAD', 'realIn', Array.from({ length: 50 }, () => -1)));
  latest.set('REAL_IN_SOLEDAD', buf('REAL_IN_SOLEDAD', 'realIn', Array.from({ length: 50 }, (_, i) => i + 100)));
  const ex = engine.extract('soledad', latest, dl);
  assert.equal(ex[0].value, 100); // REAL_IN_SOLEDAD[0], no DATOS_IN_PTAP_SOLEDAD[0]
  assert.equal(dl.snapshot().total, 0);
});

test('mapping: sourceBuffer ausente en runtime → dead-letter BUFFER_MISSING', () => {
  const mapping: LoadedMapping = {
    version: '0.8.0', protocolVersion: 'v2', dtoVersion: 'v1',
    plants: [{ plantId: 'soledad', displayName: 'Soledad', livenessWindowSec: null }],
    targets: [],
    signals: [
      { plantId: 'soledad', buffer: 'realIn', sourceBuffer: 'REAL_IN_SOLEDAD', index: 0, domainKey: 'inletFlow1', label: null, unit: null, min: null, max: null, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    ],
    raw: {},
  };
  const engine = new MappingEngine(mapping);
  const dl = new DeadLetterBuffer();
  const latest = new Map<string, RawBufferSample>();
  // llegó OTRO buffer del canal, pero no el declarado: NO debe usarse como sustituto
  latest.set('DATOS_IN_PTAP_SOLEDAD', buf('DATOS_IN_PTAP_SOLEDAD', 'realIn', Array.from({ length: 50 }, () => -1)));
  const ex = engine.extract('soledad', latest, dl);
  assert.equal(ex[0].value, null);
  assert.ok(dl.snapshot().counts.BUFFER_MISSING >= 1);
});

test('mapping: buffer ausente → dead-letter BUFFER_MISSING', () => {
  const engine = new MappingEngine(montebelloMapping());
  const dl = new DeadLetterBuffer();
  engine.extract('montebello', new Map(), dl); // sin buffers
  assert.ok(dl.snapshot().counts.BUFFER_MISSING >= 1);
});

test('mapping: índice fuera de rango → dead-letter INDEX_OUT_OF_RANGE', () => {
  const engine = new MappingEngine(montebelloMapping());
  const dl = new DeadLetterBuffer();
  const latest = new Map<string, RawBufferSample>();
  latest.set('REAL_IN_MONTEBELLO', buf('REAL_IN_MONTEBELLO', 'realIn', [14.1, 170466])); // solo 2 elementos; idx 5 no existe
  engine.extract('montebello', latest, dl);
  assert.ok(dl.snapshot().counts.INDEX_OUT_OF_RANGE >= 1);
});

// ── PlantCache / sequence (PASO 3.2) ─────────────────────────────────────────

test('cache: sequence monótono por planta, independiente entre plantas', () => {
  const cache = new PlantCache();
  assert.equal(cache.nextSequence('montebello'), 1);
  assert.equal(cache.nextSequence('montebello'), 2);
  assert.equal(cache.nextSequence('montebello'), 3);
  assert.equal(cache.nextSequence('soledad'), 1); // contador propio
  assert.equal(cache.nextSequence('montebello'), 4);
});

test('cache: solo se lee lo que se escribió', () => {
  const cache = new PlantCache();
  assert.equal(cache.get('montebello'), null);
});
