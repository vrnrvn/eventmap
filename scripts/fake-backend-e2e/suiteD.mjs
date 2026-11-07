import { open, check, results, sleep } from './lib.mjs';
const [repo, dist] = process.argv.slice(2);
const P = { repo, dist };

{ // D1 offline mid-session → recover
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
{ // D2 expired token, backend reachable: refresh once, stay signed in
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
console.log(`\nSUITE D: ${results.filter((r) => r.ok).length}/${results.length} passed`);
process.exit(0);
