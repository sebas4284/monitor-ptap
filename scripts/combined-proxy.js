const http = require('http');

const FRONTEND_PORT = Number(process.env.FRONTEND_PORT || 3000);
const BACKEND_PORT = Number(process.env.BACKEND_PORT || 4000);
const COMBINED_PORT = Number(process.env.COMBINED_PORT || 8080);

function proxyRequest(targetPort, req, res) {
  const target = `http://127.0.0.1:${targetPort}${req.url || '/'}`;
  const proxyReq = http.request(target, {
    method: req.method,
    headers: req.headers,
  }, proxyRes => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', error => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Proxy error', message: error.message }));
  });

  req.pipe(proxyReq, { end: true });
}

const server = http.createServer((req, res) => {
  const path = req.url || '/';
  if (path.startsWith('/api') || path.startsWith('/socket.io')) {
    return proxyRequest(BACKEND_PORT, req, res);
  }
  return proxyRequest(FRONTEND_PORT, req, res);
});

server.listen(COMBINED_PORT, '0.0.0.0', () => {
  console.log(`Reverse proxy running on http://localhost:${COMBINED_PORT}`);
  console.log(`Frontend: http://localhost:${FRONTEND_PORT}`);
  console.log(`Backend: http://localhost:${BACKEND_PORT}`);
});
