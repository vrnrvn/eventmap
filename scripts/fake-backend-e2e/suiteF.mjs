import { open, check, results, sleep, UID } from './lib.mjs';
const [repo, dist, only] = process.argv.slice(2);
const P = { repo, dist };
const run = (k) => !only || only.split(',').includes(k);
const UID2 = '22222222-2222-4222-8222-222222222222';
const queueKey = `eventmap.pendingWrites.${UID}`;
const keysFor = (st, id) => Object.keys(st).filter((k) => k.includes(id));
// Click the LAST matching button (a confirm dialog's button after the row that opened it).
const clickLast = (h, re) => h.eval(`(() => { const els = [...document.querySelectorAll('[role=button],button')].filter((e) => ${re}.test((e.getAttribute('aria-label') || e.innerText || '').trim()));
  const el = els.at(-1); if (!el) return 'NOT FOUND'; el.click(); return 'ok'; })()`);

// F0: a device that has used the app online (cache + snapshots), as any real device would.
let device;
{
  const h = await open(P);
  await h.go('/', 9000);
  await h.click('Profile', true); await sleep(2500);
  await h.click('Saved', true); await sleep(3000);
  device = await h.storage();
  delete device['sb-127-auth-token']; // each scenario seeds its own token
  await h.close();
}

if (run('F1')) { // the offline day: expired token, nothing reachable → every cached screen usable, a write queued, restart offline, reconnect sends it exactly once
  const h = await open({ ...P, seedExtra: device, expOffsetS: -600, offline: true });
  await h.go('/', 12000);
  check('F1 offline start on an expired token: signed in', !(await h.text()).includes('Get Started'));
  await h.click('Profile', true); await sleep(2500);
  check('F1 profile from cache', (await h.text()).includes('Test User'));
  check('F1 saved opens', (await h.click('Saved', true)) === 'ok'); await sleep(2500);
  check('F1 saved rows from cache', /Jazz night|Yoga in the park/.test(await h.text()));
  check('F1 remove tapped offline', (await h.click('from saved events')) === 'ok'); await sleep(2000);
  check('F1 queued with the sync notice', (await h.text()).includes("sync when you're back online"));
  const st1 = await h.storage();
  check('F1 queue persisted on the device', typeof st1[queueKey] === 'string' && st1[queueKey].includes('"on":false'), st1[queueKey] ? 'present' : 'MISSING');
  // Restart while still offline.
  await h.go('/saved-events', 9000);
  const st2 = await h.storage();
  check('F1 restart offline: still signed in', !(await h.text()).includes('Get Started'));
  check('F1 restart offline: queue still there', typeof st2[queueKey] === 'string');
  // Reconnect: nothing but requests succeeding again.
  const isDelete = (r) => r.method === 'DELETE' && r.path.endsWith('/saves');
  const refused = h.count(isDelete);
  h.ctl.offline = false;
  check('F1 open an event (a request goes out)', (await h.click('Jazz night #7')) === 'ok'); await sleep(8000);
  check('F1 reconnect: queued unsave sent exactly once', h.count(isDelete) === refused + 1, `${h.count(isDelete) - refused} sent, ${refused} refused earlier`);
  const st3 = await h.storage();
  check('F1 queue cleared after the sync', st3[queueKey] === undefined);
  check('F1 token refreshed after reconnect', h.count((r) => r.path.startsWith('/auth/v1/token')) >= 1);
  check('F1 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('F2')) { // sign-out removes every key for the user
  const h = await open({ ...P, seedExtra: { ...device, [queueKey]: '[]' } });
  await h.go('/settings', 8000);
  check('F2 sign-out row', (await clickLast(h, '/^sign out$/i')) === 'ok'); await sleep(1200);
  check('F2 confirm sign-out', (await clickLast(h, '/^sign out$/i')) === 'ok'); await sleep(4000);
  check('F2 welcome shown', (await h.text()).includes('Get Started'));
  const st = await h.storage();
  check('F2 no device key left for the user', keysFor(st, UID).length === 0, keysFor(st, UID).join(', '));
  check('F2 supabase session removed', st['sb-127-auth-token'] === undefined);
  check('F2 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('F3')) { // a second user on the same device never sends the first user's token and gets their own cache key
  const { session } = await import('./seed.mjs');
  const s1 = session(3600);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const jwt2 = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID2, role: 'authenticated', exp, aud: 'authenticated' })}.sig`;
  const s2 = { ...s1, access_token: jwt2, refresh_token: 'r-u2', user: { ...s1.user, id: UID2, email: 'second@example.test' } };
  const h = await open({ ...P, seedExtra: { ...device, 'sb-127-auth-token': JSON.stringify(s2) } });
  await h.go('/', 9000);
  await h.click('Profile', true); await sleep(3000);
  const sub = (r) => { try { const tok = (r.headers.Authorization || r.headers.authorization || '').split(/\s+/)[1]; return JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).sub; } catch { return null; } };
  const rest = h.requests.filter((r) => r.path.startsWith('/rest/v1/'));
  check('F3 REST requests were made', rest.length > 0, `${rest.length}`);
  check('F3 no request used the first user\'s token', rest.every((r) => sub(r) !== UID), rest.filter((r) => sub(r) === UID).map((r) => r.path).slice(0, 3).join(', '));
  const st = await h.storage();
  check('F3 second user has their own cache key', typeof st[`eventmap.queryCache.${UID2}`] === 'string');
  check('F3 first user\'s queue key untouched (private, not loaded)', st[queueKey] === device[queueKey]);
  check('F3 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

console.log(`\nSUITE F: ${results.filter((r) => r.ok).length}/${results.length} passed`);
process.exit(0);
