import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(ready: () => boolean) {
  for (let count = 0; count < 30 && !ready(); count++) await tick();
  assert.equal(ready(), true, 'expected asynchronous step did not run');
}
function moduleFrom(
  file: string,
  modules: Record<string, unknown>,
  globals: Record<string, unknown>,
) {
  const exports: Record<string, any> = {};
  const context = createContext({
    exports,
    module: { exports },
    console,
    atob,
    setTimeout,
    clearTimeout,
    AbortController,
    require: (name: string) => {
      if (!(name in modules)) throw new Error(`Unexpected import ${name}`);
      return modules[name];
    },
    ...globals,
  });
  runInContext(
    ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    context,
  );
  return exports;
}
/** Event-driven IndexedDB mock, including a controllable open delay for session races. */
function fakeDb() {
  const values = new Map<string, any>();
  let gate: Promise<void> | null = null;
  let failOpen = false;
  const database = {
    close: () => {},
    createObjectStore: () => {},
    transaction: () => {
      const tx: any = {
        error: null,
        abort: () => {
          setImmediate(() => tx.onabort?.());
        },
      };
      tx.objectStore = () => ({
        get: (key: string) => {
          const request: any = {};
          setImmediate(() => {
            request.result = values.get(key);
            request.onsuccess?.();
            setImmediate(() => tx.oncomplete?.());
          });
          return request;
        },
        put: (value: any, key: string) => values.set(key, value),
        delete: (key: string) => values.delete(key),
      });
      return tx;
    },
  };
  return {
    values,
    pauseNextOpen: (value: Promise<void>) => {
      gate = value;
    },
    failNextOpen: () => {
      failOpen = true;
    },
    indexedDB: {
      open: () => {
        const request: any = { result: database };
        const waiting = gate;
        gate = null;
        const fail = failOpen;
        failOpen = false;
        void (waiting ?? Promise.resolve()).then(() =>
          setImmediate(() => {
            if (fail) {
              request.error = new Error('storage unavailable');
              request.onerror?.();
            } else request.onsuccess?.();
          }),
        );
        return request;
      },
    },
  };
}

let uuid = 0;
// Both tabs represent the same issued JWT, even if their fixture setup crosses a second.
const issuedExpiry = Math.floor(Date.now() / 1000) + 3600;
function fixture(db = fakeDb(), browserStorage = new Map<string, string>()) {
  let token: string | null = null;
  let generation = 0;
  let configGate: Promise<any> | null = null;
  let registerGate: Promise<any> | null = null;
  const requests: {
    path: string;
    body: any;
    token: string;
    response: ReturnType<typeof deferred<any>>;
  }[] = [];
  const notifications = [
    {
      closed: false,
      close() {
        this.closed = true;
      },
    },
  ];
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/example',
    options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer },
    unsubscribe: async () => true,
    toJSON: () => ({ keys: { p256dh: 'synthetic-public-key', auth: 'synthetic-auth' } }),
  };
  const registration = {
    getNotifications: async () => notifications,
    pushManager: { getSubscription: async () => subscription, subscribe: async () => subscription },
  };
  const globals = {
    indexedDB: db.indexedDB,
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}` },
    localStorage: { getItem: (key: string) => browserStorage.get(key) ?? null },
    window: {
      isSecureContext: true,
      Notification: { permission: 'granted' },
      PushManager: function () {},
    },
    navigator: {
      serviceWorker: {
        register: () => registerGate ?? Promise.resolve(registration),
        ready: Promise.resolve(registration),
        getRegistration: async () => registration,
      },
    },
  };
  const api = {
    getAuthToken: () => token,
    getAuthGeneration: () => generation,
    getJson: () => configGate ?? Promise.resolve({ pushActivo: true, publicKey: 'AQID' }),
    postJsonWithToken: (path: string, body: any, bearer: string) => {
      const response = deferred<any>();
      requests.push({ path, body, token: bearer, response });
      return response.promise;
    },
  };
  const session = moduleFrom(
    './notification-session.ts',
    { './api': api, 'react-native': { Platform: { OS: 'web' } } },
    globals,
  );
  const web = moduleFrom(
    './web-push-registration.ts',
    {
      './api': api,
      './notification-session': session,
      'react-native': { Platform: { OS: 'web' } },
    },
    globals,
  );
  const login = (sub: string | null, plant = 'km18') => {
    generation++;
    token = sub
      ? `h.${Buffer.from(JSON.stringify({ sub, plant, role: 'operador', exp: issuedExpiry })).toString('base64url')}.s`
      : null;
    if (token) browserStorage.set('ptap_auth_token', token);
    else browserStorage.delete('ptap_auth_token');
  };
  return {
    web,
    db,
    globals,
    requests,
    notifications,
    login,
    browserStorage,
    subscription,
    registration,
    currentToken: () => token,
    configGate: (value: Promise<any>) => {
      configGate = value;
    },
    registerGate: (value: Promise<any>) => {
      registerGate = value;
    },
  };
}

test('shared session fixture keeps the same issued JWT across a wall-clock second', () => {
  const now = Date.now;
  const started = now();
  try {
    Date.now = () => started;
    const first = fixture();
    first.login('A');
    Date.now = () => started + 1_000;
    const other = fixture(first.db, first.browserStorage);
    other.login('A');
    assert.equal(first.currentToken(), other.currentToken());
  } finally {
    Date.now = now;
  }
});

test('web registration binds only after server confirmation and active status follows that identity', async () => {
  const f = fixture();
  f.login('A');
  const first = f.web.registrarWebPush();
  assert.equal(f.web.registrarWebPush(), first, 'duplicate hooks share the same request');
  await until(() => f.requests.length === 1);
  assert.equal(f.db.values.get('current').active, false);
  assert.equal(f.db.values.get('current').binding, '');
  f.requests[0].response.resolve({ pushActivo: true, binding: f.requests[0].body.binding });
  assert.equal(await first, 'activo');
  assert.equal(await f.web.webPushActivo(), true);
  assert.match(f.requests[0].path, /web-push\/subscriptions$/);
  f.login('B', 'cascajal');
  assert.equal(await f.web.webPushActivo(), false);
});

test('logout while registration response is pending cannot reactivate A and B enrolls with a new binding', async () => {
  const f = fixture();
  f.login('A');
  const old = f.web.registrarWebPush();
  await until(() => f.requests.length === 1);
  await f.web.desregistrarWebPush();
  f.login('B', 'cascajal');
  const next = f.web.registrarWebPush();
  f.requests[0].response.resolve({ pushActivo: true, binding: f.requests[0].body.binding });
  assert.equal(await old, 'pendiente');
  await until(() => f.requests.length === 2);
  assert.notEqual(f.requests[0].body.binding, f.requests[1].body.binding);
  f.requests[1].response.resolve({ pushActivo: true, binding: f.requests[1].body.binding });
  assert.equal(await next, 'activo');
  assert.equal(f.db.values.get('current').binding, f.requests[1].body.binding);
});

test('logout during permission-independent worker setup or IndexedDB read rejects old registration', async () => {
  for (const stage of ['worker', 'storage'] as const) {
    const f = fixture();
    f.login('A');
    const gate = deferred<any>();
    if (stage === 'worker') f.registerGate(gate.promise);
    else f.db.pauseNextOpen(gate.promise);
    const old = f.web.registrarWebPush();
    await tick();
    await tick();
    await f.web.invalidarWebPushLocal();
    f.login('B');
    gate.resolve({ pushManager: { getSubscription: async () => null } });
    assert.equal(await old, 'pendiente');
    assert.equal(f.requests.length, 0);
    assert.equal(f.db.values.has('current'), false);
  }
});

test('offline logout revokes local binding and closes visible notifications before network removal settles', async () => {
  const f = fixture();
  f.login('A');
  const registration = f.web.registrarWebPush();
  await until(() => f.requests.length === 1);
  f.requests[0].response.resolve({ pushActivo: true, binding: f.requests[0].body.binding });
  await registration;
  const logout = f.web.desregistrarWebPush();
  await until(() => f.requests.length === 2);
  assert.equal(f.db.values.has('current'), false);
  assert.equal(f.notifications[0].closed, true);
  assert.equal(await f.web.webPushActivo(), false);
  f.requests[1].response.reject(new Error('offline'));
  await logout;
});

test('disabled server clears active local state so foreground fallback remains enabled', async () => {
  const f = fixture();
  f.login('A');
  const registration = f.web.registrarWebPush();
  await until(() => f.requests.length === 1);
  f.requests[0].response.resolve({ pushActivo: true, binding: f.requests[0].body.binding });
  await registration;
  f.configGate(Promise.resolve({ pushActivo: false, publicKey: null }));
  assert.equal(await f.web.registrarWebPush(), 'servidor-apagado');
  assert.equal(await f.web.webPushActivo(), false);
});

test('IndexedDB intent prevents another tab from resurrecting a registration after shared revocation', async () => {
  const first = fixture();
  first.login('A');
  const other = fixture(first.db, first.browserStorage);
  other.login('A');
  const pending = first.web.registrarWebPush();
  await until(() => first.requests.length === 1);
  await other.web.invalidarWebPushLocal();
  first.requests[0].response.resolve({ pushActivo: true, binding: first.requests[0].body.binding });
  assert.equal(await pending, 'pendiente');
  assert.equal(first.db.values.has('current'), false);
});

test('newer tab intent wins over an older response even for the same account and JWT', async () => {
  const first = fixture();
  first.login('A');
  const other = fixture(first.db, first.browserStorage);
  other.login('A');
  const old = first.web.registrarWebPush();
  await until(() => first.requests.length === 1);
  const latest = other.web.registrarWebPush();
  await until(() => other.requests.length === 1);
  other.requests[0].response.resolve({ pushActivo: true, binding: other.requests[0].body.binding });
  assert.equal(await latest, 'activo');
  first.requests[0].response.resolve({ pushActivo: true, binding: first.requests[0].body.binding });
  assert.equal(await old, 'pendiente');
  assert.equal(first.db.values.get('current').binding, other.requests[0].body.binding);
});

test('persisted browser identity invalidates a departed tab before it starts another registration', async () => {
  const first = fixture();
  first.login('A');
  const other = fixture(first.db, first.browserStorage);
  other.login('B', 'cascajal');
  assert.equal(await first.web.registrarWebPush(), 'pendiente');
  assert.equal(first.requests.length, 0);
  assert.equal(await first.web.webPushActivo(), false);
});

test('VAPID rotation disables old binding and replaces subscription before enrolling new endpoint', async () => {
  const f = fixture();
  f.login('A');
  f.subscription.options.applicationServerKey = new Uint8Array([9, 9, 9]).buffer;
  const unsubscribe = deferred<boolean>();
  let unsubscribes = 0;
  let subscribes = 0;
  f.subscription.unsubscribe = () => {
    unsubscribes++;
    return unsubscribe.promise;
  };
  f.registration.pushManager.subscribe = async () => {
    subscribes++;
    return { ...f.subscription, endpoint: 'https://fcm.googleapis.com/fcm/send/replaced' };
  };
  const registering = f.web.registrarWebPush();
  await until(() => unsubscribes === 1);
  assert.equal(f.db.values.get('current').active, false);
  assert.equal(f.db.values.get('current').binding, '');
  unsubscribe.resolve(true);
  await until(() => f.requests.length === 1);
  assert.equal(subscribes, 1);
  assert.match(f.requests[0].body.endpoint, /replaced$/);
  f.requests[0].response.resolve({ pushActivo: true, binding: f.requests[0].body.binding });
  assert.equal(await registering, 'activo');
});

test('account change during permission prompt cannot register or update departed hook state', async () => {
  const permission = deferred<string>();
  let current = true;
  let registrations = 0;
  let updates = 0;
  const hooks = moduleFrom(
    '../hooks/useDeviceNotifications.ts',
    {
      react: {
        useCallback: (callback: unknown) => callback,
        useEffect: () => {},
        useState: (initial: unknown) => [initial, () => updates++],
      },
      'react-native': { Platform: { OS: 'web' } },
      '../context/AuthContext': { useAuth: () => ({ token: 'A', hasPermission: () => true }) },
      '../services/device-notifications': {
        isSupported: () => true,
        unsupportedReason: () => null,
        getPermission: async () => 'granted',
        requestPermission: () => permission.promise,
      },
      '../services/notification-sync': {},
      '../services/notification-session': {
        notificationSession: () => ({ token: 'A' }),
        isNotificationSession: () => current,
      },
      '../services/push-registration': {
        registrarPush: async () => {
          registrations++;
          return 'activo';
        },
      },
    },
    {},
  );
  const hook = hooks.useDeviceNotifications();
  const asking = hook.ask();
  current = false;
  permission.resolve('granted');
  await asking;
  assert.equal(registrations, 0);
  assert.equal(updates, 0);
});

function workerFixture(db = fakeDb()) {
  const listeners = new Map<string, (event: any) => void>();
  const shown: any[] = [];
  const opened: string[] = [];
  let showGate: Promise<void> | null = null;
  let presentationStarted = false;
  const self = {
    location: { origin: 'https://aquora.example' },
    skipWaiting: async () => {},
    addEventListener: (name: string, listener: (event: any) => void) =>
      listeners.set(name, listener),
    clients: {
      claim: async () => {},
      matchAll: async () => [],
      openWindow: async (url: string) => opened.push(url),
    },
    registration: {
      getNotifications: async () => shown,
      showNotification: async (title: string, options: any) => {
        presentationStarted = true;
        if (showGate) await showGate;
        shown.push({
          title,
          ...options,
          closed: false,
          close() {
            this.closed = true;
          },
        });
      },
    },
  };
  runInContext(
    readFileSync(new URL('../public/aquora-push-sw.js', import.meta.url), 'utf8'),
    createContext({ self, indexedDB: db.indexedDB, URL }),
  );
  async function event(name: string, payload: any) {
    let result: Promise<void> | undefined;
    listeners.get(name)!({
      data: { json: () => payload },
      notification: payload,
      waitUntil: (promise: Promise<void>) => {
        result = promise;
      },
    });
    await result;
  }
  return {
    db,
    shown,
    opened,
    listeners,
    event,
    presentationStarted: () => presentationStarted,
    delayShow: (value: Promise<void>) => {
      showGate = value;
    },
  };
}
const payload = (binding: string) => ({
  title: 'Planta',
  body: 'Revisar',
  tag: 'n-1',
  critical: true,
  binding,
});

test('worker ignores absent, revoked, mismatched and malformed bindings without caching pages', async () => {
  const f = workerFixture();
  assert.equal(f.listeners.has('fetch'), false);
  await f.event('push', payload('A'));
  f.db.values.set('current', { binding: 'B', active: true });
  await f.event('push', payload('A'));
  await f.event('push', { binding: 'B', title: '<external>' });
  assert.equal(f.shown.length, 0);
  await f.event('push', payload('B'));
  assert.equal(f.shown.length, 1);
  assert.equal(f.shown[0].requireInteraction, true);
  assert.equal(f.shown[0].body, 'Revisar');
});

test('worker closes an old notification if logout commits while browser presentation is pending', async () => {
  const f = workerFixture();
  f.db.values.set('current', { binding: 'A', active: true });
  const show = deferred<void>();
  f.delayShow(show.promise);
  const push = f.event('push', payload('A'));
  await until(f.presentationStarted);
  f.db.values.delete('current');
  show.resolve();
  await push;
  assert.equal(f.shown.length, 1);
  assert.equal(f.shown[0].closed, true);
});

test('worker closes accepted notification if ownership storage fails during revalidation', async () => {
  const f = workerFixture();
  f.db.values.set('current', { binding: 'A', active: true });
  const show = deferred<void>();
  f.delayShow(show.promise);
  const push = f.event('push', payload('A'));
  await until(f.presentationStarted);
  f.db.failNextOpen();
  show.resolve();
  await push;
  assert.equal(f.shown.length, 1);
  assert.equal(f.shown[0].closed, true);
});

test('worker click uses only the fixed authenticated inbox and rejects notifications of a departed account', async () => {
  const f = workerFixture();
  const notification = { data: { binding: 'A' }, close: () => {}, url: 'https://attacker.example' };
  f.db.values.set('current', { binding: 'B', active: true });
  await f.event('notificationclick', notification);
  assert.deepEqual(f.opened, []);
  f.db.values.set('current', { binding: 'A', active: true });
  await f.event('notificationclick', notification);
  assert.deepEqual(f.opened, ['https://aquora.example/alertas']);
});
