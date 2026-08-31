/**
 * Editar el mapeo desde la app: qué se acepta y qué no.
 *
 * Estos tests son la red que hace que la función sea admisible. Un override mal validado no da un
 * error visible: da un tablero que enseña un número plausible sacado del sitio equivocado, que es
 * exactamente el fallo de los 409,50 psi de Cascajal — seis horas para descubrirlo, y solo porque
 * alguien se fijó en que 409,50 es 4095/10.
 *
 * Así que se prueba con saña lo que rechaza, no lo que acepta.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aplicarOverrides,
  aplicarSobreRaw,
  bufferDeLaSenal,
  fusionar,
  soloCambios,
  validarParche,
  valoresActuales,
  type MappingOverride,
} from '../src/infrastructure/connectivity/mapping/mapping-overrides';
import type { LoadedMapping } from '../src/infrastructure/connectivity/mapping/opc-mapping.loader';
import { mappingPatchSchema } from '../src/modules/mapping/mapping-patch.schema';

/** Mapping con la forma real de Cascajal: realIn de 50, un intOut de válvula y un buffer corto. */
function mappingCascajal(): LoadedMapping {
  return {
    version: '0.14.0',
    protocolVersion: 'v2',
    dtoVersion: 'v1',
    plants: [{ plantId: 'cascajal', displayName: 'Cascajal', livenessWindowSec: null }],
    targets: [
      { plantId: 'cascajal', browseName: 'REAL_IN_CASCAJAL', channel: 'realIn', node: { nsUri: 'AQUATECH4', identifier: 'g=F0C27430' }, arrayLength: 50, dataType: 'Float' },
      { plantId: 'cascajal', browseName: 'TK1_CASCAJAL', channel: 'realIn', node: { nsUri: 'AQUATECH4', identifier: 'g=TK1' }, arrayLength: 10, dataType: 'Float' },
      { plantId: 'cascajal', browseName: 'INT_OUT_CASCAJAL', channel: 'intOut', node: { nsUri: 'AQUATECH4', identifier: 'g=37DF3BEA' }, arrayLength: 20, dataType: 'Int16' },
    ],
    signals: [
      { plantId: 'cascajal', buffer: 'realIn', index: 0, domainKey: 'outletFlow1', label: 'Caudal de salida 1', unit: 'l/s', min: 0, max: 1000, opMin: 1, opMax: 3, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
      { plantId: 'cascajal', buffer: 'realIn', index: 19, domainKey: 'inletPressure1', label: 'Presion de entrada', unit: 'psi', min: -15, max: 232, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
      { plantId: 'cascajal', buffer: 'intOut', sourceBuffer: 'INT_OUT_CASCAJAL', index: 0, domainKey: 'valve1', label: 'Valvula 1', unit: null, min: null, max: null, mappingStatus: 'mapped', confidence: 'confirmed', writable: true },
    ],
    raw: {
      plants: [
        {
          plantId: 'cascajal',
          signals: [
            { buffer: 'realIn', index: 0, domainKey: 'outletFlow1', unit: 'l/s', min: 0, max: 1000, opMin: 1, opMax: 3, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
            { buffer: 'realIn', index: 19, domainKey: 'inletPressure1', unit: 'psi', min: -15, max: 232, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
            { buffer: 'intOut', index: 0, domainKey: 'valve1', mappingStatus: 'mapped', confidence: 'confirmed', writable: true },
          ],
        },
      ],
    },
  };
}

function override(domainKey: string, patch: MappingOverride['patch']): MappingOverride {
  return { plantId: 'cascajal', domainKey, patch, by: 'Admin', at: '2026-08-31T10:00:00.000Z' };
}

function senal(m: LoadedMapping, domainKey: string) {
  const s = m.signals.find((x) => x.domainKey === domainKey);
  assert.ok(s, `falta ${domainKey} en el fixture`);
  return s;
}

// ── Aplicación ──────────────────────────────────────────────────────────────────

test('override: mueve el índice y baja la confianza a inferred', () => {
  // Bajar la confianza no es decorativo: dice que detrás de ese índice ya no hay un documento de la
  // planta, sino la decisión de una persona. El tablero lo muestra y quien lo lea lo sabe.
  const m = aplicarOverrides(mappingCascajal(), [override('inletPressure1', { index: 21 })]);
  assert.equal(senal(m, 'inletPressure1').index, 21);
  assert.equal(senal(m, 'inletPressure1').confidence, 'inferred');
});

test('override: NO muta el mapping base', () => {
  // Es lo que permite recalcular el efectivo desde cero en cada cambio. Sin esto, dos ediciones
  // seguidas se apilarían y revertir no podría volver al JSON sin reiniciar el proceso.
  const base = mappingCascajal();
  aplicarOverrides(base, [override('inletPressure1', { index: 21, unit: 'bar' })]);
  assert.equal(senal(base, 'inletPressure1').index, 19, 'el base tiene que seguir intacto');
  assert.equal(senal(base, 'inletPressure1').unit, 'psi');
  assert.equal(senal(base, 'inletPressure1').confidence, 'confirmed');
});

test('override: una señal ESCRIBIBLE no se toca ni con la fila ya guardada', () => {
  // La validación de la puerta de entrada no puede ser la única: si alguien mete la fila a mano en
  // MySQL, el canal de mando de una válvula sigue sin moverse.
  const m = aplicarOverrides(mappingCascajal(), [override('valve1', { index: 7 })]);
  assert.equal(senal(m, 'valve1').index, 0);
  assert.equal(senal(m, 'valve1').confidence, 'confirmed');
});

test('override: uno que apunta a una señal inexistente se ignora sin romper nada', () => {
  // Pasa cuando el JSON renombra una señal y la fila vieja se queda en la base. No puede resucitar
  // una señal ni impedir que el backend arranque.
  const m = aplicarOverrides(mappingCascajal(), [override('senalQueYaNoExiste', { index: 3 })]);
  assert.equal(m.signals.length, 3);
});

test('override: sin overrides devuelve el MISMO objeto (sin trabajo tirado)', () => {
  const base = mappingCascajal();
  assert.equal(aplicarOverrides(base, []), base);
});

test('override: un null borra el valor; un campo ausente lo deja como estaba', () => {
  const m = aplicarOverrides(mappingCascajal(), [override('outletFlow1', { opMin: null })]);
  assert.equal(senal(m, 'outletFlow1').opMin, null, 'opMin se borra');
  assert.equal(senal(m, 'outletFlow1').opMax, 3, 'opMax no se tocó');
  assert.equal(senal(m, 'outletFlow1').unit, 'l/s');
});

test('override: fusionar y valoresActuales son coherentes entre sí', () => {
  const s = fusionar(senal(mappingCascajal(), 'outletFlow1'), { index: 5, unit: 'm3/h' });
  const v = valoresActuales(s);
  assert.equal(v.index, 5);
  assert.equal(v.unit, 'm3/h');
  assert.equal(v.min, 0);
});

// ── Qué cambia de verdad ────────────────────────────────────────────────────────

test('cambios: solo se guardan los campos DISTINTOS de lo que ya rige', () => {
  const s = senal(mappingCascajal(), 'outletFlow1');
  const cambios = soloCambios(s, { index: 0, unit: 'm3/h', min: 0 });
  assert.deepEqual(cambios, { unit: 'm3/h' }, 'index y min eran iguales: no son un cambio');
});

test('cambios: poner null donde había valor SÍ es un cambio', () => {
  const s = senal(mappingCascajal(), 'outletFlow1');
  assert.deepEqual(soloCambios(s, { opMin: null }), { opMin: null });
});

// ── Validación: lo que se rechaza ───────────────────────────────────────────────

test('validar: señal desconocida', () => {
  const v = validarParche(mappingCascajal(), 'cascajal', 'noExiste', { index: 1 });
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.motivo, 'SENAL_DESCONOCIDA');
});

test('validar: una válvula NO se edita desde la app', () => {
  const v = validarParche(mappingCascajal(), 'cascajal', 'valve1', { index: 1 });
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.motivo, 'SENAL_ESCRIBIBLE');
});

test('validar: sin cambios se rechaza en vez de guardar una fila vacía', () => {
  const v = validarParche(mappingCascajal(), 'cascajal', 'outletFlow1', { index: 0 });
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.motivo, 'SIN_CAMBIOS');
});

test('validar: el índice tiene que caber en el buffer declarado', () => {
  // REAL_IN_CASCAJAL declara 50 elementos ⇒ el último válido es el 49. Un override al 50 no daría
  // un error visible: daría un dead-letter INDEX_OUT_OF_RANGE en CADA muestra y una señal muda.
  const v = validarParche(mappingCascajal(), 'cascajal', 'outletFlow1', { index: 50 });
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.motivo, 'INDICE_FUERA_DE_RANGO');
  assert.match(v.ok === false ? v.detalle : '', /49/, 'el mensaje dice cuál es el último válido');

  assert.equal(validarParche(mappingCascajal(), 'cascajal', 'outletFlow1', { index: 49 }).ok, true);
});

test('validar: el índice se comprueba contra el buffer NUEVO, no contra el viejo', () => {
  // El caso que se cuela solo: la señal está en el realIn de 50 y se la manda al TK1 de 10 dejando
  // el índice 19. Validar contra el buffer anterior lo habría aceptado.
  const v = validarParche(mappingCascajal(), 'cascajal', 'inletPressure1', { sourceBuffer: 'TK1_CASCAJAL' });
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.motivo, 'INDICE_FUERA_DE_RANGO');

  // Con un índice que cabe en el buffer nuevo, sí pasa.
  const ok = validarParche(mappingCascajal(), 'cascajal', 'inletPressure1', {
    sourceBuffer: 'TK1_CASCAJAL',
    index: 4,
  });
  assert.equal(ok.ok, true);
});

test('validar: un buffer que no existe en esa planta', () => {
  const v = validarParche(mappingCascajal(), 'cascajal', 'outletFlow1', { sourceBuffer: 'REAL_IN_OTRA' });
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.motivo, 'BUFFER_DESCONOCIDO');
});

test('validar: no se puede saltar de canal', () => {
  // Cambiar realIn por intOut cambia el TIPO del dato (Float → Int16). Eso no es corregir un
  // índice: es otra señal.
  const v = validarParche(mappingCascajal(), 'cascajal', 'outletFlow1', { sourceBuffer: 'INT_OUT_CASCAJAL' });
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.motivo, 'BUFFER_DE_OTRO_CANAL');
});

test('validar: rangos invertidos, tanto los físicos como los operativos', () => {
  const a = validarParche(mappingCascajal(), 'cascajal', 'outletFlow1', { min: 10, max: 5 });
  assert.equal(a.ok === false && a.motivo, 'RANGO_INVERTIDO');
  const b = validarParche(mappingCascajal(), 'cascajal', 'outletFlow1', { opMin: 9, opMax: 2 });
  assert.equal(b.ok === false && b.motivo, 'RANGO_INVERTIDO');
});

test('validar: el rango invertido se detecta CRUZANDO el valor guardado', () => {
  // Solo se manda `min`, y queda por encima del `max` que ya tenía la señal. Validar el parche
  // aislado lo habría aceptado.
  const v = validarParche(mappingCascajal(), 'cascajal', 'outletFlow1', { min: 2000 });
  assert.equal(v.ok === false && v.motivo, 'RANGO_INVERTIDO');
});

test('validar: unidad vacía o kilométrica', () => {
  const a = validarParche(mappingCascajal(), 'cascajal', 'outletFlow1', { unit: '   ' });
  assert.equal(a.ok === false && a.motivo, 'UNIDAD_INVALIDA');
  const b = validarParche(mappingCascajal(), 'cascajal', 'outletFlow1', { unit: 'metros cúbicos por hora' });
  assert.equal(b.ok === false && b.motivo, 'UNIDAD_INVALIDA');
  assert.equal(validarParche(mappingCascajal(), 'cascajal', 'outletFlow1', { unit: 'm3/h' }).ok, true);
});

test('validar: quitar el sourceBuffer vuelve al buffer primario del canal', () => {
  const m = mappingCascajal();
  const v = validarParche(m, 'cascajal', 'inletPressure1', { sourceBuffer: null, index: 19 });
  assert.equal(v.ok, false, 'index 19 ya era el actual y sourceBuffer ya era null: no hay cambio');
  assert.equal(v.ok === false && v.motivo, 'SIN_CAMBIOS');
});

test('buffer primario: gana el de más elementos del canal', () => {
  const m = mappingCascajal();
  assert.equal(bufferDeLaSenal(m, 'cascajal', 'realIn', null)?.browseName, 'REAL_IN_CASCAJAL');
  assert.equal(bufferDeLaSenal(m, 'cascajal', 'realIn', 'TK1_CASCAJAL')?.browseName, 'TK1_CASCAJAL');
});

// ── El documento crudo (lo que se revalida contra el schema) ─────────────────────

test('raw: el parche llega al documento y la confianza baja', () => {
  const m = mappingCascajal();
  const doc = aplicarSobreRaw(m.raw, [override('inletPressure1', { index: 21, unit: 'bar' })]) as {
    plants: { signals: Record<string, unknown>[] }[];
  };
  const s = doc.plants[0].signals.find((x) => x.domainKey === 'inletPressure1');
  assert.equal(s?.index, 21);
  assert.equal(s?.unit, 'bar');
  assert.equal(s?.confidence, 'inferred');
});

test('raw: un null BORRA la clave en vez de dejar un null ilegal', () => {
  // El schema declara estos campos como number/string opcionales: un `null` explícito haría el
  // documento inválido, y el rechazo llegaría al guardar sin que nadie entendiera por qué.
  const m = mappingCascajal();
  const doc = aplicarSobreRaw(m.raw, [override('outletFlow1', { opMin: null })]) as {
    plants: { signals: Record<string, unknown>[] }[];
  };
  const s = doc.plants[0].signals.find((x) => x.domainKey === 'outletFlow1');
  assert.equal('opMin' in (s ?? {}), false, 'la clave se borra');
  assert.equal(s?.opMax, 3);
});

test('raw: no muta el documento original', () => {
  // El `raw` lo usa resolveNamespaces() al arrancar el puente: mutarlo sería corromper la fuente de
  // los NodeIds en caliente.
  const m = mappingCascajal();
  aplicarSobreRaw(m.raw, [override('inletPressure1', { index: 21 })]);
  const original = (m.raw as { plants: { signals: Record<string, unknown>[] }[] }).plants[0].signals;
  assert.equal(original.find((x) => x.domainKey === 'inletPressure1')?.index, 19);
});

test('raw: las señales escribibles no se tocan', () => {
  const m = mappingCascajal();
  const doc = aplicarSobreRaw(m.raw, [override('valve1', { index: 9 })]) as {
    plants: { signals: Record<string, unknown>[] }[];
  };
  const s = doc.plants[0].signals.find((x) => x.domainKey === 'valve1');
  assert.equal(s?.index, 0);
  assert.equal(s?.confidence, 'confirmed');
});

// ── La forma del cuerpo de la petición ──────────────────────────────────────────

test('cuerpo: un campo que no existe se RECHAZA en vez de ignorarse', () => {
  // El peor final posible sería un 200 tras mandar `indice` en vez de `index`: la persona se va
  // convencida de haber corregido algo.
  assert.equal(mappingPatchSchema.safeParse({ indice: 3 }).success, false);
  assert.equal(mappingPatchSchema.safeParse({ index: 3, nsUri: 'AQUATECH4' }).success, false);
});

test('cuerpo: un cuerpo vacío se rechaza', () => {
  assert.equal(mappingPatchSchema.safeParse({}).success, false);
});

test('cuerpo: index entero y no negativo; null no vale para index', () => {
  assert.equal(mappingPatchSchema.safeParse({ index: 3.5 }).success, false);
  assert.equal(mappingPatchSchema.safeParse({ index: -1 }).success, false);
  assert.equal(mappingPatchSchema.safeParse({ index: null }).success, false);
  assert.equal(mappingPatchSchema.safeParse({ index: 0 }).success, true);
});

test('cuerpo: los rangos y la unidad SÍ aceptan null (borrar es una corrección)', () => {
  assert.equal(mappingPatchSchema.safeParse({ opMin: null }).success, true);
  assert.equal(mappingPatchSchema.safeParse({ unit: null }).success, true);
  assert.equal(mappingPatchSchema.safeParse({ min: Number.NaN }).success, false);
});
