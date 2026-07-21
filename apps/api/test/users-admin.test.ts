/**
 * Administración de usuarios (matriz oficial: crear/editar usuarios y asignar roles son
 * exclusivas del Administrador). Se prueba:
 *  - RBAC real por permiso: civil/operador/jefe → 403; admin → 200;
 *  - el cambio de rol queda auditado con from→to y quién lo hizo;
 *  - guard rails: un admin no puede auto-degradarse ni auto-desactivarse.
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Role, UserSummary } from '@ptap/shared';
import { AuditLogService, type AuditEntry } from '../src/infrastructure/audit/audit-log.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../src/modules/auth/guards/permission.guard';
import { JwtService } from '../src/modules/auth/jwt.service';
import { UsersController } from '../src/modules/users/users.controller';
import { UsersRepository, type UserListFilter } from '../src/modules/users/users.repository';
import { UsersService } from '../src/modules/users/users.service';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-users-admin';

const ADMIN_ID = 'admin-id';
const TARGET_ID = 'target-id';

function summary(id: string, role: Role, isActive = true): UserSummary {
  return {
    id, email: `${role}@ptap.co`, name: role, phone: null, role, plant: 'montebello',
    isActive, lastLoginAt: null, createdAt: null,
  };
}

function fakeRepo() {
  const store = new Map<string, UserSummary>([
    [ADMIN_ID, summary(ADMIN_ID, 'admin')],
    [TARGET_ID, summary(TARGET_ID, 'civil')],
  ]);
  const filters: UserListFilter[] = [];
  return {
    store,
    filters,
    list: async (filter: UserListFilter = {}) => {
      filters.push(filter); // para verificar que el filtro llega al SQL, no se aplica en el cliente
      return [...store.values()];
    },
    // Lo usa JwtAuthGuard en cada petición. Los tokens de estos tests van con sub `u-<rol>` o
    // ADMIN_ID; devolver el rol del propio id mantiene coherentes token y "base".
    findById: async (id: string) => {
      const known = store.get(id);
      const role = known?.role ?? id.replace(/^u-/, '');
      return { id, email: `${role}@ptap.co`, name: role, role, plant: 'montebello',
        passwordHash: 'x', pepperVersion: 1, isActive: true };
    },
    findSummaryById: async (id: string) => store.get(id) ?? null,
    updateRole: async (id: string, role: Role) => {
      const u = store.get(id); if (u) store.set(id, { ...u, role });
    },
    setActive: async (id: string, isActive: boolean) => {
      const u = store.get(id); if (u) store.set(id, { ...u, isActive });
    },
  } as unknown as UsersRepository & { store: Map<string, UserSummary>; filters: UserListFilter[] };
}

function fakeAudit(): { service: AuditLogService; calls: AuditEntry[] } {
  const calls: AuditEntry[] = [];
  return { service: { record: async (e: AuditEntry) => { calls.push(e); } } as unknown as AuditLogService, calls };
}

async function buildApp(repo: UsersRepository, audit: AuditLogService) {
  @Module({
    controllers: [UsersController],
    providers: [
      UsersService, JwtAuthGuard, PermissionGuard, JwtService,
      { provide: UsersRepository, useValue: repo },
      { provide: AuditLogService, useValue: audit },
    ],
  })
  class UsersTestModule {}

  const moduleRef = await Test.createTestingModule({ imports: [UsersTestModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
  return { app, jwt: moduleRef.get(JwtService) as JwtService };
}

function tokenFor(jwt: JwtService, role: Role, sub = `u-${role}`): string {
  return jwt.sign({ sub, email: `${role}@ptap.co`, name: role, role, plant: 'montebello' });
}

test('users-admin: GET /api/users → 401 sin token; 403 para civil/operador/jefe; 200 para admin', async () => {
  const { app, jwt } = await buildApp(fakeRepo(), fakeAudit().service);
  try {
    await request(app.getHttpServer()).get('/api/users').expect(401);
    for (const role of ['civil', 'operador', 'jefe'] as Role[]) {
      await request(app.getHttpServer()).get('/api/users').set('Authorization', `Bearer ${tokenFor(jwt, role)}`).expect(403);
    }
    const res = await request(app.getHttpServer())
      .get('/api/users').set('Authorization', `Bearer ${tokenFor(jwt, 'admin', ADMIN_ID)}`).expect(200);
    assert.equal(res.body.users.length, 2);
    // el listado NUNCA debe exponer secretos
    assert.equal('passwordHash' in res.body.users[0], false);
    assert.equal('pepperVersion' in res.body.users[0], false);
  } finally {
    await app.close();
  }
});

test('users-admin: los filtros de la query llegan al repositorio (se resuelven en SQL, no en el cliente)', async () => {
  const repo = fakeRepo();
  const { app, jwt } = await buildApp(repo, fakeAudit().service);
  const admin = `Bearer ${tokenFor(jwt, 'admin', ADMIN_ID)}`;
  try {
    await request(app.getHttpServer()).get('/api/users').set('Authorization', admin).expect(200);
    assert.deepEqual(repo.filters[0], { search: undefined, role: undefined, isActive: undefined }, 'sin query = sin filtro');

    // ?isActive=false es la bandeja de "pendientes de aprobación": debe llegar como booleano
    // false, no como el string "false" (que en JS es truthy y colaría a los activos).
    await request(app.getHttpServer()).get('/api/users?isActive=false').set('Authorization', admin).expect(200);
    assert.equal(repo.filters[1].isActive, false);

    await request(app.getHttpServer()).get('/api/users?isActive=true').set('Authorization', admin).expect(200);
    assert.equal(repo.filters[2].isActive, true);

    await request(app.getHttpServer())
      .get('/api/users?search=ana&role=civil&isActive=false')
      .set('Authorization', admin)
      .expect(200);
    assert.deepEqual(repo.filters[3], { search: 'ana', role: 'civil', isActive: false });
  } finally {
    await app.close();
  }
});

test('users-admin: la query se valida — rol inexistente o parámetro desconocido → 400', async () => {
  const repo = fakeRepo();
  const { app, jwt } = await buildApp(repo, fakeAudit().service);
  const admin = `Bearer ${tokenFor(jwt, 'admin', ADMIN_ID)}`;
  try {
    await request(app.getHttpServer()).get('/api/users?role=superadmin').set('Authorization', admin).expect(400);
    await request(app.getHttpServer()).get('/api/users?isActive=quizas').set('Authorization', admin).expect(400);
    await request(app.getHttpServer()).get('/api/users?limit=99').set('Authorization', admin).expect(400);
    assert.equal(repo.filters.length, 0, 'una query inválida no debe llegar a la base');
  } finally {
    await app.close();
  }
});

test('users-admin: PATCH role → 403 para no-admin (ni el jefe puede asignar roles)', async () => {
  const { app, jwt } = await buildApp(fakeRepo(), fakeAudit().service);
  try {
    for (const role of ['civil', 'operador', 'jefe'] as Role[]) {
      await request(app.getHttpServer())
        .patch(`/api/users/${TARGET_ID}/role`)
        .set('Authorization', `Bearer ${tokenFor(jwt, role)}`)
        .send({ role: 'admin' })
        .expect(403);
    }
  } finally {
    await app.close();
  }
});

test('users-admin: el admin eleva civil→operador y queda auditado con from→to', async () => {
  const repo = fakeRepo();
  const audit = fakeAudit();
  const { app, jwt } = await buildApp(repo, audit.service);
  try {
    const res = await request(app.getHttpServer())
      .patch(`/api/users/${TARGET_ID}/role`)
      .set('Authorization', `Bearer ${tokenFor(jwt, 'admin', ADMIN_ID)}`)
      .send({ role: 'operador' })
      .expect(200);

    assert.equal(res.body.role, 'operador');
    assert.equal(repo.store.get(TARGET_ID)?.role, 'operador');

    const entry = audit.calls.find((c) => c.eventType === 'user.role_changed');
    assert.ok(entry, 'el cambio de rol debe auditarse');
    assert.equal(entry.userId, ADMIN_ID, 'debe registrar QUIÉN lo cambió');
    assert.deepEqual(entry.detail?.from, 'civil');
    assert.deepEqual(entry.detail?.to, 'operador');
    assert.deepEqual(entry.detail?.targetUserId, TARGET_ID);
  } finally {
    await app.close();
  }
});

test('users-admin: rol inválido → 400 (solo civil|operador|jefe|admin)', async () => {
  const { app, jwt } = await buildApp(fakeRepo(), fakeAudit().service);
  try {
    await request(app.getHttpServer())
      .patch(`/api/users/${TARGET_ID}/role`)
      .set('Authorization', `Bearer ${tokenFor(jwt, 'admin', ADMIN_ID)}`)
      .send({ role: 'superuser' })
      .expect(400);
  } finally {
    await app.close();
  }
});

// Guard rails: evitan que un admin se deje fuera del sistema.
test('users-admin: un admin NO puede cambiar su propio rol → 400', async () => {
  const repo = fakeRepo();
  const { app, jwt } = await buildApp(repo, fakeAudit().service);
  try {
    await request(app.getHttpServer())
      .patch(`/api/users/${ADMIN_ID}/role`)
      .set('Authorization', `Bearer ${tokenFor(jwt, 'admin', ADMIN_ID)}`)
      .send({ role: 'civil' })
      .expect(400);
    assert.equal(repo.store.get(ADMIN_ID)?.role, 'admin', 'su rol no debe cambiar');
  } finally {
    await app.close();
  }
});

test('users-admin: un admin NO puede desactivarse a sí mismo → 400', async () => {
  const repo = fakeRepo();
  const { app, jwt } = await buildApp(repo, fakeAudit().service);
  try {
    await request(app.getHttpServer())
      .patch(`/api/users/${ADMIN_ID}/active`)
      .set('Authorization', `Bearer ${tokenFor(jwt, 'admin', ADMIN_ID)}`)
      .send({ isActive: false })
      .expect(400);
    assert.equal(repo.store.get(ADMIN_ID)?.isActive, true);
  } finally {
    await app.close();
  }
});

test('users-admin: el admin puede desactivar a OTRO usuario y queda auditado', async () => {
  const repo = fakeRepo();
  const audit = fakeAudit();
  const { app, jwt } = await buildApp(repo, audit.service);
  try {
    await request(app.getHttpServer())
      .patch(`/api/users/${TARGET_ID}/active`)
      .set('Authorization', `Bearer ${tokenFor(jwt, 'admin', ADMIN_ID)}`)
      .send({ isActive: false })
      .expect(200);
    assert.equal(repo.store.get(TARGET_ID)?.isActive, false);
    assert.ok(audit.calls.some((c) => c.eventType === 'user.active_changed'));
  } finally {
    await app.close();
  }
});
