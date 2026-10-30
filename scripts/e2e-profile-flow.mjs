// Drives the web build through the profile user journey in headless Chrome and
// records screenshots, console errors, and failed requests for review.
//
// Prereqs (all isolated from the shared database):
//   1. scripts/db-scratch.sh refresh + apply the attendance migration, with
//      SCRATCH_DB=eventmap_scratch_<you>
//   2. a private PostgREST on :3999 bound to that scratch DB
//   3. node scripts/e2e-isolated-api.mjs       (proxy on :54399)
//   4. a web export built with EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399
//
//   node scripts/e2e-profile-flow.mjs /tmp/eventmap-web-elm /tmp/eventmap-e2e
//
// Steps are best-effort: a step that cannot find its target logs a GAP line and
// the run continues, so one missing button does not hide everything after it.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

const [exportDir, outDir] = process.argv.slice(2);
if (!exportDir || !outDir) {
  console.error('usage: node scripts/e2e-profile-flow.mjs <exportDir> <outDir>');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

import { execFileSync } from 'node:child_process';
const SCRATCH_DB = process.env.SCRATCH_DB ?? 'eventmap_scratch_elm';
const scratchSql = (sql) => execFileSync('docker', ['exec', '-i', '-e', 'PGPASSWORD=postgres', process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_eventmap-local', 'psql', '-U', 'postgres', '-d', SCRATCH_DB, '-Atc', sql], { encoding: 'utf8' }).trim();
const EMAIL = process.env.E2E_EMAIL ?? 'alex@example.test';
const PASSWORD = process.env.E2E_PASSWORD ?? 'LocalDemo123!';
const PORT = 8090;

// ---- static server for the export --------------------------------------------
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let file = path.join(exportDir, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(exportDir, 'index.html');
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));
const base = `http://localhost:${PORT}`;

// ---- chrome + CDP ---------------------------------------------------------------
const profileDir = fs.mkdtempSync('/tmp/eventmap-e2e-chrome-');
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-port=9345', '--no-first-run', `--user-data-dir=${profileDir}`,
  '--window-size=390,844', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));
const target = (await (await fetch('http://127.0.0.1:9345/json')).json()).find((t) => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.on('open', r));
let seq = 0;
const pending = new Map();
const consoleErrors = [];
const dialogs = [];
const failedRequests = [];
const requests = new Map();
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Page.javascriptDialogOpening') { dialogs.push(m.params.message); send('Page.handleJavaScriptDialog', { accept: true }); }
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
    const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (!/Download the React DevTools|expo-notifications|props.pointerEvents|shadow\*|accessibilityRole/.test(text)) consoleErrors.push(`[${m.params.type}] ${text.slice(0, 300)}`);
  }
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(`[exception] ${m.params.exceptionDetails.text} ${m.params.exceptionDetails.exception?.description ?? ''}`.slice(0, 400));
  if (m.method === 'Network.requestWillBeSent') requests.set(m.params.requestId, m.params.request);
  if (m.method === 'Network.responseReceived') {
    const req = requests.get(m.params.requestId);
    const { status, url } = m.params.response;
    if (req && status >= 400 && url.includes('127.0.0.1:54399')) failedRequests.push(`${status} ${req.method} ${url.replace('http://127.0.0.1:54399', '')}`.slice(0, 240));
  }
  if (m.method === 'Network.loadingFailed') {
    const req = requests.get(m.params.requestId);
    if (req && req.url.includes('127.0.0.1:54399') && !req.url.includes('/realtime/')) failedRequests.push(`FAILED ${req.method} ${req.url.replace('http://127.0.0.1:54399', '')} ${m.params.errorText}`.slice(0, 240));
  }
});
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return `EVAL-ERROR ${r.result.exceptionDetails.text}`;
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let shotIndex = 0;
const report = [];
const log = (line) => { console.log(line); report.push(line); };
const shot = async (name) => {
  const { result } = await send('Page.captureScreenshot', { format: 'png' });
  const file = `${String(++shotIndex).padStart(2, '0')}-${name}.png`;
  fs.writeFileSync(path.join(outDir, file), Buffer.from(result.data, 'base64'));
  log(`shot ${file}`);
};

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ---- DOM helpers (run inside the page) -------------------------------------------
const helpers = `
window.__e2e = {
  visible(el) { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth && s.visibility !== 'hidden' && s.display !== 'none'; },
  byText(text, exact = true) {
    const all = [...document.querySelectorAll('div, span, button, a')];
    const match = all.filter((el) => el.children.length === 0 && (exact ? el.textContent.trim() === text : el.textContent.trim().includes(text)) && this.visible(el));
    return match.at(-1) ?? null;
  },
  clickable(el) { let n = el; while (n && n !== document.body) { if (n.getAttribute('role') === 'button' || n.getAttribute('tabindex') === '0' || n.onclick || n.tagName === 'BUTTON' || n.tagName === 'A') return n; n = n.parentElement; } return el; },
  click(el) { const t = this.clickable(el); t.scrollIntoView({ block: 'center' }); ['mousedown','mouseup','click'].forEach((type) => t.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))); return true; },
  clickText(text, exact = true) { const el = this.byText(text, exact); if (!el) return false; return this.click(el); },
  byLabel(label) { const all = [...document.querySelectorAll('[aria-label="' + label.replace(/"/g, '\\\\"') + '"]')]; return all.find((e) => this.visible(e)) ?? null; },
  clickLabel(label) { const el = this.byLabel(label); if (!el) return false; if (el.tagName === 'INPUT') { el.click(); return true; } return this.click(el); },
  checked(label) { const el = this.byLabel(label); return el ? !!el.checked : null; },
  setValue(selector, value) { const el = document.querySelector(selector); if (!el) return false; el.focus(); const proto = Object.getPrototypeOf(el); const d = Object.getOwnPropertyDescriptor(proto, 'value'); d.set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; },
  typeByPlaceholder(ph, value) { return this.setValue('[placeholder="' + ph + '"]', value); },
  hasText(text) { return !!this.byText(text, false); },
  texts() { return [...document.querySelectorAll('div, span')].filter((el) => el.children.length === 0 && this.visible(el)).map((el) => el.textContent.trim()).filter(Boolean).slice(0, 80); },
  labels() { return [...document.querySelectorAll('[aria-label]')].filter((el) => this.visible(el)).map((el) => el.getAttribute('aria-label')).slice(0, 60); },
};
'ok'`;
const ensureHelpers = () => evaluate(helpers);
const waitFor = async (text, timeout = 8000, exact = false) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    await ensureHelpers();
    if (await evaluate(`__e2e.byText(${JSON.stringify(text)}, ${exact}) !== null`)) return true;
    await sleep(300);
  }
  return false;
};
const step = async (name, fn) => {
  try {
    const result = await fn();
    if (result === false) log(`GAP  ${name}`);
    else log(`ok   ${name}`);
    return result;
  } catch (err) {
    log(`ERR  ${name}: ${err.message}`);
    return false;
  }
};
const clickText = async (text, exact = true) => { await ensureHelpers(); return evaluate(`__e2e.clickText(${JSON.stringify(text)}, ${exact})`); };
const clickLabel = async (label) => { await ensureHelpers(); return evaluate(`__e2e.clickLabel(${JSON.stringify(label)})`); };
const type = async (placeholder, value) => { await ensureHelpers(); return evaluate(`__e2e.typeByPlaceholder(${JSON.stringify(placeholder)}, ${JSON.stringify(value)})`); };
const texts = async () => { await ensureHelpers(); return evaluate('JSON.stringify(__e2e.texts())'); };
const navigate = async (url, settle = 2500) => { await send('Page.navigate', { url: `${base}${url}` }); await sleep(settle); await ensureHelpers(); };

try {
  // ---- 1. Sign in --------------------------------------------------------------
  await navigate('/', 3500);
  await shot('auth-welcome');
  await step('welcome: Sign In', async () => (await waitFor('Get Started', 10000, true)) && clickText('Already have an account? Sign In'));
  await sleep(1200);
  if (!(await waitFor('Welcome Back', 3000))) {
    await step('fallback: reach login form', async () => (await clickText('Log In')) || (await clickText('Login')));
    await sleep(1000);
  }
  await shot('auth-login');
  await step('login: fill + submit', async () => {
    const a = await type('name@example.com', EMAIL);
    const b = await type('••••••••', PASSWORD);
    await sleep(200);
    return a && b && (await clickText('Login'));
  });
  await sleep(4000);
  await shot('after-login');

  // ---- 2. Onboarding --------------------------------------------------------------
  await step('onboarding: welcome page shown', () => waitFor('Welcome to EventMap', 10000));
  await step('onboarding: step hint present', () => evaluate(`__e2e.hasText('skip any step')`));
  await step("onboarding: Let's Get Started", () => clickText("Let's Get Started"));
  await sleep(900);
  await shot('onb-profile-empty');
  await step('profile: step label', () => evaluate(`__e2e.hasText('Step 1 of 6')`));
  await step('profile: no Skip for a first-time user', () => evaluate(`!__e2e.byLabel('Skip this step')`));
  await step('profile: name prefilled', () => evaluate(`!!document.querySelector('[placeholder="How should people call you?"]') && document.querySelector('[placeholder="How should people call you?"]').value.length > 0`));
  await step('edge: clearing the name disables Continue + shows inline error', async () => {
    await type('How should people call you?', '');
    await sleep(300);
    const disabled = await evaluate(`(() => { const b = __e2e.clickable(__e2e.byText('Continue')); return b && b.getAttribute('aria-disabled') === 'true'; })()`);
    const err = await evaluate(`__e2e.hasText('Your name is required')`);
    await type('How should people call you?', 'Demo Alex');
    return disabled && err;
  });
  await step('edge: bio is capped at 160 characters', async () => {
    await type('What should people know about you?', 'x'.repeat(200));
    await sleep(200);
    const len = await evaluate(`(document.querySelector('[placeholder="What should people know about you?"]') || {}).value.length`);
    return len === 160;
  });
  await step('profile: type bio + hobbies + socials', async () => {
    const a = await type('What should people know about you?', 'Coffee first, then live music. Say hi if you see me.');
    const b = await type('Live music, hiking, board games…', 'Jazz, trail runs');
    const c = await type('@yourhandle', '@demo.alex');
    return a && b && c;
  });
  await step('profile: bio counter updates', () => evaluate(`__e2e.hasText('/160')`));
  await shot('onb-profile-filled');
  await step('profile: Continue', () => clickText('Continue'));
  await sleep(1800);
  await shot('onb-interests');
  await step('interests: step label', () => evaluate(`__e2e.hasText('Step 2 of 6')`));
  await step('interests: Continue disabled before pick', () => evaluate(`__e2e.hasText('Pick at least one')`));
  await step('interests: pick two', async () => {
    const labels = await evaluate(`JSON.stringify([...document.querySelectorAll('[role="checkbox"]')].slice(0,2).map(e => e.getAttribute('aria-label')))`);
    const list = JSON.parse(labels || '[]');
    for (const l of list) await clickLabel(l);
    return list.length === 2;
  });
  await step('interests: count shows', () => evaluate(`__e2e.hasText('2 selected')`));
  await shot('onb-interests-picked');
  await step('interests: Continue', () => clickText('Continue'));
  await sleep(1800);
  await shot('onb-permissions');
  await step('permissions: step label', () => evaluate(`__e2e.hasText('Step 3 of 6')`));
  // Persistence: a reload mid-flow must land back on the same step with answers kept.
  await sleep(700); // let the debounced draft write flush
  await send('Page.reload'); await sleep(4500); await ensureHelpers();
  await shot('onb-resumed-after-reload');
  await step('resume: back on Step 3 after reload', () => waitFor('Step 3 of 6', 8000));
  await step('resume: go back to profile step keeps bio', async () => {
    await clickLabel('Go back'); await sleep(700); await clickLabel('Go back'); await sleep(700);
    const v = await evaluate(`(document.querySelector('[placeholder="What should people know about you?"]') || {}).value || ''`);
    return v.startsWith('Coffee first');
  });
  await step('resume: interests still selected', async () => {
    await clickText('Continue'); await sleep(1500);
    return evaluate(`__e2e.hasText('2 selected')`);
  });
  await step('resume: forward to permissions', async () => { await clickText('Continue'); await sleep(1500); return waitFor('Step 3 of 6', 5000); });
  await step('permissions: Skip pill present', () => clickLabel('Skip this step'));
  await sleep(900);
  await shot('onb-city');
  await step('city: step label', () => evaluate(`__e2e.hasText('Step 4 of 6')`));
  await step('city: Continue without', () => clickText('Continue without'));
  await sleep(1200);
  await shot('onb-privacy');
  await step('privacy: step label', () => evaluate(`__e2e.hasText('Step 5 of 6')`));
  await step('privacy: preview shows bio typed earlier', () => evaluate(`__e2e.hasText('Coffee first')`));
  await step('privacy: toggle profile hidden', async () => { await clickLabel('Show my profile to others'); await sleep(400); return (await evaluate(`__e2e.checked('Show my profile to others')`)) === false; });
  await step('privacy: preview flips to hidden state', () => evaluate(`__e2e.hasText('Hidden from other attendees') && __e2e.hasText('Not applicable while your profile is hidden')`));
  await shot('onb-privacy-hidden');
  await step('privacy: toggle profile visible again', async () => { await clickLabel('Show my profile to others'); await sleep(400); return (await evaluate(`__e2e.checked('Show my profile to others')`)) === true; });
  await step('privacy: Continue', () => clickText('Continue'));
  await sleep(1800);
  await shot('onb-finish');
  await step('finish: step label', () => evaluate(`__e2e.hasText('Step 6 of 6')`));
  await step('finish: Start Exploring', () => clickText('Start Exploring'));
  await sleep(4500);
  await shot('discover-after-onboarding');
  await step('landed on Discover', () => evaluate(`location.pathname.includes('discover') || __e2e.hasText('Discover')`));

  // ---- 3. Profile tab -------------------------------------------------------------
  await navigate('/profile', 4000);
  await shot('profile-tab');
  await step('profile tab: name + bio shown', () => evaluate(`__e2e.hasText('Coffee first')`));
  await step('profile tab: stat cards', () => evaluate(`__e2e.hasText('Upcoming') && __e2e.hasText('Attended') && __e2e.hasText('Saved')`));
  await step('profile tab: counts loaded (no dashes)', async () => {
    const t = JSON.parse(await texts());
    return !t.includes('–');
  });
  await step('profile tab: Events Joined has View All', () => evaluate(`__e2e.hasText('View All')`));
  await step('profile tab: quick links', () => evaluate(`!!document.querySelector('[aria-label="Following"]') && !!document.querySelector('[aria-label="Saved"]')`));
  log(`texts: ${await texts()}`);

  // ---- 4. Joined events ------------------------------------------------------------
  await step('open joined events via View All', () => clickText('View All'));
  await sleep(2500);
  await shot('joined-going');
  await step('joined: Going tab lists live event', () => evaluate(`__e2e.hasText('Live Jazz Right Now') && __e2e.hasText('LIVE')`));
  await step('joined: switch Interested', () => clickText('Interested'));
  await sleep(1800);
  await shot('joined-interested');
  await step('joined: interested lists Coffee and Conversation', () => evaluate(`__e2e.hasText('Coffee and Conversation')`));
  await step('joined: switch Attended', () => clickText('Attended'));
  await sleep(1800);
  await shot('joined-attended');
  await step('joined: attended lists Past Poetry Night', () => evaluate(`__e2e.hasText('Past Poetry Night')`));

  // ---- 5. Event detail: ended, live, upcoming --------------------------------------
  await navigate('/event/3e000000-0000-4000-8000-000000000001', 4500);
  await shot('event-past-attended');
  await step('past event: You attended + ended notice', () => evaluate(`__e2e.hasText('You attended') && __e2e.hasText('attendance history')`));
  await step('past event: time row is a range', () => evaluate(`__e2e.texts().some(t => t.includes(' – ') && /[AP]M/.test(t))`));
  await navigate('/event/3e000000-0000-4000-8000-000000000003', 4500);
  await shot('event-ended-not-joined');
  await step('ended event: Event ended + no RSVP row', () => evaluate(`__e2e.hasText('Event ended') && !__e2e.hasText('Interested')`));
  await navigate('/event/30000000-0000-4000-8000-000000000003', 4500);
  await shot('event-upcoming-interested');
  await step('upcoming: Join Event CTA visible', () => evaluate(`__e2e.hasText('Join Event')`));
  await step('upcoming: bookmark button present', () => evaluate(`!!document.querySelector('[aria-label="Save event"]') || !!document.querySelector('[aria-label="Remove from saved events"]')`));
  await step('upcoming: interested shown as filled star + hint', () => evaluate(`!!document.querySelector('[aria-label="Remove interest"]') && __e2e.hasText('Marked as interested')`));
  await step('upcoming: old RSVP row is gone', () => evaluate(`!__e2e.byText('Going', true) && !__e2e.byText('Remove', true)`));
  await step('upcoming: Join', () => clickText('Join Event'));
  await sleep(2500);
  await shot('event-joined');
  await step('upcoming: Event Joined state + Leave control', () => evaluate(`__e2e.hasText('Event Joined') && !!document.querySelector('[aria-label="Leave event"]')`));
  await step('upcoming: attendees row shows count', () => evaluate(`__e2e.hasText('going')`));
  await step('upcoming: open attendees sheet', () => clickText("tap to see who", false));
  await sleep(1500);
  await shot('attendees-sheet');
  await step('attendees sheet: lists Demo Alex', () => evaluate(`__e2e.hasText("Who's Going") && __e2e.hasText('Demo Alex')`));
  await step('attendees sheet: paginated (46 going, Show more visible)', async () => (await waitFor('46 going', 5000)) && evaluate(`!!__e2e.byLabel('Load more attendees')`));
  await step('attendees sheet: load more appends the rest', async () => {
    await clickLabel('Load more attendees');
    const started = Date.now();
    while (Date.now() - started < 8000) {
      if (await evaluate(`!__e2e.byLabel('Load more attendees') && [...document.querySelectorAll('[aria-label="Anonymous attendee"]')].length >= 6`)) return true;
      await sleep(400);
    }
    return false;
  });
  await step('attendees sheet: search filters server-side', async () => {
    await evaluate(`__e2e.setValue('[aria-label="Search attendees by name"]', 'bulk user 1')`); await sleep(1200);
    return evaluate(`__e2e.hasText('11 matches') && !__e2e.hasText('Demo Alex')`);
  });
  await step('attendees sheet: no-match state', async () => {
    await evaluate(`__e2e.setValue('[aria-label="Search attendees by name"]', 'zzzz')`); await sleep(1200);
    return evaluate(`__e2e.hasText('No attendees match')`);
  });
  await step('attendees sheet: clear search restores list', async () => {
    await clickLabel('Clear search'); await sleep(1200);
    return evaluate(`__e2e.hasText('46 going')`);
  });
  await evaluate(`(() => { const el = document.querySelector('[aria-label="Search attendees by name"]'); if (el) el.blur(); return 1; })()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(600);
  await navigate('/event/30000000-0000-4000-8000-000000000003', 4000);
  await step('upcoming: save event', () => clickLabel('Save event'));
  await sleep(1500);
  await step('upcoming: saved state', () => evaluate(`!!document.querySelector('[aria-label="Remove from saved events"]')`));

  // ---- 5b. RSVP transitions ---------------------------------------------------------
  await step('transition: Leave drops the going RSVP', async () => { await clickLabel('Leave event'); await sleep(2000); return evaluate(`__e2e.hasText('Join Event') && !!__e2e.byLabel('Mark as interested')`); });
  await step('transition: star marks interested again', async () => { await clickLabel('Mark as interested'); await sleep(1800); return evaluate(`!!__e2e.byLabel('Remove interest')`); });
  await step('transition: join from interested', async () => { await clickText('Join Event'); await sleep(2000); return evaluate(`__e2e.hasText('Event Joined')`); });
  await navigate('/joined-events?tab=interested', 3500);
  await shot('transition-interested-tab');
  await step('transition: deep link opens Interested tab, now empty', () => waitFor('No interested events', 6000));

  // ---- 6. Saved events + profile counts refresh --------------------------------------
  await navigate('/saved-events', 3500);
  await shot('saved-events');
  await step('saved: lists both saves', () => evaluate(`__e2e.hasText('Coffee and Conversation') && __e2e.hasText('Weekend Run Club')`));
  await navigate('/profile', 4000);
  await shot('profile-after-actions');
  await step('profile: counts after actions', async () => { log(`texts: ${await texts()}`); return true; });

  // ---- 7. Public profile + settings redo --------------------------------------------
  await navigate('/user/10000000-0000-4000-8000-000000000003', 3500);
  await shot('public-profile-sam');
  await step('public profile loads via RPC', () => evaluate(`__e2e.hasText('Demo Sam')`));
  await navigate('/settings', 3500);
  await step('settings: Redo setup row', () => evaluate(`!!document.querySelector('[aria-label="Redo setup"]')`));
  await evaluate(`window.scrollTo(0, document.body.scrollHeight); [...document.querySelectorAll('[aria-label="Redo setup"]')].forEach(e => e.scrollIntoView({block:'center'}))`);
  await sleep(500);
  await shot('settings-redo-row');

  // ---- 7b. Settings: toggles persist across reload -----------------------------------
  await step('settings: interested nudge toggle off persists', async () => {
    await evaluate(`[...document.querySelectorAll('[aria-label]')].forEach(() => 0)`);
    const before = await evaluate(`__e2e.checked('Interested nudge') ?? (() => { const el = [...document.querySelectorAll('input[type=checkbox]')].find((c) => c.closest('div')?.textContent?.includes('Interested nudge')); return el ? el.checked : null; })()`);
    const clicked = await evaluate(`(() => { const label = __e2e.byText('Interested nudge'); if (!label) return false; let n = label; for (let i = 0; i < 6 && n; i++) { const cb = n.querySelector && n.querySelector('input[type=checkbox]'); if (cb) { cb.click(); return true; } n = n.parentElement; } return false; })()`);
    await sleep(1500);
    await send('Page.reload'); await sleep(4000); await ensureHelpers();
    const after = await evaluate(`(() => { const label = __e2e.byText('Interested nudge'); if (!label) return null; let n = label; for (let i = 0; i < 6 && n; i++) { const cb = n.querySelector && n.querySelector('input[type=checkbox]'); if (cb) return cb.checked; n = n.parentElement; } return null; })()`);
    log(`   nudge toggle before=${before} clicked=${clicked} after=${after}`);
    return clicked && after === false;
  });
  await step('settings: nudge preference stored in profile', () => scratchSql("SELECT notification_preferences->>'interested_reminder' FROM profiles WHERE id='10000000-0000-4000-8000-000000000002'") === 'false');

  // ---- 7c. Visual edge cases: very long name + max bio, empty state, private profile ----
  scratchSql("UPDATE profiles SET name = 'Maximiliano Alexander Bartholomew-Fitzgerald III', bio = repeat('Long bio text to check wrapping and spacing on the profile header. ', 2) WHERE id = '10000000-0000-4000-8000-000000000002'");
  await navigate('/profile', 4000);
  await shot('edge-long-name-bio');
  await step('edge: long name/bio render without crashing', () => evaluate(`__e2e.hasText('Maximiliano')`));
  scratchSql("UPDATE profiles SET name = 'Demo Alex', bio = 'Coffee first, then live music. Say hi if you see me.' WHERE id = '10000000-0000-4000-8000-000000000002'");
  scratchSql("UPDATE profiles SET is_profile_private = true WHERE id = '10000000-0000-4000-8000-000000000003'");
  await navigate('/user/10000000-0000-4000-8000-000000000003', 3500);
  await shot('edge-private-profile');
  await step('edge: private profile shows the private state', () => evaluate(`__e2e.hasText('Private Profile') && !__e2e.hasText('Synthetic demo account')`));
  scratchSql("UPDATE profiles SET is_profile_private = false WHERE id = '10000000-0000-4000-8000-000000000003'");
  await navigate('/user/00000000-0000-4000-8000-00000000dead', 3500);
  await step('edge: unknown user shows not-found', () => evaluate(`__e2e.hasText('Profile not found')`));

  // ---- 8. Lockdown ripple checks: chat sender names, following list ---------------
  await navigate('/event-chat/30000000-0000-4000-8000-000000000001', 5000);
  await shot('event-chat');
  await step('chat: sender names resolve through the display RPC', () => evaluate(`__e2e.hasText('Demo Sam') || __e2e.hasText('See you there')`));
  await navigate('/following', 3500);
  await shot('following');
  await step('following screen renders', () => evaluate(`__e2e.hasText('Following') || __e2e.hasText('Not following')`));

  // ---- 9. Redo setup: onboarding prefills from the saved profile -------------------
  await navigate('/settings', 3500);
  await step('redo: tap Redo setup (web confirm accepted)', async () => (await clickLabel('Redo setup')) && (await sleep(4500), dialogs.some((d) => d.includes('Redo setup'))));
  await step('redo: onboarding shown again', async () => (await waitFor('Welcome to EventMap', 8000)) || (await navigate('/', 4500), waitFor('Welcome to EventMap', 8000)));
  await step("redo: Let's Get Started", () => clickText("Let's Get Started"));
  await sleep(900);
  await shot('onb-redo-prefilled');
  await step('redo: bio + socials prefilled from server', async () => {
    const bio = await evaluate(`(document.querySelector('[placeholder="What should people know about you?"]') || {}).value || ''`);
    const ig = await evaluate(`(document.querySelector('[placeholder="@yourhandle"]') || {}).value || ''`);
    return bio.startsWith('Coffee first') && ig === 'demo.alex';
  });
  await step('redo: Skip is offered because a bio exists', () => evaluate(`!!__e2e.byLabel('Skip this step')`));
  scratchSql("UPDATE profiles SET has_completed_onboarding = true WHERE id = '10000000-0000-4000-8000-000000000002'");

  // ---- 10. Empty state as a different user -----------------------------------------
  scratchSql("DELETE FROM rsvps WHERE user_id = '10000000-0000-4000-8000-000000000003'; DELETE FROM saves WHERE user_id = '10000000-0000-4000-8000-000000000003'");
  await evaluate(`Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k)); 'ok'`);
  await navigate('/', 3500);
  await step('empty: sign in as sam', async () => {
    await clickText('Already have an account? Sign In'); await sleep(1200);
    const a = await type('name@example.com', 'sam@example.test');
    const b = await type('••••••••', PASSWORD);
    return a && b && (await clickText('Login'));
  });
  await sleep(4500);
  await navigate('/profile', 4000);
  await shot('empty-profile-sam');
  await step('empty: zero counts and empty-state card', () => evaluate(`__e2e.hasText('No events joined yet') && __e2e.texts().filter((t) => t === '0').length >= 3`));
  await navigate('/joined-events', 3500);
  await shot('empty-joined');
  await step('empty: joined screen empty state', () => evaluate(`__e2e.hasText('Nothing coming up')`));
  await navigate('/saved-events', 3500);
  await step('empty: saved screen empty state', () => evaluate(`__e2e.hasText('No Saved Events')`));
} finally {
  const summary = {
    consoleErrors: [...new Set(consoleErrors)].slice(0, 40),
    dialogs,
    failedRequests: [...new Set(failedRequests)].slice(0, 40),
    steps: report,
  };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(summary, null, 2));
  console.log('\n== console errors ==\n' + summary.consoleErrors.join('\n'));
  console.log('\n== failed requests ==\n' + summary.failedRequests.join('\n'));
  ws.close(); chrome.kill(); server.close();
  await sleep(800);
  try { fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* chrome may still be flushing */ }
  process.exit(0);
}
