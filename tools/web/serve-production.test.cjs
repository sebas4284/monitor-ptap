const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const { createServer } = require('./serve-production.cjs');

test('production server compresses exports, caches hashed assets and restricts fallback', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aquora-static-'));
  const asset = 'index-0123456789abcdef0123456789abcdef.js';
  const body = '/* representative compressible code */\n'.repeat(300);
  fs.writeFileSync(
    path.join(root, 'index.html'),
    '<!doctype html><title>Aquora</title><script src="/_expo/static/js/web/__expo-metro-runtime-ab.js" defer></script><script src="/_expo/static/js/web/index-cd.js" defer></script>',
  );
  const chunks = path.join(root, '_expo/static/js/web');
  fs.mkdirSync(chunks, { recursive: true });
  for (const file of ['_layout-ab.js', 'tablero-cd.js', 'login-ef.js'])
    fs.writeFileSync(path.join(chunks, file), '');
  fs.writeFileSync(path.join(root, asset), body);
  fs.writeFileSync(path.join(root, asset + '.br'), zlib.brotliCompressSync(Buffer.from(body)));
  fs.writeFileSync(path.join(root, '.env'), 'must-not-be-served');
  const server = createServer(root).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true });
  });
  function request(url, method = 'GET', encoding = 'gzip') {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: server.address().port,
          path: url,
          method,
          headers: { 'Accept-Encoding': encoding },
        },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () =>
            resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });
  }
  const compressed = await request('/' + asset);
  assert.equal(compressed.headers['content-encoding'], 'gzip');
  assert.equal(zlib.gunzipSync(compressed.body).toString(), body);
  assert.match(compressed.headers['cache-control'], /immutable/);
  const brotli = await request('/' + asset, 'GET', 'gzip, deflate, br, zstd');
  assert.equal(brotli.headers['content-encoding'], 'br');
  assert.equal(zlib.brotliDecompressSync(brotli.body).toString(), body);
  assert.match(brotli.headers.vary, /Accept-Encoding/);
  assert.notEqual(
    (await request('/' + asset, 'GET', 'br;q=0, gzip')).headers['content-encoding'],
    'br',
  );
  assert.equal((await request('/' + asset, 'GET', 'identity')).body.toString(), body);
  assert.match((await request('/tablero')).body.toString(), /Aquora/);
  const dashboard = (await request('/tablero', 'GET', 'identity')).body.toString();
  assert.ok(dashboard.indexOf('__expo-metro-runtime') < dashboard.indexOf('tablero-cd'));
  assert.ok(dashboard.indexOf('tablero-cd') < dashboard.indexOf('index-cd'));
  assert.doesNotMatch(dashboard, /login-ef/);
  assert.equal((await request('/tablero')).headers['cache-control'], 'no-cache');
  assert.equal((await request('/missing.js')).status, 404);
  assert.equal((await request('/api/auth/login', 'POST')).status, 405);
  assert.equal((await request('/.env')).status, 404);
  assert.equal((await request('/%2eenv')).status, 404);
});
