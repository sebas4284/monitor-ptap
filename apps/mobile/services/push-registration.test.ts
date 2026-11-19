import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function load(relative: string, modules: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const exports: Record<string, any> = {};
  const context = createContext({ exports, module: { exports }, console, setTimeout, clearTimeout, AbortController,
    require: (name: string) => {
      if (!(name in modules)) throw new Error(`Unexpected import ${name}`);
      return modules[name];
    }, ...globals });
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, context);
  return exports;
}
function fixture() {
  let bearer: string | null = 'session-A';
  let generation = 1;
  const storage = new Map<string, string>();
  const order: string[] = [];
  const channel = deferred<void>();
  const native = deferred<{ data: string }>();
  const requests: { path: string; body: any; bearer: string; reply: ReturnType<typeof deferred<any>> }[] = [];
  const api = load('./push-registration.ts', {
    '@react-native-async-storage/async-storage': {
      getItem: async (key: string) => storage.get(key) ?? null,
      setItem: async (key: string, value: string) => { storage.set(key, value); },
      removeItem: async (key: string) => { storage.delete(key); },
      multiRemove: async (keys: string[]) => { keys.forEach(key => storage.delete(key)); },
    },
    'react-native': { Platform: { OS: 'android' } },
    './api': {
      getAuthToken: () => bearer, getAuthGeneration: () => generation,
      postJson: async () => ({}),
      postJsonWithToken: (path: string, body: any, token: string) => {
        const reply = deferred<any>(); requests.push({ path, body, bearer: token, reply }); return reply.promise;
      },
    },
    './app-release': { runningVersion: () => 'synthetic' },
    './device-notifications': {
      ensureAndroidChannel: async () => { order.push('channels'); await channel.promise; },
      getPermission: async () => { order.push('permission'); return 'granted'; },
    },
    './push-rules': {
      estadoTrasRegistro: (result: any) => result.pushActivo === true ? 'activo' : 'servidor-apagado',
      esFaltaDeFirebase: () => false,
    },
    './session-store': { tokenExpiryMs: () => Date.now() + 60000 },
    'expo-notifications': { getDevicePushTokenAsync: () => { order.push('native-token'); return native.promise; } },
  });
  return { api, storage, order, channel, native, requests,
    changeSession: (value: string | null) => { generation++; bearer = value; } };
}

test('Android channel completion precedes native FCM token request; duplicate hooks share registration', async () => {
  const f = fixture();
  const first = f.api.registrarPush();
  assert.equal(f.api.registrarPush(), first);
  await tick();
  assert.deepEqual(f.order, ['channels']);
  f.channel.resolve(); await tick();
  assert.deepEqual(f.order.slice(0, 3), ['channels', 'permission', 'native-token']);
  f.native.resolve({ data: 'synthetic-device' }); await tick();
  assert.equal(f.requests.length, 1);
  f.requests[0].reply.resolve({ pushActivo: true });
  assert.equal(await first, 'activo');
  assert.equal(await f.api.pushActivo(), true);
});

test('logout during native token lookup cannot register or reactivate the departed session', async () => {
  const f = fixture(); f.channel.resolve();
  const registration = f.api.registrarPush(); await tick();
  f.changeSession('session-A'); // AuthContext invalidates requests before cleanup while retaining outgoing JWT.
  await f.api.desregistrarPush(); f.changeSession(null);
  f.native.resolve({ data: 'synthetic-device' });
  assert.equal(await registration, 'pendiente');
  assert.equal(f.requests.length, 0);
  assert.equal(await f.api.pushActivo(), false);
});

test('late registration, outgoing cleanup and new login remain ordered with their original session credentials', async () => {
  const f = fixture(); f.channel.resolve(); f.native.resolve({ data: 'same-synthetic-device' });
  const oldRegistration = f.api.registrarPush(); await tick();
  assert.equal(f.requests[0].bearer, 'session-A');
  f.changeSession('session-A');
  const logout = f.api.desregistrarPush();
  assert.equal(await f.api.registrarPush(), 'pendiente', 'retained outgoing JWT cannot start another registration during logout');
  f.changeSession('session-B');
  const newRegistration = f.api.registrarPush(); await tick();
  assert.equal(f.requests.length, 1, 'new session cannot overtake old cleanup');
  f.requests[0].reply.resolve({ pushActivo: true }); await tick();
  assert.equal(await oldRegistration, 'pendiente');
  assert.equal(f.requests[1].path, '/api/notifications/devices/unregister');
  assert.equal(f.requests[1].bearer, 'session-A');
  f.requests[1].reply.resolve({ quitado: true }); await logout; await tick();
  assert.equal(f.requests[2].path, '/api/notifications/devices');
  assert.equal(f.requests[2].bearer, 'session-B');
  f.requests[2].reply.resolve({ pushActivo: true });
  assert.equal(await newRegistration, 'activo');
  assert.equal(await f.api.pushActivo(), true);
});

test('transient registration failure clears active flag and allows a later retry', async () => {
  const f = fixture(); f.channel.resolve(); f.native.resolve({ data: 'synthetic-device' });
  const first = f.api.registrarPush(); await tick();
  f.requests[0].reply.reject(new Error('synthetic offline'));
  assert.equal(await first, 'error'); assert.equal(await f.api.pushActivo(), false);
  const retry = f.api.registrarPush(); await tick();
  f.requests[1].reply.resolve({ pushActivo: true });
  assert.equal(await retry, 'activo');
});

test('permission request awaits Android channel creation', async () => {
  const channel = deferred<void>();
  const order: string[] = [];
  const api = load('./device-notifications.ts', {
    'react-native': { Platform: { OS: 'android' } },
    '@ptap/shared': { CANAL_AVISOS: 'aquora-avisos', CANAL_CRITICAS: 'aquora-criticas' },
    './push-rules': { CANALES_AQUORA: [{ id: 'aquora-avisos', nombre: 'test', importancia: 'HIGH' }], CANALES_RETIRADOS: [] },
    'expo-notifications': {
      AndroidImportance: { HIGH: 4 }, AndroidNotificationVisibility: { PUBLIC: 1 },
      setNotificationChannelAsync: async () => { order.push('channel'); await channel.promise; },
      requestPermissionsAsync: async () => { order.push('permission'); return { status: 'granted' }; },
    },
  });
  const permission = api.requestPermission(); await tick();
  assert.deepEqual(order, ['channel']);
  channel.resolve(); assert.equal(await permission, 'granted');
  assert.deepEqual(order, ['channel', 'permission']);
});

test('captured device-session 401 does not revoke the currently logged-in account', async () => {
  let unauthorized = 0;
  let authorization = '';
  const api = load('./api.ts', { 'expo-constants': { expoConfig: { extra: { apiBaseUrl: 'https://synthetic.invalid' } } } }, {
    fetch: async (_url: string, options: any) => { authorization = options.headers.Authorization; return { status: 401, ok: false }; },
  });
  api.setAuthToken('new-session'); api.setOnUnauthorized(() => unauthorized++);
  await assert.rejects(api.postJsonWithToken('/api/notifications/devices/unregister', {}, 'old-session'));
  assert.equal(authorization, 'Bearer old-session');
  assert.equal(unauthorized, 0);
});
