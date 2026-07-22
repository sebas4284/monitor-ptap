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

test('quality: Good + en rango + live → usable, sin aviso de rango', () => {
  assert.deepEqual(evaluateQuality({ value: 14.2, quality: 'Good', min: 0, max: 1000, livenessState: 'live' }), {
    usable: true,
    outOfRange: false,
  });
});

test('quality: caudal negativo llega Good y SIGUE siendo usable — solo se marca outOfRange (regla de producto: los límites son para alertar, no para ocultar)', () => {
  const v = evaluateQuality({ value: -5, quality: 'Good', min: 0, max: 1000, livenessState: 'live' });
  assert.equal(v.usable, true);
  assert.equal(v.outOfRange, true);
  assert.equal(v.reason, undefined);
});

test('quality: fuera del máximo → sigue usable, outOfRange=true', () => {
  const v = evaluateQuality({ value: 262144, quality: 'Good', min: 0, max: 1000, livenessState: 'live' });
  assert.equal(v.usable, true);
  assert.equal(v.outOfRange, true);
});

test('quality: NaN/Infinity → INVALID_NUMBER', () => {
  assert.equal(evaluateQuality({ value: NaN, quality: 'Good', min: 0, max: 1000, livenessState: 'live' }).reason, 'INVALID_NUMBER');
  assert.equal(evaluateQuality({ value: Infinity, quality: 'Good', min: 0, max: 1000, livenessState: 'live' }).reason, 'INVALID_NUMBER');
});

test('quality: StatusCode != Good → BAD_QUALITY', () => {
  assert.equal(evaluateQuality({ value: 10, quality: 'Bad', min: 0, max: 1000, livenessState: 'live' }).reason, 'BAD_QUALITY');
});

// DEF-04: una señal estructuralmente rota (índice fuera de rango, buffer ausente) llega con
// value=null; antes salía usable:true, indistinguible de un dato bueno.
test('quality: value=null aun con quality Good → NO usable (INVALID_NUMBER)', () => {
  const v = evaluateQuality({ value: null, quality: 'Good', min: 0, max: 1000, livenessState: 'live' });
  assert.equal(v.usable, false);
  assert.equal(v.reason, 'INVALID_NUMBER');
});

// DEF-03: un `null` por elemento del PLC se convierte en NaN en el adaptador (nunca 0). Aquí se
// verifica la GARANTÍA aguas abajo: un elemento sin dato (NaN) termina NO usable, jamás como 0 real.
test('quality: NaN (lo que produce un null del PLC) → NO usable, nunca un 0 falso', () => {
  const v = evaluateQuality({ value: NaN, quality: 'Good', min: 0, max: 1000, livenessState: 'live' });
  assert.equal(v.usable, false);
  assert.equal(v.reason, 'INVALID_NUMBER');
});

test('quality: liveness frozen → BRIDGE_STALE (perdimos la fuente)', () => {
  assert.equal(evaluateQuality({ value: 10, quality: 'Good', min: 0, max: 1000, livenessState: 'frozen' }).reason, 'BRIDGE_STALE');
});

// El fix de fondo: una planta en régimen estable estaba viendo DESAPARECER sus lecturas.
test('quality: liveness stable NO invalida — proceso quieto es operación normal', () => {
  const v = evaluateQuality({ value: 10, quality: 'Good', min: 0, max: 1000, livenessState: 'stable' });
  assert.equal(v.usable, true);
  assert.equal(v.reason, undefined);
});

// ── LivenessTracker (PASO 3.3) — 3 estados: live / stable / frozen ───────────

test('liveness: sesión sana y sin frames → stable (conectados, aún sin movimiento)', () => {
  const lt = new LivenessTracker(10, 300);
  assert.equal(lt.get('voragine', true).state, 'stable');
});

test('liveness: sin sesión → frozen, pase lo que pase con los valores', () => {
  const lt = new LivenessTracker(10, 300);
  assert.equal(lt.get('voragine', false).state, 'frozen');
  // incluso con un cambio recentísimo: sin fuente viva el dato no está respaldado
  lt.ingest(frame('voragine', [buf('B', 'realIn', [1])]));
  lt.ingest(frame('voragine', [buf('B', 'realIn', [2])]));
  assert.equal(lt.get('voragine', false).state, 'frozen');
});

test('liveness: segundo frame con valor distinto → cambio → live', () => {
  const lt = new LivenessTracker(10, 300);
  lt.ingest(frame('montebello', [buf('REAL_IN_MONTEBELLO', 'realIn', [14.1])]));
  const changed = lt.ingest(frame('montebello', [buf('REAL_IN_MONTEBELLO', 'realIn', [14.2])]));
  assert.equal(changed, true);
  assert.equal(lt.get('montebello', true).state, 'live');
});

// EL CASO QUE MOTIVÓ EL CAMBIO: valores quietos hace rato, pero la sesión responde.
// Antes esto era 'stale' (rojo, "congelado") y además invalidaba las señales.
test('liveness: cambio viejo con sesión sana → stable, NO congelado', () => {
  const lt = new LivenessTracker(10, 300);
  const old = new Date(Date.now() - 60_000).toISOString();
  lt.ingest(frame('m', [buf('B', 'realIn', [1], old)]));
  lt.ingest(frame('m', [buf('B', 'realIn', [2], old)]));
  assert.equal(lt.get('m', true).state, 'stable');

  const veryOld = new Date(Date.now() - 400_000).toISOString(); // más de la ventana de 300 s
  lt.ingest(frame('m', [buf('B', 'realIn', [3], veryOld)]));
  assert.equal(lt.get('m', true).state, 'stable', 'con la sesión viva, el tiempo por sí solo no congela');
  assert.equal(lt.get('m', false).state, 'frozen', 'lo que congela es perder la sesión');
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

// DEF-04 (capa 2): un índice fuera del array real → quality:'Bad' (no la del buffer), para que
// aguas abajo salga BAD_QUALITY y nunca usable:true con value:null.
test('mapping: índice fuera de rango → value:null Y quality:Bad (señal rota)', () => {
  const mapping: LoadedMapping = {
    version: '0.9.0', protocolVersion: 'v2', dtoVersion: 'v1',
    plants: [{ plantId: 'montebello', displayName: 'Montebello', livenessWindowSec: null }],
    targets: [],
    signals: [
      { plantId: 'montebello', buffer: 'realIn', sourceBuffer: 'REAL_IN_MONTEBELLO', index: 40, domainKey: 'x', label: null, unit: null, min: null, max: null, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    ],
    raw: {},
  };
  const engine = new MappingEngine(mapping);
  const dl = new DeadLetterBuffer();
  const latest = new Map<string, RawBufferSample>();
  // llega un buffer más corto (10) de lo que el mapping direcciona (índice 40)
  latest.set('REAL_IN_MONTEBELLO', buf('REAL_IN_MONTEBELLO', 'realIn', Array.from({ length: 10 }, (_, i) => i)));
  const ex = engine.extract('montebello', latest, dl);
  assert.equal(ex[0].value, null);
  assert.equal(ex[0].quality, 'Bad', 'una señal con índice fuera de rango NO puede heredar quality Good del buffer');
  // y por tanto NO es usable
  assert.equal(evaluateQuality({ value: ex[0].value, quality: ex[0].quality, min: null, max: null, livenessState: 'live' }).usable, false);
  assert.equal(dl.snapshot().total, 1);
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
