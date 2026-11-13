import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';

const defaults = { mutedKinds: [], mutedItems: [], minSeverity: 'info', quietFrom: null, quietTo: null };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function load(file: string, modules: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  const context = createContext({ exports, module: { exports }, console, atob, setTimeout, clearTimeout,
    require: (name: string) => {
      if (!(name in modules)) throw new Error(`Unexpected import ${name}`);
      return modules[name];
    } });
  runInContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, context);
  return exports;
}
function fixture() {
  let generation = 0;
  let token: string | null = null;
  const storage = new Map<string, string>();
  const requests: { token: string | null; method: string; response: ReturnType<typeof deferred<any>> }[] = [];
  const request = (method: string) => {
    const response = deferred<any>(); requests.push({ token, method, response }); return response.promise;
  };
  const api = { getAuthToken: () => token, getAuthGeneration: () => generation,
    getJson: () => request('GET'), putJson: () => request('PUT') };
  const session = load('./notification-session.ts', { './api': api, 'react-native': { Platform: { OS: 'android' } } });
  const asyncStorage = { getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => { storage.set(key, value); } };
  const shared = { NOTIFICATION_PREFS_DEFAULT: defaults, claveDeItem: () => '',
    cuerpoDeAviso: (n: any) => n.message, debeSonar: (n: any, p: any) => !p.mutedKinds.includes(n.kind),
    etiquetaDeAviso: (id: number) => `n-${id}`, ETIQUETA_RESUMEN: 'resumen',
    resumenDeAvisos: () => ({ titulo: 'Resumen', cuerpo: 'Detalle' }) };
  const prefs = load('./notification-prefs.ts', { './api': api, './notification-session': session,
    '@react-native-async-storage/async-storage': asyncStorage, '@ptap/shared': shared,
    react: { useCallback: () => {}, useEffect: () => {}, useState: () => {}, useSyncExternalStore: () => {} } });
  let notifications: any[] = [];
  let fetchGate: Promise<any> | null = null;
  let publicationGate: Promise<void> | null = null;
  const published: string[] = [];
  const pointer = load('./notification-pointer.ts', {});
  const sync = load('./notification-sync.ts', {
    './notification-session': session, './notification-prefs': prefs,
    '@react-native-async-storage/async-storage': asyncStorage, '@ptap/shared': shared,
    'react-native': { Platform: { OS: 'web' } },
    './notifications': { fetchNotifications: () => fetchGate ?? Promise.resolve({ notifications }) },
    './device-notifications': { getPermission: async () => 'granted', ensureAndroidChannel: async () => {},
      presentNotification: async (title: string, _body: string, _data: any, _critical: boolean, current: () => boolean) => {
        if (publicationGate) await publicationGate;
        if (!current()) return false;
        published.push(title); return true;
      } },
    './app-release': { fetchAppRelease: async () => null, runningVersionCode: () => 1 },
    './app-release-compare': { decidirAvisoActualizacion: () => null },
    './notification-pointer': pointer, './push-registration': { pushActivo: async () => false },
  });
  function login(sub: string | null, plant = 'km18') {
    generation++;
    token = sub ? `header.${Buffer.from(JSON.stringify({ sub, plant, role: 'operador', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature` : null;
  }
  return { prefs, sync, storage, requests, published, login,
    setNotifications: (value: any[]) => { notifications = value; },
    setFetchGate: (value: Promise<any> | null) => { fetchGate = value; },
    setPublicationGate: (value: Promise<void>) => { publicationGate = value; } };
}
const notice = (id: number, title: string) => ({ id, title, message: title, plantId: 'km18',
  seen: false, kind: 'sensor_stale', severity: 'warning', subject: null });

test('preferences cache and freshness never carry from A into B; late A response cannot overwrite B', async () => {
  const f = fixture(); f.login('A');
  const oldLoad = f.prefs.loadNotificationPrefs(); await tick();
  f.login('B');
  assert.equal(f.prefs.getNotificationPrefs().mutedKinds.length, 0);
  const newLoad = f.prefs.loadNotificationPrefs(); await tick();
  assert.equal(f.requests.length, 2, 'B must fetch despite the request pending for A');
  f.requests[1].response.resolve({ ...defaults, minSeverity: 'critical' }); await newLoad;
  f.requests[0].response.resolve({ ...defaults, mutedKinds: ['sensor_stale'] }); await oldLoad;
  assert.equal(f.prefs.getNotificationPrefs().minSeverity, 'critical');
  assert.equal(f.prefs.getNotificationPrefs().mutedKinds.length, 0);
  f.login('C'); const third = f.prefs.loadNotificationPrefs(); await tick();
  assert.equal(f.requests.length, 3, 'freshness of B does not suppress loading C');
  f.requests[2].response.resolve(defaults); await third;
  assert.ok([...f.storage.keys()].every(key => key.startsWith('ptap_notification_prefs:')));
});

test('late failed optimistic save for A does not roll back B preferences', async () => {
  const f = fixture(); f.login('A');
  const save = f.prefs.saveNotificationPrefs({ ...defaults, minSeverity: 'warning' });
  const rejected = assert.rejects(save, /offline/);
  f.login('B'); const loadB = f.prefs.loadNotificationPrefs(); await tick();
  f.requests[1].response.resolve({ ...defaults, minSeverity: 'critical' }); await loadB;
  f.requests[0].response.reject(new Error('offline')); await rejected;
  assert.equal(f.prefs.getNotificationPrefs().minSeverity, 'critical');
});

test('late notification response from departed A is discarded while B sync proceeds independently', async () => {
  const f = fixture(); f.login('A');
  const responseA = deferred<any>(); f.setFetchGate(responseA.promise);
  const syncA = f.sync.syncNotificationsToDevice(); await tick();
  f.requests[0].response.resolve(defaults); await tick();
  f.login('B', 'cascajal'); f.setFetchGate(null); f.setNotifications([notice(4, 'B')]);
  const syncB = f.sync.syncNotificationsToDevice(); await tick();
  f.requests[1].response.resolve(defaults); assert.equal(await syncB, 1);
  responseA.resolve({ notifications: [notice(50, 'A confidential')] });
  assert.equal(await syncA, 0);
  assert.deepEqual(f.published, ['B']);
});

test('notification cursor belongs to user and plant; legacy device cursor cannot suppress B alerts', async () => {
  const f = fixture(); f.storage.set('ptap_last_notified_id', '999');
  f.login('A'); f.setNotifications([notice(50, 'A')]);
  const syncA = f.sync.syncNotificationsToDevice(); await tick();
  f.requests[0].response.resolve(defaults); assert.equal(await syncA, 1);
  f.login('B', 'cascajal'); f.setNotifications([notice(4, 'B')]);
  const syncB = f.sync.syncNotificationsToDevice(); await tick();
  f.requests[1].response.resolve(defaults); assert.equal(await syncB, 1);
  assert.deepEqual(f.published, ['A', 'B']);
  const cursors = [...f.storage].filter(([key]) => key.startsWith('ptap_last_notified_id:'));
  assert.equal(cursors.length, 2);
  assert.deepEqual(cursors.map(([, value]) => value).sort(), ['4', '50']);
});

test('logout during native publication prevents old plant content and cursor write', async () => {
  const f = fixture(); f.login('A'); f.setNotifications([notice(50, 'A confidential')]);
  const publication = deferred<void>(); f.setPublicationGate(publication.promise);
  const sync = f.sync.syncNotificationsToDevice(); await tick();
  f.requests[0].response.resolve(defaults); await tick();
  f.login(null); publication.resolve();
  assert.equal(await sync, 0); assert.deepEqual(f.published, []);
  assert.equal([...f.storage.keys()].some(key => key.startsWith('ptap_last_notified_id:')), false);
  assert.equal(await f.sync.syncNotificationsToDevice(), 0);
});

test('native presenter rechecks session after waiting for Android channels', async () => {
  const channel = deferred<void>();
  let current = true;
  let scheduled = 0;
  const device = load('./device-notifications.ts', {
    'react-native': { Platform: { OS: 'android' } },
    '@ptap/shared': { CANAL_AVISOS: 'avisos', CANAL_CRITICAS: 'criticas' },
    './push-rules': { CANALES_AQUORA: [{ id: 'avisos', nombre: 'Avisos', importancia: 'HIGH' }], CANALES_RETIRADOS: [] },
    'expo-notifications': {
      getPermissionsAsync: async () => ({ status: 'granted' }),
      AndroidImportance: { HIGH: 4 }, AndroidNotificationVisibility: { PUBLIC: 1 },
      setNotificationChannelAsync: () => channel.promise,
      scheduleNotificationAsync: async () => { scheduled++; },
    },
  });
  const publication = device.presentNotification('Confidential A', 'A', {}, false, () => current);
  await tick(); current = false; channel.resolve();
  assert.equal(await publication, false);
  assert.equal(scheduled, 0);
});
