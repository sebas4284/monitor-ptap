import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { toast, getToasts, resetToasts, dismissToast } from './toast-store';
import { navigationItems } from './navigation-menu';
import { hasPermission, type Role } from '@ptap/shared';

test('navigation menu preserves role permissions and has no duplicate destinations', () => {
  for (const role of ['admin', 'jefe', 'operador', 'civil'] as const satisfies readonly Role[]) {
    const items = navigationItems((permission) => hasPermission(role, permission));
    const paths: string[] = items.map((item) => item.path);
    assert.equal(new Set(paths).size, paths.length);
    assert.equal(paths.includes('/(app)/usuarios'), hasPermission(role, 'manage_users'));
    assert.equal(paths.includes('/(app)/reportes'), hasPermission(role, 'export_data'));
    assert.equal(paths.includes('/(app)/tablero'), hasPermission(role, 'view_dashboard'));
    assert.equal(paths.includes('/(app)/electrovalvulas'), hasPermission(role, 'view_dashboard'));
    assert.equal(paths.includes('/(app)/alertas'), hasPermission(role, 'view_dashboard'));
    assert.equal(paths.includes('/(app)/estado'), !hasPermission(role, 'view_dashboard'));
    assert.equal(paths.includes('/(app)/ajustes'), false);
  }
});

test('header search opens only the plant selector, returns to the dashboard and respects plant scope', () => {
  let open = false;
  let canSwitchPlant = true;
  let dashboard = true;
  const pushed: string[] = [];
  const element = (type: unknown, props: any) => ({ type, props });
  const module = load('../components/NavigationSearch.tsx', {
    react: { useState: () => [open, (value: boolean) => { open = value; }] },
    'react/jsx-runtime': { jsx: element, jsxs: element },
    'react-native': { Pressable: 'Pressable', Text: 'Text', StyleSheet: { create: (v: unknown) => v }, useWindowDimensions: () => ({ width: 1366 }) },
    'expo-router': { router: { push: (path: string) => pushed.push(path) } },
    './AppIcon': { default: 'Icon', __esModule: true },
    './PlantPicker': { PlantSheet: 'PlantSheet' },
    '../context/AuthContext': { useAuth: () => ({ hasPermission: () => dashboard }) },
    '../context/PlantContext': { usePlant: () => ({ canSwitchPlant }) },
    '../constants/colors': { brand: {} },
    '../constants/fonts': { Fonts: {} },
  });
  const trigger = module.NavigationSearch().props.children[0];
  assert.equal(trigger.props.accessibilityLabel, 'Buscar planta en el tablero');
  trigger.props.onPress();
  const sheet = module.NavigationSearch().props.children[1];
  assert.equal(sheet.type, 'PlantSheet');
  assert.equal(sheet.props.searchOnly, true);
  sheet.props.onClose();
  assert.equal(open, false);
  assert.deepEqual(pushed, []);
  trigger.props.onPress();
  sheet.props.onPicked();
  assert.equal(open, false);
  assert.deepEqual(pushed, ['/(app)/tablero']);
  canSwitchPlant = false;
  assert.equal(module.NavigationSearch(), null);
  canSwitchPlant = true;
  dashboard = false;
  assert.equal(module.NavigationSearch(), null);
});

test('login errors disappear after four seconds without a click; other errors retain their reading time', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  resetToasts();
  t.after(resetToasts);
  toast.error('Error de acceso', 'Credenciales inválidas', 4000);
  toast.error('Otro error', 'Mensaje con más información');
  t.mock.timers.tick(3999);
  assert.equal(getToasts().length, 2);
  t.mock.timers.tick(1);
  assert.deepEqual(getToasts().map((item) => item.title), ['Otro error']);
  dismissToast(getToasts()[0].id);
  t.mock.timers.tick(6000);
  assert.equal(getToasts().length, 0);
});

test('water runs on the native driver, cleans its loop and remains static for reduced motion', () => {
  let effect: () => void | (() => void) = () => {};
  let reduced = false;
  let runs = 0;
  let stops = 0;
  let driver: unknown;
  const drift = { interpolate: () => 0, setValue: () => {} };
  const module = load('../components/WaterBackground.tsx', {
    react: {
      memo: (component: unknown) => component,
      createElement: () => null,
      useEffect: (callback: typeof effect) => { effect = callback; },
      useState: (initial: unknown) => [typeof initial === 'number' ? 320 : drift, () => {}],
    },
    'react/jsx-runtime': { jsx: () => null, jsxs: () => null },
    'react-native': {
      View: 'View', Platform: { OS: 'android' }, StyleSheet: { create: (value: unknown) => value },
      Easing: { linear: () => {} },
      Animated: { Value: function () {}, View: 'Animated.View',
        timing: (_value: unknown, options: { useNativeDriver: boolean }) => { driver = options.useNativeDriver; return {}; },
        loop: () => ({ start: () => runs++, stop: () => stops++ }) },
    },
    './WaterVector': { default: 'Svg', Path: 'Path', __esModule: true },
    './wave-path': { wavePath: () => '' },
    '../constants/colors': { login: { waveBack: 'back', waveMid: 'mid', waveFront: 'front' } },
    '../hooks/useReducedMotion': { useReducedMotion: () => reduced },
  });
  module.WaterBackground({ level: 0.26 });
  const cleanup = effect();
  assert.equal(runs, 1);
  assert.equal(driver, true);
  if (typeof cleanup === 'function') cleanup();
  assert.equal(stops, 1);
  reduced = true;
  module.WaterBackground({ level: 0.26 });
  effect();
  assert.equal(runs, 1);
});

test('tank waves keep compositor motion on reading rerenders and stop for frozen or reduced motion', () => {
  let effect: () => void | (() => void) = () => {};
  let reduced = false;
  let runs = 0;
  let stops = 0;
  const platform = { OS: 'web' };
  const drift = { interpolate: () => 0, setValue: () => {} };
  const element = (type: unknown, props: any) => ({ type, props });
  const module = load('../components/TankWave.tsx', {
    react: {
      memo: (component: unknown) => component,
      createElement: element,
      useEffect: (callback: typeof effect) => { effect = callback; },
      useMemo: (factory: () => unknown) => factory(),
      useState: () => [drift, () => {}],
    },
    'react/jsx-runtime': { jsx: element, jsxs: element },
    'react-native': { Platform: platform, StyleSheet: { create: (value: unknown) => value },
      Easing: { linear: () => {} }, Animated: { Value: function () {}, View: 'Animated.View',
        timing: (_value: unknown, options: { useNativeDriver: boolean }) => { assert.equal(options.useNativeDriver, true); return {}; },
        loop: () => ({ start: () => runs++, stop: () => stops++ }) } },
    './WaterVector': { default: 'Svg', Path: 'Path', __esModule: true },
    './wave-path': { wavePath: () => '' },
    '../constants/colors': { login: { waveMid: 'water' } },
    '../hooks/useReducedMotion': { useReducedMotion: () => reduced },
  });
  const first = module.TankWave({ still: false });
  effect();
  const second = module.TankWave({ still: false });
  effect();
  assert.equal(first.props.children[1].props.style.animation, 'aquora-tank-drift 4s linear infinite');
  assert.equal(second.props.children[1].props.style.animation, first.props.children[1].props.style.animation);
  assert.equal(runs, 0, 'web does not run per-frame JS loops');
  assert.equal(module.TankWave({ still: true }), null);
  reduced = true;
  assert.equal(module.TankWave({ still: false }), null);
  reduced = false;
  platform.OS = 'android';
  module.TankWave({ still: false });
  const cleanup = effect();
  assert.equal(runs, 1);
  if (typeof cleanup === 'function') cleanup();
  assert.equal(stops, 1);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function load(
  file: string,
  modules: Record<string, unknown>,
  globals: Record<string, unknown> = {},
) {
  const exports: Record<string, any> = {};
  const context = createContext({
    ...globals,
    exports,
    module: { exports },
    require: (name: string) => {
      if (!(name in modules)) throw new Error(`Unexpected import ${name}`);
      return modules[name];
    },
  });
  runInContext(
    ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText,
    context,
  );
  return exports;
}

function preferences() {
  const read = deferred<string | null>();
  const writes: { value: string; gate: ReturnType<typeof deferred<void>> }[] = [];
  const store = load('./dashboard-prefs.ts', {
    react: {
      useEffect: (effect: () => void) => effect(),
      useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
    },
    '@react-native-async-storage/async-storage': {
      getItem: () => read.promise,
      setItem: (_key: string, value: string) => {
        const gate = deferred<void>();
        writes.push({ value, gate });
        return gate.promise;
      },
    },
  });
  store.useDashboardPrefs();
  return { store, read, writes, snapshot: () => JSON.parse(JSON.stringify(store.getPrefs())) };
}

test('late dashboard hydration preserves an explicit false and loads untouched groups', async () => {
  const f = preferences();
  f.store.setCompact(false);
  f.read.resolve(JSON.stringify({ compact: true, collapsed: ['outlet'] }));
  await tick();
  assert.deepEqual(f.snapshot(), { compact: false, collapsed: ['outlet'] });
  f.writes[0].gate.resolve();
  await tick();
  assert.deepEqual(JSON.parse(f.writes[1].value), f.snapshot());
  f.writes[1].gate.resolve();
});

test('late dashboard hydration preserves a group toggled during the read', async () => {
  const f = preferences();
  f.store.toggleGroup('inlet');
  f.read.resolve(JSON.stringify({ compact: true, collapsed: ['outlet'] }));
  await tick();
  assert.deepEqual(f.snapshot(), { compact: true, collapsed: ['inlet'] });
  f.writes[0].gate.resolve();
  await tick();
  f.writes[1].gate.resolve();
});

test('dashboard writes complete in edit order even with slow storage', async () => {
  const f = preferences();
  f.read.resolve(null);
  f.store.setCompact(true);
  f.store.setCompact(false);
  await tick();
  assert.equal(f.writes.length, 1);
  f.writes[0].gate.resolve();
  await tick();
  assert.equal(f.writes.length, 2);
  assert.equal(JSON.parse(f.writes[1].value).compact, false);
  f.writes[1].gate.resolve();
});

test('dashboard storage rejects invalid groups and duplicates', async () => {
  const f = preferences();
  f.read.resolve(
    JSON.stringify({ compact: false, collapsed: ['inlet', null, {}, 'invalid', 'inlet'] }),
  );
  await tick();
  assert.deepEqual(f.snapshot(), { compact: false, collapsed: ['inlet'] });
});

test('corrupt dashboard storage leaves usable defaults', async () => {
  for (const value of ['null', '{bad', '42']) {
    const f = preferences();
    f.read.resolve(value);
    await tick();
    assert.deepEqual(f.snapshot(), { compact: false, collapsed: [] });
  }
});

function motion() {
  const reads: ReturnType<typeof deferred<boolean>>[] = [];
  let changes: ((value: boolean) => void) | undefined;
  let subscriptions = 0;
  let removals = 0;
  let subscribe!: (listener: () => void) => () => void;
  let snapshot!: () => boolean;
  const hook = load('../hooks/useReducedMotion.ts', {
    react: {
      useSyncExternalStore: (nextSubscribe: typeof subscribe, nextSnapshot: typeof snapshot) => {
        subscribe = nextSubscribe;
        snapshot = nextSnapshot;
        return snapshot();
      },
    },
    'react-native': {
      AccessibilityInfo: {
        addEventListener: (_event: string, callback: (value: boolean) => void) => {
          subscriptions++;
          changes = callback;
          return {
            remove: () => {
              removals++;
              changes = undefined;
            },
          };
        },
        isReduceMotionEnabled: () => {
          const read = deferred<boolean>();
          reads.push(read);
          return read.promise;
        },
      },
    },
  });
  hook.useReducedMotion();
  return {
    reads,
    subscribe: (listener = () => {}) => subscribe(listener),
    snapshot: () => snapshot(),
    change: (value: boolean) => changes?.(value),
    counts: () => ({ subscriptions, removals }),
  };
}

test('motion shares one listener and cleans it after the last component unmounts', async () => {
  const f = motion();
  assert.equal(f.snapshot(), true);
  const first = f.subscribe();
  const second = f.subscribe();
  assert.equal(f.counts().subscriptions, 1);
  f.reads[0].resolve(false);
  await tick();
  assert.equal(f.snapshot(), false);
  first();
  assert.equal(f.counts().removals, 0);
  second();
  assert.equal(f.counts().removals, 1);
  assert.equal(f.snapshot(), true);
});

test('motion change wins over an older asynchronous preference read', async () => {
  const f = motion();
  const stop = f.subscribe();
  f.change(true);
  f.reads[0].resolve(false);
  await tick();
  assert.equal(f.snapshot(), true);
  f.change(false);
  assert.equal(f.snapshot(), false);
  stop();
});

test('motion ignores an old query after unmount and remount', async () => {
  const f = motion();
  f.subscribe()();
  const stop = f.subscribe();
  f.reads[0].resolve(false);
  await tick();
  assert.equal(f.snapshot(), true);
  f.reads[1].resolve(false);
  await tick();
  assert.equal(f.snapshot(), false);
  stop();
});

test('production font CSS avoids duplicate registration while Metro still loads its fonts', () => {
  const modules = {
    'expo-font': {
      FontDisplay: { SWAP: 'swap' },
      useFonts: (sources: object) => Object.keys(sources),
    },
    '../assets/fonts/Poppins_400Regular.woff2': 'regular.woff2',
    '../assets/fonts/Poppins_500Medium.woff2': 'medium.woff2',
    '../assets/fonts/Poppins_600SemiBold.woff2': 'semibold.woff2',
  };
  assert.equal(load('../constants/fonts.web.ts', modules).usePoppins().length, 3);
  assert.equal(
    load('../constants/fonts.web.ts', modules, {
      document: { getElementById: (id: string) => (id === 'aquora-fonts' ? {} : null) },
    }).usePoppins().length,
    0,
  );
});

test('compact icons fall back to the full font for names added later', () => {
  const full = Object.assign(() => null, { glyphMap: { water: 1, future: 2 } });
  const compact = () => null;
  const module = load('../components/AppIcon.web.ts', {
    react: { createElement: (type: unknown, props: unknown) => ({ type, props }) },
    'react-native': { Text: 'Text' },
    '@expo/vector-icons/Ionicons': full,
    '@expo/vector-icons/createIconSet': () => compact,
    '../assets/fonts/ionicons-used.json': { water: 1 },
    '../assets/fonts/Ionicons.woff2': 'compact.woff2',
  });
  assert.equal(module.default({ name: 'water', size: 22 }).type, compact);
  const future = module.default({ name: 'future', size: 22 });
  assert.equal(future.type, full);
  assert.equal(future.props.size, 22);
  assert.equal(module.default.glyphMap, full.glyphMap);
});

test('preloaded web icons retain vendor defaults, styles, labels, children and fallbacks', () => {
  const full = Object.assign(() => null, { glyphMap: { water: 1, future: 2 } });
  const compact = () => null;
  const module = load(
    '../components/AppIcon.web.ts',
    {
      react: {
        createElement: (type: unknown, props: any, ...children: unknown[]) => ({
          type,
          props,
          children,
        }),
      },
      'react-native': { Text: 'Text' },
      '@expo/vector-icons/Ionicons': full,
      '@expo/vector-icons/createIconSet': () => compact,
      '../assets/fonts/ionicons-used.json': { water: 1 },
      '../assets/fonts/Ionicons.woff2': 'compact.woff2',
    },
    { document: { getElementById: () => ({}) } },
  );
  const defaults = module.default({
    name: 'water',
    accessibilityLabel: 'Agua',
    'aria-hidden': true,
  });
  assert.equal(defaults.type, 'Text');
  assert.equal(defaults.props.selectable, false);
  assert.equal(defaults.props.allowFontScaling, false);
  assert.equal(defaults.props.accessibilityLabel, 'Agua');
  assert.equal(defaults.props['aria-hidden'], true);
  assert.equal(defaults.props.style[0].fontSize, 12);
  assert.equal(defaults.props.style[2].fontFamily, 'ionicons-aquora-web');
  assert.equal(defaults.props.style[2].fontWeight, 'normal');
  assert.equal(defaults.props.style[2].fontStyle, 'normal');
  const style = { transform: [{ rotate: '180deg' }] };
  const custom = module.default({
    name: 'water',
    size: 20,
    color: '#2491CC',
    style,
    allowFontScaling: true,
    selectable: true,
    children: 'extra',
  });
  assert.equal(custom.props.style[0].fontSize, 20);
  assert.equal(custom.props.style[0].color, '#2491CC');
  assert.equal(custom.props.style[1], style);
  assert.equal(custom.props.selectable, true);
  assert.equal(custom.props.allowFontScaling, true);
  assert.equal(custom.children[0], String.fromCodePoint(1));
  assert.equal(custom.children[1], 'extra');
  assert.equal(module.default({ name: 'future' }).type, full);
  assert.equal(module.default({ name: 'water', ref: {} }).type, compact);
  assert.equal(module.default.glyphMap, full.glyphMap);
});

test('plant restoration never exposes the previous account or default plant for one render', () => {
  let user: { id: string; plant: string } | null = null;
  let selection: unknown = null;
  let canSwitch = true;
  const module = load('../context/PlantContext.tsx', {
    react: {
      createContext: () => ({ Provider: 'provider' }),
      useCallback: (fn: unknown) => fn,
      useMemo: (fn: () => unknown) => fn(),
      useState: () => [
        selection,
        (value: unknown) => {
          selection = value;
        },
      ],
    },
    'react/jsx-runtime': { jsx: (_type: unknown, props: any) => props.value },
    './AuthContext': { useAuth: () => ({ user, hasPermission: () => canSwitch }) },
  });
  const render = () => module.PlantProvider({ children: null });
  assert.equal(render().selectedPlant.id, 'montebello');
  user = { id: 'one', plant: 'sim-una' };
  assert.equal(render().selectedPlant.id, 'sim-una');
  render().setSelectedPlant({ id: 'voragine', name: 'La Vorágine' });
  assert.equal(render().selectedPlant.id, 'voragine');
  user = { id: 'two', plant: 'soledad' };
  assert.equal(render().selectedPlant.id, 'soledad');
  canSwitch = false;
  render().setSelectedPlant({ id: 'voragine', name: 'La Vorágine' });
  assert.equal(render().selectedPlant.id, 'soledad');
});

test('navigation animates a new selection, cancels on cleanup and respects reduced motion', () => {
  let effect: () => void | (() => void) = () => {};
  let reduced = false;
  let runs = 0;
  let stops = 0;
  const previous = { current: false };
  const scale = {
    value: 1,
    setValue(value: number) {
      this.value = value;
    },
  };
  const module = load('../components/NavigationTabButton.tsx', {
    react: {
      useState: () => [scale],
      useRef: () => previous,
      useEffect: (fn: typeof effect) => {
        effect = fn;
      },
    },
    'react/jsx-runtime': { jsx: () => null },
    'react-native': {
      Platform: { OS: 'web' },
      Easing: { cubic: null, out: () => null },
      Animated: {
        View: () => null,
        timing: () => ({
          start: () => {
            runs++;
          },
          stop: () => {
            stops++;
          },
        }),
      },
    },
    'expo-router/react-navigation': { PlatformPressable: () => null },
    '../hooks/useReducedMotion': { useReducedMotion: () => reduced },
  });
  module.NavigationTabButton({ 'aria-selected': false });
  effect();
  assert.equal(runs, 0);
  module.NavigationTabButton({ 'aria-selected': true });
  const cleanup = effect();
  assert.equal(runs, 1);
  assert.equal(scale.value, 0.94);
  cleanup?.();
  assert.equal(stops, 1);
  assert.equal(scale.value, 1);
  reduced = true;
  previous.current = false;
  module.NavigationTabButton({ 'aria-selected': true });
  effect();
  assert.equal(runs, 1);
  assert.equal(scale.value, 1);
});

test('distribution motion runs only on change and stops for reduced motion', () => {
  let effect = () => {};
  let reduced = false;
  let runs = 0;
  const previous = { current: 0.5 };
  const progress = {
    value: 0.5,
    setValue(value: number) {
      this.value = value;
    },
  };
  const module = load('../components/SignalDistributionBar.tsx', {
    react: {
      memo: (fn: unknown) => fn,
      useState: () => [progress],
      useRef: () => previous,
      useEffect: (fn: () => void) => {
        effect = fn;
      },
    },
    'react/jsx-runtime': { jsx: () => null, jsxs: () => null },
    'react-native': {
      View: () => null,
      StyleSheet: { create: (x: unknown) => x },
      Platform: { OS: 'web' },
      Easing: { cubic: null, out: () => null },
      Animated: {
        View: () => null,
        timing: () => ({
          start: () => {
            runs++;
          },
          stop: () => {},
        }),
      },
    },
    '../constants/colors': { brand: { divider: '#000' } },
    '../hooks/useReducedMotion': { useReducedMotion: () => reduced },
  });
  module.SignalDistributionBar({ fraction: 0.5, color: '#000', label: 'test' });
  effect();
  assert.equal(runs, 0);
  module.SignalDistributionBar({ fraction: 1, color: '#000', label: 'test' });
  effect();
  assert.equal(runs, 1);
  reduced = true;
  module.SignalDistributionBar({ fraction: 0.25, color: '#000', label: 'test' });
  effect();
  assert.equal(progress.value, 0.25);
  assert.equal(runs, 1);
});

test('valve overrides are cleared before a different plant commits its render', () => {
  const state: any[] = [null, { valve1: 'open' }, 'plant-a'];
  const refs = [
    { current: { valve1: { flow: 'open', state: 'closed' } } as Record<string, unknown> },
    { current: { valve1: 1 } as Record<string, unknown> },
  ];
  let stateIndex = 0;
  let refIndex = 0;
  let changed = false;
  let effects: (() => unknown)[] = [];
  let comparisons = 0;
  const module = load('../hooks/useValveSupervisor.ts', {
    react: {
      useState: () => {
        const index = stateIndex++;
        return [
          state[index],
          (value: any) => {
            state[index] = typeof value === 'function' ? value(state[index]) : value;
            changed = true;
          },
        ];
      },
      useRef: (initial: Record<string, unknown>) => {
        const index = refIndex++;
        return (refs[index] ??= { current: initial });
      },
      useLayoutEffect: (fn: () => unknown) => {
        effects.push(fn);
      },
      useEffect: (fn: () => unknown) => {
        effects.push(fn);
      },
      useMemo: (fn: () => unknown) => fn(),
      useCallback: (fn: unknown) => fn,
    },
    '../services/api': {
      sendValveCommand: () => {
        throw new Error('No command expected');
      },
    },
    '../services/valves': {
      vigilaOperacionManual: () => true,
      detectManual: () => {
        comparisons++;
        return null;
      },
    },
  });
  const valve = { id: 'valve1', state: 'closed', byState: 'closed', byFlow: 'closed' };
  function render(plant: string) {
    let value: any;
    let passes = 0;
    do {
      assert.ok(passes++ < 3, 'Plant reset must converge before commit');
      changed = false;
      stateIndex = 0;
      refIndex = 0;
      effects = [];
      value = module.useValveSupervisor(plant, [valve]);
    } while (changed);
    return value;
  }
  assert.equal(render('plant-a').valves[0].effectiveState, 'open');
  const next = render('plant-b');
  assert.equal(next.valves[0].effectiveState, 'closed');
  assert.equal(next.valves[0].manualOverride, false);
  // React runs these only after the guarded render has converged.
  effects.forEach((fn) => fn());
  assert.equal(comparisons, 0, 'The first reading of B cannot be compared with A');
  assert.equal(
    render('plant-a').valves[0].manualOverride,
    false,
    'Returning to A cannot restore its old override',
  );
});

test('push presentation follows the current session and permission without reviving an old result', async () => {
  const state: any[] = ['undetermined', null];
  let stateIndex = 0;
  let effects: (() => unknown)[] = [];
  let token = 'A';
  let generation = 1;
  let permission = 'granted';
  const module = load('../hooks/useDeviceNotifications.ts', {
    react: {
      useState: () => {
        const index = stateIndex++;
        return [
          state[index],
          (value: any) => {
            state[index] = value;
          },
        ];
      },
      useEffect: (fn: () => unknown) => {
        effects.push(fn);
      },
      useCallback: (fn: unknown) => fn,
    },
    'react-native': {
      Platform: { OS: 'web' },
      AppState: {
        currentState: 'active',
        addEventListener: () => ({ remove() {} }),
      },
    },
    '../context/AuthContext': { useAuth: () => ({ token, hasPermission: () => true }) },
    '../services/device-notifications': {
      isSupported: () => true,
      unsupportedReason: () => null,
      getPermission: async () => permission,
      requestPermission: async () => permission,
    },
    '../services/notification-sync': {},
    '../services/notification-session': {
      notificationSession: () => ({ token, generation }),
      isNotificationSession: (session: any) =>
        session.token === token && session.generation === generation,
    },
    '../services/push-registration': {
      registrarPush: async () => 'activo',
      escucharCambiosDeToken: () => () => {},
    },
  });
  function render() {
    stateIndex = 0;
    effects = [];
    return module.useDeviceNotifications();
  }
  render();
  effects[0]();
  await tick();
  render();
  const stop = effects[2]() as () => void;
  await tick();
  assert.equal(render().push, 'activo');
  permission = 'denied';
  effects[0]();
  await tick();
  assert.equal(render().push, 'pendiente');
  permission = 'granted';
  effects[0]();
  await tick();
  assert.equal(
    render().push,
    'pendiente',
    'Granting permission must await a new registration result',
  );
  stop();
  const stopAgain = effects[2]() as () => void;
  await tick();
  assert.equal(render().push, 'activo');
  token = 'B';
  generation++;
  assert.equal(render().push, 'pendiente');
  token = 'A';
  generation++;
  assert.equal(
    render().push,
    'pendiente',
    'A new session with the same JWT cannot reuse the previous generation',
  );
  stopAgain();
  const currentRegistration = effects[2]() as () => void;
  await tick();
  assert.equal(render().push, 'activo');
  generation++;
  assert.equal(
    render().push,
    'pendiente',
    'Renewing the same token must invalidate the old generation immediately',
  );
  currentRegistration();
  const renewedRegistration = effects[2]() as () => void;
  await tick();
  assert.equal(render().push, 'activo', 'The renewed generation can register again');
  renewedRegistration();
});

function valveRaceRuntime() {
  const state: any[] = [];
  const refs: any[] = [];
  const committed: { deps: unknown[]; cleanup?: () => void }[] = [];
  let stateIndex = 0,
    refIndex = 0,
    effectIndex = 0,
    changed = false,
    writes = 0;
  let pending: { index: number; deps: unknown[]; effect: () => void | (() => void) }[] = [];
  const registerEffect = (effect: () => void | (() => void), deps: unknown[]) => {
    const index = effectIndex++;
    if (!committed[index] || deps.some((value, i) => !Object.is(value, committed[index].deps[i])))
      pending.push({ index, deps, effect });
  };
  const react = {
    useState(initial: any) {
      const index = stateIndex++;
      if (!Object.hasOwn(state, index))
        state[index] = typeof initial === 'function' ? initial() : initial;
      return [
        state[index],
        (next: any) => {
          state[index] = typeof next === 'function' ? next(state[index]) : next;
          changed = true;
          writes++;
        },
      ];
    },
    useRef(initial: unknown) {
      return (refs[refIndex++] ??= { current: initial });
    },
    useEffect: registerEffect,
    useLayoutEffect: registerEffect,
    useMemo: (fn: () => unknown) => fn(),
    useCallback: (fn: unknown) => fn,
  };
  return {
    react,
    state,
    get writes() {
      return writes;
    },
    render<T>(fn: () => T): T {
      let result!: T;
      for (let pass = 0; pass < 8; pass++) {
        stateIndex = refIndex = effectIndex = 0;
        pending = [];
        changed = false;
        result = fn();
        if (changed) continue;
        for (const entry of pending) {
          committed[entry.index]?.cleanup?.();
          const cleanup = entry.effect();
          committed[entry.index] = { deps: entry.deps, cleanup: cleanup || undefined };
        }
        if (!changed) return result;
      }
      throw new Error('Valve fixture did not converge');
    },
    unmount() {
      committed.forEach((entry) => entry?.cleanup?.());
    },
  };
}

const commandRaceVerdict = {
  ok: true,
  signalSent: true,
  tone: 'success',
  title: 'Orden confirmada',
  message: 'Resultado real de A',
};

function supervisedRace() {
  const runtime = valveRaceRuntime();
  let generation = 1;
  const requests: {
    plant: string;
    target: string;
    gate: ReturnType<typeof deferred<typeof commandRaceVerdict>>;
  }[] = [];
  const module = load('../hooks/useValveSupervisor.ts', {
    react: runtime.react,
    '../services/api': {
      getAuthGeneration: () => generation,
      sendValveCommand: (plant: string, _verb: string, target: string) => {
        const gate = deferred<typeof commandRaceVerdict>();
        requests.push({ plant, target, gate });
        return gate.promise;
      },
    },
    '../services/valves': {
      vigilaOperacionManual: () => true,
      detectManual: () => null,
      interpretCommand: (value: unknown) => value,
      presentacionDeValvula: () => ({ kind: 'closed', label: 'Cerrada' }),
    },
  });
  const valve = {
    id: 'valve1',
    name: 'Válvula 1',
    state: 'closed',
    byState: 'closed',
    byFlow: 'closed',
  };
  const valves = [valve];
  return {
    runtime,
    requests,
    valve,
    changeAccount() {
      generation++;
    },
    render: (plant: string) => runtime.render<any>(() => module.useValveSupervisor(plant, valves)),
  };
}

test('valve supervision keeps the original verdict but never clears overrides after A to B to A', async () => {
  const f = supervisedRace();
  const first = f.render('A');
  const operation = first.send(first.valves[0], 'open');
  assert.equal(
    f.render('B').busy,
    'valve1',
    'The real outstanding operation remains globally busy',
  );
  f.render('A');
  f.runtime.state[1] = { valve1: 'open' };
  f.requests[0].gate.resolve(commandRaceVerdict);
  const verdict = await operation;
  const current = f.render('A');
  assert.equal(verdict.message, commandRaceVerdict.message);
  assert.equal(
    current.valves[0].manualOverride,
    true,
    'Old A confirmation cannot erase the new A context',
  );
  assert.equal(current.busy, null);
  assert.deepEqual(
    f.requests.map((x) => [x.plant, x.target]),
    [['A', 'valve1']],
    'Only the original plant receives the command',
  );
  f.runtime.unmount();
});

test('valve supervision cannot release a newer operation or override in another plant', async () => {
  const f = supervisedRace();
  const a = f.render('A');
  const old = a.send(a.valves[0], 'open');
  const b = f.render('B');
  const newer = b.send(b.valves[0], 'open');
  f.runtime.state[1] = { valve1: 'open' };
  f.requests[0].gate.resolve(commandRaceVerdict);
  await old;
  assert.equal(f.render('B').busy, 'valve1');
  assert.equal(f.render('B').valves[0].manualOverride, true);
  f.requests[1].gate.resolve({ ...commandRaceVerdict, message: 'Resultado real de B' });
  await newer;
  assert.equal(f.render('B').busy, null);
  f.runtime.unmount();
});

test('valve supervision returns the real verdict without updating an unmounted or departed account', async () => {
  for (const leave of ['unmount', 'account']) {
    const f = supervisedRace();
    const value = f.render('A');
    const operation = value.send(value.valves[0], 'open');
    if (leave === 'unmount') f.runtime.unmount();
    else f.changeAccount();
    const before = f.runtime.writes;
    f.requests[0].gate.resolve(commandRaceVerdict);
    assert.equal((await operation).message, commandRaceVerdict.message);
    assert.equal(f.runtime.writes, before, leave);
    f.runtime.unmount();
  }
});

function valveScreenRace() {
  const runtime = valveRaceRuntime();
  let plant = 'A',
    generation = 1;
  const gate = deferred<typeof commandRaceVerdict>();
  const valve = { id: 'valve1', name: 'Válvula 1', effectiveState: 'closed', commandable: true };
  const modules: Record<string, unknown> = {
    react: runtime.react,
    'react/jsx-runtime': {
      jsx: (type: unknown, props: unknown) => ({ type, props }),
      jsxs: (type: unknown, props: unknown) => ({ type, props }),
    },
    'react-native': {
      View: 'View',
      Text: 'Text',
      ScrollView: 'ScrollView',
      RefreshControl: 'RefreshControl',
      StyleSheet: { create: (x: unknown) => x },
    },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../../components/AppIcon': 'Icon',
    '../../hooks/useSnapshot': {
      useSnapshot: () => ({
        data: { liveness: { state: 'live' }, displayName: 'Planta ' + plant },
      }),
    },
    '../../context/PlantContext': {
      usePlant: () => ({ selectedPlant: { id: plant, name: 'Planta ' + plant } }),
    },
    '../../context/AuthContext': { useAuth: () => ({ hasPermission: () => true }) },
    '../../services/valves': {
      valvesFromSnapshot: () => [valve],
      accionDisponible: () => ({ kind: 'command', verb: 'open' }),
      resumenDeValvulas: () => ({}),
    },
    '../../hooks/useValveSupervisor': {
      useValveSupervisor: () => ({ valves: [valve], busy: null, send: () => gate.promise }),
    },
    '../../services/dashboard-prefs': { useDashboardPrefs: () => ({ compact: false }) },
    '../../services/api': { getAuthGeneration: () => generation },
    '../../services/plant-status': { EN_INTEGRACION: {} },
    '../../constants/colors': { primary: '#2491CC', brand: {} },
    '../../constants/fonts': { Fonts: {} },
    '../../components/PlantPicker': { PlantPickerLayout: 'PlantPickerLayout', PlantPickerTrigger: 'PlantPickerTrigger' },
  };
  for (const name of [
    'ValveItem',
    'ValveConfirmDialog',
    'ValveResultDialog',
    'PlantSelector',
    'ConnectionBanner',
    'LiveBadge',
    'OfflineNotice',
  ]) {
    modules['../../components/' + name] = { [name]: name };
  }
  modules['../../components/Skeleton'] = { ListSkeleton: 'ListSkeleton' };
  const module = load('../app/(app)/electrovalvulas.tsx', modules);
  function find(node: any, type: string): any {
    if (!node || typeof node !== 'object') return null;
    if (node.type === type) return node;
    const children = Array.isArray(node) ? node : [node.props?.children];
    for (const child of children.flat()) {
      const match = find(child, type);
      if (match) return match;
    }
    return null;
  }
  const render = () => runtime.render<any>(() => module.default());
  return {
    runtime,
    gate,
    render,
    find,
    changePlant(value: string) {
      plant = value;
    },
    changeAccount() {
      generation++;
    },
    confirm() {
      find(render(), 'ValveItem').props.onToggle(valve);
      find(render(), 'ValveConfirmDialog').props.onConfirm();
    },
  };
}

test('valve result after a plant switch always identifies the original plant and preserves acknowledgment', async () => {
  const f = valveScreenRace();
  f.confirm();
  f.changePlant('B');
  f.render();
  f.gate.resolve(commandRaceVerdict);
  await tick();
  const dialog = f.find(f.render(), 'ValveResultDialog');
  assert.equal(dialog.props.verdict.valveName, 'Planta A · Válvula 1');
  assert.match(dialog.props.verdict.message, /Planta: Planta A \(A\)/);
  assert.match(dialog.props.verdict.message, /Resultado real de A/);
  dialog.props.onClose();
  assert.equal(f.find(f.render(), 'ValveResultDialog').props.verdict, null);
  f.runtime.unmount();
});

test('valve result is not published after unmount or an account transition', async () => {
  for (const leave of ['unmount', 'account']) {
    const f = valveScreenRace();
    f.confirm();
    if (leave === 'unmount') f.runtime.unmount();
    else f.changeAccount();
    const before = f.runtime.writes;
    f.gate.resolve(commandRaceVerdict);
    await tick();
    assert.equal(f.runtime.writes, before, leave);
    f.runtime.unmount();
  }
});
