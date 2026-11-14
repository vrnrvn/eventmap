// Fake-backend web harness: serves a web export, launches a fresh headless
// Chrome, intercepts EVERY request to the build's (dead) backend URL over CDP
// and answers it from an in-memory fake. Nothing can reach a real database.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

export async function freePort() {
  return new Promise((r) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startHarness({ repo, dist, backendOrigin, route, seed, viewport = [430, 932] }) {
  const WebSocket = createRequire(repo + '/package.json')('ws');
  const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png', '.json': 'application/json' };
  const appPort = await freePort(), cdpPort = await freePort();
  const server = http.createServer((req, res) => {
    let p = path.join(dist, decodeURIComponent(req.url.split('?')[0]));
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(dist, 'index.html');
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  }).listen(appPort);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'elm-e2e-profile-'));
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`,
    '--disable-web-security', `--window-size=${viewport[0]},${viewport[1]}`, 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250);
    try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json()).find((t) => t.type === 'page'); } catch {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let id = 0; const pending = new Map(); const log = []; const requests = [];
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.on('message', async (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') log.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n').slice(0, 4).join(' | '));
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type))
      log.push(m.params.type.toUpperCase() + ' ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400));
    if (m.method === 'Fetch.requestPaused') {
      const { requestId, request } = m.params;
      const url = new URL(request.url);
      const entry = { t: Date.now(), method: request.method, path: url.pathname, query: url.search, headers: request.headers, body: request.postData };
      requests.push(entry);
      let resp;
      try { resp = await route(entry); } catch (e) { resp = { status: 500, json: { message: String(e) } }; }
      if (resp?.abort) { await send('Fetch.failRequest', { requestId, errorReason: 'ConnectionRefused' }); return; }
      if (resp?.delay) await sleep(resp.delay);
      const body = resp.raw !== undefined ? resp.raw : JSON.stringify(resp.json ?? null);
      const headers = [
        { name: 'content-type', value: 'application/json' },
        { name: 'access-control-allow-origin', value: '*' },
        { name: 'access-control-expose-headers', value: 'content-range' },
        ...Object.entries(resp.headers || {}).map(([name, value]) => ({ name, value: String(value) })),
      ];
      await send('Fetch.fulfillRequest', { requestId, responseCode: resp.status ?? 200, responseHeaders: headers, body: Buffer.from(body).toString('base64') });
    }
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: backendOrigin + '/*' }] });
  if (seed) await send('Page.addScriptToEvaluateOnNewDocument', { source: seed });
  const base = `http://127.0.0.1:${appPort}`;
  const api = {
    base, send, log, requests,
    async go(p, wait = 6000) { await send('Page.navigate', { url: base + p }); await sleep(wait); },
    async eval(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r?.result?.value ?? r?.exceptionDetails?.text; },
    async text() { return api.eval('document.body.innerText'); },
    async shot(file) { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(s.data, 'base64')); },
    async click(text, exact = false) {
      return api.eval(`(() => { const want = ${JSON.stringify(text)};
        // checkbox/switch included: RN-web renders those roles for toggles
        // (the playbook's manual ticks, Settings switches), which were
        // previously unreachable from a suite.
        const els = [...document.querySelectorAll('[role=button],[role=tab],[role=link],[role=checkbox],[role=switch],a,button,[tabindex]')];
        const el = els.find((e) => { const t = (e.getAttribute('aria-label') || e.innerText || '').trim(); return ${exact} ? t === want : t.includes(want); });
        if (!el) return 'NOT FOUND'; el.scrollIntoView({block:'center'}); el.click(); return 'ok'; })()`);
    },
    async close() { try { ws.close(); } catch {} chrome.kill(); server.close(); await sleep(800); try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch {} },
  };
  return api;
}
