import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import type { PlantReport } from './api';
import { plantReportSections } from './plant-report';

function load(file: string, modules: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const exports: Record<string, any> = {};
  runInContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, createContext({ exports, module: { exports }, ...globals,
    require: (name: string) => {
      if (!(name in modules)) throw new Error(`Unexpected import ${name}`);
      return modules[name];
    },
  }));
  return exports;
}

const report: PlantReport = {
  plantId: 'cascajal', displayName: 'Cascajal', at: '2026-11-12T10:00:00Z',
  network: { scope: 'global', latest: { at: '2026-11-12T09:00:00Z', eventType: 'route.sample',
    detail: { code: 'PLC-13', where: 'plc-servicio', probes: { plc: { outcome: 'timeout', ms: 3000 }, control: { outcome: 'refused', ms: 25 } } } }, history: [] },
  bridge: { scope: 'global', status: 'Connected', at: null, diagnostics: { reconnectCount: 2 }, history: [] },
  plant: null, liveness: null,
  buffers: [
    { plantId: 'cascajal', browseName: 'REAL', channel: 'realIn', resolved: true, faulted: false, reason: null, sourceTimestamp: null },
    { plantId: 'cascajal', browseName: 'INT', channel: 'intIn', resolved: false, faulted: true, reason: 'BadNodeIdUnknown', sourceTimestamp: null },
  ],
  signals: [{ domainKey: 'level', label: 'Nivel', value: null, unit: 'm', quality: 'Bad', usable: false, reason: 'BAD_QUALITY', mappingStatus: 'mapped', confidence: 'inferred', ts: null }],
  anomalies: [{ at: '2026-11-12T09:59:00Z', type: 'BUFFER_MISSING', plantId: 'cascajal', domainKey: 'level', detail: 'Sin buffer INT' }],
  freshness: null, deepProbe: false,
};

test('plant sections preserve evidence timestamps, independent buffer failures and unusable reasons', () => {
  const sections = plantReportSections(report);
  assert.deepEqual(sections.map((section) => section.title), ['Red', 'Puente', 'Buffers', 'Señales', 'Anomalías']);
  assert.equal(sections[0].items[0].at, report.network.latest?.at);
  assert.equal(sections[0].items[1].state, 'ok', 'control rejection proves the host route responds');
  assert.deepEqual(sections[2].items.map((item) => item.state), ['unknown', 'error']);
  assert.equal(sections[2].items[0].at, null, 'do not invent a PLC timestamp');
  assert.match(sections[3].items[0].detail, /sin valor.*no usable: BAD_QUALITY/);
  assert.equal(sections[4].items[0].at, report.anomalies[0].at);
});

test('missing route evidence is unknown and exported text keeps all sections and missing hours', async () => {
  assert.equal(plantReportSections({ ...report, network: { scope: 'global', latest: null, history: [] } })[0].items[0].state, 'unknown');
  let shared = '';
  const exporter = load('./diagnostics-export.ts', {
    'react-native': { Platform: { OS: 'android' }, Share: { share: async ({ message }: { message: string }) => { shared = message; } } },
    '@ptap/shared': { CONNECTION_CODES: {} }, './api': { API_BASE_URL: 'http://api' }, './plant-report': { plantReportSections },
  });
  const text = exporter.buildPlantDiagnosticsReport(report);
  assert.match(text, /Cascajal.*cascajal/);
  assert.match(text, /Hora: sin hora disponible/);
  assert.match(text, /BadNodeIdUnknown/);
  assert.match(text, /BUFFER_MISSING/);
  assert.equal(await exporter.exportPlantDiagnosticsReport(report), true);
  assert.equal(shared, text);
});

test('cached signals never turn green from a timestamp, frozen plant or disconnected bridge', () => {
  const signal = { ...report.signals[0], value: 3, usable: true, quality: 'Good' as const, ts: report.at };
  const current = { ...report, signals: [signal] };
  assert.equal(plantReportSections(current)[3].items[0].state, 'unknown');
  assert.equal(plantReportSections({ ...current, signals: [{ ...signal, ts: null }] })[3].items[0].state, 'unknown');
  const frozen = plantReportSections({ ...current, liveness: { state: 'frozen', lastChangeAt: report.at, windowSec: 60 } });
  assert.equal(frozen[3].items[0].state, 'warning');
  assert.match(frozen[3].items[0].detail, /planta frozen/);
  const disconnected = plantReportSections({ ...current, bridge: { ...report.bridge, status: 'Disconnected' } });
  assert.equal(disconnected[3].items[0].state, 'warning');
  assert.match(disconnected[3].items[0].detail, /puente Disconnected/);
});

test('historic buffer timestamps do not turn frozen or disconnected data green', () => {
  const current = { ...report, buffers: [{ ...report.buffers[0], sourceTimestamp: report.at }] };
  assert.equal(plantReportSections(current)[2].items[0].state, 'ok');
  for (const stale of [
    { ...current, liveness: { state: 'frozen' as const, lastChangeAt: report.at, windowSec: 60 } },
    { ...current, bridge: { ...report.bridge, status: 'Disconnected' as const } },
  ]) {
    const item = plantReportSections(stale)[2].items[0];
    assert.equal(item.state, 'warning');
    assert.match(item.detail, /dato en cache/);
    assert.equal(plantReportSections({ ...stale, buffers: [{ ...stale.buffers[0], sourceTimestamp: null }] })[2].items[0].state, 'unknown');
    assert.equal(plantReportSections({ ...stale, buffers: [{ ...stale.buffers[0], faulted: true }] })[2].items[0].state, 'error');
  }
});

test('plant request encodes the id and never activates a deep PLC read', async () => {
  let requested = '';
  const api = load('./api.ts', { 'expo-constants': { expoConfig: { extra: { apiBaseUrl: 'http://api' } } } }, {
    fetch: async (url: string) => { requested = url; return { ok: true, status: 200, json: async () => report }; },
  });
  await api.fetchPlantReport('plant/one');
  assert.equal(requested, 'http://api/api/diagnostics/plant/plant%2Fone');
});

test('notification filters combine family, text and unseen with stable date order without mutation', () => {
  const service = load('./notifications.ts', { './api': {} });
  const notices = [
    { id: 1, kind: 'sensor_stale', seen: false, title: 'Sensor', message: '', subject: null, createdAt: '2026-11-11T10:00:00Z' },
    { id: 2, kind: 'sensor_stale', seen: true, title: 'Sensor', message: '', subject: null, createdAt: '2026-11-12T10:00:00Z' },
    { id: 3, kind: 'sensor_stale', seen: false, title: 'Sensor', message: '', subject: null, createdAt: '2026-11-12T09:00:00Z' },
    { id: 4, kind: 'valve_command', seen: false, title: 'Válvula', message: '', subject: null, createdAt: '2026-11-12T11:00:00Z' },
  ];
  const ids = (...args: unknown[]) => Array.from(service.filtrarAvisos(notices, ...args), (n: any) => n.id);
  assert.deepEqual(ids('sensores', 'sensor', true), [3, 1]);
  assert.deepEqual(ids('sensores', 'sensor', true, true), [1, 3]);
  assert.deepEqual(ids(null, '', false), [4, 2, 3, 1]);
  assert.deepEqual(notices.map((n) => n.id), [1, 2, 3, 4]);
  assert.equal(notices[0].seen, false);
  assert.equal(notices[1].seen, true);
});

test('notification seen action is explicit and retains account and plant query isolation', () => {
  const queries: any[] = [];
  const invalidated: any[] = [];
  let account = { id: 'A', role: 'operador', plant: 'cascajal' };
  let marked = 0;
  const hook = load('../hooks/useNotifications.ts', {
    react: { useCallback: (fn: unknown) => fn },
    '@tanstack/react-query': {
      useQueryClient: () => ({ invalidateQueries: (key: unknown) => invalidated.push(key) }),
      useQuery: (options: unknown) => { queries.push(options); return { data: { notifications: [], unseen: 0 } }; },
      useMutation: (options: any) => ({ mutate: () => { options.mutationFn(); options.onSuccess(); } }),
    },
    '../context/AuthContext': { useAuth: () => ({ user: account, token: 'token', hasPermission: () => true }) },
    '../services/notifications': { markNotificationsSeen: () => { marked++; }, fetchNotifications() {}, fetchUnseenCount() {} },
  });
  const first = hook.useNotifications();
  assert.equal(marked, 0);
  first.markSeen();
  assert.equal(marked, 1);
  account = { id: 'B', role: 'operador', plant: 'km18' };
  hook.useNotifications();
  assert.deepEqual(Array.from(queries[0].queryKey), ['notifications', 'A', 'operador', 'cascajal']);
  assert.deepEqual(Array.from(queries[1].queryKey), ['notifications', 'B', 'operador', 'km18']);
  assert.equal(invalidated.length, 2);
  assert.equal(marked, 1, 'changing account does not mark notifications seen');
});
