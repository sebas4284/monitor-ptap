/**
 * El formulario de corrección del mapeo.
 *
 * Se prueba el módulo puro (`mapping-edit-form.ts`) y no `mapping-edit.ts`, que importa el cliente
 * HTTP: la misma separación que hay entre `app-release-compare` y `app-release`.
 *
 * Lo que fijan estos tests, y por qué importa: aquí se decide qué se manda al servidor. Un parche
 * que incluya campos sin cambiar deja un histórico ilegible («cambió unit de l/s a l/s»), y un
 * número mal parseado corrige un rango al valor equivocado sin que nadie lo note.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  borradorDesde,
  comoTexto,
  hayCambios,
  hayErrores,
  parsearBorrador,
  parsearNumero,
  resumenCambios,
  valorEnIndice,
  type ValoresSenal,
} from './mapping-edit-form';

/** outletFlow1 de Cascajal, tal como sale del backend. */
const ACTUAL: ValoresSenal = {
  index: 0,
  sourceBuffer: null,
  unit: 'l/s',
  min: 0,
  max: 1000,
  opMin: 1,
  opMax: 3,
};

test('números: se acepta la COMA decimal', () => {
  // La app está en español y el tablero pinta «8,32». Exigir punto habría convertido cada
  // corrección de rango en un error incomprensible.
  assert.equal(parsearNumero('1,5'), 1.5);
  assert.equal(parsearNumero('1.5'), 1.5);
  assert.equal(parsearNumero('-0,19'), -0.19);
  assert.equal(parsearNumero('  12  '), 12);
});

test('números: vacío es null (borrar), texto es error', () => {
  assert.equal(parsearNumero(''), null);
  assert.equal(parsearNumero('   '), null);
  assert.equal(parsearNumero('abc'), 'error');
  assert.equal(parsearNumero('1,2,3'), 'error');
});

test('texto: los números se enseñan con coma y el null como vacío', () => {
  assert.equal(comoTexto(1.5), '1,5');
  assert.equal(comoTexto(null), '');
  assert.equal(comoTexto('l/s'), 'l/s');
});

test('borrador: parte de lo que rige, sin inventarse nada', () => {
  const b = borradorDesde(ACTUAL);
  assert.equal(b.index, '0');
  assert.equal(b.unit, 'l/s');
  assert.equal(b.sourceBuffer, '');
  assert.equal(b.opMax, '3');
});

test('parche: sin tocar nada, no hay cambios', () => {
  // Es lo que evita guardar una fila que no dice nada y ensucia el histórico.
  const { patch, errores } = parsearBorrador(borradorDesde(ACTUAL), ACTUAL);
  assert.equal(hayCambios(patch), false);
  assert.equal(hayErrores(errores), false);
});

test('parche: solo entra el campo que cambió', () => {
  const b = { ...borradorDesde(ACTUAL), index: '19' };
  const { patch } = parsearBorrador(b, ACTUAL);
  assert.deepEqual(patch, { index: 19 });
});

test('parche: vaciar un rango se manda como null explícito', () => {
  const b = { ...borradorDesde(ACTUAL), opMin: '' };
  const { patch } = parsearBorrador(b, ACTUAL);
  assert.deepEqual(patch, { opMin: null }, 'ausente sería «no lo toques»; null es «bórralo»');
});

test('parche: el índice no puede quedar vacío', () => {
  const b = { ...borradorDesde(ACTUAL), index: '' };
  const { errores } = parsearBorrador(b, ACTUAL);
  assert.ok(errores.index, 'toda señal cuelga de una posición concreta');
});

test('parche: el índice tiene que ser entero', () => {
  for (const malo of ['3,5', '-1', '2.5', 'x']) {
    const { errores } = parsearBorrador({ ...borradorDesde(ACTUAL), index: malo }, ACTUAL);
    assert.ok(errores.index, `«${malo}» debería dar error`);
  }
});

test('parche: rango invertido CRUZANDO el valor guardado', () => {
  // Solo se escribe `min`, y queda por encima del `max` que ya tenía la señal. Validar el campo
  // aislado no lo habría visto.
  const { errores } = parsearBorrador({ ...borradorDesde(ACTUAL), min: '2000' }, ACTUAL);
  assert.ok(errores.min);
  assert.match(errores.min ?? '', /1000/, 'el mensaje dice contra qué se compara');
});

test('parche: rango operativo invertido', () => {
  const { errores } = parsearBorrador({ ...borradorDesde(ACTUAL), opMin: '9' }, ACTUAL);
  assert.ok(errores.opMin);
});

test('parche: bajar el máximo por debajo del mínimo también se detecta', () => {
  const { errores } = parsearBorrador({ ...borradorDesde(ACTUAL), max: '-5' }, ACTUAL);
  assert.ok(errores.min, 'el aviso se ancla en el mínimo, que es donde se lee la contradicción');
});

test('parche: una unidad kilométrica se rechaza aquí, sin ir al servidor', () => {
  const { errores } = parsearBorrador({ ...borradorDesde(ACTUAL), unit: 'metros cúbicos por hora' }, ACTUAL);
  assert.ok(errores.unit);
});

test('parche: vaciar la unidad es legítimo', () => {
  const { patch, errores } = parsearBorrador({ ...borradorDesde(ACTUAL), unit: '' }, ACTUAL);
  assert.equal(hayErrores(errores), false);
  assert.deepEqual(patch, { unit: null });
});

test('parche: un número con coma llega convertido', () => {
  const { patch } = parsearBorrador({ ...borradorDesde(ACTUAL), opMax: '3,5' }, ACTUAL);
  assert.deepEqual(patch, { opMax: 3.5 });
});

test('parche: cambiar el buffer de origen y volver a vaciarlo', () => {
  const conBuffer = parsearBorrador({ ...borradorDesde(ACTUAL), sourceBuffer: 'TK1_CASCAJAL' }, ACTUAL);
  assert.deepEqual(conBuffer.patch, { sourceBuffer: 'TK1_CASCAJAL' });

  const conBufferActual: ValoresSenal = { ...ACTUAL, sourceBuffer: 'TK1_CASCAJAL' };
  const vaciado = parsearBorrador({ ...borradorDesde(conBufferActual), sourceBuffer: '' }, conBufferActual);
  assert.deepEqual(vaciado.patch, { sourceBuffer: null }, 'vacío = el buffer principal del canal');
});

test('resumen: el «de → a» que se enseña antes de guardar', () => {
  const cambios = resumenCambios(ACTUAL, { index: 19, unit: 'psi', opMin: null });
  assert.equal(cambios.length, 3);

  const porCampo = new Map(cambios.map((c) => [c.campo, c]));
  assert.deepEqual({ de: porCampo.get('index')?.de, a: porCampo.get('index')?.a }, { de: '0', a: '19' });
  assert.deepEqual({ de: porCampo.get('unit')?.de, a: porCampo.get('unit')?.a }, { de: 'l/s', a: 'psi' });
  assert.deepEqual({ de: porCampo.get('opMin')?.de, a: porCampo.get('opMin')?.a }, { de: '1', a: '(vacío)' });
});

test('resumen: lleva el nombre en INGLÉS del campo, que es el del mapeo', () => {
  const [c] = resumenCambios(ACTUAL, { sourceBuffer: 'TK1_CASCAJAL' });
  assert.equal(c.ingles, 'sourceBuffer');
  assert.equal(c.etiqueta, 'Buffer de origen');
});

test('resumen: en el orden del formulario — primero dónde se lee, luego cómo se interpreta', () => {
  const cambios = resumenCambios(ACTUAL, { opMax: 9, index: 4, unit: 'm' });
  assert.deepEqual(
    cambios.map((c) => c.campo),
    ['index', 'unit', 'opMax'],
  );
});

test('resumen: un parche vacío no produce resumen', () => {
  assert.deepEqual(resumenCambios(ACTUAL, {}), []);
});

// ── Qué hay en el índice de destino (lo que hace verificable la revisión) ────────

const BUFFER = {
  receivedLength: 50,
  channels: [
    { index: 0, value: 8.32 },
    { index: 19, value: 409.5 },
    { index: 21, value: null },
  ],
};

test('destino: devuelve el valor que se lee ahí ahora mismo', () => {
  assert.deepEqual(valorEnIndice(BUFFER, 19), { value: 409.5, oculto: false });
});

test('destino: un índice ausente pero DENTRO de lo recibido vale 0, no «sin dato»', () => {
  // La vista esconde los ceros sin mapear para que la tabla sea legible. Confundir eso con falta
  // de dato haría que la revisión dijera «no se sabe» de un canal que está entregando ceros.
  assert.deepEqual(valorEnIndice(BUFFER, 7), { value: 0, oculto: true });
});

test('destino: fuera de lo recibido es «no hay dato»', () => {
  assert.equal(valorEnIndice(BUFFER, 60), null);
  assert.equal(valorEnIndice({ receivedLength: null, channels: [] }, 3), null);
  assert.equal(valorEnIndice(undefined, 3), null);
});

test('destino: un índice declarado cuyo valor no vino se distingue del cero', () => {
  assert.deepEqual(valorEnIndice(BUFFER, 21), { value: null, oculto: false });
});
