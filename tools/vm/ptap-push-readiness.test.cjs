'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateKeyPairSync } = require('node:crypto');
const { accountInfo, publicAccount } = require('./ptap-push-readiness.cjs');
test('readiness distinguishes missing and malformed credentials without reporting key contents', () => {
  assert.deepEqual(accountInfo(undefined), { configured: false, exists: false, validShape: false });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptap-push-readiness-'));
  try {
    const file = path.join(dir, 'synthetic.json');
    assert.equal(accountInfo(file).exists, false);
    fs.writeFileSync(file, '{"private_key":"SYNTHETIC-SECRET');
    assert.equal(accountInfo(file).parseFailed, true);
    assert.equal(JSON.stringify(publicAccount(accountInfo(file))).includes('SYNTHETIC-SECRET'), false);
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    fs.writeFileSync(file, JSON.stringify({ type: 'service_account', project_id: 'synthetic-project', client_email: 'synthetic@example.invalid', private_key: privateKey }));
    const result = accountInfo(file);
    assert.equal(result.validShape, true); assert.equal(result.privateKeyParses, true);
    assert.equal(Object.hasOwn(publicAccount(result), 'project'), false);
    assert.equal(JSON.stringify(publicAccount(result)).includes(privateKey), false);
  } finally {
    // This is the exact directory freshly returned by mkdtemp, never a derived/user target.
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
