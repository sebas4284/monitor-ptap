/**
 * Firma encadenada de las maniobras de válvula.
 *
 * POR QUÉ EXISTE ESTO. En estas plantas no hay forma electrónica de confirmar que una válvula se
 * abrió: el PLC no publica un estado fiable y lo que se ve se deduce del caudal. Si el equipo no
 * puede dar fe de la maniobra, la única evidencia posible es el registro de quién dio la orden — y
 * un registro que se pueda retocar después no es evidencia de nada.
 *
 * Lo que estos casos fijan es exactamente eso: que tocar el histórico se note. Cada uno reproduce
 * una forma concreta de manipularlo (cambiar un dato, borrar una fila, colar una inventada,
 * reordenar) y comprueba que la verificación la señala.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  firmaCorta,
  sellar,
  selloCoincide,
  textoCanonico,
  verificarCadena,
  type CommandFacts,
} from '../src/modules/commands/command-signature';
import { avisoDeManiobra } from '../src/modules/commands/valve-notice';

const SECRETO = 'secreto-de-prueba-que-no-es-el-de-produccion';

function maniobra(id: number, over: Partial<CommandFacts> = {}): CommandFacts {
  return {
    id,
    at: `2026-08-21T1${id}:00:00.000Z`,
    plantId: 'voragine',
    target: 'valve1',
    command: 'open',
    status: 'confirmed',
    userId: `u-${id}`,
    userName: 'Ana Ruiz',
    userEmail: 'ana@ptap.co',
    role: 'operador',
    writtenValue: '4096',
    confirmedValue: '4096',
    ...over,
  };
}

/** Encadena una lista de maniobras como lo haría el servicio, y devuelve las filas ya selladas. */
function cadena(hechos: CommandFacts[]): (CommandFacts & { signature: string; prevSignature: string | null })[] {
  let previo: string | null = null;
  return hechos.map((h) => {
    const signature = sellar(h, previo, SECRETO);
    const fila = { ...h, signature, prevSignature: previo };
    previo = signature;
    return fila;
  });
}

test('una cadena intacta verifica sin eslabones rotos', () => {
  const filas = cadena([maniobra(1), maniobra(2, { command: 'close' }), maniobra(3)]);
  assert.deepEqual(verificarCadena(filas, SECRETO), []);
});

test('cambiar QUIÉN dio la orden rompe la firma de esa fila', () => {
  const filas = cadena([maniobra(1), maniobra(2), maniobra(3)]);
  // El ataque realista: alguien con acceso a la base cambia el nombre para que la maniobra parezca
  // de otra persona. Es exactamente lo que la firma tiene que impedir que pase inadvertido.
  filas[1].userName = 'Otro Nombre';
  const rotos = verificarCadena(filas, SECRETO);
  assert.deepEqual(rotos, [{ id: 2, motivo: 'firma_no_coincide' }]);
});

test('cambiar la maniobra (abrir por cerrar) también se detecta', () => {
  const filas = cadena([maniobra(1), maniobra(2)]);
  filas[0].command = 'close';
  assert.deepEqual(verificarCadena(filas, SECRETO), [{ id: 1, motivo: 'firma_no_coincide' }]);
});

test('BORRAR una maniobra del medio rompe el eslabón siguiente', () => {
  const filas = cadena([maniobra(1), maniobra(2), maniobra(3)]);
  const sinLaDelMedio = [filas[0], filas[2]];
  // Es el caso que un sello por fila NO detectaría: las dos que quedan siguen siendo válidas por
  // separado. Lo que delata el borrado es que la tercera apunta a un sello que ya no está.
  assert.deepEqual(verificarCadena(sinLaDelMedio, SECRETO), [{ id: 3, motivo: 'eslabon_no_encaja' }]);
});

test('COLAR una maniobra inventada no cuela', () => {
  const filas = cadena([maniobra(1), maniobra(2)]);
  const falsa = { ...maniobra(99), signature: 'a'.repeat(64), prevSignature: filas[0].signature };
  const conFalsa = [filas[0], falsa, filas[1]];
  const rotos = verificarCadena(conFalsa, SECRETO);
  assert.ok(
    rotos.some((r) => r.id === 99 && r.motivo === 'firma_no_coincide'),
    'la fila inventada no lleva una firma válida',
  );
  assert.ok(
    rotos.some((r) => r.id === 2 && r.motivo === 'eslabon_no_encaja'),
    'y además desencaja a la que venía después',
  );
});

test('con OTRO secreto, ninguna firma verifica', () => {
  const filas = cadena([maniobra(1), maniobra(2)]);
  const rotos = verificarCadena(filas, 'otro-secreto');
  assert.equal(rotos.length, 2);
  assert.ok(rotos.every((r) => r.motivo === 'firma_no_coincide'));
});

test('el texto canónico distingue null de cadena vacía y no se puede confundir por los bordes', () => {
  const conNull = textoCanonico(maniobra(1, { userName: null }));
  const conVacio = textoCanonico(maniobra(1, { userName: '' }));
  assert.notEqual(conNull, conVacio, 'null y "" no pueden producir la misma firma');

  // Sin un separador imposible, mover un carácter de un campo al siguiente daría el mismo texto.
  const a = textoCanonico(maniobra(1, { target: 'valve', command: '1open' }));
  const b = textoCanonico(maniobra(1, { target: 'valve1', command: 'open' }));
  assert.notEqual(a, b);
});

test('selloCoincide compara bien, incluida la longitud', () => {
  const s = sellar(maniobra(1), null, SECRETO);
  assert.equal(selloCoincide(s, s), true);
  assert.equal(selloCoincide(s, s.slice(0, 30)), false);
  assert.equal(selloCoincide(s, 'b'.repeat(64)), false);
});

test('la firma corta es lo que se enseña, y sigue identificando la maniobra', () => {
  const s = sellar(maniobra(1), null, SECRETO);
  assert.equal(firmaCorta(s)?.length, 12);
  assert.equal(firmaCorta(null), null);
  assert.notEqual(firmaCorta(s), firmaCorta(sellar(maniobra(2), null, SECRETO)));
});

test('el aviso dice quién, qué válvula y a qué hora, y no afirma lo que no se sabe', () => {
  const base = {
    userName: 'Ana Ruiz',
    userEmail: 'ana@ptap.co',
    valveName: 'Válvula de entrada',
    command: 'open',
    at: '2026-08-21T14:35:00',
    firma: 'a3f9c2d10e4b',
  };

  const confirmada = avisoDeManiobra({ ...base, status: 'confirmed', estadoVerificado: true });
  assert.match(confirmada.title, /Ana Ruiz abrió Válvula de entrada/);
  assert.match(confirmada.message, /14:35/);
  assert.match(confirmada.message, /a3f9c2d10e4b/);
  assert.equal(confirmada.severity, 'info');

  // El caso de estas plantas: el canal de comando responde, pero NADIE puede confirmar que la
  // válvula se movió. El aviso no puede decir "confirmada".
  const sinEstado = avisoDeManiobra({ ...base, status: 'confirmed', estadoVerificado: false });
  assert.equal(sinEstado.severity, 'warning');
  assert.match(sinEstado.message, /no reporta el estado eléctrico|no se puede confirmar/i);
  assert.match(sinEstado.action ?? '', /Verificar en sitio/i);

  const rechazada = avisoDeManiobra({ ...base, status: 'rejected', estadoVerificado: true });
  assert.match(rechazada.message, /NO se tocó/);

  const fallida = avisoDeManiobra({ ...base, status: 'failed', estadoVerificado: true });
  assert.equal(fallida.severity, 'warning');
  assert.match(fallida.action ?? '', /Verificar en sitio/i);
});

test('sin nombre, el aviso cae al correo antes que a un identificador ilegible', () => {
  const a = avisoDeManiobra({
    userName: null,
    userEmail: 'ana@ptap.co',
    valveName: 'Válvula de salida',
    command: 'close',
    status: 'confirmed',
    at: '2026-08-21T09:05:00',
    firma: null,
    estadoVerificado: true,
  });
  assert.match(a.title, /ana@ptap\.co cerró Válvula de salida/);
  // Ojo con la comprobación ingenua: "confirmada" CONTIENE "firma". Se busca el sello de verdad.
  assert.ok(!/firma [0-9a-f]{6,}/.test(a.message), 'sin firma no se inventa un sello');
});
