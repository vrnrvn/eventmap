// Visual check for host insights, business analytics and the zoned Saved /
// Joined rows (web build) against an ISOLATED backend. Same harness as
// scripts/calendar-visual.mjs: tokens minted locally, no shared-GoTrue
// sign-in, REST through a proxy to a private PostgREST on a scratch copy.
//
// Prereqs: scratch copy with 20261104100000..130000 applied, plus
// scripts/calendar-visual.fixture.sql and scripts/insights-visual.fixture.sql;
// private PostgREST + proxy; web export pointed at the proxy.
//
//   SCRATCH_DB=eventmap_scratch_<yours> PROXY=http://127.0.0.1:54381 \
//     node scripts/insights-visual.mjs /tmp/export /tmp/shots
//
// Flips the demo host between premium and free ON THE SCRATCH COPY ONLY
// (refuses SCRATCH_DB=postgres or unset).
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

const [exportDir, outDir] = process.argv.slice(2);
assert.ok(exportDir && outDir, 'usage: node scripts/insights-visual.mjs <exportDir> <outDir>');
const PROXY = process.env.PROXY ?? 'http://127.0.0.1:54381';
assert.ok(/^http:\/\/(127\.0\.0\.1|localhost):/.test(PROXY), 'refusing a non-local proxy');
const SCRATCH_DB = process.env.SCRATCH_DB ?? '';
assert.ok(/^eventmap_scratch_[a-z0-9_]+$/.test(SCRATCH_DB), 'set SCRATCH_DB to your scratch copy (never postgres)');
const STATIC_PORT = Number(process.env.STATIC_PORT ?? 8071);
const CDP_PORT = Number(process.env.CDP_PORT ?? 9371);
fs.mkdirSync(outDir, { recursive: true });

const HOST = '10000000-0000-4000-8000-000000000001';
const ALEX = '10000000-0000-4000-8000-000000000002';
const GALLERY = 'cafe0000-0000-4000-8000-000000000001';

const scratchSql = (sql) =>
  execFileSync('docker', ['exec', '-i', '-e', 'PGPASSWORD=postgres', 'supabase_db_eventmap-local', 'psql', '-U', 'postgres', '-d', SCRATCH_DB, '-v', 'ON_ERROR_STOP=1', '-qAt', '-c', sql], { encoding: 'utf8' });
const setHostTier = (premium) =>
  scratchSql(`UPDATE profiles SET is_admin = ${premium} WHERE id = '${HOST}';
              UPDATE businesses SET subscription_tier = '${premium ? 'premium' : 'free'}', subscription_expires_at = NULL WHERE owner_id = '${HOST}';`);

// ── Tokens ───────────────────────────────────────────────────────────────────
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function hmacKey() {
  const env = execFileSync('docker', ['inspect', 'supabase_rest_eventmap-local', '--format', '{{range .Config.Env}}{{.}}{{"\\n"}}{{end}}'], { encoding: 'utf8' });
  const secret = env.split('\n').find((l) => l.startsWith('PGRST_JWT_SECRET='))?.slice('PGRST_JWT_SECRET='.length) ?? '';
  try {
    const oct = JSON.parse(secret).keys?.find((k) => k.kty === 'oct');
    if (oct) return Buffer.from(oct.k.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  } catch {
    // Plain shared secret.
  }
  return Buffer.from(secret, 'utf8');
}
const KEY = hmacKey();
const mint = (sub, email) => {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: now, exp: now + 6 * 3600, iss: 'supabase', aud: 'authenticated', role: 'authenticated', sub, email }));
  return `${header}.${payload}.${b64url(createHmac('sha256', KEY).update(`${header}.${payload}`).digest())}`;
};
const sessionFor = (sub, email) => ({
  access_token: mint(sub, email),
  refresh_token: 'insights-visual-no-refresh',
  token_type: 'bearer',
  expires_in: 6 * 3600,
  expires_at: Math.floor(Date.now() / 1000) + 6 * 3600,
  user: { id: sub, aud: 'authenticated', role: 'authenticated', email, app_metadata: { provider: 'email' }, user_metadata: {} },
});

// ── Static server + Chrome ───────────────────────────────────────────────────
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let file = path.join(exportDir, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(exportDir, 'index.html');
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(STATIC_PORT, r));
const base = `http://localhost:${STATIC_PORT}`;
const profileDir = `/tmp/eventmap-chrome-insights-${process.pid}`;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--no-first-run', `--user-data-dir=${profileDir}`, '--window-size=390,844', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
let failures = 0;
try {
  let target;
  for (let i = 0; i < 30 && !target; i++) {
    await sleep(300);
    try {
      target = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).find((t) => t.type === 'page');
    } catch {
      // starting
    }
  }
  assert.ok(target, 'Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
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
    }
  });
  const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const shot = async (name) => {
    const { result } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(result.data, 'base64'));
    console.log('saved', name);
  };
  const text = 'document.body.innerText';
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
  const scrollMain = (y) => evaluate(`(() => { const s = [...document.querySelectorAll('div')].filter((d) => d.scrollHeight > d.clientHeight + 100 && getComputedStyle(d).overflowY !== 'visible').pop(); if (s) s.scrollTop = ${y}; return !!s; })()`);
  const storageKey = `sb-${new URL(PROXY).hostname.split('.')[0]}-auth-token`;
  const signInAs = async (sub, email, extra = '') => {
    await send('Page.navigate', { url: `${base}/` });
    await sleep(1200);
    await evaluate(`localStorage.clear(); localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(JSON.stringify(sessionFor(sub, email)))}); ${extra} 'ok'`);
  };
  const open = async (route, ready, label) => {
    await send('Page.navigate', { url: `${base}${route}` });
    await waitFor(ready, label);
    await sleep(2000);
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTimezoneOverride', { timezoneId: 'America/New_York' });
  await send('Emulation.setLocaleOverride', { locale: 'en-US' });

  // EXPECT_FALLBACK=1: get_event_insights is absent (shared DB today); the
  // screen must still show counts from the host overview and say why the
  // rest is missing, without a Pro lock.
  if (process.env.EXPECT_FALLBACK === '1') {
    setHostTier(false);
    await signInAs(HOST, 'host@example.test', `localStorage.setItem('eventmap.userMode.${HOST}', 'business');`);
    await open(`/business/event-insights/${GALLERY}`, `/From view to RSVP/i.test(${text})`, 'insights (fallback)');
    await check('fallback: no distinct-viewer guess', `!${text}.includes('People who viewed')`);
    await check('fallback: counts from the host overview', `/From view to RSVP/i.test(${text}) && ${text}.includes('All-time counts')`);
    await check('fallback: explains missing sections, no Pro lock', `${text}.includes('More insights are on the way') && !${text}.includes('More with Pro')`);
    await shot('08-insights-fallback');
    if (consoleErrors.length) console.log('page exceptions:\n  ' + consoleErrors.slice(0, 8).join('\n  '));
    console.log(failures === 0 ? 'ALL VISUAL CHECKS PASSED' : `${failures} visual check(s) failed`);
    throw Object.assign(new Error('done'), { done: true });
  }

  // ── Premium host ───────────────────────────────────────────────────────────
  setHostTier(true);
  await signInAs(HOST, 'host@example.test', `localStorage.setItem('eventmap.userMode.${HOST}', 'business');`);
  await open(`/business/event-insights/${GALLERY}`, `${text}.includes('People who viewed')`, 'insights (premium)');
  await check('premium: counts + funnel', `${text}.includes('Gallery night') && /From view to RSVP/i.test(${text}) && ${text}.includes('of 10 spots')`);
  await check('premium: period selector', `${text}.includes('7 days') && ${text}.includes('90 days')`);
  await check('premium: trend, lead time, audience', `/Daily activity/i.test(${text}) && /When people RSVP/i.test(${text}) && /Who is going/i.test(${text})`);
  await check('premium: no sample data anywhere', `!/sample data/i.test(${text})`);
  await shot('01-insights-premium-top');
  await scrollMain(700);
  await sleep(500);
  await check('premium: announcement reach', `${text}.includes('1 sent') && ${text}.includes('50% read')`);
  await check('premium: taps section', `/Taps on your event page/i.test(${text}) && ${text}.includes('Added to calendar')`);
  await check('premium: RSVP changes with drop-off', `/RSVP changes/i.test(${text}) && ${text}.includes('1 left') && ${text}.includes('Drop-off')`);
  await shot('02-insights-premium-bottom');
  await scrollMain(1500);
  await sleep(500);
  await shot('02b-insights-premium-end');

  await open('/profile-analytics', `${text}.includes('Total Posts')`, 'business analytics (premium)');
  // Section titles are uppercased with textTransform; innerText reflects that.
  await check('business premium: taps card', `/taps \\(30d\\)/i.test(${text}) && ${text}.includes('Calendar adds')`);
  await check('business premium: top events + trend', `/top events/i.test(${text}) && /engagement trend/i.test(${text}) && !${text}.includes('More with Pro')`);
  await shot('03-business-premium');
  await scrollMain(1500);
  await sleep(500);
  await shot('03b-business-premium-end');

  // Host calendar flow: business-mode profile links to the calendar, and a
  // first visit shows hosted events alongside going ones.
  await open('/profile', `${text}.includes('Public profile')`, 'business profile');
  await check('host: Calendar quick link in business mode', `[...document.querySelectorAll('[role="button"]')].some((el) => el.getAttribute('aria-label') === 'Calendar')`);
  await shot('03c-business-profile');
  await open('/calendar', `!!document.querySelector('[aria-label="Show hosting events"]')`, 'host calendar');
  // The default applies once the business profile has loaded, which can take
  // longer than the fixed settle time above.
  const hostingOn = `document.querySelector('[aria-label="Show hosting events"]')?.getAttribute('aria-checked') === 'true'`;
  await waitFor(hostingOn, 'hosting default', 8000).catch(() => {});
  await check('host: Hosting source on by default', hostingOn);
  await shot('03d-host-calendar');

  // ── Free host ──────────────────────────────────────────────────────────────
  setHostTier(false);
  await open(`/business/event-insights/${GALLERY}`, `${text}.includes('People who viewed')`, 'insights (free)');
  await check('free: real counts shown', `/From view to RSVP/i.test(${text}) && ${text}.includes('of 10 spots')`);
  await check('free: premium sections locked', `${text}.includes('More with Pro') && !/Daily activity/i.test(${text}) && !/Taps on your event page/i.test(${text})`);
  await check('free: no period selector', `!${text}.includes('90 days')`);
  await shot('04-insights-free');

  await open('/profile-analytics', `${text}.includes('Total Posts')`, 'business analytics (free)');
  await check('business free: totals visible, top events locked', `${text}.includes('Total Posts') && ${text}.includes('More with Pro') && ${text}.includes('Your top events') && !${text}.includes('Unlock analytics for your business')`);
  await shot('05-business-free');

  // ── Attendee: zoned Saved / Joined rows ────────────────────────────────────
  await signInAs(ALEX, 'alex@example.test');
  await open('/saved-events', `${text}.includes('Saturday food market')`, 'saved events');
  await check('saved: event-zone time + your-time line', `${text}.includes('10:00 AM') && ${text}.includes('your time')`);
  await shot('06-saved-zoned');
  await open('/joined-events', `${text}.includes('Gallery night')`, 'joined events');
  await check('joined: your-time line on going rows', `${text}.includes('your time')`);
  await shot('07-joined-zoned');

  if (consoleErrors.length) console.log('page exceptions:\n  ' + consoleErrors.slice(0, 8).join('\n  '));
  console.log(failures === 0 ? 'ALL VISUAL CHECKS PASSED' : `${failures} visual check(s) failed`);
} catch (err) {
  if (!err?.done) throw err;
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
