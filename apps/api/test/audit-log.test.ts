/**
 * Audit log (Fase 4, criterio de aceptación): registra usuario/IP/timestamp. AuditLogService
 * se construye contra un Pool falso (captura los params del INSERT, no toca MySQL real).
 * AuditInterceptor y ConnectionEventsSubscriber se prueban por separado, con dobles simples.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { of } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { AuditLogService } from '../src/infrastructure/audit/audit-log.service';
import { AuditInterceptor } from '../src/infrastructure/audit/audit.interceptor';
import { ConnectionEventsSubscriber } from '../src/infrastructure/audit/connection-events.subscriber';
import type { AuthenticatedRequest } from '../src/modules/auth/authenticated-request';
import type { ConnectivityAdapter, BridgeStatus } from '../src/infrastructure/connectivity/ports/connectivity-adapter.port';

interface Captured {
  sql: string;
  params: unknown[];
}

function fakePool(): { pool: Pool; calls: Captured[] } {
  const calls: Captured[] = [];
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return [[], []];
    },
  } as unknown as Pool;
  return { pool, calls };
}

test('audit-log: record() inserta userId/userEmail/role/ip/statusCode como params posicionales', async () => {
  const { pool, calls } = fakePool();
  const service = new AuditLogService(pool);

  await service.record({
    eventType: 'http.request',
    userId: 'u1',
    userEmail: 'a@b.com',
    role: 'admin',
    ip: '10.0.0.5',
    method: 'GET',
    path: '/api/opc/info',
    statusCode: 200,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO audit_log/);
  const [eventType, userId, userEmail, role, ip, method, path, statusCode] = calls[0].params;
  assert.equal(eventType, 'http.request');
  assert.equal(userId, 'u1');
  assert.equal(userEmail, 'a@b.com');
  assert.equal(role, 'admin');
  assert.equal(ip, '10.0.0.5');
  assert.equal(method, 'GET');
  assert.equal(path, '/api/opc/info');
  assert.equal(statusCode, 200);
});

test('audit-log: record() nunca lanza aunque el pool falle', async () => {
  const pool = { query: async () => { throw new Error('MySQL caído'); } } as unknown as Pool;
  const service = new AuditLogService(pool);
  await assert.doesNotReject(() =>
    service.record({
      eventType: 'auth.login_failed',
      userId: null,
      userEmail: 'x@y.com',
      role: null,
      ip: null,
      method: null,
      path: null,
      statusCode: 401,
    }),
  );
});

test('audit-log: detail se trunca cuando excede AUDIT_LOG_DETAIL_MAX_BYTES', async () => {
  const prev = process.env.AUDIT_LOG_DETAIL_MAX_BYTES;
  process.env.AUDIT_LOG_DETAIL_MAX_BYTES = '20';
  try {
    const { pool, calls } = fakePool();
    const service = new AuditLogService(pool);
    await service.record({
      eventType: 'http.request',
      userId: null,
      userEmail: null,
      role: null,
      ip: null,
      method: null,
      path: null,
      statusCode: 200,
      detail: { long: 'x'.repeat(200) },
    });
    const detail = calls[0].params[8] as string;
    assert.ok(detail.includes('"truncated":true'));
  } finally {
    if (prev === undefined) delete process.env.AUDIT_LOG_DETAIL_MAX_BYTES;
    else process.env.AUDIT_LOG_DETAIL_MAX_BYTES = prev;
  }
});

test('audit-interceptor: extrae method/path/ip/user y statusCode de la respuesta', async () => {
  const { pool, calls } = fakePool();
  const auditLog = new AuditLogService(pool);
  const interceptor = new AuditInterceptor(auditLog);

  const request: AuthenticatedRequest = {
    method: 'GET',
    originalUrl: '/api/plants',
    ip: '192.168.1.10',
    user: { id: 'u2', name: 'B', email: 'b@c.com', role: 'operador', plant: 'sirena' },
  } as AuthenticatedRequest;
  const response = { statusCode: 200 };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
  const handler: CallHandler = { handle: () => of({ ok: true }) };

  await new Promise<void>((resolve) => {
    interceptor.intercept(ctx, handler).subscribe(() => {
      setImmediate(resolve); // el record() es fire-and-forget dentro del tap()
    });
  });

  assert.equal(calls.length, 1);
  const [eventType, userId, userEmail, role, ip, method, path, statusCode] = calls[0].params;
  assert.equal(eventType, 'http.request');
  assert.equal(userId, 'u2');
  assert.equal(userEmail, 'b@c.com');
  assert.equal(role, 'operador');
  assert.equal(ip, '192.168.1.10');
  assert.equal(method, 'GET');
  assert.equal(path, '/api/plants');
  assert.equal(statusCode, 200);
});

test('connection-events-subscriber: registra opc.bridge_status_change en cada transición', async () => {
  const { pool, calls } = fakePool();
  const auditLog = new AuditLogService(pool);

  let capturedListener: ((status: BridgeStatus, reason: string) => void) | null = null;
  const adapter = {
    onStatusChange: (listener: (status: BridgeStatus, reason: string) => void) => {
      capturedListener = listener;
    },
  } as unknown as ConnectivityAdapter;

  const subscriber = new ConnectionEventsSubscriber(adapter, auditLog);
  subscriber.onModuleInit();
  assert.ok(capturedListener);
  await (capturedListener as (status: BridgeStatus, reason: string) => void)('Faulted', 'namespace no resuelto');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.length, 1);
  const [eventType, , , , , , , , detail] = calls[0].params;
  assert.equal(eventType, 'opc.bridge_status_change');
  assert.match(detail as string, /"status":"Faulted"/);
});
