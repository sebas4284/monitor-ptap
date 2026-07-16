/**
 * Registro público (auto-registro). Dos garantías centrales, ambas del servidor:
 *  1. La cuenta nace SIEMPRE con rol 'civil' y el cliente NO puede influir — el schema
 *     `.strict()` rechaza el campo `role` con 400 en vez de ignorarlo en silencio.
 *  2. La cuenta nace PENDIENTE de aprobación: no se devuelve token, así que registrarse no
 *     da acceso. Es la defensa contra cuentas falsas/fantasma.
 * Se prueba contra el AuthService real con un UsersRepository/AuditLog dobles (sin MySQL) y
 * el esquema zod real vía el controller.
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuditLogService, type AuditEntry } from '../src/infrastructure/audit/audit-log.service';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { JwtService } from '../src/modules/auth/jwt.service';
import { PasswordHashingService } from '../src/modules/auth/password-hashing.service';
import { registerSchema } from '../src/modules/auth/dto/register.dto';
import { DUPLICATE_ENTRY, UsersRepository, type NewUser } from '../src/modules/users/users.repository';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-register';
process.env.PASSWORD_PEPPER_CURRENT_VERSION = process.env.PASSWORD_PEPPER_CURRENT_VERSION ?? '1';
process.env.PASSWORD_PEPPER_V1_BASE64 =
  process.env.PASSWORD_PEPPER_V1_BASE64 ?? Buffer.alloc(64, 7).toString('base64');

const VALID = { name: 'Ana Ruiz', email: 'ana@ptap.co', phone: '3001234567', plant: 'montebello', password: 'Secreta123!' };

function fakeRepo(existingEmails: string[] = []) {
  const created: NewUser[] = [];
  const emails = new Set(existingEmails);
  const repo = {
    created,
    create: async (u: NewUser) => {
      if (emails.has(u.email)) {
        const err = new Error('dup') as Error & { code: string };
        err.code = DUPLICATE_ENTRY;
        throw err;
      }
      emails.add(u.email);
      created.push(u);
    },
  };
  return repo as unknown as UsersRepository & { created: NewUser[] };
}

function fakeAudit(): { service: AuditLogService; calls: AuditEntry[] } {
  const calls: AuditEntry[] = [];
  return { service: { record: async (e: AuditEntry) => { calls.push(e); } } as unknown as AuditLogService, calls };
}

async function buildApp(repo: UsersRepository, audit: AuditLogService): Promise<INestApplication> {
  @Module({
    controllers: [AuthController],
    providers: [
      AuthService,
      JwtService,
      PasswordHashingService,
      { provide: UsersRepository, useValue: repo },
      { provide: AuditLogService, useValue: audit },
    ],
  })
  class RegisterTestModule {}

  const moduleRef = await Test.createTestingModule({ imports: [RegisterTestModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
  return app;
}

// ── El schema es la primera línea de defensa (unitario, sin HTTP) ──

test('register-schema: rechaza `role` en el body (.strict) — nadie se auto-asigna admin', () => {
  const result = registerSchema.safeParse({ ...VALID, role: 'admin' });
  assert.equal(result.success, false, 'mandar role DEBE fallar la validación');
});

test('register-schema: acepta un body válido sin role', () => {
  assert.equal(registerSchema.safeParse(VALID).success, true);
});

test('register-schema: exige password de al menos 8 caracteres', () => {
  assert.equal(registerSchema.safeParse({ ...VALID, password: 'corta' }).success, false);
});

test('register-schema: exige email válido y plant en formato slug', () => {
  assert.equal(registerSchema.safeParse({ ...VALID, email: 'no-es-email' }).success, false);
  assert.equal(registerSchema.safeParse({ ...VALID, plant: 'PTAP Norte' }).success, false);
});

// ── End-to-end por HTTP ──

test('register: crea la cuenta SIEMPRE con rol civil', async () => {
  const repo = fakeRepo();
  const audit = fakeAudit();
  const app = await buildApp(repo, audit.service);
  try {
    await request(app.getHttpServer()).post('/api/auth/register').send(VALID).expect(201);
    // lo persistido es civil (el rol lo fija el servidor, no el cliente)
    assert.equal(repo.created[0].role, 'civil');
    assert.equal(repo.created[0].email, VALID.email);
    assert.equal(repo.created[0].phone, VALID.phone);
  } finally {
    await app.close();
  }
});

test('register: NO devuelve token — la cuenta queda pendiente de aprobación', async () => {
  const repo = fakeRepo();
  const audit = fakeAudit();
  const app = await buildApp(repo, audit.service);
  try {
    const res = await request(app.getHttpServer()).post('/api/auth/register').send(VALID).expect(201);
    assert.equal(res.body.status, 'pending_approval');
    assert.equal(res.body.email, VALID.email);
    assert.equal(res.body.token, undefined, 'registrarse NO puede dar sesión: la aprueba un admin');
    assert.equal(res.body.user, undefined);
    assert.match(res.body.message, /pendiente de aprobación/i);
  } finally {
    await app.close();
  }
});

test('register: enviar role:"admin" → 400 y NO se crea nada', async () => {
  const repo = fakeRepo();
  const audit = fakeAudit();
  const app = await buildApp(repo, audit.service);
  try {
    await request(app.getHttpServer()).post('/api/auth/register').send({ ...VALID, role: 'admin' }).expect(400);
    assert.equal(repo.created.length, 0, 'no debe crearse ningún usuario');
  } finally {
    await app.close();
  }
});

test('register: email duplicado → 409', async () => {
  const repo = fakeRepo([VALID.email]);
  const audit = fakeAudit();
  const app = await buildApp(repo, audit.service);
  try {
    await request(app.getHttpServer()).post('/api/auth/register').send(VALID).expect(409);
    assert.ok(audit.calls.some((c) => c.eventType === 'auth.register_rejected'));
  } finally {
    await app.close();
  }
});

test('register: el alta queda auditada como auth.register con rol civil', async () => {
  const repo = fakeRepo();
  const audit = fakeAudit();
  const app = await buildApp(repo, audit.service);
  try {
    await request(app.getHttpServer()).post('/api/auth/register').send(VALID).expect(201);
    const entry = audit.calls.find((c) => c.eventType === 'auth.register');
    assert.ok(entry, 'debe auditarse el registro');
    assert.equal(entry.role, 'civil');
    assert.equal(entry.userEmail, VALID.email);
    assert.equal((entry.detail as { status?: string }).status, 'pending_approval');
  } finally {
    await app.close();
  }
});
