// Visual check for the personal calendar (web build) against an ISOLATED backend.
//
// Nothing here touches the shared database or signs in through the shared
// GoTrue: the demo attendee's session is a token minted locally from the
// stack's JWT key and injected into localStorage, and every REST call goes
// through the proxy to a private PostgREST bound to a scratch copy.
//
//   SCRATCH_DB=eventmap_scratch_<yours> scripts/db-scratch.sh refresh
//   ... apply supabase/migrations/20261104110000_user_calendar_rpc.sql and
//       scripts/calendar-visual.fixture.sql to the scratch copy
//   private PostgREST on $REST_PORT + `PORT=$PROXY_PORT node scripts/e2e-isolated-api.mjs`
//   web export built with EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:$PROXY_PORT
//
//   PROXY=http://127.0.0.1:54397 node scripts/calendar-visual.mjs /tmp/export /tmp/shots
//
// Uses headless Google Chrome over the DevTools protocol.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

const [exportDir, outDir] = process.argv.slice(2);
assert.ok(exportDir && outDir, 'usage: node scripts/calendar-visual.mjs <exportDir> <outDir>');
const PROXY = process.env.PROXY ?? 'http://127.0.0.1:54397';
assert.ok(/^http:\/\/(127\.0\.0\.1|localhost):/.test(PROXY), 'refusing a non-local proxy');
const STATIC_PORT = Number(process.env.STATIC_PORT ?? 8087);
// EXPECT_FALLBACK=1: get_user_calendar is absent, so the screen must fall back
// to the Phase A lists (no pending requests, no cancelled going events).
const FALLBACK = process.env.EXPECT_FALLBACK === '1';
// The scratch copy has 20261104120000 (requested scope + requested_count).
// Set REQUESTED_SCOPE=0 for a backend without it.
const REQUESTED_SCOPE = process.env.REQUESTED_SCOPE !== '0';
const CDP_PORT = Number(process.env.CDP_PORT ?? 9337);
fs.mkdirSync(outDir, { recursive: true });

// ── Token minting (same approach as scripts/regress-isolated.mjs) ────────────
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function hmacKey() {
  const env = execFileSync('docker', ['inspect', 'supabase_rest_eventmap-local', '--format', '{{range .Config.Env}}{{.}}{{"\\n"}}{{end}}'], { encoding: 'utf8' });
  const secret = env.split('\n').find((l) => l.startsWith('PGRST_JWT_SECRET='))?.slice('PGRST_JWT_SECRET='.length) ?? '';
  try {
    const jwks = JSON.parse(secret);
    const oct = jwks.keys?.find((k) => k.kty === 'oct');
    if (oct) return Buffer.from(oct.k.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  } catch {
    // Plain shared secret.
  }
  return Buffer.from(secret, 'utf8');
}
const KEY = hmacKey();
function mint(claims, ttl = 6 * 3600) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: now, exp: now + ttl, iss: 'supabase', aud: 'authenticated', role: 'authenticated', ...claims }));
  return `${header}.${payload}.${b64url(createHmac('sha256', KEY).update(`${header}.${payload}`).digest())}`;
}

const ALEX = '10000000-0000-4000-8000-000000000002';
const anonKey = fs.readFileSync('.env.local', 'utf8').match(/^EXPO_PUBLIC_SUPABASE_ANON_KEY=(.*)$/m)?.[1]?.trim();
assert.ok(anonKey, 'EXPO_PUBLIC_SUPABASE_ANON_KEY missing from .env.local');
const accessToken = mint({ sub: ALEX, email: 'alex@example.test' });

// ── API shape check through the proxy (scratch PostgREST) ────────────────────
if (!FALLBACK) {
  const res = await fetch(`${PROXY}/rest/v1/rpc/get_user_calendar`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_from: '2026-11-01T00:00:00Z', p_to: '2026-11-30T23:59:59Z', p_sources: ['going', 'requested', 'saved', 'interested'] }),
  });
  assert.equal(res.status, 200, `RPC through proxy returned ${res.status}`);
  const body = await res.json();
  const byTitle = Object.fromEntries(body.rows.map((r) => [r.title, r]));
  assert.deepEqual(byTitle['Pottery workshop'].sources, ['requested'], 'pending request comes back as requested');
  assert.equal(byTitle['Rooftop cinema'].status, 'cancelled', 'cancelled event kept with status');
  assert.equal(byTitle['Riverside run club'].timezone, 'Europe/Lisbon', 'zone is returned');
  assert.equal(body.truncated, false);
  console.log(`PASS: get_user_calendar over PostgREST (${body.rows.length} rows)`);
}

// ── Static server for the export ─────────────────────────────────────────────
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let file = path.join(exportDir, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(exportDir, 'index.html');
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(STATIC_PORT, r));
const base = `http://localhost:${STATIC_PORT}`;

// ── Chrome ───────────────────────────────────────────────────────────────────
const profileDir = `/tmp/eventmap-chrome-calendar-${process.pid}`;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--no-first-run', `--user-data-dir=${profileDir}`, '--window-size=390,844', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
let failures = 0;
try {
  let pageTarget;
  for (let i = 0; i < 30 && !pageTarget; i++) {
    await sleep(300);
    try {
      pageTarget = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).find((t) => t.type === 'page');
    } catch {
      // Chrome still starting.
    }
  }
  assert.ok(pageTarget, 'Chrome did not start');
  ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let seq = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    } else if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    }
  });
  const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const shot = async (name) => {
    const { result } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(result.data, 'base64'));
    console.log('saved', name);
  };
  const waitFor = async (js, label, timeout = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await evaluate(js)) return;
      await sleep(200);
    }
    throw new Error(`timed out waiting for ${label}`);
  };
  const check = async (label, js) => {
    const ok = await evaluate(js);
    console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
    if (!ok) failures++;
  };
  const text = 'document.body.innerText';
  const click = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTimezoneOverride', { timezoneId: process.env.VIEWER_TZ ?? 'Europe/Lisbon' });
  await send('Emulation.setLocaleOverride', { locale: 'en-US' });

  // Seed the session for the proxy origin's storage key, then open the calendar.
  await send('Page.navigate', { url: `${base}/` });
  await sleep(1500);
  const session = {
    access_token: accessToken,
    refresh_token: 'calendar-visual-no-refresh',
    token_type: 'bearer',
    expires_in: 6 * 3600,
    expires_at: Math.floor(Date.now() / 1000) + 6 * 3600,
    user: { id: ALEX, aud: 'authenticated', role: 'authenticated', email: 'alex@example.test', app_metadata: { provider: 'email' }, user_metadata: {} },
  };
  const storageKey = `sb-${new URL(PROXY).hostname.split('.')[0]}-auth-token`;
  await evaluate(`localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(JSON.stringify(session))}); localStorage.removeItem('calendar:sources:${ALEX}'); localStorage.removeItem('calendar:view:${ALEX}'); 'ok'`);
  await send('Page.navigate', { url: `${base}/calendar` });
  await waitFor(`${text}.includes('Calendar') && !!document.querySelector('[aria-label="Next month"]')`, 'calendar screen');
  await sleep(2000);

  // 1. Month view, default Going source.
  await check('month title shows November 2026', `${text}.includes('November 2026')`);
  await check('today (Nov 4) is labelled', `!!document.querySelector('[aria-label^="Today, Wed, Nov 4"]')`);
  await check('Nov 6 has two events', `!!document.querySelector('[aria-label="Fri, Nov 6, 2 events"]')`);
  await check('run club repeats on Tue Nov 10', `!!document.querySelector('[aria-label="Tue, Nov 10, 1 event"]')`);
  await check('jazz weekend spans Nov 20-22', `['Fri, Nov 20','Sat, Nov 21','Sun, Nov 22'].every((d) => document.querySelector('[aria-label^="' + d + ', 1 event"]'))`);
  await shot('01-month-going');
  if (!FALLBACK) await check('Nov 12 pending ring + Nov 14 cancelled ring present', `!!document.querySelector('[aria-label="Thu, Nov 12, 1 event"]') && !!document.querySelector('[aria-label="Sat, Nov 14, 1 event"]')`);

  // 2. Overlap day.
  await click('[aria-label="Fri, Nov 6, 2 events"]');
  await sleep(500);
  await check('overlap pills on Gallery night + Book swap', `(${text}.match(/Overlaps/g) || []).length === 2`);
  await shot('02-day-overlap');

  // 3. Pending request.
  await click('[aria-label^="Thu, Nov 12"]');
  await sleep(500);
  if (FALLBACK && !REQUESTED_SCOPE) await check('fallback: pending request not listed (lists cannot see it)', `!${text}.includes('Pottery workshop')`);
  else await check('pending request shows Pending + note', `${text}.includes('Pottery workshop') && ${text}.includes('Pending') && ${text}.includes('Awaiting host approval')`);
  await shot('03-day-pending');

  // 4. Cancelled.
  await click('[aria-label^="Sat, Nov 14"]');
  await sleep(500);
  if (FALLBACK) await check('fallback: cancelled going event not listed', `!${text}.includes('Rooftop cinema')`);
  else await check('cancelled event badged', `${text}.includes('Rooftop cinema') && ${text}.includes('Cancelled')`);
  await shot('04-day-cancelled');

  // 5. Multi-day middle segment.
  await click('[aria-label^="Sat, Nov 21"]');
  await sleep(500);
  await check('festival day 2 of 3', `${text}.includes('Lisbon jazz weekend') && ${text}.includes('Day 2 of 3')`);
  await shot('05-day-multiday');

  // 6. All sources on.
  await click('[aria-label="Show saved events"]');
  await click('[aria-label="Show interested events"]');
  await sleep(1500);
  await check('saved market appears on Nov 7', `!!document.querySelector('[aria-label="Sat, Nov 7, 1 event"]')`);
  await check('interested talk appears on Nov 18', `!!document.querySelector('[aria-label="Wed, Nov 18, 1 event"]')`);
  await shot('06-month-all-sources');

  // 7. Next month via arrow.
  await click('[aria-label="Next month"]');
  await sleep(1500);
  await check('December 2026 with run club Tuesdays', `${text}.includes('December 2026') && !!document.querySelector('[aria-label="Tue, Dec 1, 1 event"]')`);
  await shot('07-month-december');

  // 8. Agenda.
  await click('[aria-label="Agenda view"]');
  await sleep(1500);
  await check('agenda groups by day with Tomorrow/dates', `${text}.includes('Friday, November 6') && ${text}.includes('Show 8 more weeks')`);
  await shot('08-agenda-top');
  await evaluate(`(() => { const s = [...document.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 200 && getComputedStyle(d).overflowY !== 'visible'); if (s) s.scrollTop = 1400; return !!s; })()`);
  await sleep(600);
  await shot('09-agenda-scrolled');

  // 9. Preferences persisted.
  // 10. Joined Events: Requests tab (20261104120000).
  await send('Page.navigate', { url: `${base}/joined-events` });
  await waitFor(`${text}.includes('Events Joined')`, 'joined events');
  await sleep(2000);
  if (REQUESTED_SCOPE) {
    await check('joined: Requests tab with count', `${text}.includes('Requests 1')`);
    await evaluate(`(() => { const t = [...document.querySelectorAll('[role="tab"]')].find((el) => el.innerText.startsWith('Requests')); t?.click(); return !!t; })()`);
    await sleep(1500);
    await check('joined: pending request listed', `${text}.includes('Pottery workshop') && ${text}.includes('Pending') && ${text}.includes('waiting for approval')`);
    await shot('10-joined-requests');
  } else {
    await check('joined: no Requests tab on an old backend', `!${text}.includes('Requests')`);
  }
  await send('Page.navigate', { url: `${base}/calendar` });
  await waitFor(`!!document.querySelector('[aria-label="Agenda view"]')`, 'calendar again');
  await sleep(1000);

  await check('sources + view persisted', `localStorage.getItem('calendar:view:${ALEX}') === 'agenda' && JSON.parse(localStorage.getItem('calendar:sources:${ALEX}')).length === 3`);

  const relevant = consoleErrors.filter((e) => e && !/favicon|DevTools|Download the React DevTools/i.test(e));
  if (relevant.length) {
    console.log('console errors:\n  ' + relevant.slice(0, 10).join('\n  '));
  }
  console.log(failures === 0 ? 'ALL VISUAL CHECKS PASSED' : `${failures} visual check(s) failed`);
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  const exited = new Promise((r) => chrome.once('exit', r));
  chrome.kill();
  await Promise.race([exited, sleep(3000)]);
  server.close();
  try {
    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch {
    console.log(`note: could not remove ${profileDir}`);
  }
}
process.exit(failures === 0 ? 0 : 1);
