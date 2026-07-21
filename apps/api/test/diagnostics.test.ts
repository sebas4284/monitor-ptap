/**
 * Diagnóstico de conexión (Parte D del corte de datos):
 *   1. `classifyBridge` — la regla que decide qué falla es "de ruta" (solo admin) vs "del PLC
 *      maestro" (todos). Es la fuente única compartida con el móvil.
 *   2. `GET /api/diagnostics/connection-events` — historial del audit_log, SOLO admin
 *      (`system_config`). El caso que protege: un operador NO debe poder leer el diagnóstico
 *      de infraestructura.
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { classifyBridge, type Role } from '@ptap/shared';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../src/modules/auth/guards/permission.guard';
import { JwtService } from '../src/modules/auth/jwt.service';
import { UsersRepository, type UserRecord } from '../src/modules/users/users.repository';
import { AuditLogService, type AuditEventRow } from '../src/infrastructure/audit/audit-log.service';
import { DiagnosticsController } from '../src/infrastructure/connectivity/diagnostics.controller';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-diagnostics';

// ── 1. Clasificador (unitario) ───────────────────────────────────────────────

test('classifyBridge: Connected → ok', () => {
  assert.equal(classifyBridge('Connected'), 'ok');
});

test('classifyBridge: Stale → master_no_data (hubo sesión, el PLC dejó de enviar)', () => {
  assert.equal(classifyBridge('Stale'), 'master_no_data');
});

test('classifyBridge: Connecting/Disconnected/Recovering/Faulted → route (no alcanza el PLC)', () => {
  for (const s of ['Connecting', 'Disconnected', 'Recovering', 'Faulted']) {
    assert.equal(classifyBridge(s), 'route', `${s} debe ser route`);
  }
});

// ── 2. Endpoint (e2e por HTTP) ───────────────────────────────────────────────

const usersDouble = {
  findById: async (id: string): Promise<UserRecord | null> => {
    const role = id.replace(/^u-/, '');
    return { id, email: `${role}@ptap.co`, name: role, role, plant: 'montebello', passwordHash: 'x', pepperVersion: 1, isActive: true };
  },
} as unknown as UsersRepository;

const EVENTS: AuditEventRow[] = [
  { at: '2026-07-21T15:47:00.000Z', eventType: 'opc.bridge_status_change', detail: { status: 'Connecting', reason: 'timeout TCP' } },
];

const auditDouble = {
  listByEventType: async () => EVENTS,
} as unknown as AuditLogService;

async function buildApp(): Promise<{ app: INestApplication; jwt: JwtService }> {
  const moduleRef = await Test.createTestingModule({
    controllers: [DiagnosticsController],
    providers: [
      JwtAuthGuard,
      PermissionGuard,
      JwtService,
      { provide: UsersRepository, useValue: usersDouble },
      { provide: AuditLogService, useValue: auditDouble },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
  return { app, jwt: moduleRef.get(JwtService) };
}

function tokenFor(jwt: JwtService, role: Role): string {
  return jwt.sign({ sub: `u-${role}`, email: `${role}@ptap.co`, name: role, role, plant: 'montebello' });
}

test('diagnostics: sin token → 401', async () => {
  const { app } = await buildApp();
  try {
    await request(app.getHttpServer()).get('/api/diagnostics/connection-events').expect(401);
  } finally {
    await app.close();
  }
});

test('diagnostics: operador/jefe/civil → 403 (no es infraestructura para ellos)', async () => {
  const { app, jwt } = await buildApp();
  try {
    for (const role of ['civil', 'operador', 'jefe'] as Role[]) {
      await request(app.getHttpServer())
        .get('/api/diagnostics/connection-events')
        .set('Authorization', `Bearer ${tokenFor(jwt, role)}`)
        .expect(403);
    }
  } finally {
    await app.close();
  }
});

test('diagnostics: admin → 200 con el historial de eventos', async () => {
  const { app, jwt } = await buildApp();
  try {
    const res = await request(app.getHttpServer())
      .get('/api/diagnostics/connection-events')
      .set('Authorization', `Bearer ${tokenFor(jwt, 'admin')}`)
      .expect(200);
    assert.equal(res.body.events.length, 1);
    assert.equal(res.body.events[0].detail.status, 'Connecting');
  } finally {
    await app.close();
  }
});
