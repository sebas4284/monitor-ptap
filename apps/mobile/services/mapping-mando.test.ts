/**
 * El formulario del canal de mando: qué valor abre y cuál cierra.
 *
 * Lo que fijan estos tests es lo que NO debe poder guardarse. Un verbo mal escrito, dos verbos con
 * el mismo valor o un índice fuera de sitio no producen un error visible en el PLC: producen un
 * botón que hace otra cosa —o nada— mientras el registro afirma que se hizo lo que se pidió. En 8 de
 * las 10 plantas el `open: 4096` actual es una suposición heredada de La Vorágine que nadie
 * verificó, así que este formulario es por donde va a entrar la corrección de todas ellas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  borradorMandoDesde,
  comandosComoTexto,
  comandosDesdeFilas,
  filasDesde,
  mismosComandos,
  parsearMando,
  parsearValorComando,
  resumenMando,
  type ValoresMando,
} from './mapping-mando-form';

/** El mando real de Carbonero: open heredado, sin close, en bitmask. */
const ACTUAL: ValoresMando = {
  index: 0,
  commands: { open: 4096 },
  mode: 'bitmask',
  compuesta: false,
  stateOpen: null,
  stateClosed: null,
};

test('mando: los verbos salen como filas, en orden estable', () => {
  // Estable para que no bailen mientras se escribe: una lista que se reordena a cada tecla es
  // imposible de editar.
  const filas = filasDesde({ open: 4096, close: 8192 });
  assert.deepEqual(
    filas.map((f) => f.verbo),
    ['close', 'open'],
  );
  assert.equal(filas.find((f) => f.verbo === 'open')?.valor, '4096');
});

test('mando: un valor puede ser número o booleano', () => {
  // El mapeo admite booleanos: hay canales de bit donde el valor no es un número, y obligar a
  // escribir 1 o 0 ahí produciría un write spec que el schema rechaza.
  assert.equal(parsearValorComando('4096'), 4096);
  assert.equal(parsearValorComando('true'), true);
  assert.equal(parsearValorComando('FALSE'), false);
  assert.equal(parsearValorComando('1,5'), 1.5);
  assert.equal(parsearValorComando('abrir'), 'error');
  assert.equal(parsearValorComando(''), 'error', 'un verbo sin valor no vale');
});

test('mando: un verbo con nombre ilegal se rechaza aquí, sin ir al servidor', () => {
  const r = comandosDesdeFilas([{ verbo: '2abrir', valor: '1' }]);
  assert.ok('error' in r);
});

test('mando: dos verbos con el MISMO valor se rechazan', () => {
  // El equipo no podría distinguir una orden de la otra: una de las dos haría lo contrario de lo que
  // dice su botón.
  const r = comandosDesdeFilas([
    { verbo: 'open', valor: '4096' },
    { verbo: 'close', valor: '4096' },
  ]);
  assert.ok('error' in r);
  assert.match('error' in r ? r.error : '', /distinguir/);
});

test('mando: el mismo verbo dos veces se rechaza', () => {
  const r = comandosDesdeFilas([
    { verbo: 'open', valor: '1' },
    { verbo: 'open', valor: '2' },
  ]);
  assert.ok('error' in r);
});

test('mando: sin ningún verbo no hay válvula que accionar', () => {
  assert.ok('error' in comandosDesdeFilas([]));
  assert.ok('error' in comandosDesdeFilas([{ verbo: '', valor: '' }]));
});

test('mando: una fila recién añadida y vacía se ignora, no rompe el formulario', () => {
  // Si la fila en blanco contara como error, añadir un verbo dejaría el botón de guardar apagado
  // hasta terminar de escribirlo, y el mensaje diría algo que el usuario ya sabe.
  const r = comandosDesdeFilas([
    { verbo: 'open', valor: '4096' },
    { verbo: '', valor: '' },
  ]);
  assert.deepEqual('error' in r ? null : r.commands, { open: 4096 });
});

test('mando: sin tocar nada no hay parche', () => {
  const { patch, errores } = parsearMando(borradorMandoDesde(ACTUAL), ACTUAL);
  assert.deepEqual(patch, {});
  assert.deepEqual(errores, {});
});

test('mando: añadir el verbo que falta — el caso real de las 8 plantas', () => {
  const b = borradorMandoDesde(ACTUAL);
  b.comandos.push({ verbo: 'close', valor: '8192' });
  const { patch, errores } = parsearMando(b, ACTUAL);
  assert.deepEqual(errores, {});
  assert.deepEqual(patch, { writeCommands: { open: 4096, close: 8192 } });
});

test('mando: cambiar el índice por el que sale la orden', () => {
  const b = { ...borradorMandoDesde(ACTUAL), writeIndex: '3' };
  assert.deepEqual(parsearMando(b, ACTUAL).patch, { writeIndex: 3 });
});

test('mando: el índice no puede quedar vacío ni ser decimal', () => {
  assert.ok(parsearMando({ ...borradorMandoDesde(ACTUAL), writeIndex: '' }, ACTUAL).errores.writeIndex);
  assert.ok(parsearMando({ ...borradorMandoDesde(ACTUAL), writeIndex: '2,5' }, ACTUAL).errores.writeIndex);
});

test('mando: en una orden COMPUESTA no se ofrecen ni verbos ni índice', () => {
  // Sus reglas de secuencia son las que impiden energizar dos direcciones a la vez. El servidor lo
  // rechazaría igual; ofrecerlo y que falle sería peor que no ofrecerlo.
  const compuesta: ValoresMando = { ...ACTUAL, compuesta: true };
  const b = borradorMandoDesde(compuesta);
  b.writeIndex = '9';
  b.comandos.push({ verbo: 'close', valor: '8192' });

  const { patch } = parsearMando(b, compuesta);
  assert.equal(patch.writeIndex, undefined);
  assert.equal(patch.writeCommands, undefined);
});

test('mando: el modo de escritura sí se puede cambiar siempre', () => {
  const b = { ...borradorMandoDesde(ACTUAL), writeMode: 'absolute' as const };
  assert.deepEqual(parsearMando(b, ACTUAL).patch, { writeMode: 'absolute' });
});

test('mando: abierta y cerrada no pueden leerse con el mismo valor', () => {
  const b = { ...borradorMandoDesde(ACTUAL), stateOpen: '16384', stateClosed: '16384' };
  assert.ok(parsearMando(b, ACTUAL).errores.stateOpen);

  const bien = { ...borradorMandoDesde(ACTUAL), stateOpen: '16385', stateClosed: '16384' };
  const { patch, errores } = parsearMando(bien, ACTUAL);
  assert.deepEqual(errores, {});
  assert.deepEqual(patch, { stateOpen: 16385, stateClosed: 16384 });
});

test('mando: vaciar el estado se manda como null explícito', () => {
  const con: ValoresMando = { ...ACTUAL, stateOpen: 16385, stateClosed: 16384 };
  const b = { ...borradorMandoDesde(con), stateOpen: '' };
  assert.deepEqual(parsearMando(b, con).patch, { stateOpen: null });
});

test('mando: el resumen lleva la ruta REAL del mapeo, no un nombre inventado', () => {
  // Es lo que permite que quien lea la revisión pueda buscar después ese mismo campo en el JSON.
  const cambios = resumenMando(ACTUAL, { writeCommands: { open: 4096, close: 8192 }, writeIndex: 2 });
  const rutas = cambios.map((c) => c.ingles);
  assert.ok(rutas.includes('write.commands'));
  assert.ok(rutas.includes('write.target.index'));

  const verbos = cambios.find((c) => c.ingles === 'write.commands');
  assert.equal(verbos?.de, 'open=4096');
  assert.equal(verbos?.a, 'close=8192 · open=4096');
});

test('mando: comparar mapas de verbos por contenido, no por referencia', () => {
  assert.equal(mismosComandos({ open: 1, close: 2 }, { close: 2, open: 1 }), true);
  assert.equal(mismosComandos({ open: 1 }, { open: 1, close: 2 }), false);
  assert.equal(mismosComandos({ open: 1 }, { open: 2 }), false);
});

test('mando: se lee de un vistazo', () => {
  assert.equal(comandosComoTexto({ open: 4096, close: 8192 }), 'close=8192 · open=4096');
  assert.equal(comandosComoTexto({}), '(ninguno)');
});
