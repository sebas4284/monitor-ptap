const { test } = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const { testArguments } = require('../scripts/run-tests.cjs');

test('API runner discovers new tests and forwards explicit selections without a shell', () => {
  const all = testArguments();
  assert.deepEqual(all.slice(0, 4), ['--import', 'tsx', '--test', '--test-concurrency=2']);
  assert.ok(all.includes(join('test', 'run-tests.test.cjs')));
  assert.ok(all.includes(join('test', 'bridge.test.ts')));
  assert.ok(all.includes(join('test', 'login.test.ts')));
  const selected = ['--test-concurrency=4', 'test/bridge.test.ts'];
  assert.deepEqual(testArguments(selected).slice(4), selected);
});

test('API runner preserves failing exit codes, config and paths containing spaces', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'ptap runner '));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const probe = join(directory, 'expected failure.test.cjs');
  const config = join(__dirname, '..', 'tsconfig.test.json');
  writeFileSync(
    probe,
    [
      "const {test}=require('node:test'); const assert=require('node:assert/strict');",
      'test("config",()=>assert.equal(process.env.TSX_TSCONFIG_PATH,' +
        JSON.stringify(config) +
        '));',
      'test("exit code",()=>assert.fail("expected runner failure"));',
    ].join('\n'),
  );
  const env = { ...process.env };
  // This child must behave as a fresh CLI rather than inheriting node:test worker mode.
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    [join(__dirname, '..', 'scripts', 'run-tests.cjs'), probe],
    { encoding: 'utf8', timeout: 10_000, env },
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /expected runner failure/);
  assert.match(result.stdout, /pass 1/);
});
