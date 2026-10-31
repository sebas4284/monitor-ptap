/**
 * Verificación de correo (anti-bot) — el flujo del AuthService, con dobles (sin MySQL ni HTTP):
 *  - verifyEmail(token): un token válido marca el correo verificado; uno inválido/vencido/usado
 *    NO revela nada (verified:false), y NUNCA marca a nadie.
 *  - resendVerification(email): responde igual exista o no la cuenta (anti-enumeración) y solo
 *    reemite si la cuenta existe y aún no está verificada.
 */
import { test, type TestContext } from 'node:test';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { AuthService } from '../src/modules/auth/auth.service';
import type { UsersRepository, UserRecord } from '../src/modules/users/users.repository';
import type { EmailVerificationRepository } from '../src/modules/auth/email-verification.repository';
import { EmailService } from '../src/modules/email/email.service';
import type { JsonLogger } from '../src/infrastructure/logging/json-logger.service';
import type { AuditLogService, AuditEntry } from '../src/infrastructure/audit/audit-log.service';
import type { PasswordHashingService } from '../src/modules/auth/password-hashing.service';
import type { JwtService } from '../src/modules/auth/jwt.service';

function setEnv(t: TestContext, key: string, value: string): void {
  const previous = process.env[key];
  process.env[key] = value;
  t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
}

function record(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'u1', email: 'ana@ptap.co', name: 'Ana', role: 'civil', plant: 'montebello',
    passwordHash: 'x', pepperVersion: 1, isActive: false, emailVerified: false, ...overrides,
  };
}

function build(opts: {
  consume?: (raw: string) => Promise<string | null>;
  findByEmail?: (email: string) => Promise<UserRecord | null>;
  send?: () => Promise<void>;
}) {
  const verifiedIds: string[] = [];
  const issued: string[] = [];
  const invalidated: string[] = [];
  const sent: Array<{ to: string; link: string }> = [];
  const audit: AuditEntry[] = [];

  const users = {
    findByEmail: opts.findByEmail ?? (async () => null),
    setEmailVerified: async (id: string) => { verifiedIds.push(id); },
  } as unknown as UsersRepository;
  const verification = {
    issue: async (userId: string) => { issued.push(userId); return { raw: 'raw', hash: 'h' }; },
    consume: opts.consume ?? (async () => null),
    invalidateForUser: async (userId: string) => { invalidated.push(userId); },
  } as unknown as EmailVerificationRepository;
  const email = {
    sendVerificationEmail: async (to: string, link: string) => { sent.push({ to, link }); await opts.send?.(); },
  } as unknown as EmailService;
  const auditLog = { record: async (e: AuditEntry) => { audit.push(e); } } as unknown as AuditLogService;

  const service = new AuthService(
    users,
    {} as unknown as PasswordHashingService,
    {} as unknown as JwtService,
    auditLog,
    verification,
    email,
  );
  return { service, verifiedIds, issued, invalidated, sent, audit };
}

test('verifyEmail: token válido → marca el correo verificado y audita', async () => {
  const h = build({ consume: async () => 'u1' });
  const res = await h.service.verifyEmail('raw');
  assert.equal(res.verified, true);
  assert.deepEqual(h.verifiedIds, ['u1']);
  assert.ok(h.audit.some((e) => e.eventType === 'auth.email_verified'));
});

test('verifyEmail: token inválido/vencido/usado → verified:false y NO marca a nadie', async () => {
  const h = build({ consume: async () => null });
  const res = await h.service.verifyEmail('lo-que-sea');
  assert.equal(res.verified, false);
  assert.equal(h.verifiedIds.length, 0);
});

test('resendVerification: cuenta inexistente → no hace nada (respuesta genérica)', async () => {
  const h = build({ findByEmail: async () => null });
  await h.service.resendVerification('nadie@ptap.co');
  assert.equal(h.issued.length, 0);
  assert.equal(h.sent.length, 0);
});

test('resendVerification: cuenta YA verificada → no reenvía', async () => {
  const h = build({ findByEmail: async () => record({ emailVerified: true }) });
  await h.service.resendVerification('ana@ptap.co');
  assert.equal(h.sent.length, 0);
});

test('resendVerification: cuenta sin verificar → invalida tokens previos y reenvía', async () => {
  const h = build({ findByEmail: async () => record({ id: 'u9', emailVerified: false }) });
  await h.service.resendVerification('ana@ptap.co');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(h.invalidated, ['u9']);
  assert.deepEqual(h.issued, ['u9']);
  assert.equal(h.sent.length, 1);
});

test('resendVerification: respuesta genérica no espera SMTP para cuentas existentes y audita fallos sin secretos', async () => {
  let rejectDelivery!: (error: Error) => void;
  const delivery = new Promise<void>((_resolve, reject) => { rejectDelivery = reject; });
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const existing = build({ findByEmail: async () => record(), send: async () => { markStarted(); await delivery; } });
  const missing = build({});
  const resend = existing.service.resendVerification('ana@ptap.co');
  let timer!: ReturnType<typeof setTimeout>;
  try {
    await started;
    const result = await Promise.race([
      resend.then(() => 'returned'),
      new Promise<string>((resolve) => { timer = setTimeout(() => resolve('blocked'), 500); }),
    ]);
    assert.equal(result, 'returned', 'SMTP no puede revelar si existe una cuenta sin verificar');
    assert.equal(await resend, await missing.service.resendVerification('unknown@example.com'));
    assert.deepEqual(missing.issued, []);
    assert.deepEqual(missing.sent, []);
    rejectDelivery(new Error('https://example.com/?token=SYNTHETIC_SECRET'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const entry = existing.audit.find((event) => event.eventType === 'auth.verification_delivery');
    assert.equal(entry?.detail?.outcome, 'failed');
    assert.equal(entry?.path, '/api/auth/resend-verification');
    assert.doesNotMatch(JSON.stringify(existing.audit), /SYNTHETIC_SECRET|example.com/);
  } finally {
    clearTimeout(timer);
    rejectDelivery(new Error('synthetic delivery failure'));
    await resend.catch(() => undefined);
  }
});

test('email: console nunca registra enlaces, tokens ni cuerpos de verificación', async (t) => {
  setEnv(t, 'NODE_ENV', 'development');
  setEnv(t, 'EMAIL_TRANSPORT', 'console');
  const entries: unknown[] = [];
  const logger = { log: (entry: unknown) => entries.push(entry), warn: (entry: unknown) => entries.push(entry) } as unknown as JsonLogger;
  await new EmailService(logger).sendVerificationEmail('synthetic@example.com', 'https://example.com/verify?token=SYNTHETIC_SECRET');
  assert.ok(entries.length > 0, 'deja constancia de que no se envió');
  assert.doesNotMatch(JSON.stringify(entries), /SYNTHETIC_SECRET|example.com\/verify|Confirma tu correo|"body"|"link"/);
});

test('email: producción rechaza SMTP incompleto o console sin filtrar credenciales', async (t) => {
  setEnv(t, 'NODE_ENV', 'production');
  setEnv(t, 'SMTP_HOST', '');
  setEnv(t, 'SMTP_USER', '');
  setEnv(t, 'SMTP_PASS', '');
  const entries: unknown[] = [];
  const logger = { log: (entry: unknown) => entries.push(entry), warn: (entry: unknown) => entries.push(entry) } as unknown as JsonLogger;
  for (const transport of ['smtp', 'console', 'unsupported']) {
    setEnv(t, 'EMAIL_TRANSPORT', transport);
    await assert.rejects(new EmailService(logger).sendVerificationEmail('synthetic@example.com', 'https://example.com/verify?token=SYNTHETIC_SECRET'));
  }
  assert.doesNotMatch(JSON.stringify(entries), /SYNTHETIC_SECRET|example.com\/verify/);
});

test('seed-users: el CLI siembra con contraseña sintética sin imprimirla', async () => {
  const password = 'SYNTHETIC_DEMO_PASSWORD';
  const output: string[] = [];
  const inserts: unknown[][] = [];
  let finish!: () => void;
  const ended = new Promise<void>((resolve) => { finish = resolve; });
  const pool = {
    query: async (sql: string, values: unknown[]) => {
      if (sql.startsWith('INSERT')) inserts.push(values);
      return [[]];
    },
    end: async () => { finish(); },
  };
  const module = { exports: {} };
  const requireStub = Object.assign((name: string) => {
    if (name === '../src/config/load-env') return {};
    if (name === 'node:crypto') return { randomUUID: () => 'synthetic-id' };
    if (name === 'mysql2/promise') return { createPool: () => pool };
    if (name.endsWith('/database.config')) return { readDatabaseConfig: () => ({}) };
    if (name.endsWith('/password-hashing.service')) return {
      PasswordHashingService: class { async hashPassword(value: string) {
        assert.equal(value, password);
        return { passwordHash: 'synthetic-hash', pepperVersion: 1 };
      } },
    };
    throw new Error(`Unexpected script dependency: ${name}`);
  }, { main: module });
  const source = readFileSync('scripts/seed-users.ts', 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(compiled, {
    module, exports: module.exports, require: requireStub,
    process: { env: { SEED_USERS_PASSWORD: password }, exit: () => { throw new Error('unexpected exit'); } },
    console: { log: (...args: unknown[]) => output.push(args.join(' ')), error: (...args: unknown[]) => output.push(args.join(' ')) },
  });
  await ended;
  assert.equal(inserts.length, 4);
  assert.ok(output.some((line) => line.includes('creado')));
  assert.ok(output.every((line) => !line.includes(password)), 'la contraseña nunca debe salir por consola');
});
