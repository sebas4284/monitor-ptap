'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resourceStrings, matchesResource, privateEntry, textContains } = require('./ptap-apk-inspect.cjs');

test('compiled Firebase resource parsing matches exact values and rejects conflicting variants', () => {
  const output = [
    'resource 0x7f010001 string/project_id', '  () "synthetic-project"',
    'resource 0x7f010002 com.ptap.monitor:string/google_app_id', '  () (string8) "1:123:android:synthetic"',
    'resource 0x7f010003 string/gcm_defaultSenderId', '  () "123"',
    'resource 0x7f010004 string/unrelated', '  () "private value must not leak into the preceding resource"',
  ].join('\n');
  const resources = resourceStrings(output);
  assert.equal(matchesResource(resources, 'project_id', 'synthetic-project'), true);
  assert.equal(matchesResource(resources, 'google_app_id', '1:123:android:synthetic'), true);
  assert.equal(matchesResource(resources, 'gcm_defaultSenderId', '123'), true);
  assert.equal(matchesResource(resources, 'project_id', 'another-project'), false);
  assert.equal(matchesResource(resourceStrings(''), 'project_id', 'synthetic-project'), false);
  const conflicting = resourceStrings(`${output}\nresource 0x7f010001 string/project_id\n  (es) "another-project"`);
  assert.equal(matchesResource(conflicting, 'project_id', 'synthetic-project'), false);
});

test('private credential filenames and ASCII/UTF16 bundle markers are recognized without artifact execution', () => {
  for (const name of ['assets/.env', 'assets/.env.production.local', 'assets/fcm-service-account.json', 'assets/firebase-adminsdk-abc.json', 'assets/private_key.pem', 'assets/debug.keystore']) assert.equal(privateEntry(name), true);
  for (const name of ['assets/app.config', 'assets/data.json', 'META-INF/CERT.RSA', 'classes.dex']) assert.equal(privateEntry(name), false);
  assert.equal(textContains(Buffer.from('prefix https://aquora.xpertic.co suffix'), 'https://aquora.xpertic.co'), true);
  assert.equal(textContains(Buffer.from('https://aquora.xpertic.co', 'utf16le'), 'https://aquora.xpertic.co'), true);
  assert.equal(textContains(Buffer.from('prefix trycloudflare suffix'), 'trycloudflare'), true);
  assert.equal(textContains(Buffer.from('other host'), 'https://aquora.xpertic.co'), false);
});
