'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { runInNewContext } = require('node:vm');
const { sourcePath, boundedFile, validateArchiveListing, resumeAndroid, assembleAndroid } = require('./ptap-stage-release.cjs');

test('resume Android preserves native files and runs bounded Gradle between both preflights without skipping lint', () => {
  const context = { stage: '/synthetic/release', mobile: '/synthetic/release/apps/mobile', env: { API_BASE_URL: 'https://aquora.xpertic.co', PTAP_REQUIRE_FCM: '1' } };
  const calls = [];
  let validated = 0;
  const assemble = runInNewContext(`(${assembleAndroid.toString()})`, {
    path: require('node:path').posix, process: { execPath: '/synthetic/node' }, BUILD: '/synthetic/build',
    run: (...args) => calls.push(args),
  });
  const resume = runInNewContext(`(${resumeAndroid.toString()})`, {
    androidContext: input => { assert.equal(input, context.stage); validated++; return context; },
    assembleAndroid: assemble,
    fs: new Proxy({}, { get: () => assert.fail('Resume must not regenerate/copy native files') }),
  });
  resume(context.stage);
  assert.equal(validated, 1);
  assert.equal(calls.length, 3);
  assert.equal(calls[0][2][0], '/synthetic/release/tools/vm/ptap-android-release-preflight.cjs');
  assert.equal(calls[1][1], '/synthetic/build/gradle-9.4.1/bin/gradle');
  assert.ok(calls[1][2].includes('--max-workers=1'));
  assert.ok(calls[1][2].includes('-Pkotlin.compiler.execution.strategy=in-process'));
  assert.ok(calls[1][2].includes('-Dorg.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=768m -XX:+ExitOnOutOfMemoryError'));
  assert.ok(!calls[1][2].some(arg => arg === '-x' || /exclude|skip.*lint/i.test(arg)));
  assert.equal(calls[2][2][1], '/synthetic/release/apps/mobile/android/app/build/outputs/apk/release/app-release.apk');
  assert.ok(calls.every(call => call[3] === context.env));
  const failing = runInNewContext(`(${assembleAndroid.toString()})`, {
    path: require('node:path').posix, process: { execPath: '/synthetic/node' }, BUILD: '/synthetic/build',
    run: (_cwd, binary) => { if (binary.endsWith('/gradle')) throw new Error('synthetic Gradle failure'); },
  });
  assert.throws(() => failing(context.stage, context.mobile, context.env), /synthetic Gradle failure/);
});

test('source archive rejects traversal, secrets, generated native trees and dependency directories', () => {
  for (const file of ['apps/api/src/main.ts', './apps/mobile/public/sw.js', '.gitignore', '.env.example', 'vendor/deepmerge/LICENSE']) {
    assert.equal(sourcePath(file), true, file);
  }
  for (const file of ['../escape', '/absolute', 'C:\\private', 'a/../../escape', 'a\\..\\escape', '.git/config',
    'node_modules/module/index.js', 'apps/mobile/.expo/config.json', '.env', 'apps/api/.env.production.local',
    'apps/mobile/google-services.json', 'key.pem', 'signing.keystore', 'apps/mobile/android/app/build.gradle',
    'apps/mobile/ios/project.pbxproj', 'apps/mobile/public/injected\nname']) {
    assert.equal(sourcePath(file), false, file);
  }
  assert.equal(sourcePath('./apps//mobile/./android/app/build.gradle'), false);
  assert.equal(sourcePath('./apps/mobile/android'), false);
});

test('archive listing fails closed for links, special entries, empty input and invalid paths', () => {
  assert.doesNotThrow(() => validateArchiveListing(['apps/', 'apps/main.ts'], ['drwx------ directory', '-rw------- regular']));
  assert.doesNotThrow(() => validateArchiveListing(['./', './apps/main.ts'], ['drwx------ root', '-rw------- regular']));
  assert.throws(() => validateArchiveListing(['./'], ['-rw------- root']));
  for (const kind of ['l', 'h', 'b', 'c', 'p', 's']) {
    assert.throws(() => validateArchiveListing(['apps/main.ts'], [`${kind}rw------- entry`]));
  }
  assert.throws(() => validateArchiveListing([], []));
  assert.throws(() => validateArchiveListing(['../escape'], ['-rw------- regular']));
  assert.throws(() => validateArchiveListing(['apps/main.ts'], []));
});

test('copied artifacts require exact SHA256, regular files and bounded nonempty bytes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ptap-stage-test-'));
  try {
    const file = path.join(directory, 'synthetic.json');
    const bytes = Buffer.from('{"synthetic":true}');
    fs.writeFileSync(file, bytes);
    const expected = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.doesNotThrow(() => boundedFile(file, expected, 1024));
    assert.throws(() => boundedFile(file, '0'.repeat(64), 1024));
    assert.throws(() => boundedFile(file, expected, 1));
    assert.throws(() => boundedFile(directory, expected, 1024));
    fs.writeFileSync(file, 'changed');
    assert.throws(() => boundedFile(file, expected, 1024));
    fs.writeFileSync(file, '');
    assert.throws(() => boundedFile(file, crypto.createHash('sha256').update('').digest('hex'), 1024));
  } finally {
    // This fixed temporary directory was just created by the test and contains synthetic data only.
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('ptap-stage-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
