/**
 * Deduplicación de avisos: qué se calla y qué NO se puede callar.
 *
 * La deduplicación existe para que un problema que dura una semana no genere 144 avisos al día. Pero
 * estaba silenciando algo que no debía: el EMPEORAMIENTO. Estos tests fijan la línea entre ambas
 * cosas, porque es la línea entre una bandeja usable y una que oculta una emergencia.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeDay } from '../src/modules/notifications/notification-day';
import { NotificationRepository, type NewNotification } from '../src/modules/notifications/notification.repository';

/**
 * La clave es privada, así que se observa a través de lo único que importa: si dos avisos colisionan
 * en el índice único. Se captura el primer parámetro del INSERT, que es la clave.
 */
function claveDe(n: NewNotification): string {
  const claves: string[] = [];
  const pool = {
    query: async (_sql: string, params: unknown[]) => {
      claves.push(params[0] as string);
      return [{}] as never;
    },
  };
  const repo = new NotificationRepository(pool as never);
  void repo.create(n);
  return claves[0];
}

const BASE: NewNotification = {
  kind: 'tank_level',
  severity: 'warning',
  plantId: 'carbonero',
  subject: 'tank1',
  title: 'Tanque 1: pasa del máximo',
  message: 'da igual',
  day: '2026-08-18',
};

test('la repetición IDÉNTICA se sigue callando: es para lo que existe la deduplicación', () => {
  assert.equal(claveDe(BASE), claveDe({ ...BASE, title: 'otro título', message: 'otro texto' }));
});

// EL FALLO MÁS GRAVE QUE TENÍA EL SISTEMA. Un tanque que a las 19:05 estaba `indeterminado`
// (warning) y a las 21:00 pasaba a `rebosando` (critical) NO generaba aviso: mismo tipo, misma
// planta, mismo sujeto, mismo día. La escalada a crítico se tragaba en silencio.
test('CLAVE: empeorar SÍ vuelve a avisar, aunque ya se avisara ese día', () => {
  const antes = claveDe({ ...BASE, severity: 'warning' });
  const despues = claveDe({ ...BASE, severity: 'critical' });
  assert.notEqual(antes, despues, 'un aviso que empeora no puede quedarse callado');
});

test('mejorar también avisa: «va a menos» es información útil que antes no llegaba', () => {
  assert.notEqual(claveDe({ ...BASE, severity: 'critical' }), claveDe({ ...BASE, severity: 'warning' }));
});

test('siguen separándose por planta, tipo y sujeto', () => {
  assert.notEqual(claveDe(BASE), claveDe({ ...BASE, plantId: 'voragine' }));
  assert.notEqual(claveDe(BASE), claveDe({ ...BASE, subject: 'tank2' }));
  assert.notEqual(claveDe(BASE), claveDe({ ...BASE, kind: 'sensor_stale' }));
  assert.notEqual(claveDe(BASE), claveDe({ ...BASE, day: '2026-08-19' }));
});

// El día era `toISOString().slice(0,10)`, o sea UTC. Con Colombia en UTC−5 la clave cambiaba a las
// 19:00 hora local: todos los problemas persistentes se re-emitían de golpe, de noche, con la planta
// vacía, y el móvil los colapsaba en un «37 avisos nuevos» sin severidad ni planta. Encima, un aviso
// creado a las 18:55 se repetía a las 19:05.
test('CLAVE: el día del dedupe es LOCAL, no UTC', () => {
  // 2026-08-18 a las 20:00 hora local: en UTC ya es el día 19 si el proceso va por detrás de
  // Greenwich. Lo que se comprueba es que el día sale del reloj local, no del desplazamiento a UTC.
  const tarde = new Date(2026, 7, 18, 20, 0, 0);
  assert.equal(dedupeDay(tarde), '2026-08-18');

  const casiMedianoche = new Date(2026, 7, 18, 23, 59, 0);
  const pasadaMedianoche = new Date(2026, 7, 19, 0, 1, 0);
  assert.equal(dedupeDay(casiMedianoche), '2026-08-18');
  assert.equal(dedupeDay(pasadaMedianoche), '2026-08-19', 'la tanda diaria cae al cambio de fecha real');
});

test('el día se rellena con ceros (una clave de texto se ordena y se compara como texto)', () => {
  assert.equal(dedupeDay(new Date(2026, 0, 5, 12, 0, 0)), '2026-01-05');
});
