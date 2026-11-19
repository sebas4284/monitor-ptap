'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parse } = require('dotenv');
const { envValue, renderEnv, persist } = require('./ptap-configure-smtp.cjs');

test('dotenv preserves special characters and rejects unrepresentable values', () => {
  for (const value of ['synthetic#password', 'a\\nb', "a'b", 'a`b', 'a"b', "a'`b", ' leading trailing ', '${NOT_EXPANDED}']) {
    assert.equal(parse(`SMTP_PASS=${envValue(value)}\n`).SMTP_PASS, value);
  }
  for (const value of ['bad\nline', 'bad\rline', 'bad\0value', "'`\"", "'`\\n\""]) assert.throws(() => envValue(value));
});

test('replaces duplicates and exports while preserving unrelated configuration', () => {
  const original = '# private fixture\r\nDATABASE_PASSWORD="synthetic"\r\nEMAIL_TRANSPORT=console\r\nexport SMTP_PASS=old\r\nSMTP_PASS=duplicate\r\n';
  const result = renderEnv(original, { EMAIL_TRANSPORT: 'smtp', SMTP_PASS: "synth#'etic" });
  assert.equal((result.match(/^SMTP_PASS=/gm) || []).length, 1);
  assert.equal(parse(result).SMTP_PASS, "synth#'etic");
  assert.equal(parse(result).DATABASE_PASSWORD, 'synthetic');
  assert.equal(parse(result).EMAIL_TRANSPORT, 'smtp');
});

test('rejects multiline replaced assignments without modifying original', () => {
  assert.throws(() => renderEnv('SMTP_PASS="first\nsecond"\n', { SMTP_PASS: 'new' }));
  assert.throws(() => renderEnv('OTHER="first\nSMTP_PASS=inside\nlast"\n', { SMTP_PASS: 'new' }));
});

test('repository excludes SMTP backup and temporary names from git', () => {
  const repository = process.cwd();
  for (const name of ['.env.bak-smtp-synthetic', '.env.bak-smtp-tmp-synthetic']) {
    const result = spawnSync('git', ['check-ignore', '--no-index', '--', name], { cwd: repository, encoding: 'utf8' });
    assert.equal(result.status, 0, `${name} must match the existing repository ignore rules`);
    assert.equal(result.stdout.trim(), name);
  }
});

test('atomic persistence backs up exact original with restrictive permissions and refuses stale input', { skip: process.platform !== 'linux' }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ptap-smtp-test-'));
  const envPath = path.join(directory, '.env');
  try {
    fs.writeFileSync(envPath, 'ORIGINAL=synthetic\n', { mode: 0o600 });
    assert.throws(() => persist(envPath, 'stale', 'replacement'));
    assert.equal(fs.readFileSync(envPath, 'utf8'), 'ORIGINAL=synthetic\n');
    const backup = persist(envPath, 'ORIGINAL=synthetic\n', 'REPLACED=synthetic\n');
    assert.match(path.basename(backup), /^\.env\.bak-smtp-\d+-[a-f0-9]+$/);
    assert.equal(fs.readFileSync(backup, 'utf8'), 'ORIGINAL=synthetic\n');
    assert.equal(fs.readFileSync(envPath, 'utf8'), 'REPLACED=synthetic\n');
    assert.equal(fs.statSync(envPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(backup).mode & 0o777, 0o600);
    const linkPath = path.join(directory, 'link');
    fs.symlinkSync(envPath, linkPath);
    assert.throws(() => persist(linkPath, 'REPLACED=synthetic\n', 'bad'));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
