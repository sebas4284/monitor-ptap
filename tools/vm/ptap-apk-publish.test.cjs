'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path').posix;
const crypto = require('node:crypto');
const { runInNewContext } = require('node:vm');
const source = fs.readFileSync(new URL('./ptap-apk-publish.cjs', `file://${__filename.replace(/\\/g, '/')}`), 'utf8');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const destination = '/var/www/ptap-download';
const candidatePath = '/home/xpertic_app/android-build/releases/release-e2cf4d4ee164-CFMDWd/apps/mobile/android/app/build/outputs/apk/release/app-release.apk';
const previousApk = Buffer.from('SYNTHETIC_OLD_APK'), candidate = Buffer.from('SYNTHETIC_NEW_APK');
const previousMeta = Buffer.from(JSON.stringify({ version: '1.4.0', versionCode: 9, notes: 'synthetic previous notes' }));

/** Fully in-memory filesystem. These tests never call root, remote tools or real mutation APIs. */
function fixture({ failSecondRename = false } = {}) {
  const nodes = new Map(), descriptors = new Map(), renames = [], output = [];
  let clock = 1, nextDescriptor = 10, nextDirectory = 1, failed = false;
  const error = code => Object.assign(new Error(`synthetic ${code}`), { code });
  function directory(file) {
    if (nodes.has(file)) return;
    if (file !== '/') directory(path.dirname(file));
    nodes.set(file, { directory: true, uid: 0, gid: 0, mode: 0o700, mtimeMs: clock++, dev: 1 });
  }
  function write(file, bytes, options = {}) {
    if (options.flag === 'wx' && nodes.has(file)) throw error('EEXIST');
    if (!nodes.get(path.dirname(file))?.directory) throw error('ENOENT');
    nodes.set(file, { bytes: Buffer.from(bytes), uid: 0, gid: 0, mode: options.mode || 0o600, mtimeMs: clock++, dev: 1 });
  }
  function get(file) { const node = nodes.get(file); if (!node) throw error('ENOENT'); return node; }
  function stat(node) { return { ...node, size: node.bytes?.length || 0, isFile: () => !node.directory, isDirectory: () => Boolean(node.directory), isSymbolicLink: () => false }; }
  directory(path.dirname(candidatePath)); directory(destination); directory('/var/backups/aquora-apk');
  write(candidatePath, candidate);
  write(`${destination}/monitor-ptap.apk`, previousApk);
  write(`${destination}/version.json`, previousMeta);
  const memoryFs = {
    constants: fs.constants,
    realpathSync: file => { get(file); return file; },
    lstatSync: file => stat(get(file)), statSync: file => stat(get(file)),
    openSync: file => { const descriptor = nextDescriptor++; descriptors.set(descriptor, get(file)); return descriptor; },
    fstatSync: descriptor => stat(descriptors.get(descriptor)), closeSync: descriptor => descriptors.delete(descriptor),
    readFileSync: (file, encoding) => { const bytes = Buffer.from(typeof file === 'number' ? descriptors.get(file).bytes : get(file).bytes); return encoding ? bytes.toString(encoding) : bytes; },
    writeFileSync: write,
    existsSync: file => nodes.has(file),
    mkdirSync: directory,
    mkdtempSync: prefix => { const file = `${prefix}${nextDirectory++}`; directory(file); return file; },
    chmodSync: (file, mode) => { get(file).mode = mode; },
    chownSync: (file, uid, gid) => { get(file).uid = uid; get(file).gid = gid; },
    renameSync: (from, to) => {
      const node = get(from);
      if (failSecondRename && !failed && to === `${destination}/version.json`) { failed = true; throw error('EIO'); }
      assert.ok(nodes.get(path.dirname(to))?.directory);
      nodes.set(to, node); nodes.delete(from); renames.push({ from, to });
    },
  };
  // Only the baseline artifact fingerprint is substituted for synthetic bytes.
  const productionFingerprint = "const PREVIOUS_APK_SHA = '4082213222c1fe131850c8bee30f1da88771e5843952ac401a7e4d380a4ff11a';";
  assert.ok(source.includes(productionFingerprint));
  const evaluated = source.replace(productionFingerprint, `const PREVIOUS_APK_SHA = '${sha(previousApk)}';`);
  const module = { exports: {} };
  const requireFixture = name => name === 'node:fs' ? memoryFs : name === 'node:path' ? path : name === 'node:crypto' ? crypto : assert.fail(`Unexpected dependency ${name}`);
  runInNewContext(`${evaluated}\nmodule.exports = { publish, rollback };`, {
    require: requireFixture, module, Buffer,
    __filename: '/usr/local/sbin/ptap-apk-publish.cjs',
    console: { log: text => output.push(JSON.parse(text)), error: text => output.push(JSON.parse(text)) },
  });
  return { ...module.exports, nodes, renames, output, write,
    bytes: file => Buffer.from(get(file).bytes),
    publicRenames: () => renames.filter(item => item.to === `${destination}/monitor-ptap.apk` || item.to === `${destination}/version.json`) };
}

test('wrong candidate hash cannot publish or create a backup receipt', () => {
  const f = fixture();
  assert.throws(() => f.publish('0'.repeat(64)), /distinta de la aprobada/);
  assert.deepEqual(f.bytes(`${destination}/monitor-ptap.apk`), previousApk);
  assert.deepEqual(f.bytes(`${destination}/version.json`), previousMeta);
  assert.equal(f.publicRenames().length, 0);
  assert.ok(![...f.nodes.keys()].some(file => file.endsWith('/receipt.json')));
});

test('success publishes hotfix before metadata, preserves private evidence and rolls back to 1.4.0', () => {
  const f = fixture(); f.publish(sha(candidate));
  assert.deepEqual(f.publicRenames().map(item => path.basename(item.to)), ['monitor-ptap.apk', 'version.json']);
  assert.deepEqual(f.bytes(`${destination}/monitor-ptap.apk`), candidate);
  const meta = JSON.parse(f.bytes(`${destination}/version.json`));
  assert.equal(meta.version, '1.4.1'); assert.equal(meta.versionCode, 10);
  assert.match(meta.notes, /cierre.*iniciar/); assert.match(meta.notes, /Aquora/);
  const published = f.output.find(item => item.status === 'published');
  assert.ok(published.rollbackDirectory);
  assert.equal(published.version, '1.4.1'); assert.equal(published.versionCode, 10);
  assert.deepEqual(f.bytes(`${published.rollbackDirectory}/before.apk`), previousApk);
  assert.deepEqual(f.bytes(`${published.rollbackDirectory}/before.json`), previousMeta);
  assert.equal(f.nodes.get(published.rollbackDirectory).mode, 0o700);
  assert.equal(f.nodes.get(`${published.rollbackDirectory}/before.apk`).mode, 0o600);
  const receipt = JSON.parse(f.bytes(`${published.rollbackDirectory}/receipt.json`));
  assert.equal(receipt.status, 'published'); assert.equal(receipt.afterApkSha256, sha(candidate));
  assert.equal(receipt.version, '1.4.1'); assert.equal(receipt.versionCode, 10);
  f.rollback(published.rollbackDirectory);
  assert.deepEqual(f.bytes(`${destination}/monitor-ptap.apk`), previousApk);
  assert.deepEqual(f.bytes(`${destination}/version.json`), previousMeta);
  assert.equal(f.output.at(-1).version, '1.4.0'); assert.equal(f.output.at(-1).versionCode, 9);
});

test('second public rename failure automatically restores both artifacts and retains rollback evidence', () => {
  const f = fixture({ failSecondRename: true });
  assert.throws(() => f.publish(sha(candidate)), /synthetic EIO/);
  assert.deepEqual(f.bytes(`${destination}/monitor-ptap.apk`), previousApk);
  assert.deepEqual(f.bytes(`${destination}/version.json`), previousMeta);
  assert.deepEqual(f.publicRenames().map(item => path.basename(item.to)), ['monitor-ptap.apk', 'version.json', 'monitor-ptap.apk']);
  const result = f.output.at(-1);
  assert.equal(result.status, 'rolled-back');
  assert.equal(JSON.parse(f.bytes(`${result.rollbackDirectory}/receipt.json`)).status, 'rolled-back');
});

test('explicit rollback refuses to overwrite another subsequent publication', () => {
  const f = fixture(); f.publish(sha(candidate));
  const backup = f.output.find(item => item.status === 'published').rollbackDirectory;
  const foreign = Buffer.from('SYNTHETIC_FOREIGN_APK');
  f.write(`${destination}/monitor-ptap.apk`, foreign);
  const before = f.publicRenames().length;
  assert.throws(() => f.rollback(backup), /Otra publicación cambió/);
  assert.equal(f.publicRenames().length, before);
  assert.deepEqual(f.bytes(`${destination}/monitor-ptap.apk`), foreign);
  assert.equal(JSON.parse(f.bytes(`${destination}/version.json`)).versionCode, 10);
});
