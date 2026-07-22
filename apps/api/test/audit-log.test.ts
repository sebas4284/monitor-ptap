/**
 * Audit log (Fase 4, criterio de aceptación): registra usuario/IP/timestamp. AuditLogService
 * se construye contra un Pool falso (captura los params del INSERT, no toca MySQL real).
 * El AuditMiddleware (registro de accesos permitidos y denegados) se prueba en
 * audit-middleware.test.ts; ConnectionEventsSubscriber se prueba aquí con un doble simple.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'mysql2/promise';
import { AuditLogService } from '../src/infrastructure/audit/audit-log.service';
import { ConnectionEventsSubscriber } from '../src/infrastructure/audit/connection-events.subscriber';
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

test('audit-log: listByEventType tolera detail como OBJETO (columna JSON de mysql2) y como string', async () => {
  // Regresión del 500 del diagnóstico: la columna `detail` es JSON y mysql2 la entrega YA
  // parseada como objeto; hacer JSON.parse(objeto) reventaba el endpoint con 500.
  const rows = [
    { at: new Date('2026-07-22T10:00:00.000Z'), event_type: 'opc.bridge_status_change', detail: { status: 'Connecting', reason: 'timeout TCP' } },
    { at: new Date('2026-07-22T09:00:00.000Z'), event_type: 'opc.bridge_status_change', detail: '{"status":"Faulted"}' },
    { at: new Date('2026-07-22T08:00:00.000Z'), event_type: 'opc.bridge_status_change', detail: null },
  ];
  const pool = { query: async () => [rows, []] } as unknown as Pool;
  const service = new AuditLogService(pool);

  const events = await service.listByEventType('opc.bridge_status_change', 10);
  assert.equal(events[0].detail?.status, 'Connecting'); // objeto del driver: pasa tal cual
  assert.equal(events[1].detail?.status, 'Faulted'); // string JSON: se parsea
  assert.equal(events[2].detail, null);
});

test('connection-events-subscriber: graba la línea base de arranque Y cada transición', async () => {
  const { pool, calls } = fakePool();
  const auditLog = new AuditLogService(pool);

  let capturedListener: ((status: BridgeStatus, reason: string) => void) | null = null;
  const adapter = {
    onStatusChange: (listener: (status: BridgeStatus, reason: string) => void) => {
      capturedListener = listener;
    },
    // El puente ya está en Connecting al registrarnos (la transición inicial no nos llegó).
    getBridgeStatus: () => 'Connecting' as BridgeStatus,
  } as unknown as ConnectivityAdapter;

  const subscriber = new ConnectionEventsSubscriber(adapter, auditLog);
  subscriber.onModuleInit();
  await new Promise((resolve) => setImmediate(resolve));

  // La línea base captura el 'Connecting' de arranque, que antes se perdía → sin ella, durante
  // un corte (el puente se queda en Connecting) NO se registraría nada.
  assert.equal(calls.length, 1, 'debe grabar el estado de arranque aunque no haya transición nueva');
  assert.match(calls[0].params[8] as string, /"status":"Connecting"/);

  // Y además cada transición posterior.
  assert.ok(capturedListener);
  await (capturedListener as (status: BridgeStatus, reason: string) => void)('Faulted', 'namespace no resuelto');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.length, 2);
  assert.equal(calls[1].params[0], 'opc.bridge_status_change');
  assert.match(calls[1].params[8] as string, /"status":"Faulted"/);
});
