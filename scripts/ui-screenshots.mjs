// Visual check for the event chat (web build) and the admin chat-moderation page.
//
// Prereqs: local Supabase running (npm run backend:start), a web export built with
// dotenv enabled (env -u EXPO_NO_DOTENV npx expo export --platform web --output-dir /tmp/eventmap-web-export),
// and the admin dev server on :3100 (cd admin && npx next dev -p 3100). Uses headless Google Chrome.
//
//   node scripts/ui-screenshots.mjs /tmp/eventmap-web-export /tmp/eventmap-shots
//
// Creates a few temporary chat messages/reports via the seeded demo accounts and removes them afterwards.
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';

const [exportDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const status = JSON.parse(execFileSync('node_modules/.bin/supabase', ['status', '-o', 'json'], { encoding: 'utf8' }));
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let file = path.join(exportDir, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(exportDir, 'index.html');
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(8089, r));
const base = 'http://localhost:8089';
const mk = () => createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const alex = mk(), sam = mk(), host = mk();
const alexSession = (await alex.auth.signInWithPassword({ email: 'alex@example.test', password: 'LocalDemo123!' })).data.session;
await sam.auth.signInWithPassword({ email: 'sam@example.test', password: 'LocalDemo123!' });
await host.auth.signInWithPassword({ email: 'host@example.test', password: 'LocalDemo123!' });
const serviceRole = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const samId = (await sam.auth.getUser()).data.user.id, alexId = (await alex.auth.getUser()).data.user.id;
const eventId = '30000000-0000-4000-8000-000000000001';
const storageKey = alex.auth.storageKey;

// Temporary data
const tmpIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
await sam.from('event_chat_messages').insert({ id: tmpIds[0], event_id: eventId, sender_id: samId, body: 'Anyone want to grab coffee before? ☕ Here is the map: https://maps.example.com/venue' });
await sam.from('event_chat_messages').insert({ id: tmpIds[1], event_id: eventId, sender_id: samId, body: '@Demo Alex are you bringing the prints?', mentions: [alexId] });
await sam.from('event_chat_messages').insert({ id: tmpIds[2], event_id: eventId, sender_id: samId, body: 'this one gets removed' });
await host.rpc('delete_event_chat_message', { p_message_id: tmpIds[2] });
await alex.from('complaints').insert({ reporter_id: alexId, target_type: 'chat_message', target_id: tmpIds[0], reason: 'Spam or scam' });

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9333', '--no-first-run', '--user-data-dir=/tmp/eventmap-chrome-profile2', '--window-size=390,844', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));
const page = (await (await fetch('http://127.0.0.1:9333/json')).json()).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => ws.on('open', r));
let seq = 0; const pending = new Map();
ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { const { result } = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(result.data, 'base64')); console.log('saved', name); };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
const longPress = (sel) => evaluate(`(async () => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'missing'; const r = el.getBoundingClientRect(); const t = new Touch({identifier:1,target:el,clientX:r.x+20,clientY:r.y+10}); el.dispatchEvent(new TouchEvent('touchstart',{touches:[t],targetTouches:[t],changedTouches:[t],bubbles:true})); await new Promise(r=>setTimeout(r,650)); el.dispatchEvent(new TouchEvent('touchend',{changedTouches:[t],bubbles:true})); return 'ok'; })()`);

try {
  await send('Page.navigate', { url: `${base}/` }); await sleep(1500);
  await evaluate(`localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(JSON.stringify(alexSession))}); 'ok'`);
  await send('Page.navigate', { url: `${base}/event-chat/${eventId}` }); await sleep(4500);
  await shot('scenario-attendee-rich');
  // Mention strip
  await evaluate(`(() => { const el = document.querySelector('[aria-label="Message input"]'); el.focus(); const proto = Object.getPrototypeOf(el); Object.getOwnPropertyDescriptor(proto,'value').set.call(el, 'Hey @'); el.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`);
  await sleep(800); await shot('scenario-mention-strip');
  await evaluate(`(() => { const el = document.querySelector('[aria-label="Message input"]'); const proto = Object.getPrototypeOf(el); Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ''); el.dispatchEvent(new Event('input',{bubbles:true})); el.blur(); return 'ok'; })()`);
  // Report sheet on Sam's message
  console.log('longpress:', await longPress(`[aria-label="Demo Sam's message, long press for options"]`)); await sleep(700); await shot('scenario-actions-other');
  await evaluate(`(() => { const b = document.querySelector('[aria-label="Report message"]'); if (b) b.click(); return !!b; })()`); await sleep(500); await shot('scenario-report-reasons');
  // Deep link highlight
  await send('Page.navigate', { url: `${base}/event-chat/${eventId}?messageId=${tmpIds[1]}` }); await sleep(2600); await shot('scenario-deeplink');
} finally {
  ws.close(); chrome.kill(); server.close();
}

// Admin with a pending report
const chrome2 = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9334', '--no-first-run', '--user-data-dir=/tmp/eventmap-chrome-admin2', '--window-size=1280,900', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));
const p2 = (await (await fetch('http://127.0.0.1:9334/json')).json()).find((t) => t.type === 'page');
const ws2 = new WebSocket(p2.webSocketDebuggerUrl); await new Promise((r) => ws2.on('open', r));
const pend2 = new Map(); let seq2 = 0;
ws2.on('message', (raw) => { const m = JSON.parse(raw); if (m.id && pend2.has(m.id)) { pend2.get(m.id)(m); pend2.delete(m.id); } });
const send2 = (method, params = {}) => new Promise((res) => { const id = ++seq2; pend2.set(id, res); ws2.send(JSON.stringify({ id, method, params })); });
const eval2 = async (expression) => (await send2('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot2 = async (name) => { const { result } = await send2('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(result.data, 'base64')); console.log('saved', name); };
try {
  await send2('Page.enable'); await send2('Runtime.enable');
  await send2('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send2('Page.navigate', { url: 'http://localhost:3100/login' }); await sleep(4000);
  const setValue = (sel, v) => `(() => { const el = document.querySelector('${sel}'); const proto = Object.getPrototypeOf(el); Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); return !!el; })()`;
  await eval2(setValue('input[type="email"]', 'host@example.test')); await eval2(setValue('input[type="password"]', 'LocalDemo123!'));
  await eval2(`document.querySelector('button[type="submit"]').click(); 'clicked'`); await sleep(5000);
  await send2('Page.navigate', { url: 'http://localhost:3100/chat-moderation' }); await sleep(5000);
  await shot2('scenario-admin-queue');
  await eval2(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Details'); if (b) b.click(); return !!b; })()`);
  await sleep(2500); await shot2('scenario-admin-details');
} finally {
  ws2.close(); chrome2.kill();
  // Cleanup temp data (hard delete cascades reports via trigger; restore not needed)
  await serviceRole.from('event_chat_messages').delete().in('id', tmpIds);
  await serviceRole.from('event_chat_moderation_actions').delete().in('message_id', tmpIds);
  await serviceRole.from('notifications').delete().eq('event_id', eventId).in('type', ['chat_message', 'chat_mention']).gt('created_at', new Date(Date.now() - 600000).toISOString());
  console.log('cleanup done');
  process.exit(0);
}
