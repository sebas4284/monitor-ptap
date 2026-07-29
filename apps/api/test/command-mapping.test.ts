/**
 * Fase 5 — validación del mapping de comandos (criterio de aceptación):
 *  - una señal writable con confidence != confirmed es IMPOSIBLE por schema;
 *  - una señal writable DEBE declarar su write spec;
 *  - el mapping de PRODUCCIÓN no tiene NINGUNA señal writable (sin L5X → seguro por defecto).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadJson, validateMapping } from '../scripts/validate-mapping';

const schema = loadJson(join(__dirname, '..', 'config', 'opc_mapping.schema.json')) as object;

const OUT_BUFFER = { browseName: 'INT_OUT_TEST', node: { nsUri: 'AQUATECH', identifier: 's=IntOutTest' } };

function mappingWithSignal(signal: Record<string, unknown>): unknown {
  return {
    version: '1.0.0',
    protocolVersion: 'v2',
    dtoVersion: 'v1',
    plants: [
      {
        plantId: 'voragine',
        displayName: 'La Vorágine',
        displayNameProvisional: true,
        opcBuffers: { intOut: [OUT_BUFFER] },
        connection: { done: null, error: null, timeout: null, mappingStatus: 'unmapped', confidence: 'inferred' },
        signals: [signal],
      },
    ],
  };
}

const VALID_WRITE = {
  target: { channel: 'intOut', sourceBuffer: 'INT_OUT_TEST', index: 3 },
  commands: { openValve: 1, closeValve: 0 },
  readBack: { channel: 'intOut', sourceBuffer: 'INT_OUT_TEST', index: 3, confirmsWrittenValue: true },
  timeoutMs: 60,
  rollbackValue: 0,
  permission: 'control_valves',
};

test('mapping: señal writable con confidence:inferred es rechazada por el schema', () => {
  const result = validateMapping(schema, mappingWithSignal({
    buffer: 'intOut', index: 3, domainKey: 'valveEV01',
    mappingStatus: 'mapped', confidence: 'inferred', writable: true, write: VALID_WRITE,
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /confidence|confirmed/i.test(e)), `esperaba error de confidence, hubo: ${result.errors.join(' | ')}`);
});

test('mapping: señal writable SIN write spec es rechazada por el schema', () => {
  const result = validateMapping(schema, mappingWithSignal({
    buffer: 'intOut', index: 3, domainKey: 'valveEV01',
    mappingStatus: 'mapped', confidence: 'confirmed', writable: true,
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /write/i.test(e)), `esperaba error de write requerido, hubo: ${result.errors.join(' | ')}`);
});

test('mapping: señal writable confirmed + write spec válido es aceptada', () => {
  const result = validateMapping(schema, mappingWithSignal({
    buffer: 'intOut', index: 3, domainKey: 'valveEV01',
    mappingStatus: 'mapped', confidence: 'confirmed', writable: true, write: VALID_WRITE,
  }));
  assert.equal(result.ok, true, `errores: ${result.errors.join(' | ')}`);
});

test('mapping: write.target.sourceBuffer inexistente es rechazado (validación semántica)', () => {
  const result = validateMapping(schema, mappingWithSignal({
    buffer: 'intOut', index: 3, domainKey: 'valveEV01',
    mappingStatus: 'mapped', confidence: 'confirmed', writable: true,
    write: { ...VALID_WRITE, target: { channel: 'intOut', sourceBuffer: 'NO_EXISTE', index: 3 } },
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /NO_EXISTE/.test(e)));
});

test('mapping de PRODUCCIÓN: solo la señal writable field-verified de Sirena (seguro por defecto sin L5X)', () => {
  // Invariante actualizada (2026-07-29, prueba de campo válvula Sirena, docs/PRUEBA_VALVULA_SIRENA.md):
  // el mapping seguía "cero writable hasta el L5X" hasta que se confirmó por CAPTURA REAL en campo
  // (monitor por suscripción mientras se disparaba el comando desde el HMI) que INT_OUT_SIRENA[0]=4096
  // abre la válvula 1. Es la ÚNICA excepción — si aparece una segunda señal writable sin el mismo
  // respaldo de evidencia, este test debe fallar y alguien debe justificarla explícitamente aquí.
  const prod = loadJson(join(__dirname, '..', 'config', 'opc_mapping.json')) as {
    plants: Array<{ plantId: string; signals?: Array<{ domainKey?: string; writable?: boolean }> }>;
  };
  const writables = prod.plants.flatMap((p) =>
    (p.signals ?? []).filter((s) => s.writable === true).map((s) => `${p.plantId}/${s.domainKey}`),
  );
  assert.deepEqual(writables, ['sirena/valve1'], 'única señal writable esperada hoy en producción');
});
