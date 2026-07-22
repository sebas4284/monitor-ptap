/**
 * Verificación de correo (anti-bot) — el flujo del AuthService, con dobles (sin MySQL ni HTTP):
 *  - verifyEmail(token): un token válido marca el correo verificado; uno inválido/vencido/usado
 *    NO revela nada (verified:false), y NUNCA marca a nadie.
 *  - resendVerification(email): responde igual exista o no la cuenta (anti-enumeración) y solo
 *    reemite si la cuenta existe y aún no está verificada.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../src/modules/auth/auth.service';
import type { UsersRepository, UserRecord } from '../src/modules/users/users.repository';
import type { EmailVerificationRepository } from '../src/modules/auth/email-verification.repository';
import type { EmailService } from '../src/modules/email/email.service';
import type { AuditLogService, AuditEntry } from '../src/infrastructure/audit/audit-log.service';
import type { PasswordHashingService } from '../src/modules/auth/password-hashing.service';
import type { JwtService } from '../src/modules/auth/jwt.service';

function record(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'u1', email: 'ana@ptap.co', name: 'Ana', role: 'civil', plant: 'montebello',
    passwordHash: 'x', pepperVersion: 1, isActive: false, emailVerified: false, ...overrides,
  };
}

function build(opts: {
  consume?: (raw: string) => Promise<string | null>;
  findByEmail?: (email: string) => Promise<UserRecord | null>;
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
    sendVerificationEmail: async (to: string, link: string) => { sent.push({ to, link }); },
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
  assert.deepEqual(h.invalidated, ['u9']);
  assert.deepEqual(h.issued, ['u9']);
  assert.equal(h.sent.length, 1);
});
