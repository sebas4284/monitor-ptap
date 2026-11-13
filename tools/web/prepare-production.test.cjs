const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { prepare } = require('./prepare-production.cjs');
test('font hints use the four shipped fonts and are idempotent', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aquora-font-hints-'));
  t.after(() => fs.rmSync(root, { recursive: true }));
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(
    path.join(root, 'index.html'),
    '<html lang="en"><head></head><body></body></html>',
  );
  for (const name of [
    'Poppins_400Regular',
    'Poppins_500Medium',
    'Poppins_600SemiBold',
    'Ionicons',
  ]) {
    fs.writeFileSync(path.join(root, 'assets', name + '.012345abcdef.woff2'), 'fixture');
  }
  prepare(root);
  const first = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(first, /lang="es"/);
  assert.equal((first.match(/rel="preload"/g) || []).length, 4);
  const script = path.join(root, 'app.js');
  fs.writeFileSync(script, 'console.log("Aquora")');
  prepare(root);
  assert.equal(
    zlib.brotliDecompressSync(fs.readFileSync(script + '.br')).toString(),
    fs.readFileSync(script, 'utf8'),
  );
  assert.equal(
    zlib.gunzipSync(fs.readFileSync(script + '.gz')).toString(),
    fs.readFileSync(script, 'utf8'),
  );
  assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), first);
  fs.unlinkSync(path.join(root, 'assets/Ionicons.012345abcdef.woff2'));
  assert.throws(() => prepare(root), /Expected four/);
});
