import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Subject } from 'rxjs';
import type { Role } from '@ptap/shared';
import { ConnectivityGateway } from '../src/infrastructure/connectivity/connectivity.gateway';
import { JwtService } from '../src/modules/auth/jwt.service';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { SOCKET_IDENTITY } from '../src/infrastructure/connectivity/connectivity.gateway';
import { PlantCache } from '../src/infrastructure/connectivity/pipeline/plant-cache';
import { PlantPipelineService } from '../src/infrastructure/connectivity/pipeline/plant-pipeline.service';

process.env.JWT_SECRET = 'gateway-security-synthetic-secret';
delete process.env.SOCKET_AUTH_REQUIRED;
const drain = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture(role: Role = 'operador', tokenRole: Role = role) {
  let current: { id: string; role: Role; plant: string } | null = { id: 'u1', role, plant: 'km18' };
  const snapshot$ = new Subject();
  const liveness$ = new Subject();
  const rooms = new Set(['socket-security']);
  const emitted: string[] = [];
  let disconnected = false;
  const socket = {
    id: 'socket-security', data: {}, rooms,
    handshake: { auth: { token: new JwtService().sign({ sub: 'u1', role: tokenRole, plant: 'km18', email: 'test@example.invalid', name: 'Test' }) } },
    join: async (room: string) => { rooms.add(room); },
    leave: async (room: string) => { rooms.delete(room); },
    emit: (event: string) => { emitted.push(event); },
    disconnect: () => { disconnected = true; },
  };
  // Constructor's third argument is the production identity port (added by the fix).
  const gateway = new (ConnectivityGateway as unknown as new (...args: unknown[]) => ConnectivityGateway)(
    { snapshot$, liveness$ }, { get: () => ({ plantId: 'km18', signals: { flow: 42 } }) },
    async () => current,
  );
  (gateway as unknown as { server: unknown }).server = {
    to: (room: string | string[]) => ({ emit: (event: string) => {
      if ((Array.isArray(room) ? room : [room]).some((r) => rooms.has(r))) emitted.push(event);
    } }),
  };
  return { gateway, socket: socket as never, snapshot$, liveness$, emitted, rooms,
    disconnected: () => disconnected, setCurrent: (value: typeof current) => { current = value; } };
}

test('SEC01: Civil is denied detailed socket data', async () => {
  const f = fixture('civil');
  await f.gateway.handleConnection(f.socket);
  await f.gateway.subscribeToPlant({ plantId: 'km18' }, f.socket);
  assert.equal(f.disconnected(), true);
  assert.equal(f.emitted.includes('opc:snapshot'), false);
  f.gateway.onModuleDestroy();
});
test('SEC02: inactive user cannot open a socket with a valid token', async () => {
  const f = fixture();
  f.setCurrent(null);
  await f.gateway.handleConnection(f.socket);
  assert.equal(f.disconnected(), true);
  f.gateway.onModuleDestroy();
});
test('SEC02: current account plant and role override old admin claims', async () => {
  const f = fixture('operador', 'admin');
  await f.gateway.handleConnection(f.socket);
  await f.gateway.subscribeToPlant({ plantId: 'other-plant' }, f.socket);
  assert.equal(f.rooms.has('other-plant'), false);
  assert.equal(f.emitted.includes('opc:snapshot'), false);
  f.gateway.onModuleDestroy();
});
test('SEC02: revocation is checked before every snapshot broadcast', async () => {
  const f = fixture();
  f.gateway.onModuleInit();
  await f.gateway.handleConnection(f.socket);
  await f.gateway.subscribeToPlant({ plantId: 'km18' }, f.socket);
  f.emitted.length = 0;
  f.setCurrent(null);
  f.snapshot$.next({ plantId: 'km18', signals: { flow: 99 } });
  await drain();
  assert.equal(f.emitted.includes('opc:snapshot'), false);
  assert.equal(f.disconnected(), true);
  f.gateway.onModuleDestroy();
});
test('SEC02: server closes an idle established connection when its JWT expires', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const before = process.env.JWT_EXPIRES_IN;
  process.env.JWT_EXPIRES_IN = '1s';
  const f = fixture();
  try {
    await f.gateway.handleConnection(f.socket);
    assert.equal(f.disconnected(), false);
    t.mock.timers.tick(1100);
    assert.equal(f.disconnected(), true);
  } finally {
    f.gateway.onModuleDestroy();
    if (before === undefined) delete process.env.JWT_EXPIRES_IN;
    else process.env.JWT_EXPIRES_IN = before;
  }
});

function nextEvent(socket: ClientSocket, event: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const callback = (value: unknown) => { clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => { socket.off(event, callback); reject(new Error(`No event: ${event}`)); }, 3000);
    socket.once(event, callback);
  });
}

test('SEC02 integration: real Nest/Socket.IO delivers authorized data then disconnects before revoked push', async () => {
  let active = true;
  const snapshot$ = new Subject();
  @Module({ providers: [ConnectivityGateway,
    { provide: PlantPipelineService, useValue: { snapshot$, liveness$: new Subject() } },
    { provide: PlantCache, useValue: { get: () => ({ plantId: 'km18', signals: { flow: 42 } }) } },
    { provide: SOCKET_IDENTITY, useValue: async () => active ? { id: 'u1', role: 'operador', plant: 'km18' } : null },
  ] })
  class TestRealtimeModule {}
  const app = await NestFactory.create(TestRealtimeModule, { logger: false });
  let client: ClientSocket | undefined;
  try {
    await app.listen(0, '127.0.0.1');
    client = io(await app.getUrl(), { autoConnect: false, transports: ['websocket'],
      auth: { token: new JwtService().sign({ sub: 'u1', role: 'operador', plant: 'km18', email: 'test@example.invalid', name: 'Test' }) } });
    const connected = nextEvent(client, 'connect');
    client.connect();
    await connected;
    const first = nextEvent(client, 'opc:snapshot');
    client.emit('opc:subscribe', { plantId: 'km18' });
    assert.deepEqual(await first, { plantId: 'km18', signals: { flow: 42 } });
    let leaked = false;
    client.on('opc:snapshot', () => { leaked = true; });
    const disconnected = nextEvent(client, 'disconnect');
    active = false;
    snapshot$.next({ plantId: 'km18', signals: { flow: 99 } });
    await disconnected;
    assert.equal(leaked, false);
  } finally {
    client?.disconnect();
    await app.close();
  }
});
