/**
 * Vista de buffers CRUDOS para el modo desarrollador (solo lectura).
 *
 * Lo que protege: la regla del filtro. Se ocultan los ceros para que la tabla sea legible, PERO con
 * dos excepciones que si se pierden dejan la vista inútil justo en los casos que la motivaron:
 *
 *  1. `intOut` se muestra COMPLETO, ceros incluidos. Es el canal donde escribimos NOSOTROS —el write
 *     spec de Cascajal apunta ahí— y el pulso se suelta a los 300 ms, así que está en cero casi
 *     siempre. Ocultar sus ceros lo escondería entero.
 *  2. Un índice MAPEADO se muestra aunque valga 0. Que una señal declarada lea cero es información:
 *     el caudalímetro de Cascajal marca 0 con agua pasando, y eso es exactamente lo que hay que ver.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRawBuffersView,
  debeMostrarse,
} from '../src/infrastructure/connectivity/diagnostics/raw-buffers';
import type { LoadedMapping } from '../src/infrastructure/connectivity/mapping/opc-mapping.loader';
import type { RawBufferSample } from '../src/infrastructure/connectivity/ports/connectivity-adapter.port';

function muestra(browseName: string, channel: string, values: Array<number | boolean>): RawBufferSample {
  return {
    browseName,
    channel,
    values,
    quality: 'Good',
    statusCode: 'Good',
    sourceTimestamp: '2026-08-26T12:00:00.000Z',
    serverTimestamp: '2026-08-26T12:00:00.000Z',
  };
}

/** Mapping mínimo con la forma real de Cascajal: realIn primario + intOut de válvula. */
function mappingCascajal(): LoadedMapping {
  return {
    version: '0.14.0',
    protocolVersion: 'v2',
    dtoVersion: 'v1',
    plants: [{ plantId: 'cascajal', displayName: 'Cascajal', livenessWindowSec: null }],
    targets: [
      { plantId: 'cascajal', browseName: 'REAL_IN_CASCAJAL', channel: 'realIn', node: { nsUri: 'AQUATECH4', identifier: 'g=F0C27430' }, arrayLength: 50, dataType: 'Float' },
      { plantId: 'cascajal', browseName: 'INT_OUT_CASCAJAL', channel: 'intOut', node: { nsUri: 'AQUATECH4', identifier: 'g=37DF3BEA' }, arrayLength: 20, dataType: 'Int16' },
      { plantId: 'otra', browseName: 'REAL_IN_OTRA', channel: 'realIn', node: { nsUri: 'AQUATECH4', identifier: 'g=OTRA' }, arrayLength: 50, dataType: 'Float' },
    ],
    signals: [
      { plantId: 'cascajal', buffer: 'realIn', index: 0, domainKey: 'outletFlow1', label: 'Caudal de salida 1', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
      { plantId: 'cascajal', buffer: 'realIn', index: 19, domainKey: 'inletPressure1', label: 'Presion de entrada', unit: 'psi', min: -15, max: 232, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
      { plantId: 'cascajal', buffer: 'intOut', sourceBuffer: 'INT_OUT_CASCAJAL', index: 0, domainKey: 'valve1', label: 'Valvula 1', unit: null, min: null, max: null, mappingStatus: 'mapped', confidence: 'confirmed', writable: true },
    ],
    raw: {},
  };
}

function vista() {
  const latest = new Map<string, RawBufferSample>();
  // realIn: [0]=0 mapeado · [3]=230,46 sin mapear · [19]=409,50 mapeado y fuera de rango · resto 0
  const real = Array.from({ length: 50 }, () => 0);
  real[3] = 230.46;
  real[19] = 409.5;
  latest.set('REAL_IN_CASCAJAL', muestra('REAL_IN_CASCAJAL', 'realIn', real));
  latest.set('INT_OUT_CASCAJAL', muestra('INT_OUT_CASCAJAL', 'intOut', Array.from({ length: 20 }, () => 0)));
  return buildRawBuffersView(mappingCascajal(), 'cascajal', latest)!;
}

test('raw: solo los buffers de ESA planta', () => {
  const v = vista();
  assert.deepEqual(
    v.buffers.map((b) => b.browseName),
    ['REAL_IN_CASCAJAL', 'INT_OUT_CASCAJAL'],
  );
  assert.equal(v.displayName, 'Cascajal');
});

test('raw: el NodeId del mapping viaja a la vista, sin indice de namespace', () => {
  const b = vista().buffers[0];
  assert.equal(b.nsUri, 'AQUATECH4');
  assert.equal(b.identifier, 'g=F0C27430');
  assert.equal(b.dataType, 'Float');
});

test('raw: oculta los ceros SIN mapear y dice cuantos oculto', () => {
  const b = vista().buffers.find((x) => x.channel === 'realIn')!;
  assert.deepEqual(
    b.channels.map((c) => c.index),
    [0, 3, 19],
    'el 0 por estar mapeado, el 3 por no ser cero, el 19 por ambas',
  );
  assert.equal(b.hiddenZeros, 47);
});

test('raw: un indice MAPEADO se ve aunque valga 0 (el caudalimetro muerto de Cascajal)', () => {
  const b = vista().buffers.find((x) => x.channel === 'realIn')!;
  const c = b.channels.find((x) => x.index === 0)!;
  assert.equal(c.value, 0);
  assert.equal(c.domainKey, 'outletFlow1');
  assert.equal(c.label, 'Caudal de salida 1');
});

test('raw: intOut se muestra COMPLETO aunque este todo a cero (ahi escribimos nosotros)', () => {
  const b = vista().buffers.find((x) => x.channel === 'intOut')!;
  assert.equal(b.channels.length, 20, 'los 20 indices, ceros incluidos');
  assert.equal(b.hiddenZeros, 0);
});

test('raw: la valvula sale bloqueada (el mapeo de lo escribible no se toca desde la app)', () => {
  const b = vista().buffers.find((x) => x.channel === 'intOut')!;
  const c = b.channels.find((x) => x.index === 0)!;
  assert.equal(c.domainKey, 'valve1');
  assert.equal(c.locked, true);
});

test('raw: marca fuera de rango (409,50 psi con max 232) sin ocultar el valor', () => {
  const b = vista().buffers.find((x) => x.channel === 'realIn')!;
  const c = b.channels.find((x) => x.index === 19)!;
  assert.equal(c.value, 409.5);
  assert.equal(c.outOfRange, true);
  assert.equal(c.unit, 'psi');
});

test('raw: un buffer del que no llego NADA se lista igual, con receivedLength null', () => {
  const v = buildRawBuffersView(mappingCascajal(), 'cascajal', new Map())!;
  const b = v.buffers[0];
  assert.equal(b.receivedLength, null);
  assert.equal(b.declaredLength, 50);
  assert.equal(b.quality, null);
});

test('raw: un indice declarado que la muestra NO trae se ve, con value null', () => {
  const latest = new Map<string, RawBufferSample>();
  // La muestra trae 5 elementos, pero el mapping declara una señal en el 19.
  latest.set('REAL_IN_CASCAJAL', muestra('REAL_IN_CASCAJAL', 'realIn', [1, 0, 0, 0, 0]));
  const v = buildRawBuffersView(mappingCascajal(), 'cascajal', latest)!;
  const c = v.buffers[0].channels.find((x) => x.index === 19);
  assert.notEqual(c, undefined, 'es el fallo que produce un dead-letter INDEX_OUT_OF_RANGE');
  assert.equal(c!.value, null);
});

test('raw: planta desconocida devuelve null', () => {
  assert.equal(buildRawBuffersView(mappingCascajal(), 'no-existe', new Map()), null);
});

test('debeMostrarse: la regla del filtro, aislada', () => {
  assert.equal(debeMostrarse('realIn', 0, false), false, 'cero sin mapear se oculta');
  assert.equal(debeMostrarse('realIn', 0, true), true, 'cero mapeado se ve');
  assert.equal(debeMostrarse('intOut', 0, false), true, 'intOut siempre se ve');
  assert.equal(debeMostrarse('realIn', 3.04, false), true, 'no cero se ve');
  assert.equal(debeMostrarse('realIn', false, false), false, 'un bit apagado sin mapear se oculta');
  assert.equal(debeMostrarse('realIn', null, false), false, 'sin valor y sin mapear, nada que mostrar');
});
