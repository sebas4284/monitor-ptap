/**
 * Login: qué se le dice a quién. Tres respuestas distintas y el ORDEN en que se deciden:
 *  - credenciales malas → 401 genérico (nunca revela si el correo existe);
 *  - credenciales buenas + cuenta pendiente/desactivada → 403 explicando la situación;
 *  - credenciales buenas + cuenta activa → 200 con JWT.
 *
 * El caso que de verdad protege: cuenta pendiente + contraseña MALA → 401, no 403. Si
 * respondiera 403 ahí, cualquiera podría enumerar los correos registrados probando
 * contraseñas al azar. Por eso el chequeo de `isActive` va DESPUÉS de verificar la contraseña.
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
import { UsersRepository, type UserRecord } from '../src/modules/users/users.repository';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-login';
process.env.PASSWORD_PEPPER_CURRENT_VERSION = process.env.PASSWORD_PEPPER_CURRENT_VERSION ?? '1';
process.env.PASSWORD_PEPPER_V1_BASE64 =
  process.env.PASSWORD_PEPPER_V1_BASE64 ?? Buffer.alloc(64, 9).toString('base64');

const PASSWORD = 'Secreta123!';
const EMAIL = 'ana@ptap.co';

/** Repo doble con UN usuario, cuyo `isActive` decide cada test. Hash real (Argon2id + pepper). */
async function fakeRepo(isActive: boolean): Promise<UsersRepository & { touched: string[] }> {
  const hashing = new PasswordHashingService();
  const { passwordHash, pepperVersion } = await hashing.hashPassword(PASSWORD);
  const record: UserRecord = {
    id: 'u-1',
    email: EMAIL,
    name: 'Ana Ruiz',
    role: 'civil',
    plant: 'montebello',
    passwordHash,
    pepperVersion,
    isActive,
  };
  const touched: string[] = [];
  return {
    touched,
    findByEmail: async (email: string) => (email === record.email ? record : null),
    touchLastLogin: async (id: string) => {
      touched.push(id);
    },
  } as unknown as UsersRepository & { touched: string[] };
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
  class LoginTestModule {}

  const moduleRef = await Test.createTestingModule({ imports: [LoginTestModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
  return app;
}

test('login: cuenta activa + contraseña correcta → 200 con JWT', async () => {
  const repo = await fakeRepo(true);
  const app = await buildApp(repo, fakeAudit().service);
  try {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);
    assert.equal(res.body.token.split('.').length, 3, 'debe ser un JWT');
    assert.equal(res.body.user.role, 'civil');
    assert.deepEqual(repo.touched, ['u-1'], 'debe registrar el último acceso');
  } finally {
    await app.close();
  }
});

test('login: cuenta PENDIENTE + contraseña correcta → 403 explicando que falta la aprobación', async () => {
  const repo = await fakeRepo(false);
  const audit = fakeAudit();
  const app = await buildApp(repo, audit.service);
  try {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(403);
    assert.match(res.body.message, /pendiente de aprobación/i);
    assert.equal(res.body.token, undefined, 'una cuenta sin aprobar NO recibe sesión');
    assert.deepEqual(repo.touched, [], 'no hubo acceso: no debe tocarse last_login_at');
    assert.ok(audit.calls.some((c) => c.eventType === 'auth.login_failed'));
  } finally {
    await app.close();
  }
});

test('login: cuenta PENDIENTE + contraseña MALA → 401 genérico (no filtra que el correo existe)', async () => {
  const repo = await fakeRepo(false);
  const app = await buildApp(repo, fakeAudit().service);
  try {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: EMAIL, password: 'otra-cosa-123' })
      .expect(401);
    assert.match(res.body.message, /credenciales inválidas/i);
    assert.doesNotMatch(
      res.body.message,
      /pendiente|aprobación|desactivada/i,
      'con contraseña mala NO puede revelarse el estado de la cuenta: sería enumeración de correos',
    );
  } finally {
    await app.close();
  }
});

test('login: correo inexistente → 401 idéntico al de contraseña mala', async () => {
  const repo = await fakeRepo(true);
  const app = await buildApp(repo, fakeAudit().service);
  try {
    const desconocido = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'nadie@ptap.co', password: PASSWORD })
      .expect(401);
    const malaPassword = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: EMAIL, password: 'otra-cosa-123' })
      .expect(401);
    assert.equal(
      desconocido.body.message,
      malaPassword.body.message,
      'ambas respuestas deben ser indistinguibles para el atacante',
    );
  } finally {
    await app.close();
  }
});
