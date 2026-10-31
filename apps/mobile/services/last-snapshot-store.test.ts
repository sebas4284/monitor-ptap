import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { QueryClient } from '@tanstack/react-query';
import { hasPermission as checkPermission, type Permission } from '../../../packages/shared/src';

// Native storage is replaced only at the device boundary; the real cache implementation runs.
function fixture(disk = new Map<string, string>(), platform = 'android') {
  let releaseRead: (() => void) | undefined;
  let blockRead = false;
  let blockWrite = false;
  let releaseWrite: (() => void) | undefined;
  const source = readFileSync(new URL('./last-snapshot-store.ts', import.meta.url), 'utf8').replace(
    /^import\b[\s\S]*?;\r?\n/gm,
    '',
  );
  const context = vm.createContext({
    exports: {},
    Platform: { OS: platform },
    localStorage: {
      get length() {
        return disk.size;
      },
      key: (index: number) => [...disk.keys()][index] ?? null,
      getItem: (key: string) => disk.get(key) ?? null,
      setItem: (key: string, value: string) => disk.set(key, value),
      removeItem: (key: string) => disk.delete(key),
    },
    checkPermission,
    AsyncStorage: {
      getAllKeys: async () => [...disk.keys()],
      multiGet: async (keys: string[]) => {
        const values = keys.map((key) => [key, disk.get(key) ?? null]);
        if (blockRead)
          await new Promise<void>((resolve) => {
            releaseRead = resolve;
          });
        return values;
      },
      setItem: async (key: string, value: string) => {
        if (blockWrite)
          await new Promise<void>((resolve) => {
            releaseWrite = resolve;
          });
        disk.set(key, value);
      },
      multiRemove: async (keys: string[]) => {
        keys.forEach((key) => disk.delete(key));
      },
    },
  });
  vm.runInContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context,
  );
  return {
    store: context.exports as Record<string, (...args: any[]) => any>,
    disk,
    block: () => {
      blockRead = true;
    },
    release: () => releaseRead?.(),
    blockWrite: () => {
      blockWrite = true;
    },
    releaseWrite: () => releaseWrite?.(),
  };
}
const alice = { id: 'alice', role: 'operador', plant: 'a' } as const;
const bob = { id: 'bob', role: 'civil', plant: 'b' } as const;
const snapshot = { plantId: 'a', signals: { flow: { value: 42 } }, pending: false };
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('logout removes device snapshots and rejects a late response from the old session', async () => {
  const { store, disk } = fixture();
  await store.setLastDataSession(alice);
  const generation = store.lastDataSession();
  store.rememberSnapshot(snapshot, generation);
  await tick();
  assert.ok(disk.size > 0, 'authorized offline snapshot persists');
  await store.setLastDataSession(null);
  store.rememberSnapshot(snapshot, generation);
  await tick();
  assert.equal(store.getLastSnapshot('a'), null);
  assert.equal(disk.size, 0);
});

test('switching account cannot read the previous plant or detail cache', async () => {
  const { store } = fixture();
  await store.setLastDataSession(alice);
  store.rememberSnapshot(snapshot, store.lastDataSession());
  await store.setLastDataSession(bob);
  assert.equal(store.getLastSnapshot('a'), null);
  assert.equal(store.getLastSnapshot('b'), null);
});

test('in-flight hydration cannot resurrect snapshots after logout', async () => {
  const { store, disk, block, release } = fixture();
  await store.setLastDataSession(alice);
  store.rememberSnapshot(snapshot, store.lastDataSession());
  await tick();
  block();
  const hydration = store.setLastDataSession(alice);
  await tick();
  const logout = store.setLastDataSession(null);
  release();
  await Promise.all([hydration, logout]);
  assert.equal(store.getLastSnapshot('a'), null);
  assert.equal(disk.size, 0);
});

function authFixture(store: Record<string, (...args: any[]) => any>) {
  const queryClient = new QueryClient();
  const effects: (() => void)[] = [];
  const state: unknown[] = [];
  let pushDone: () => void = () => undefined;
  let authToken: string | null = 'old';
  let restore: ((value: string | null) => void)[] = [];
  const source = readFileSync(
    new URL('../context/AuthContext.tsx', import.meta.url),
    'utf8',
  ).replace(/^import\b[\s\S]*?;\r?\n/gm, '');
  const context = vm.createContext({
    exports: {},
    require: () => ({ jsx: (_type: unknown, props: any) => props.value }),
    createContext: () => ({ Provider: {} }),
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
    useState: (initial: unknown) => {
      const index = state.length;
      state.push(initial);
      return [
        initial,
        (value: unknown) => {
          state[index] = value;
        },
      ];
    },
    useRef: (value: unknown) => ({ current: value }),
    useEffect: (fn: () => void) => {
      effects.push(fn);
    },
    useQueryClient: () => queryClient,
    storage: {
      getItem: () => new Promise<string | null>((resolve) => restore.push(resolve)),
      setItem: async () => {},
      deleteItem: async () => {},
    },
    invalidateSessionRestoration: () => {},
    resumeSessionRestoration: () => {},
    TOKEN_KEY: 'token',
    USER_KEY: 'user',
    tokenExpiryMs: () => Date.now() + 60_000,
    setAuthToken: (value: string | null) => {
      authToken = value;
    },
    setOnUnauthorized: () => {},
    invalidateAuthRequests: () => {},
    desregistrarPush: () =>
      new Promise<void>((resolve) => {
        pushDone = resolve;
      }),
    resetSocket: () => {},
    setLastDataSession: store.setLastDataSession,
    checkPermission: () => true,
  });
  vm.runInContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    context,
  );
  const auth = (context.exports as any).AuthProvider({ children: null });
  return {
    auth,
    queryClient,
    effects,
    state,
    token: () => authToken,
    finishPush: () => pushDone(),
    finishRestore: () => {
      restore[0]('old');
      restore[1](JSON.stringify(alice));
    },
  };
}

test('logout immediately removes query data and fallback before push unregister finishes', async () => {
  const { store } = fixture();
  await store.setLastDataSession(alice);
  store.rememberSnapshot(snapshot, store.lastDataSession());
  const auth = authFixture(store);
  auth.queryClient.setQueryData(['notifications'], ['private']);
  const logout = auth.auth.logout();
  assert.equal(auth.queryClient.getQueryData(['notifications']), undefined);
  assert.equal(store.getLastSnapshot('a'), null);
  auth.finishPush();
  await logout;
});

test('late persisted-session restoration cannot revive a session after logout', async () => {
  const { store } = fixture();
  const auth = authFixture(store);
  auth.effects[0]();
  const logout = auth.auth.logout();
  auth.finishPush();
  await logout;
  auth.finishRestore();
  await tick();
  assert.equal(auth.token(), null);
  assert.equal(auth.state[1], null);
});

function renderHook(
  file: string,
  name: string,
  user: typeof alice | typeof bob,
  data: unknown,
  store: Record<string, (...args: any[]) => any>,
) {
  let options: any;
  const context = vm.createContext({
    exports: {},
    ...store,
    useAuth: () => ({
      user,
      token: 'synthetic',
      hasPermission: (permission: Permission) => checkPermission(user.role, permission),
    }),
    useQuery: (config: unknown) => {
      options = config;
      return { data, refetch: () => {} };
    },
    useQueryClient: () => new QueryClient(),
    useMutation: () => ({ mutate: () => {} }),
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
    useEffect: () => {},
    useRef: (value: unknown) => ({ current: value }),
    useState: (value: unknown) => [value, () => {}],
    useSyncExternalStore: () => 0,
    fetchSnapshot: async () => snapshot,
    fetchBasicStatus: async () => ({ plantId: 'a', waterAvailable: true }),
    fetchNotifications: () => {},
    fetchUnseenCount: () => {},
    markNotificationsSeen: () => {},
  });
  const source = readFileSync(new URL(`../hooks/${file}.ts`, import.meta.url), 'utf8').replace(
    /^import\b[\s\S]*?;\r?\n/gm,
    '',
  );
  vm.runInContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context,
  );
  const result = (context.exports as any)[name]('a');
  return { result, options };
}

test('disabled notification hooks never expose cached detail to a Civil', () => {
  const { store } = fixture();
  const cached = { notifications: [{ id: 11, message: 'private' }], unseen: 5 };
  const { result } = renderHook('useNotifications', 'useNotifications', bob, cached, store);
  assert.equal(result.notifications.length, 0);
  assert.equal(result.unseen, 0);
  assert.equal(renderHook('useNotifications', 'useUnseenNotifications', bob, 5, store).result, 0);
});

test('telemetry query identity changes across sessions and current results populate offline fallback', async () => {
  const { store } = fixture();
  await store.setLastDataSession(alice);
  const first = renderHook('useSnapshot', 'useSnapshot', alice, undefined, store);
  await first.options.queryFn();
  assert.equal(store.getLastSnapshot('a')?.signals.flow.value, 42);
  await store.setLastDataSession(bob);
  const second = renderHook('useSnapshot', 'useSnapshot', bob, undefined, store);
  assert.notDeepEqual([...first.options.queryKey], [...second.options.queryKey]);
});

function transportFixture() {
  let complete: ((value: unknown) => void) | undefined;
  let unauthorized = 0;
  const source = readFileSync(new URL('./api.ts', import.meta.url), 'utf8').replace(
    /^import\b[\s\S]*?;\r?\n/gm,
    '',
  );
  const context = vm.createContext({
    exports: {},
    Constants: {},
    fetch: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  });
  vm.runInContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context,
  );
  const api = context.exports as Record<string, (...args: any[]) => any>;
  api.setOnUnauthorized(() => unauthorized++);
  return { api, finish401: () => complete?.({ status: 401 }), unauthorized: () => unauthorized };
}

test('an old request 401 cannot log out a later session, even if the token string is reused', async () => {
  const { api, finish401, unauthorized } = transportFixture();
  api.setAuthToken('first');
  const old = api.getJson('/synthetic');
  api.setAuthToken(null);
  api.setAuthToken('first');
  finish401();
  await assert.rejects(old);
  assert.equal(unauthorized(), 0);
});

test('current-session 401 still requests logout', async () => {
  const { api, finish401, unauthorized } = transportFixture();
  api.setAuthToken('first');
  const current = api.getJson('/synthetic');
  finish401();
  await assert.rejects(current);
  assert.equal(unauthorized(), 1);
});

function backgroundSessionFixture() {
  let complete: ((value: string | null) => void) | undefined;
  let token: string | null = null;
  const source = readFileSync(new URL('./session-store.ts', import.meta.url), 'utf8').replace(
    /^import\b[\s\S]*?;\r?\n/gm,
    '',
  );
  const context = vm.createContext({
    exports: {},
    Platform: { OS: 'android' },
    atob,
    SecureStore: {
      getItemAsync: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    },
    getAuthToken: () => token,
    setAuthToken: (value: string | null) => {
      token = value;
    },
  });
  vm.runInContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context,
  );
  return {
    session: context.exports as Record<string, (...args: any[]) => any>,
    token: () => token,
    finishRead: () => complete?.(`x.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 60 }))}.x`),
  };
}

test('a pending background credential read cannot restore a session revoked during the read', async () => {
  const { session, token, finishRead } = backgroundSessionFixture();
  const restoring = session.restaurarTokenDeSesion();
  session.invalidateSessionRestoration();
  finishRead();
  assert.equal(await restoring, false);
  assert.equal(token(), null);
});

test('a valve-command 401 from the previous identity cannot revoke the next login', async () => {
  const { api, finish401, unauthorized } = transportFixture();
  api.setAuthToken('first');
  const old = api.sendValveCommand('synthetic', 'open', 'valve1');
  api.setAuthToken('second');
  finish401();
  assert.equal((await old).http, 401);
  assert.equal(unauthorized(), 0);
});

for (const platform of ['android', 'web']) {
  test(`${platform}: cold restore preserves only the same authorized user's offline fallback`, async () => {
    const first = fixture(undefined, platform);
    await first.store.setLastDataSession(alice);
    first.store.rememberSnapshot(snapshot, first.store.lastDataSession());
    await tick();
    const restored = fixture(first.disk, platform);
    assert.equal(restored.store.getLastSnapshot('a'), null, 'no hydration before auth');
    await restored.store.setLastDataSession(alice);
    assert.equal(restored.store.getLastSnapshot('a')?.signals.flow.value, 42);
    await restored.store.setLastDataSession({ ...alice, role: 'civil' });
    assert.equal(restored.store.getLastSnapshot('a'), null, 'role downgrade discards detail');
    assert.equal(first.disk.size, 0);
  });

  test(`${platform}: legacy unscoped backups are discarded rather than assigned to a new identity`, async () => {
    const disk = new Map([['ptap_last_snapshot_a', JSON.stringify(snapshot)]]);
    const { store } = fixture(disk, platform);
    await store.setLastDataSession(alice);
    assert.equal(store.getLastSnapshot('a'), null);
    assert.equal(disk.size, 0);
  });
}

test('logout cleanup follows an already in-flight native write and removes its output', async () => {
  const { store, disk, blockWrite, releaseWrite } = fixture();
  await store.setLastDataSession(alice);
  blockWrite();
  store.rememberSnapshot(snapshot, store.lastDataSession());
  await tick();
  const logout = store.setLastDataSession(null);
  releaseWrite();
  await logout;
  assert.equal(disk.size, 0);
  assert.equal(store.getLastSnapshot('a'), null);
});

test('Civil offline fallback is limited to basic status for the assigned plant', async () => {
  const { store } = fixture();
  await store.setLastDataSession(bob);
  const session = store.lastDataSession();
  store.rememberSnapshot({ ...snapshot, plantId: 'b' }, session);
  store.rememberBasicStatus({ plantId: 'a', waterAvailable: true }, session);
  store.rememberBasicStatus({ plantId: 'b', waterAvailable: false }, session);
  assert.equal(store.getLastSnapshot('b'), null);
  assert.equal(store.getLastBasicStatus('a'), null);
  assert.equal(store.getLastBasicStatus('b')?.waterAvailable, false);
});

test('repeated unauthorized logout callbacks share cleanup instead of restarting push unregister', async () => {
  const { store } = fixture();
  const auth = authFixture(store);
  const first = auth.auth.logout();
  const second = auth.auth.logout();
  auth.finishPush();
  await Promise.race([
    Promise.all([first, second]),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('logout restarted its in-flight unregister')), 100),
    ),
  ]);
  assert.equal(auth.token(), null);
});

test('a request started before a foreground transition cannot revoke that transition', async () => {
  const { api, finish401, unauthorized } = transportFixture();
  api.setAuthToken('first');
  const old = api.getJson('/synthetic');
  api.invalidateAuthRequests();
  finish401();
  await assert.rejects(old);
  assert.equal(unauthorized(), 0);
});
