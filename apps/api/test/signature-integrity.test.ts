/**
 * Vigilancia automática del libro de firmas.
 *
 * El botón de la app no basta: nadie comprueba a diario algo que lleva meses saliendo bien. Si el
 * registro de maniobras es la evidencia que sustituye a la confirmación eléctrica que estas plantas
 * no dan, enterarse de que fue alterado no puede depender de que a alguien se le ocurra mirar.
 *
 * Lo que se fija aquí:
 *  - un aviso POR PLANTA afectada, no uno global que no le llegaría a nadie en concreto;
 *  - crítico y no silenciable, porque tapar la manipulación no puede ser una preferencia;
 *  - con la cadena intacta NO se dice nada (un «todo bien» diario enseña a ignorar la sección);
 *  - sin secreto de firma tampoco se molesta al operario: eso es un fallo de configuración.
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esSilenciable } from '@ptap/shared';
import { SignatureIntegrityDetector } from '../src/modules/commands/signature-integrity.detector';
import type { CommandSignatureService } from '../src/modules/commands/command-signature.service';
import type { NewNotification, NotificationRepository } from '../src/modules/notifications/notification.repository';

type Verificacion = Awaited<ReturnType<CommandSignatureService['verificar']>>;

function build(resultado: Verificacion) {
  const publicados: NewNotification[] = [];
  const firmas = { verificar: async () => resultado } as unknown as CommandSignatureService;
  const avisos = {
    create: async (n: NewNotification) => {
      publicados.push(n);
      return true;
    },
  } as unknown as NotificationRepository;
  return { detector: new SignatureIntegrityDetector(firmas, avisos), publicados };
}

test('cadena intacta: no se publica nada', async () => {
  const { detector, publicados } = build({ firmadas: 14, rotos: [], verificable: true });
  assert.equal(await detector.sweep(), 0);
  assert.equal(publicados.length, 0, 'un «todo bien» diario enseñaría a ignorar la sección');
});

test('sin secreto de firma no se molesta al operario', async () => {
  // No se está firmando nada, que es grave — pero es un fallo de configuración del servidor, no una
  // manipulación del histórico. Va al log, no a la bandeja de quien opera la planta.
  const { detector, publicados } = build({ firmadas: 0, rotos: [], verificable: false });
  assert.equal(await detector.sweep(), 0);
  assert.equal(publicados.length, 0);
});

test('CLAVE: un aviso por planta afectada, crítico y no silenciable', async () => {
  const { detector, publicados } = build({
    firmadas: 20,
    verificable: true,
    rotos: [
      { id: 4, motivo: 'firma_no_coincide', plantId: 'voragine', at: '2026-08-20T10:00:00.000Z' },
      { id: 9, motivo: 'eslabon_no_encaja', plantId: 'voragine', at: '2026-08-21T11:00:00.000Z' },
      { id: 12, motivo: 'firma_no_coincide', plantId: 'sirena', at: '2026-08-22T09:00:00.000Z' },
    ],
  });

  assert.equal(await detector.sweep(), 2, 'dos plantas afectadas, dos avisos');
  assert.deepEqual(
    publicados.map((n) => n.plantId).sort(),
    ['sirena', 'voragine'],
    'el aviso tiene que llegarle al equipo de SU planta',
  );

  for (const n of publicados) {
    assert.equal(n.kind, 'signature_broken');
    assert.equal(n.severity, 'critical');
    assert.equal(esSilenciable(n.kind), false, 'poder callarlo sería poder tapar la manipulación');
    assert.match(n.action ?? '', /NO borrar nada|no borres nada/i);
    // Sin `eventId`: la deduplicación por defecto deja un aviso por planta y día. Repetirlo cada
    // 6 h solo enseñaría a ignorarlo.
    assert.equal(n.eventId, undefined);
  }
});

test('el mensaje distingue una fila editada de una que falta', async () => {
  const { detector, publicados } = build({
    firmadas: 20,
    verificable: true,
    rotos: [
      { id: 4, motivo: 'firma_no_coincide', plantId: 'voragine', at: '2026-08-20T10:00:00.000Z' },
      { id: 9, motivo: 'eslabon_no_encaja', plantId: 'voragine', at: '2026-08-21T11:00:00.000Z' },
    ],
  });
  await detector.sweep();

  const m = publicados[0].message;
  // Las dos averías llevan a buscar cosas distintas: alguien editó un registro, o alguien lo quitó.
  assert.match(m, /modificada/i);
  assert.match(m, /borra o se inserta/i);
  assert.match(m, /20 maniobras firmadas/, 'sitúa el daño sobre el total');
  assert.match(m, /20\/08/, 'dice desde cuándo');
});

test('una sola fila rota se cuenta en singular', async () => {
  const { detector, publicados } = build({
    firmadas: 3,
    verificable: true,
    rotos: [{ id: 2, motivo: 'firma_no_coincide', plantId: 'km18', at: '2026-08-22T08:00:00.000Z' }],
  });
  await detector.sweep();
  assert.match(publicados[0].message, /1 maniobra fue modificada/);
});

test('un fallo al verificar no tumba el barrido', async () => {
  const firmas = {
    verificar: async () => {
      throw new Error('base caída');
    },
  } as unknown as CommandSignatureService;
  const avisos = { create: async () => true } as unknown as NotificationRepository;
  const detector = new SignatureIntegrityDetector(firmas, avisos);

  // No poder comprobar NO es lo mismo que estar roto: se registra y se sigue, sin asustar a nadie
  // con un aviso de manipulación que no consta.
  assert.equal(await detector.sweep(), 0);
});
