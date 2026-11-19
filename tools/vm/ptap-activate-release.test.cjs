'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { runInNewContext } = require('node:vm');
const { validatePushValues, runtimeEnv, treeHash, applyOnly0016, boot, health } = require('./ptap-activate-release.cjs');
const MIGRATION = '0016_web_push_subscription.sql';
const migrationFile = path.join(__dirname, '../../apps/api/src/infrastructure/database/migrations', MIGRATION);
const sql = fs.readFileSync(migrationFile, 'utf8').replace(/\r\n/g, '\n');
const earlier = Array.from({ length: 15 }, (_, i) => `${String(i + 1).padStart(4, '0')}_synthetic.sql`);

test('health diagnostics expose only route statuses and tolerate the configured precheck window', async () => {
  const original = globalThis.fetch;
  try {
    const called = [];
    globalThis.fetch = async url => { called.push(String(url)); return { status: 200 }; };
    assert.equal(await health(60000), true);
    assert.equal(called.length, 3);
    globalThis.fetch = async url => ({ status: String(url).endsWith('/health/db') ? 503 : 200 });
    await assert.rejects(health(0), error => error.safeToPrint && error.message.includes('"health/db":503'));
    globalThis.fetch = async () => { throw new Error('SYNTHETIC_PRIVATE_ERROR'); };
    await assert.rejects(health(0), error => error.safeToPrint && error.message.includes('timeout-or-network') && !error.message.includes('SYNTHETIC_PRIVATE_ERROR'));
  } finally { globalThis.fetch = original; }
});

function push() {
  const pair = crypto.createECDH('prime256v1'); pair.generateKeys();
  return { FIREBASE_SERVICE_ACCOUNT_PATH: '/home/xpertic_app/.config/aquora-push/synthetic-account.json',
    WEB_PUSH_VAPID_PUBLIC_KEY: pair.getPublicKey().toString('base64url'), WEB_PUSH_VAPID_PRIVATE_KEY: pair.getPrivateKey().toString('base64url'),
    WEB_PUSH_VAPID_SUBJECT: 'mailto:synthetic@example.invalid' };
}

test('runtime overlays original dotenv and whitelisted push without permitting arbitrary environment changes', () => {
  const values = push();
  const merged = runtimeEnv({ OPCUA_WRITES_ENABLED: 'true', NODE_ENV: 'production' }, { OPCUA_WRITES_ENABLED: 'false', DB_PASSWORD: 'synthetic-never-real' }, values);
  assert.equal(merged.OPCUA_WRITES_ENABLED, 'false');
  assert.equal(merged.NODE_ENV, 'production');
  assert.equal(merged.DB_PASSWORD, 'synthetic-never-real');
  assert.equal(merged.WEB_PUSH_VAPID_PRIVATE_KEY, values.WEB_PUSH_VAPID_PRIVATE_KEY);
  assert.throws(() => validatePushValues({ ...values, NODE_OPTIONS: '--require=unexpected' }));
  assert.throws(() => validatePushValues({ ...values, FIREBASE_SERVICE_ACCOUNT_PATH: '/tmp/account.json' }));
  assert.throws(() => validatePushValues({ ...values, WEB_PUSH_VAPID_PUBLIC_KEY: push().WEB_PUSH_VAPID_PUBLIC_KEY }));
  assert.throws(() => validatePushValues({ ...values, WEB_PUSH_VAPID_SUBJECT: 'http://insecure.invalid' }));
});

test('runtime private-parser failure cannot reveal its input fragment through PM2 stderr', () => {
  const guardedBoot = runInNewContext(`(${boot.toString()})`, {
    loadSecrets: () => { throw new SyntaxError('SYNTHETIC_PRIVATE_FRAGMENT'); },
    require: () => assert.fail('The API must not load after invalid private configuration'),
  });
  assert.throws(() => guardedBoot('/synthetic/stage'), error =>
    !error.message.includes('SYNTHETIC_PRIVATE_FRAGMENT') && /sin mostrar datos/.test(error.message));
});

function connection(options = {}) {
  const calls = [];
  const state = { applied: options.applied || [...earlier], table: options.table || false };
  return { calls, state, query: async (statement, args) => {
    calls.push([statement, args]);
    if (/GET_LOCK/.test(statement)) return [[{ acquired: options.lock === false ? 0 : 1 }]];
    if (/SELECT filename/.test(statement)) return [state.applied.map(filename => ({ filename }))];
    if (/information_schema.tables/.test(statement)) return [[{ count: state.table ? 1 : 0 }]];
    if (statement === sql) { state.table = true; return [{}]; }
    if (/INSERT INTO schema_migrations/.test(statement)) {
      if (options.failMarker) throw new Error('synthetic marker failure');
      assert.deepEqual(args, [MIGRATION]); state.applied.push(MIGRATION); return [{}];
    }
    if (/RELEASE_LOCK/.test(statement)) return [[{ released: 1 }]];
    throw new Error('unexpected SQL');
  } };
}

test('migration executes only pinned0016 plus its marker, after existing0001–0015 under an advisory lock', async () => {
  const db = connection();
  assert.deepEqual(await applyOnly0016(db, sql, earlier), { alreadyApplied: false });
  assert.equal(db.calls.filter(([statement]) => statement === sql).length, 1);
  assert.equal(db.state.table, true);
  assert.equal(db.state.applied.at(-1), MIGRATION);
  assert.match(db.calls[0][0], /GET_LOCK/);
  assert.match(db.calls.at(-1)[0], /RELEASE_LOCK/);
  assert.ok(!db.calls.some(([statement]) => /^\s*(?:DROP|DELETE|ALTER|ROLLBACK)\b/i.test(statement)));
});

test('migration fails closed for changed SQL, missing prior migrations, partial DDL or another lock holder', async () => {
  for (const [db, text] of [
    [connection(), `${sql}\nDROP TABLE users;`],
    [connection({ applied: earlier.slice(0, 14) }), sql],
    [connection({ table: true }), sql],
    [connection({ lock: false }), sql],
  ]) {
    await assert.rejects(applyOnly0016(db, text, earlier));
    assert.ok(!db.calls.some(([statement]) => statement === sql));
  }
});

test('already applied0016 is idempotent; failed marker retains its implicitly committed table and releases lock', async () => {
  const existing = connection({ applied: [...earlier, MIGRATION], table: true });
  assert.deepEqual(await applyOnly0016(existing, sql, earlier), { alreadyApplied: true });
  assert.ok(!existing.calls.some(([statement]) => statement === sql));
  const partial = connection({ failMarker: true });
  await assert.rejects(applyOnly0016(partial, sql, earlier));
  assert.equal(partial.state.table, true);
  assert.ok(!partial.state.applied.includes(MIGRATION));
  assert.match(partial.calls.at(-1)[0], /RELEASE_LOCK/);
});

test('web tree hashes compare paths and bytes, independent of filesystem enumeration order', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ptap-activation-test-'));
  try {
    const left = path.join(temporary, 'left'), right = path.join(temporary, 'right');
    fs.mkdirSync(left); fs.mkdirSync(right);
    fs.writeFileSync(path.join(left, 'b.js'), 'B'); fs.writeFileSync(path.join(left, 'index.html'), 'I');
    fs.writeFileSync(path.join(right, 'index.html'), 'I'); fs.writeFileSync(path.join(right, 'b.js'), 'B');
    assert.equal(treeHash(left), treeHash(right));
    fs.writeFileSync(path.join(right, 'b.js'), 'changed');
    assert.notEqual(treeHash(left), treeHash(right));
  } finally {
    const resolved = fs.realpathSync(temporary);
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('ptap-activation-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
