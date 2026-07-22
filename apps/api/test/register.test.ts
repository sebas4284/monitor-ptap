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
import { EmailVerificationRepository } from '../src/modules/auth/email-verification.repository';
import { EmailService } from '../src/modules/email/email.service';

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

/** Doble del repo de tokens: `issue` cuenta llamadas y devuelve un token fijo. */
function fakeVerification(): { repo: EmailVerificationRepository; issued: string[] } {
  const issued: string[] = [];
  const repo = {
    issue: async (userId: string) => { issued.push(userId); return { raw: 'raw-token', hash: 'hash' }; },
    invalidateForUser: async () => undefined,
    consume: async () => null,
  } as unknown as EmailVerificationRepository;
  return { repo, issued };
}

/** Doble del correo: registra los enlaces "enviados". */
function fakeEmail(): { service: EmailService; sent: Array<{ to: string; link: string }> } {
  const sent: Array<{ to: string; link: string }> = [];
  const service = {
    sendVerificationEmail: async (to: string, link: string) => { sent.push({ to, link }); },
  } as unknown as EmailService;
  return { service, sent };
}

async function buildApp(
  repo: UsersRepository,
  audit: AuditLogService,
  verification: EmailVerificationRepository = fakeVerification().repo,
  email: EmailService = fakeEmail().service,
): Promise<INestApplication> {
  @Module({
    controllers: [AuthController],
    providers: [
      AuthService,
      JwtService,
      PasswordHashingService,
      { provide: UsersRepository, useValue: repo },
      { provide: AuditLogService, useValue: audit },
      { provide: EmailVerificationRepository, useValue: verification },
      { provide: EmailService, useValue: email },
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
  assert.equal(registerSchema.safeParse({ ...VALID, password: 'Corta1' }).success, false);
});

test('register-schema: exige complejidad de contraseña (mayúscula, minúscula y dígito)', () => {
  assert.equal(registerSchema.safeParse({ ...VALID, password: 'todominuscula1' }).success, false, 'sin mayúscula');
  assert.equal(registerSchema.safeParse({ ...VALID, password: 'TODOMAYUSCULA1' }).success, false, 'sin minúscula');
  assert.equal(registerSchema.safeParse({ ...VALID, password: 'SinNumeros' }).success, false, 'sin dígito');
  assert.equal(registerSchema.safeParse({ ...VALID, password: 'Valida123' }).success, true);
});

test('register-schema: exige email válido, sin desechables, y plant REAL', () => {
  assert.equal(registerSchema.safeParse({ ...VALID, email: 'no-es-email' }).success, false);
  assert.equal(registerSchema.safeParse({ ...VALID, email: 'bot@mailinator.com' }).success, false, 'desechable');
  assert.equal(registerSchema.safeParse({ ...VALID, plant: 'PTAP Norte' }).success, false, 'formato');
  assert.equal(registerSchema.safeParse({ ...VALID, plant: 'planta-inexistente' }).success, false, 'no está en el mapping');
});

test('register-schema: normaliza email (trim + minúsculas)', () => {
  const parsed = registerSchema.parse({ ...VALID, email: '  ANA@PTAP.CO ' });
  assert.equal(parsed.email, 'ana@ptap.co');
});

test('register-schema: rechaza nombre con URL y teléfono inválido', () => {
  assert.equal(registerSchema.safeParse({ ...VALID, name: 'Compra en www.spam.com' }).success, false, 'URL en el nombre');
  assert.equal(registerSchema.safeParse({ ...VALID, phone: 'abc' }).success, false, 'teléfono no numérico');
  assert.equal(registerSchema.safeParse({ ...VALID, phone: '' }).success, true, 'teléfono vacío = omitido');
});

test('register-schema: honeypot con contenido → rechazado', () => {
  assert.equal(registerSchema.safeParse({ ...VALID, website: 'http://bot.com' }).success, false);
  assert.equal(registerSchema.safeParse({ ...VALID, website: '' }).success, true, 'vacío OK');
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
    assert.match(res.body.message, /verificar/i);
  } finally {
    await app.close();
  }
});

test('register: emite un token de verificación y "envía" el correo con el enlace', async () => {
  const repo = fakeRepo();
  const verification = fakeVerification();
  const email = fakeEmail();
  const app = await buildApp(repo, fakeAudit().service, verification.repo, email.service);
  try {
    await request(app.getHttpServer()).post('/api/auth/register').send(VALID).expect(201);
    assert.equal(verification.issued.length, 1, 'debe emitir un token para el usuario creado');
    assert.equal(email.sent.length, 1, 'debe enviar el correo de verificación');
    assert.equal(email.sent[0].to, VALID.email);
    assert.match(email.sent[0].link, /\/api\/auth\/verify-email\?token=raw-token$/);
  } finally {
    await app.close();
  }
});

test('register: el honeypot lleno se rechaza con 400 y no crea usuario', async () => {
  const repo = fakeRepo();
  const app = await buildApp(repo, fakeAudit().service);
  try {
    await request(app.getHttpServer()).post('/api/auth/register').send({ ...VALID, website: 'x' }).expect(400);
    assert.equal(repo.created.length, 0);
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
