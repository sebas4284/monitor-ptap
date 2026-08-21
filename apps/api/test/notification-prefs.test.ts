/**
 * Preferencias de notificación: qué avisa y qué no.
 *
 * El problema real: la app avisaba de TODO. Con 110 señales repartidas en doce plantas, un mal día
 * llena la bandeja de decenas de avisos de los que uno o dos exigen moverse — y cuando todo grita,
 * no se lee nada. Poder callar lo que a uno no le toca es lo que hace que se lea el resto.
 *
 * Lo que se prueba aquí, y por qué cada cosa:
 *
 *  1. **Sin preferencias llega todo.** Nadie tiene que configurar nada; quien no entre a Ajustes
 *     recibe exactamente lo mismo que antes.
 *  2. **La campana y la bandeja no pueden discrepar.** Es el fallo concreto que este diseño existe
 *     para hacer imposible: si `countUnseen` contara lo que `listRecent` no muestra, el número
 *     nunca bajaría a cero.
 *  3. **Silenciar no borra.** El aviso sigue en la base y se puede pedir a propósito.
 *  4. **El horario no filtra nada**, solo calla el dispositivo — y lo crítico lo atraviesa.
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Pool } from 'mysql2/promise';
import { debeSonar, NOTIFICATION_PREFS_DEFAULT, type Role } from '@ptap/shared';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../src/modules/auth/guards/permission.guard';
import { JwtService } from '../src/modules/auth/jwt.service';
import { UsersRepository } from '../src/modules/users/users.repository';
import { MYSQL_POOL } from '../src/infrastructure/database/database.tokens';
import {
  NotificationRepository,
  scopeFilter,
  severidadesDesde,
} from '../src/modules/notifications/notification.repository';
import { NotificationPrefsRepository } from '../src/modules/notifications/notification-prefs.repository';
import { NotificationsController } from '../src/modules/notifications/notifications.controller';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-notification-prefs';

const USUARIO = { id: 'u-jefe-voragine', role: 'jefe' as Role, plant: 'voragine' };

/** Un día normal en Vorágine: mucho ruido de señal y un par de avisos que sí importan. */
const AVISOS = [
  { id: 5, plant_id: 'voragine', kind: 'signal_out_of_range', severity: 'warning' },
  { id: 4, plant_id: 'voragine', kind: 'signal_out_of_range', severity: 'critical' },
  { id: 3, plant_id: 'voragine', kind: 'sensor_stale', severity: 'warning' },
  { id: 2, plant_id: 'voragine', kind: 'tank_autonomy', severity: 'warning' },
  { id: 1, plant_id: 'voragine', kind: 'tank_level', severity: 'critical' },
];

interface Consulta {
  sql: string;
  params: unknown[];
}

/**
 * Pool falso que aplica el filtro leyendo el SQL, no adivinándolo.
 *
 * Es la parte que da valor al test: si el `WHERE` no lleva la condición, aquí no se filtra nada y
 * el test falla. Un doble que filtrara por su cuenta pasaría aunque el SQL estuviera vacío.
 */
function fakePool(prefs: Record<string, unknown> | null): { pool: Pool; consultas: Consulta[] } {
  const consultas: Consulta[] = [];
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      consultas.push({ sql, params });
      if (/FROM notification_prefs/i.test(sql)) return [prefs ? [prefs] : [], undefined];
      if (/INSERT INTO notification_prefs/i.test(sql)) return [{ affectedRows: 1 }, undefined];

      let visibles = AVISOS.filter((a) => !sql.includes('n.plant_id = ?') || params.includes(a.plant_id));

      // Los parámetros van en el orden del WHERE: [userId, horas, planta?, ...mudos, ...sev, limit?].
      let i = params.indexOf(USUARIO.plant);
      i = i < 0 ? 2 : i + 1;

      const mudos = sql.match(/n\.kind NOT IN \(([?,]+)\)/);
      if (mudos) {
        const cuantos = mudos[1].split(',').length;
        const lista = params.slice(i, i + cuantos);
        i += cuantos;
        visibles = visibles.filter((a) => !lista.includes(a.kind));
      }

      const sev = sql.match(/n\.severity IN \(([?,]+)\)/);
      if (sev) {
        const lista = params.slice(i, i + sev[1].split(',').length);
        visibles = visibles.filter((a) => lista.includes(a.severity));
      }

      if (/^\s*SELECT COUNT/i.test(sql)) return [[{ n: visibles.length }], undefined];
      if (/^\s*INSERT IGNORE/i.test(sql)) return [{ affectedRows: visibles.length }, undefined];
      return [
        visibles.map((a) => ({
          ...a,
          subject: null,
          title: `Aviso ${a.id}`,
          message: 'detalle',
          action: null,
          created_at: new Date('2026-08-21T12:00:00Z'),
          seen: 0,
        })),
        undefined,
      ];
    },
  } as unknown as Pool;
  return { pool, consultas };
}

async function buildApp(pool: Pool) {
  @Module({
    controllers: [NotificationsController],
    providers: [
      NotificationRepository,
      NotificationPrefsRepository,
      JwtAuthGuard,
      PermissionGuard,
      JwtService,
      { provide: MYSQL_POOL, useValue: pool },
      {
        provide: UsersRepository,
        useValue: {
          findById: async (id: string) =>
            id === USUARIO.id
              ? {
                  ...USUARIO,
                  email: 'jefe@ptap.co',
                  name: 'Jefe',
                  passwordHash: 'x',
                  pepperVersion: 1,
                  isActive: true,
                }
              : null,
        } as unknown as UsersRepository,
      },
    ],
  })
  class TestModule {}

  const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
  const jwt = moduleRef.get(JwtService) as JwtService;
  const token = jwt.sign({
    sub: USUARIO.id,
    email: 'jefe@ptap.co',
    name: 'Jefe',
    role: USUARIO.role,
    plant: USUARIO.plant,
  });
  return { app, token };
}

const PREFS_SIN_SENAL = {
  kinds_silenciados: JSON.stringify(['signal_out_of_range']),
  min_severidad: 'info',
  silencio_desde: null,
  silencio_hasta: null,
};

test('sin preferencias guardadas llega todo, como siempre', async () => {
  const { pool, consultas } = fakePool(null);
  const { app, token } = await buildApp(pool);
  try {
    const res = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.equal(res.body.notifications.length, AVISOS.length);
    assert.equal(res.body.unseen, AVISOS.length);
    // Y no se cuela una condición que no acota: con `info` pasan las tres severidades.
    assert.ok(consultas.every((c) => !c.sql.includes('n.severity IN')));
  } finally {
    await app.close();
  }
});

test('un tipo silenciado desaparece de la bandeja Y de la campana, con el mismo número', async () => {
  const { pool } = fakePool(PREFS_SIN_SENAL);
  const { app, token } = await buildApp(pool);
  try {
    const res = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const kinds = res.body.notifications.map((n: { kind: string }) => n.kind);
    assert.ok(!kinds.includes('signal_out_of_range'), 'lo silenciado no debe aparecer');
    assert.equal(res.body.notifications.length, 3);

    // LA prueba que importa: la campana y la bandeja dan lo mismo.
    assert.equal(res.body.unseen, res.body.notifications.length);

    const campana = await request(app.getHttpServer())
      .get('/api/notifications/unseen-count')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.equal(campana.body.unseen, res.body.unseen, 'los dos endpoints deben contar igual');
  } finally {
    await app.close();
  }
});

test('silenciar no borra: los avisos siguen ahí si se piden a propósito', async () => {
  const { pool } = fakePool(PREFS_SIN_SENAL);
  const { app, token } = await buildApp(pool);
  try {
    const res = await request(app.getHttpServer())
      .get('/api/notifications?incluirSilenciados=1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.equal(res.body.notifications.length, AVISOS.length, 'el historial es evidencia: no se pierde');
    // Pero la campana sigue reflejando SOLO lo que el usuario pidió que le reclamara la atención.
    assert.equal(res.body.unseen, 3);
  } finally {
    await app.close();
  }
});

test('la gravedad mínima acota, y solo deja pasar lo grave', async () => {
  const { pool } = fakePool({
    kinds_silenciados: null,
    min_severidad: 'critical',
    silencio_desde: null,
    silencio_hasta: null,
  });
  const { app, token } = await buildApp(pool);
  try {
    const res = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const sev = res.body.notifications.map((n: { severity: string }) => n.severity);
    assert.deepEqual([...new Set(sev)], ['critical']);
    assert.equal(res.body.notifications.length, 2);
    assert.equal(res.body.unseen, 2);
  } finally {
    await app.close();
  }
});

test('las preferencias se guardan a nombre de quien pide, nunca del cuerpo', async () => {
  const guardadas: unknown[][] = [];
  const { pool } = fakePool(null);
  const original = pool.query.bind(pool) as (sql: string, params?: unknown[]) => Promise<unknown>;
  (pool as unknown as { query: unknown }).query = async (sql: string, params: unknown[] = []) => {
    if (/INSERT INTO notification_prefs/i.test(sql)) guardadas.push(params);
    return original(sql, params);
  };
  const { app, token } = await buildApp(pool);
  try {
    const res = await request(app.getHttpServer())
      .put('/api/notifications/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ mutedKinds: ['sensor_stale'], minSeverity: 'warning', quietFrom: '22:00', quietTo: '06:00' })
      .expect(200);
    assert.deepEqual(res.body.mutedKinds, ['sensor_stale']);
    assert.equal(guardadas.length, 1);
    assert.equal(guardadas[0][0], USUARIO.id);
  } finally {
    await app.close();
  }
});

test('media franja de silencio se rechaza en vez de guardarse a medias', async () => {
  const { pool } = fakePool(null);
  const { app, token } = await buildApp(pool);
  try {
    await request(app.getHttpServer())
      .put('/api/notifications/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ mutedKinds: [], minSeverity: 'info', quietFrom: '22:00', quietTo: null })
      .expect(400);
  } finally {
    await app.close();
  }
});

test('severidadesDesde: el mínimo incluye lo peor, nunca al revés', () => {
  assert.deepEqual(severidadesDesde('info'), ['info', 'warning', 'critical']);
  assert.deepEqual(severidadesDesde('warning'), ['warning', 'critical']);
  assert.deepEqual(severidadesDesde('critical'), ['critical']);
});

test('scopeFilter: pedir lo silenciado ignora las preferencias, jamás el filtro de planta', () => {
  const f = scopeFilter({
    plantScope: 'voragine',
    mutedKinds: ['sensor_stale'],
    minSeverity: 'critical',
    includeMuted: true,
  });
  assert.ok(f.sql.includes('n.plant_id = ?'), 'la planta NUNCA se puede saltar');
  assert.ok(!f.sql.includes('n.kind NOT IN'));
  assert.ok(!f.sql.includes('n.severity IN'));
  assert.deepEqual(f.params, ['voragine']);
});

test('el horario de silencio calla el dispositivo, y lo crítico lo atraviesa', () => {
  const nocturno = { ...NOTIFICATION_PREFS_DEFAULT, quietFrom: '22:00', quietTo: '06:00' };
  const madrugada = new Date('2026-08-21T03:00:00');

  assert.equal(debeSonar('warning', nocturno, madrugada), false, 'un aviso normal no despierta a nadie');
  assert.equal(debeSonar('critical', nocturno, madrugada), true, 'un tanque rebosando suena a las 3 a. m.');
  assert.equal(debeSonar('warning', nocturno, new Date('2026-08-21T15:00:00')), true);
  // Los bordes: a las 22:00 ya calla, a las 06:00 ya no.
  assert.equal(debeSonar('warning', nocturno, new Date('2026-08-21T22:00:00')), false);
  assert.equal(debeSonar('warning', nocturno, new Date('2026-08-21T06:00:00')), true);
  assert.equal(debeSonar('warning', NOTIFICATION_PREFS_DEFAULT, madrugada), true, 'sin franja, suena siempre');

  // Franja que NO cruza la medianoche, que es la otra rama del cálculo.
  const siesta = { ...NOTIFICATION_PREFS_DEFAULT, quietFrom: '13:00', quietTo: '15:00' };
  assert.equal(debeSonar('warning', siesta, new Date('2026-08-21T14:00:00')), false);
  assert.equal(debeSonar('warning', siesta, new Date('2026-08-21T16:00:00')), true);
});
