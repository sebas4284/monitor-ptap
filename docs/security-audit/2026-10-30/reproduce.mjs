// Local audit evidence only. Runs reviewed first-party logic with fake dependencies.
// Does NOT start Nest, import npm packages, read .env, connect to a DB/PLC or use the network.
// A successful reproduction confirms the recorded behavior; it is NOT a security pass.
import assert from 'node:assert/strict';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const hashes = new Map();
const results = [];
function read(relative) {
  const source = readFileSync(resolve(root, relative), 'utf8');
  hashes.set(relative, createHash('sha256').update(source).digest('hex'));
  return source;
}
class SilentLogger { log() {} warn() {} error() {} }
class Rejected extends Error {}
function evaluate(source, names, dependencies = {}) {
  // vm is NOT a security boundary. These inputs are reviewed source, never external samples.
  const withoutImports = source.replace(/^import\b[\s\S]*?;\r?\n/gm, '');
  const withoutDecorators = withoutImports.replace(/@[A-Z]\w*\([^()\r\n]*\)\s*/g, '');
  // Node 26 strips erasable syntax only. Lower the reviewed DI parameter properties explicitly;
  // their sole runtime effect is assigning constructor arguments to equally named fields.
  const erasable = withoutDecorators.replace(/constructor\(([\s\S]*?)\)\s*\{/g, (_match, parameters) => {
    const fields = [...parameters.matchAll(/\b(?:private|public|protected)\s+(?:readonly\s+)?(\w+)\s*:/g)]
      .map((match) => match[1]);
    const ordinary = parameters.replace(/\b(?:private|public|protected)\s+(?:readonly\s+)?/g, '');
    return `constructor(${ordinary}) {${fields.map((name) => `this.${name} = ${name};`).join('')}`;
  });
  const js = stripTypeScriptTypes(erasable, { mode: 'strip' })
    .replace(/\bexport (?=(?:async )?(?:class|function|const|let))/g, '');
  const context = vm.createContext({
    Logger: SilentLogger, process: { env: {} }, Buffer,
    UnauthorizedException: Rejected, ForbiddenException: Rejected, ConflictException: Rejected,
    ...dependencies,
  }, { codeGeneration: { strings: false, wasm: false } });
  new vm.Script(`${js}\nglobalThis.exposed = { ${names.join(', ')} };`).runInContext(context, { timeout: 2000 });
  return { ...context.exposed, context };
}
async function check(id, type, description, run) {
  try {
    const observation = await run();
    results.push({ id, type, description, matched: true, observation });
  } catch (error) {
    results.push({ id, type, description, matched: false, error: error.message });
  }
}

const shared = read('packages/shared/src/index.ts');
const permissionsStart = shared.indexOf('const ROLE_PERMISSIONS:');
const permissionsEnd = shared.indexOf('/** Todos los permisos', permissionsStart);
assert.ok(permissionsStart > 0 && permissionsEnd > permissionsStart);
const { hasPermission } = evaluate(shared.slice(permissionsStart, permissionsEnd), ['hasPermission']);
const gatewaySource = read('apps/api/src/infrastructure/connectivity/connectivity.gateway.ts');
const guardSource = read('apps/api/src/modules/auth/guards/jwt-auth.guard.ts');
const snapshot = { plantId: 'audit-plant', signals: { inletFlow: { value: 42 } } };

function gatewayFixture(role) {
  let nowMs = 1000000;
  let verifies = 0;
  const claims = { sub: 'synthetic-user', role, plant: 'audit-plant', exp: nowMs / 1000 + 60 };
  class FakeJwt {
    verify() {
      verifies++;
      if (nowMs >= claims.exp * 1000) throw new Rejected('synthetic expired token');
      return { ...claims };
    }
  }
  const callbacks = {};
  const pipeline = Object.fromEntries(['snapshot$', 'liveness$'].map((key) => [key, {
    subscribe(callback) { callbacks[key] = callback; return { unsubscribe() {} }; },
  }]));
  const { ConnectivityGateway } = evaluate(gatewaySource, ['ConnectivityGateway'], {
    hasPermission, JwtService: FakeJwt, readHttpHardeningConfig: () => ({ corsOrigins: null }),
  });
  const gateway = new ConnectivityGateway(pipeline, { get: () => snapshot });
  function socket() {
    return {
      id: 'synthetic-socket', data: {}, rooms: new Set(['synthetic-socket']),
      handshake: { auth: { token: 'SYNTHETIC_ACCEPTED_CREDENTIAL' } },
      events: [], disconnected: false,
      async join(room) { this.rooms.add(room); },
      async leave(room) { this.rooms.delete(room); },
      emit(event, payload) { this.events.push({ event, payload }); },
      disconnect() { this.disconnected = true; },
    };
  }
  return { gateway, socket, FakeJwt, claims, callbacks,
    advance: (ms) => { nowMs += ms; }, verifies: () => verifies };
}

await check('SEC-01', 'vulnerability_reproduction', 'Civil receives a full snapshot via the actual gateway', async () => {
  assert.equal(hasPermission('civil', 'view_dashboard'), false);
  const f = gatewayFixture('civil');
  const socket = f.socket();
  await f.gateway.handleConnection(socket);
  await f.gateway.subscribeToPlant({ plantId: 'audit-plant' }, socket);
  assert.ok(socket.events.some((event) => event.event === 'opc:snapshot' && event.payload.signals.inletFlow.value === 42));
  return { civilHasDashboardPermission: false, fullSnapshotReceived: true };
});

await check('CONTROL-01', 'negative_control', 'Operator cannot subscribe to another plant', async () => {
  const f = gatewayFixture('operador');
  const socket = f.socket();
  await f.gateway.handleConnection(socket);
  await f.gateway.subscribeToPlant({ plantId: 'other-plant' }, socket);
  assert.equal(socket.events.some((event) => event.event === 'opc:snapshot'), false);
  assert.ok(socket.events.some((event) => event.event === 'opc:denied'));
  return { otherPlantDenied: true };
});

await check('SEC-02-A', 'vulnerability_reproduction', 'Inactive account: HTTP rejects while a new socket accepts its unexpired credential', async () => {
  const f = gatewayFixture('admin');
  const { JwtAuthGuard } = evaluate(guardSource, ['JwtAuthGuard']);
  const req = { headers: { authorization: 'Bearer SYNTHETIC_ACCEPTED_CREDENTIAL' } };
  const guard = new JwtAuthGuard({ getAllAndOverride: () => false }, new f.FakeJwt(), { findById: async () => null });
  await assert.rejects(() => guard.canActivate({
    getHandler() {}, getClass() {}, switchToHttp: () => ({ getRequest: () => req }),
  }));
  const socket = f.socket();
  await f.gateway.handleConnection(socket);
  assert.equal(socket.disconnected, false);
  assert.ok(socket.rooms.has('scope:*'));
  return { httpRejectedInactiveAccount: true, newSocketStillAcceptedAdminScope: true };
});

await check('SEC-02-B', 'vulnerability_reproduction', 'Already connected socket receives broadcasts after its credential expires', async () => {
  const f = gatewayFixture('operador');
  const socket = f.socket();
  f.gateway.server = { to: (room) => ({ emit: (event, payload) => {
    if (socket.rooms.has(room)) socket.emit(event, payload);
  } }) };
  f.gateway.onModuleInit();
  await f.gateway.handleConnection(socket);
  await f.gateway.subscribeToPlant({ plantId: 'audit-plant' }, socket);
  socket.events.length = 0;
  f.advance(61000);
  f.callbacks['snapshot$'](snapshot);
  assert.equal(f.verifies(), 1);
  assert.equal(socket.disconnected, false);
  assert.equal(socket.events[0]?.event, 'opc:snapshot');
  const reconnect = f.socket();
  await f.gateway.handleConnection(reconnect);
  assert.equal(reconnect.disconnected, true);
  f.gateway.onModuleDestroy();
  return { establishedSocketReceivedAfterExpiry: true, expiredReconnectRejected: true };
});

const signatures = evaluate(read('apps/api/src/modules/commands/command-signature.ts'),
  ['sellar', 'verificarCadena', 'firmaCorta'], { createHmac, timingSafeEqual });
const signingService = evaluate(read('apps/api/src/modules/commands/command-signature.service.ts'),
  ['CommandSignatureService'], { ...signatures, process: { env: { COMMAND_SIGNING_SECRET: 'DISPOSABLE_AUDIT_KEY' } } });
function signedRows() {
  let previous = null;
  return [1, 2, 3].map((id) => {
    const facts = { id, at: '2026-10-30T00:00:00.000Z', plantId: 'audit-plant', target: 'valve',
      command: 'open', status: 'sent', userId: 'synthetic-user', userName: 'SYNTHETIC',
      userEmail: 'audit@example.invalid', role: 'operador', writtenValue: '1', confirmedValue: null };
    const signature = signatures.sellar(facts, previous, 'DISPOSABLE_AUDIT_KEY');
    const row = { ...facts, signature, prevSignature: previous };
    previous = signature;
    return row;
  });
}
await check('CONTROL-02', 'negative_control', 'Chain verifier detects removal of a middle entry', async () => {
  const rows = signedRows();
  assert.equal(signatures.verificarCadena(rows, 'DISPOSABLE_AUDIT_KEY').length, 0);
  assert.ok(signatures.verificarCadena([rows[0], rows[2]], 'DISPOSABLE_AUDIT_KEY').length > 0);
  return { middleDeletionDetected: true };
});
await check('SEC-03-A', 'vulnerability_reproduction', 'Removing the chain tail is undetected without an external checkpoint', async () => {
  const rows = signedRows();
  assert.equal(signatures.verificarCadena(rows.slice(0, 2), 'DISPOSABLE_AUDIT_KEY').length, 0);
  assert.equal(signatures.verificarCadena([], 'DISPOSABLE_AUDIT_KEY').length, 0);
  return { suffixDeletionReportedBrokenLinks: 0, totalDeletionReportedBrokenLinks: 0 };
});
await check('SEC-03-B', 'vulnerability_reproduction', 'Service excludes unsigned rows and reports a stripped ledger as verifiable with no broken entries', async () => {
  let capturedSql = '';
  const service = new signingService.CommandSignatureService({ query: async (sql) => {
    capturedSql = sql;
    return [[]]; // DB double: signed subset after all signatures have been cleared.
  } });
  const result = await service.verificar();
  assert.match(capturedSql, /WHERE signature IS NOT NULL/);
  assert.equal(result.verificable, true);
  assert.equal(result.firmadas, 0);
  assert.equal(result.rotos.length, 0);
  return { allRowsWithNullSignatureExcluded: true, result };
});

await check('SEC-04', 'vulnerability_reproduction', 'Actual logout body leaves previous process data in device storage and memory', async () => {
  const backing = new Map([['ptap_auth_token', 'SYNTHETIC'], ['ptap_auth_user', '{}']]);
  const localStorage = { get length() { return backing.size; }, key: (n) => [...backing.keys()][n],
    getItem: (key) => backing.get(key) ?? null, setItem: (key, value) => backing.set(key, value) };
  const store = evaluate(read('apps/mobile/services/last-snapshot-store.ts'), ['rememberSnapshot', 'getLastSnapshot'], {
    Platform: { OS: 'web' }, localStorage,
  });
  store.rememberSnapshot(snapshot);
  const auth = read('apps/mobile/context/AuthContext.tsx');
  const marker = 'const logout = useCallback(async () => {';
  const start = auth.indexOf(marker) + marker.length;
  const end = auth.indexOf('\n  }, []);', start);
  assert.ok(start >= marker.length && end > start);
  Object.assign(store.context, { desregistrarPush: async () => {}, TOKEN_KEY: 'ptap_auth_token', USER_KEY: 'ptap_auth_user',
    storage: { deleteItem: async (key) => backing.delete(key) }, setAuthToken() {}, resetSocket() {}, setToken() {}, setUser() {} });
  await new vm.Script(`(async () => {${auth.slice(start, end)}\n})()`).runInContext(store.context, { timeout: 2000 });
  assert.equal(backing.has('ptap_auth_token'), false);
  assert.ok(backing.has('ptap_last_snapshot_audit-plant'));
  assert.equal(store.getLastSnapshot('audit-plant').signals.inletFlow.value, 42);
  return { credentialRemoved: true, previousSnapshotStillPersisted: true, previousSnapshotStillInMemory: true };
});

await check('SEC-05', 'vulnerability_reproduction', 'Public registration explicitly reveals that an email is already registered', async () => {
  const { AuthService } = evaluate(read('apps/api/src/modules/auth/auth.service.ts'), ['AuthService'], {
    randomUUID: () => 'synthetic-id', DUPLICATE_ENTRY: 'ER_DUP_ENTRY', toAuthUser() {},
  });
  const service = new AuthService({ create: async () => { throw { code: 'ER_DUP_ENTRY' }; } },
    { hashPassword: async () => ({ passwordHash: 'SYNTHETIC', pepperVersion: 1 }) }, {}, { record: async () => {} }, {}, {});
  await assert.rejects(() => service.register({ email: 'audit@example.invalid', password: 'SYNTHETIC' }, { ip: null }),
    /Ese correo ya est/);
  const source = read('apps/api/src/modules/auth/auth.controller.ts');
  assert.match(source, /@Public\(\)\s+@Post\('register'\)/);
  return { publicEndpoint: true, duplicateEmailConflictRevealsMembership: true };
});

await check('SEC-06', 'vulnerability_reproduction', 'SMTP misconfiguration falls back to logging the raw verification credential', async () => {
  const logged = [];
  const { EmailService } = evaluate(read('apps/api/src/modules/email/email.service.ts'), ['EmailService'], {
    process: { env: { EMAIL_TRANSPORT: 'smtp' } }, createTransport: () => { throw new Error('Must not create SMTP transport'); },
  });
  const service = new EmailService({ log: (entry) => logged.push(entry), warn() {} });
  const link = 'https://example.invalid/api/auth/verify-email?token=SYNTHETIC_TOKEN';
  await service.sendVerificationEmail('audit@example.invalid', link);
  assert.ok(logged.some((entry) => entry.link === link && entry.body.includes('SYNTHETIC_TOKEN')));
  return { missingSmtpConfiguration: true, rawVerificationTokenInLog: true };
});

await check('OT-01', 'conditional_configuration_reproduction', 'Insecure-write override labels an anonymous unencrypted session as secure', async () => {
  const source = read('apps/api/src/infrastructure/connectivity/adapters/opcua/opcua-connectivity.adapter.ts');
  const start = source.indexOf('  getWriteSecurity():');
  const end = source.indexOf('\n  async writeBufferElement', start);
  assert.ok(start > 0 && end > start);
  const { Policy } = evaluate(`class Policy { config: any; ${source.slice(start, end)} }`, ['Policy']);
  const policy = new Policy();
  policy.config = { securityMode: 'None', identity: { type: 'anonymous' }, allowInsecureWrites: false };
  assert.equal(policy.getWriteSecurity().secure, false);
  policy.config.allowInsecureWrites = true;
  assert.equal(policy.getWriteSecurity().secure, true);
  return { anonymousAndNoneWithOverride: 'secure=true', liveProductionFlagsChecked: false, plcWrites: 0 };
});

const failed = results.filter((result) => !result.matched).length;
console.log(JSON.stringify({
  purpose: 'Reproduce audited behavior; matched vulnerability checks confirm defects, not remediation.',
  utc: new Date().toISOString(), node: process.version,
  execution: 'Reviewed source with imports/decorators removed and fake dependencies; no full application integration.',
  sourceSha256: Object.fromEntries(hashes), results,
  summary: { checks: results.length, matched: results.length - failed, failed },
}, null, 2));
process.exitCode = failed ? 1 : 0;
