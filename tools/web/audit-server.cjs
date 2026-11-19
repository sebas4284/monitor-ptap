// Local production-export preview. Only the public release lookup is proxied;
// auth, commands and all writes are deliberately unavailable during audits.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../apps/mobile/dist-audit');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
  '.css': 'text/css', '.txt': 'text/plain', '.png': 'image/png', '.ttf': 'font/ttf',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };

http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); return res.end();
  }
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/api/app/version') {
      const upstream = await fetch('https://aquora.xpertic.co/api/app/version', {
        signal: AbortSignal.timeout(8000), redirect: 'error',
      });
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
      return res.end(req.method === 'HEAD' ? undefined : await upstream.text());
    }
    let file = path.resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403); return res.end();
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); return res.end();
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch {
    res.writeHead(502); res.end();
  }
}).listen(4174, '127.0.0.1', () => console.log('Audit preview: http://127.0.0.1:4174'));
