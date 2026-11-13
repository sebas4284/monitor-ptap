// Serve only an Expo production export, never the workspace or a development bundle.
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const compression = require('compression');

function createServer(directory) {
  const root = path.resolve(directory);
  if (!fs.statSync(path.join(root, 'index.html')).isFile())
    throw new Error('Missing Expo export index.html');
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(compression());
  app.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).end();
    try {
      if (
        decodeURIComponent(req.path)
          .split('/')
          .some((part) => part.startsWith('.'))
      )
        return res.status(404).end();
    } catch {
      return res.status(400).end();
    }
    next();
  });
  app.use((req, res, next) => {
    if (!/\.(js|css)$/.test(req.path) || !req.get('Accept-Encoding')) return next();
    const file = path.resolve(root, '.' + decodeURIComponent(req.path));
    if (!file.startsWith(root + path.sep)) return res.status(403).end();
    const accepted = req.acceptsEncodings();
    const encoding = accepted.includes('br') ? 'br' : accepted.includes('gzip') ? 'gzip' : false;
    const compressed = file + (encoding === 'br' ? '.br' : '.gz');
    if (!encoding || !fs.existsSync(compressed)) return next();
    res.type(path.extname(file));
    res.set('Content-Encoding', encoding);
    res.vary('Accept-Encoding');
    res.set(
      'Cache-Control',
      /[.-][a-f0-9]{32,}\./i.test(path.basename(file))
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    );
    res.sendFile(compressed);
  });
  app.use(
    express.static(root, {
      index: false,
      dotfiles: 'deny',
      setHeaders(res, file) {
        res.setHeader(
          'Cache-Control',
          /[.-][a-f0-9]{32,}\./i.test(path.basename(file))
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        );
      },
    }),
  );
  app.use((req, res) => {
    if (path.extname(req.path) || req.path.startsWith('/api/')) return res.status(404).end();
    res.setHeader('Cache-Control', 'no-cache');
    const chunks = path.join(root, '_expo/static/js/web');
    const route = req.path.split('/').filter(Boolean).pop() || 'login';
    const routeScripts = fs.existsSync(chunks)
      ? fs
          .readdirSync(chunks)
          .filter(
            (file) =>
              file.endsWith('.js') && (file.startsWith('_layout-') || file.startsWith(`${route}-`)),
          )
          .map((file) => `<script src="/_expo/static/js/web/${file}" defer></script>`)
          .join('\n')
      : '';
    // Expo supports registered chunks before its entrypoint, avoiding async route waterfalls.
    const html = fs
      .readFileSync(path.join(root, 'index.html'), 'utf8')
      .replace(/(?=<script src="\/_expo\/static\/js\/web\/index-[^"]+" defer>)/, routeScripts);
    res.type('html').send(html);
  });
  return app;
}
module.exports = { createServer };
if (require.main === module) {
  const root = process.argv[2] || path.resolve(__dirname, '../../apps/mobile/dist-audit');
  const port = Number(process.argv[3] || 8082);
  createServer(root).listen(port, process.env.HOST || '127.0.0.1', () =>
    console.log(`Production export listening on ${port}`),
  );
}
