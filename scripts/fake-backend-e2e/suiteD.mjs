import { open, check, results, sleep, UID } from './lib.mjs';
const [repo, dist, only] = process.argv.slice(2);
const P = { repo, dist };
const run = (k) => !only || only.split(',').includes(k);

if (run('D1')) { // D1 offline mid-session → recover
  const h = await open(P);
  await h.go('/', 10000);
  h.ctl.offline = true;
  await h.go('/profile', 0); await sleep(1500); // client stays; requests now refused
  await h.click('Saved', true); await sleep(2000); await h.history('history.back()', 2000);
  await sleep(8000);
  const tOff = await h.text();
  check('D1 offline: profile still shown from memory/cache', tOff.includes('Test User'));
  const before = h.requests.length;
  h.ctl.offline = false;
  await h.eval(`window.dispatchEvent(new Event('online'))`);
  await h.click('Saved', true); await sleep(2500); await h.history('history.back()', 6000);
  const burst = h.requests.slice(before).filter((r) => !r.path.startsWith('/storage'));
  const byPath = {}; for (const r of burst) byPath[r.path.replace('/rest/v1/', '')] = (byPath[r.path.replace('/rest/v1/', '')] || 0) + 1;
  check('D1 recovery burst bounded (no request > 3x)', Object.values(byPath).every((n) => n <= 3), JSON.stringify(byPath));
  check('D1 recovered: content online again', (await h.text()).includes('Test User'));
  check('D1 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}
if (run('D2')) { // D2 expired token, backend reachable: refresh once, stay signed in
  const h = await open({ ...P, expOffsetS: -600 });
  await h.go('/', 12000);
  const t = await h.text();
  check('D2 expired token refreshed and signed in', t.includes('Discover') && !t.includes('Get Started'));
  check('D2 exactly one token refresh', (h.data.refreshes || 0) === 1, `${h.data.refreshes || 0} refreshes`);
  check('D2 startup fetches not duplicated by the refresh (profile ≤ 2)', h.count('GET profiles') <= 2 && h.count('POST rpc/get_user_business') <= 2,
    `profiles ${h.count('GET profiles')}, business ${h.count('POST rpc/get_user_business')}`);
  check('D2 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}
// D3 / D4 share a device that has used the app online before (snapshots and
// cache present), as any real device would.
// auth-js console.error()s its own refresh failures; our startup code warns about the verdict. Neither is an app error.
const authNoise = (l) => /AuthApiError|AuthRetryableFetchError|Stored session rejected|Session refresh inconclusive|Unable to verify session/.test(l);
const queueKey = `eventmap.pendingWrites.${UID}`;
const queued = JSON.stringify([{ kind: 'save', targetId: '00000000-0000-4000-8000-000000000001', on: true, queuedAt: Date.now(), attempts: 0 }]);
let device;
if (['D3', 'D4', 'D6'].some(run)) {
  const h = await open(P);
  await h.go('/', 10000);
  device = await h.storage();
  delete device['sb-127-auth-token']; // seeded fresh (expired) by each scenario below
  await h.close();
}
if (run('D3')) { // D3 expired token, auth server answers 500 on refresh: NOT a sign-out. Stay signed in on the stored session, keep queued writes.
  const h = await open({ ...P, expOffsetS: -600, seedExtra: { ...device, [queueKey]: queued },
    overrides: { '/auth/v1/token': () => ({ status: 500, json: { message: 'dial tcp 10.0.0.1:5432: connection refused' } }) } });
  await h.go('/', 14000);
  const t = await h.text();
  check('D3 500 on refresh: still signed in (tabs, not welcome)', t.includes('Discover') && !t.includes('Get Started') && !t.includes("Couldn't load your profile"), t.slice(0, 80).replace(/\n/g, ' '));
  const st = await h.storage();
  check('D3 500 on refresh: queued writes survive', typeof st[queueKey] === 'string' && st[queueKey].includes('"kind":"save"'), st[queueKey] ? 'present' : 'MISSING');
  check('D3 refresh retried with the launch tokens (≥ 2 token calls)', h.count((r) => r.path.startsWith('/auth/v1/token')) >= 2, `${h.count((r) => r.path.startsWith('/auth/v1/token'))} token calls`);
  check('D3 queued write not sent with an unverified session', h.count((r) => r.path.includes('saved_events') && r.method === 'POST') === 0);
  const errs = h.errors().filter((l) => !authNoise(l));
  check('D3 no runtime errors', errs.length === 0, errs.slice(0, 2).join(' || '));
  await h.close();
}
if (run('D4')) { // D4 expired token, auth server rejects the refresh token: a real sign-out, device snapshots for that user removed.
  const h = await open({ ...P, expOffsetS: -600, seedExtra: { ...device, [queueKey]: queued },
    overrides: { '/auth/v1/token': () => ({ status: 400, json: { code: 'refresh_token_not_found', error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' } }) } });
  await h.go('/', 14000);
  const t = await h.text();
  check('D4 rejected refresh: signed out (welcome shown)', t.includes('Get Started'), t.slice(0, 80).replace(/\n/g, ' '));
  const st = await h.storage();
  check('D4 rejected refresh: queued writes for that user cleared', st[queueKey] === undefined, st[queueKey] ? 'still present' : 'cleared');
  check('D4 rejected refresh: query cache for that user cleared', st[`eventmap.queryCache.${UID}`] === undefined);
  const errs = h.errors().filter((l) => !authNoise(l));
  check('D4 no runtime errors', errs.length === 0, errs.slice(0, 2).join(' || '));
  await h.close();
}
if (run('D5')) { // D5 writes that failed on a weak (degraded, not offline) connection replay as soon as a request succeeds again — no app foreground, no 'online' event
  const h = await open({ ...P, dataOpts: { events: 40 } });
  await h.go('/saved-events', 8000);
  const isDelete = (r) => r.method === 'DELETE' && r.path.endsWith('/saves');
  h.ctl.offline = true; // every request refused; the browser still reports online → 'degraded' after 2 failures, never 'offline'
  check('D5 first remove tapped', (await h.click('from saved events')) === 'ok'); await sleep(1500);
  check('D5 second remove tapped', (await h.click('from saved events')) === 'ok'); await sleep(2500);
  check('D5 failed writes were queued (sync toast)', (await h.text()).includes("sync when you're back online"));
  check('D5 two refused attempts, nothing landed', h.count(isDelete) === 2, `${h.count(isDelete)} attempts`);
  check('D5 weak-connection banner shown (degraded)', (await h.text()).includes('Weak connection'));
  h.ctl.offline = false; // nothing else changes: the next successful request flips degraded → online
  const before = h.requests.length;
  check('D5 open an event (always fetches details)', (await h.click('Jazz night #7')) === 'ok'); await sleep(6000);
  const succeeded = h.requests.slice(before).filter((r) => !r.path.startsWith('/storage') && !isDelete(r)).length;
  check('D5 a request succeeded after the connection recovered', succeeded > 0, `${succeeded} requests`);
  check('D5 both queued unsaves replayed on degraded → online', h.count(isDelete) === 4, `${h.count(isDelete)} attempts (2 refused + 2 replayed expected)`);
  check('D5 banner gone', !(await h.text()).includes('Weak connection'));
  check('D5 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}
if (run('D6')) { // expired token, auth server 503 (retryable): auth-js backs off for ~25 s and then has no session; meanwhile NO data request may go out with the anon key (it would read empty under RLS and overwrite the cache)
  const h = await open({ ...P, expOffsetS: -600, seedExtra: device, overrides: { '/auth/v1/token': () => ({ status: 503, json: { message: 'unavailable' } }) } });
  await h.go('/', 8000);
  await h.click('Profile', true); await sleep(2500);
  await h.click('Saved', true); await sleep(22000); // past auth-js's backoff window
  const bearerOf = (r) => ((r.headers.Authorization || r.headers.authorization || '').split(/\s+/)[1] || '');
  const rest = h.requests.filter((r) => r.path.startsWith('/rest/v1/'));
  const anon = rest.filter((r) => bearerOf(r) === (r.headers.apikey || r.headers.Apikey));
  check('D6 no REST request carried the anon key while signed in', anon.length === 0, anon.slice(0, 3).map((r) => r.path).join(', '));
  check('D6 still signed in on cached data (no welcome, no "All caught up")', !(await h.text()).includes('Get Started'));
  const errs = h.errors().filter((l) => !authNoise(l));
  check('D6 no runtime errors', errs.length === 0, errs.slice(0, 2).join(' || '));
  await h.close();
}
console.log(`\nSUITE D: ${results.filter((r) => r.ok).length}/${results.length} passed`);
process.exit(0);
