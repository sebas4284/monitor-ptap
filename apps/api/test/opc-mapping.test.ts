/**
 * Tests del contrato opc_mapping (FASE 0 + correcciones FASE 0.1).
 * Node built-in test runner vía tsx. Ejecutar: npm run test:mapping
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadJson, validateMapping } from '../scripts/validate-mapping';

const CONFIG_DIR = join(__dirname, '..', 'config');
const schema = loadJson(join(CONFIG_DIR, 'opc_mapping.schema.json')) as object;

const NODE_DONE = { nsUri: 'AQUATECH', identifier: 'g=5EF09AF1-6737-1D65-D9A0-E907AB896A53' };
const NODE_ERR = { nsUri: 'AQUATECH', identifier: 'g=D8A1D8C0-95FE-2BA5-C99D-1B4701FA560B' };
const NODE_TO = { nsUri: 'AQUATECH', identifier: 'g=762CD35C-C857-13B3-A6EB-CE5300466964' };
const NODE_BUF = { nsUri: 'AQUATECH', identifier: 'g=93BAFF92-FF57-4877-74E4-B7CC1EFAE6B3' };

/** Planta mínima válida (forma FASE 0.1) reutilizable como base de los fixtures. */
function basePlant(): Record<string, unknown> {
  return {
    plantId: 'voragine',
    displayName: 'La Vorágine',
    displayNameProvisional: true,
    opcBuffers: {
      realIn: [{ browseName: 'REAL_IN_VORAGINE', node: { ...NODE_BUF }, arrayLength: 50, dataType: 'Float' }],
    },
    connection: {
      done: { ...NODE_DONE },
      error: { ...NODE_ERR },
      timeout: { ...NODE_TO },
      mappingStatus: 'mapped',
      confidence: 'confirmed',
    },
    signals: [] as unknown[],
  };
}

function wrap(plant: Record<string, unknown>): unknown {
  return { version: '0.2.0', protocolVersion: 'v2', plants: [plant] };
}

// ── FASE 0 (siguen vigentes) ─────────────────────────────────────────────────

test('el opc_mapping.json real valida', () => {
  const mapping = loadJson(join(CONFIG_DIR, 'opc_mapping.json'));
  const result = validateMapping(schema, mapping);
  assert.equal(result.ok, true, `errores:\n${result.errors.join('\n')}`);
});

test('rechaza índice duplicado dentro de un buffer', () => {
  const plant = basePlant();
  plant.signals = [
    { buffer: 'realIn', index: 3, domainKey: 'a', mappingStatus: 'unmapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 3, domainKey: 'b', mappingStatus: 'unmapped', confidence: 'inferred', writable: false },
  ];
  const result = validateMapping(schema, wrap(plant));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('índice duplicado')), result.errors.join('\n'));
});

test('rechaza domainKey duplicado en una planta', () => {
  const plant = basePlant();
  plant.signals = [
    { buffer: 'realIn', index: 1, domainKey: 'tankLevel', mappingStatus: 'unmapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 2, domainKey: 'tankLevel', mappingStatus: 'unmapped', confidence: 'inferred', writable: false },
  ];
  const result = validateMapping(schema, wrap(plant));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('domainKey duplicado')), result.errors.join('\n'));
});

test('rechaza writable:true con confidence != confirmed (regla de schema)', () => {
  const plant = basePlant();
  plant.signals = [
    { buffer: 'intOut', index: 0, domainKey: 'openValve', mappingStatus: 'mapped', confidence: 'inferred', writable: true },
  ];
  const result = validateMapping(schema, wrap(plant));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith('schema')), result.errors.join('\n'));
});

test('acepta writable:true cuando confidence == confirmed', () => {
  const plant = basePlant();
  plant.signals = [
    { buffer: 'intOut', index: 0, domainKey: 'openValve', mappingStatus: 'mapped', confidence: 'confirmed', writable: true },
  ];
  const result = validateMapping(schema, wrap(plant));
  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('rechaza min >= max', () => {
  const plant = basePlant();
  plant.signals = [
    { buffer: 'realIn', index: 4, domainKey: 'ph', min: 14, max: 0, mappingStatus: 'unmapped', confidence: 'inferred', writable: false },
  ];
  const result = validateMapping(schema, wrap(plant));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('min >= max')), result.errors.join('\n'));
});

test('rechaza plantId no-slug ("PTAP Norte")', () => {
  const plant = basePlant();
  plant.plantId = 'PTAP Norte';
  const result = validateMapping(schema, wrap(plant));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith('schema')), result.errors.join('\n'));
});

test('rechaza connection mapped con nodo ausente', () => {
  const plant = basePlant();
  (plant.connection as Record<string, unknown>).done = null;
  const result = validateMapping(schema, wrap(plant));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('done')), result.errors.join('\n'));
});

// ── FASE 0.1 (nuevos) ────────────────────────────────────────────────────────

test('H1: rechaza referencia legacy con ns= embebido (campo nodeId)', () => {
  const plant = basePlant();
  // forma prohibida: NodeId string con ns= en vez de node {nsUri, identifier}
  plant.opcBuffers = { realIn: [{ browseName: 'REAL_IN_VORAGINE', nodeId: 'ns=9;g=93BAFF92-FF57-4877-74E4-B7CC1EFAE6B3' }] };
  const result = validateMapping(schema, wrap(plant));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith('schema')), result.errors.join('\n'));
});

test('H1: rechaza identifier que contiene ns=', () => {
  const plant = basePlant();
  plant.opcBuffers = { realIn: [{ browseName: 'REAL_IN_VORAGINE', node: { nsUri: 'AQUATECH', identifier: 'ns=9;g=93BAFF92-FF57-4877-74E4-B7CC1EFAE6B3' } }] };
  const result = validateMapping(schema, wrap(plant));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith('schema') || e.includes('namespace')), result.errors.join('\n'));
});

test('H2: rechaza un canal presente pero vacío ([])', () => {
  const plant = basePlant();
  (plant.opcBuffers as Record<string, unknown>).realOut = [];
  const result = validateMapping(schema, wrap(plant));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith('schema')), result.errors.join('\n'));
});

test('H2: valida tanto un sitio mínimo (1 canal) como uno rico (varios canales)', () => {
  // Sitio mínimo: solo realIn (como quijote/san-antonio).
  const minimal = basePlant();
  minimal.plantId = 'quijote';
  minimal.opcBuffers = { realIn: [{ browseName: 'REAL_TK_QUIJOTE', node: { ...NODE_BUF } }] };

  // Sitio rico: varios canales presentes (como montebello).
  const rich = basePlant();
  rich.plantId = 'montebello';
  rich.opcBuffers = {
    realIn: [{ browseName: 'REAL_IN_MONTEBELLO', node: { ...NODE_BUF }, arrayLength: 50, dataType: 'Float' }],
    intIn: [{ browseName: 'INT_IN_MONTEBELLO', node: { ...NODE_ERR }, arrayLength: 10, dataType: 'Int16' }],
    intOut: [{ browseName: 'INT_OUT_MONTEBELLO', node: { ...NODE_TO }, arrayLength: 20, dataType: 'Int16' }],
  };

  const doc = { version: '0.2.0', protocolVersion: 'v2', plants: [minimal, rich] };
  const result = validateMapping(schema, doc);
  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('H4: rechaza planta sin displayNameProvisional', () => {
  const plant = basePlant();
  delete plant.displayNameProvisional;
  const result = validateMapping(schema, wrap(plant));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith('schema')), result.errors.join('\n'));
});
