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

test('mapping de PRODUCCIÓN: la válvula 1 está en las 10 plantas CON canal de comando, y en ninguna más', () => {
  // Invariante (2026-07-30): la ruta de la válvula se replicó a todas las plantas por instrucción
  // del operador («mín. 1 válvula, se escribe por el canal 0, abrir = 4096 en todas»), tras
  // verificarla en campo en Sirena (docs/archivo/PRUEBA_VALVULA_SIRENA.md: pulso capturado por testigo
  // independiente + MSG al PLC sin errores).
  //
  // El límite que este test protege: SOLO las plantas que tienen buffers intOut+intIn pueden tener
  // válvula. `san-antonio` y `quijote` NO los tienen (son tanques retransmitidos en el buffer de
  // Soledad, sin canal propio) → inventarles una válvula escribiría en un buffer inexistente.
  // Si aparece una writable en una planta sin canal, o de otro tipo, este test debe fallar.
  const prod = loadJson(join(__dirname, '..', 'config', 'opc_mapping.json')) as {
    plants: Array<{
      plantId: string;
      opcBuffers?: Record<string, Array<{ browseName?: string }>>;
      signals?: Array<{ domainKey?: string; writable?: boolean }>;
    }>;
  };

  const conCanal = prod.plants.filter((p) => p.opcBuffers?.intOut?.[0] && p.opcBuffers?.intIn?.[0]).map((p) => p.plantId);
  const writables = prod.plants.flatMap((p) =>
    (p.signals ?? []).filter((s) => s.writable === true).map((s) => `${p.plantId}/${s.domainKey}`),
  );

  assert.deepEqual(writables, conCanal.map((id) => `${id}/valve1`), 'una valve1 por planta con canal de comando, y nada más');
  assert.equal(conCanal.length, 10, 'hoy son 10 plantas con canal (san-antonio y quijote no tienen intOut/intIn)');
  for (const sinCanal of ['san-antonio', 'quijote']) {
    assert.ok(!writables.some((w) => w.startsWith(`${sinCanal}/`)), `${sinCanal} NO debe tener válvula: no tiene canal donde escribir`);
  }
});

// Hallazgo de campo 2026-07-30: replicar `valve1State` (intIn[0]) a ciegas publicaba un estado
// INVENTADO. Leyendo INT_IN[0] real: solo sirena tiene el patrón limpio 16384 (bit14); montebello
// (30250) y km18 (30101) tienen bit14 encendido por casualidad y habrían afirmado CERRADA/ABIERTA en
// falso. Este test impide que vuelva a colarse un estado sin verificar.
test('mapping de PRODUCCIÓN: solo las plantas con estado VERIFICADO exponen valve1State', () => {
  const prod = loadJson(join(__dirname, '..', 'config', 'opc_mapping.json')) as {
    plants: Array<{ plantId: string; signals?: Array<{ domainKey?: string }> }>;
  };
  const conEstado = prod.plants
    .filter((p) => (p.signals ?? []).some((s) => s.domainKey === 'valve1State'))
    .map((p) => p.plantId);
  assert.deepEqual(conEstado, ['sirena'], 'añadir otra planta exige confirmar su índice/patrón en campo primero');
});

test('mapping de PRODUCCIÓN: cada válvula escribe en el canal 0 con pulso y máscara de bits', () => {
  // Protege la forma verificada en campo: si alguien cambia el índice, el modo o quita el pulso,
  // el comando podría pisar bits ajenos o quedar ENCLAVADO (ver docs/archivo/PRUEBA_VALVULA_SIRENA.md).
  const prod = loadJson(join(__dirname, '..', 'config', 'opc_mapping.json')) as {
    plants: Array<{
      plantId: string;
      signals?: Array<{
        domainKey?: string;
        writable?: boolean;
        write?: {
          target?: { index?: number };
          commands?: Record<string, number>;
          mode?: string;
          pulse?: { holdMs?: number };
          readBack?: { channel?: string; confirmsWrittenValue?: boolean };
        };
      }>;
    }>;
  };
  const valves = prod.plants.flatMap((p) => (p.signals ?? []).filter((s) => s.writable).map((s) => ({ plantId: p.plantId, w: s.write })));
  assert.ok(valves.length > 0);
  for (const { plantId, w } of valves) {
    assert.equal(w?.target?.index, 0, `${plantId}: se escribe por el canal 0`);
    assert.equal(w?.commands?.open, 4096, `${plantId}: abrir = 4096 (bit12)`);
    assert.equal(w?.mode, 'bitmask', `${plantId}: modo bitmask (no pisar bits ajenos de la palabra)`);
    assert.ok((w?.pulse?.holdMs ?? 0) > 0, `${plantId}: debe declarar pulso (si no, el bit queda enclavado al confirmar)`);
    assert.equal(w?.readBack?.channel, 'intIn', `${plantId}: el read-back va por el canal de ESTADO`);
    assert.equal(w?.readBack?.confirmsWrittenValue, false, `${plantId}: un pulso no se confirma releyendo lo escrito`);
  }
});
