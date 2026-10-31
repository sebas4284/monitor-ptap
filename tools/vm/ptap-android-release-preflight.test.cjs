'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { firebaseMatches, signer, readJson } = require('./ptap-android-release-preflight.cjs');
const fixture = () => ({ project_info: { project_id: 'synthetic-project', project_number: '123456' }, client: [{ client_info: { mobilesdk_app_id: 'synthetic-app', android_client_info: { package_name: 'com.ptap.monitor' } }, api_key: [{ current_key: 'synthetic-key' }] }] });

test('FCM release rejects absent or mismatched project/package and incomplete config', () => {
  assert.doesNotThrow(() => firebaseMatches(fixture(), 'com.ptap.monitor', 'synthetic-project'));
  assert.throws(() => firebaseMatches(fixture(), 'com.ptap.monitor', undefined));
  assert.throws(() => firebaseMatches(fixture(), 'com.ptap.monitor', 'different-project'));
  assert.throws(() => firebaseMatches(fixture(), 'com.different.app', 'synthetic-project'));
  const noKey = fixture(); noKey.client[0].api_key = [];
  assert.throws(() => firebaseMatches(noKey, 'com.ptap.monitor', 'synthetic-project'));
  const duplicate = fixture(); duplicate.client.push(duplicate.client[0]);
  assert.throws(() => firebaseMatches(duplicate, 'com.ptap.monitor', 'synthetic-project'));
});

test('signer check fails closed for missing, malformed or ambiguous signer output', () => {
  const fingerprint = 'a'.repeat(64);
  const line = `Signer #1 certificate SHA-256 digest: ${fingerprint}`;
  assert.equal(signer(line), fingerprint);
  assert.throws(() => signer('No certificate'));
  assert.throws(() => signer('Signer #1 certificate SHA-256 digest: abcd'));
  assert.throws(() => signer(`${line}\n${line}`));
});

test('invalid Firebase JSON never appears in diagnostic messages', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ptap-json-test-'));
  try {
    const file = path.join(directory, 'synthetic.json');
    fs.writeFileSync(file, '{"private_key":"SYNTHETIC_DO_NOT_LOG" invalid');
    assert.throws(() => readJson(file), error => !error.message.includes('SYNTHETIC_DO_NOT_LOG') && !error.message.includes('private_key'));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
