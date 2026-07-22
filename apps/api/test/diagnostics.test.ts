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
import type { RouteCheckReport } from '../src/infrastructure/connectivity/route-check.service';
import { RouteProbeSampler } from '../src/infrastructure/connectivity/route-probe.sampler';

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

/** Muestras del sampler (más reciente primero) para /route-history. */
const PROBE_ROWS: AuditEventRow[] = [
  { at: new Date().toISOString(), eventType: 'opc.route_probe', detail: { code: 'PLC-12', bridge: 'Connecting' } },
  { at: new Date(Date.now() - 300_000).toISOString(), eventType: 'opc.route_probe', detail: { code: '—', bridge: 'Connected' } },
];

const auditDouble = {
  listByEventType: async (eventType: string) => (eventType === 'opc.route_probe' ? PROBE_ROWS : EVENTS),
} as unknown as AuditLogService;

const ROUTE_REPORT: RouteCheckReport = {
  at: '2026-07-22T13:00:00.000Z',
  target: { endpoint: 'opc.tcp://181.204.165.66:59100', host: '181.204.165.66', port: 59100 },
  serverPublicIp: '190.0.0.1',
  probes: [
    { name: 'internet', target: '8.8.8.8:53', outcome: 'ok', ms: 20, detail: null },
    { name: 'ping', target: '181.204.165.66', outcome: 'ok', ms: 21, detail: null },
    { name: 'plc', target: '181.204.165.66:59100', outcome: 'timeout', ms: 5000, detail: null },
  ],
  verdict: { code: 'PLC-12', where: 'ruta-o-planta', message: 'x' },
  bridge: { status: 'Connecting', reconnectCount: 3, lastNotificationAt: null },
};

// Doble del sampler: el endpoint manual usa manualCheck() (que además GRABA la muestra).
const samplerDouble = {
  manualCheck: async () => ROUTE_REPORT,
} as unknown as RouteProbeSampler;

async function buildApp(): Promise<{ app: INestApplication; jwt: JwtService }> {
  const moduleRef = await Test.createTestingModule({
    controllers: [DiagnosticsController],
    providers: [
      JwtAuthGuard,
      PermissionGuard,
      JwtService,
      { provide: UsersRepository, useValue: usersDouble },
      { provide: AuditLogService, useValue: auditDouble },
      { provide: RouteProbeSampler, useValue: samplerDouble },
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

test('diagnostics/route-check: operador → 403; admin → 200 con sondas y veredicto', async () => {
  const { app, jwt } = await buildApp();
  try {
    await request(app.getHttpServer())
      .get('/api/diagnostics/route-check')
      .set('Authorization', `Bearer ${tokenFor(jwt, 'operador')}`)
      .expect(403);

    const res = await request(app.getHttpServer())
      .get('/api/diagnostics/route-check')
      .set('Authorization', `Bearer ${tokenFor(jwt, 'admin')}`)
      .expect(200);
    assert.equal(res.body.probes.length, 3); // internet + ping + plc
    assert.equal(res.body.verdict.code, 'PLC-12');
    assert.equal(res.body.target.port, 59100);
  } finally {
    await app.close();
  }
});

test('diagnostics/route-history: civil → 403; admin → 200 con resumen del registro continuo', async () => {
  const { app, jwt } = await buildApp();
  try {
    await request(app.getHttpServer())
      .get('/api/diagnostics/route-history')
      .set('Authorization', `Bearer ${tokenFor(jwt, 'civil')}`)
      .expect(403);

    const res = await request(app.getHttpServer())
      .get('/api/diagnostics/route-history')
      .set('Authorization', `Bearer ${tokenFor(jwt, 'admin')}`)
      .expect(200);
    assert.equal(res.body.summary.samples, 2);
    assert.equal(res.body.summary.plcOk, 1);
    // La muestra más reciente falló → hay corte vigente desde esa muestra.
    assert.equal(res.body.summary.downSince, PROBE_ROWS[0].at);
  } finally {
    await app.close();
  }
});
