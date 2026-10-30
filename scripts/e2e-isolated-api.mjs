// Reverse proxy that gives the app an isolated REST backend without touching the
// shared local database:
//
//   /rest/v1/*  -> private PostgREST (default :3999) bound to a scratch DB copy
//   everything else (auth, storage, realtime) -> the shared Supabase gateway
//
// Auth tokens from the shared GoTrue are valid on the private PostgREST because
// both use the same JWT secret, and the scratch copy carries the same auth.users
// ids. Websocket upgrades (realtime) are tunnelled to the shared gateway.
//
//   node scripts/e2e-isolated-api.mjs            # listens on :54399
//   PORT=54400 REST=http://127.0.0.1:3999 node scripts/e2e-isolated-api.mjs
import http from 'node:http';
import net from 'node:net';
import { execFileSync } from 'node:child_process';

const status = JSON.parse(execFileSync('node_modules/.bin/supabase', ['status', '-o', 'json'], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}));
const shared = new URL(status.API_URL);
const rest = new URL(process.env.REST ?? 'http://127.0.0.1:3999');
const port = Number(process.env.PORT ?? 54399);

const server = http.createServer((req, res) => {
  const isRest = req.url.startsWith('/rest/v1');
  const target = isRest ? rest : shared;
  const path = isRest ? req.url.replace(/^\/rest\/v1/, '') || '/' : req.url;
  const headers = { ...req.headers, host: target.host };
  const upstream = http.request(
    { hostname: target.hostname, port: target.port, path, method: req.method, headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    }
  );
  upstream.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`proxy error: ${err.message}`);
  });
  req.pipe(upstream);
});

server.on('upgrade', (req, socket, head) => {
  const upstream = net.connect(Number(shared.port), shared.hostname, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (const [k, v] of Object.entries({ ...req.headers, host: shared.host })) {
      lines.push(`${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
    }
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

server.listen(port, '127.0.0.1', () => {
  console.log(`isolated API on http://127.0.0.1:${port}  rest -> ${rest.origin}  other -> ${shared.origin}`);
});
