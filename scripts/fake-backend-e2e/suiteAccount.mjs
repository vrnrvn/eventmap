// Flow 8 — account management: notification preferences, blocked users and
// deleting the account. Sign-out data clearing is covered by suite B9 / F2.
//
//   node scripts/fake-backend-e2e/suiteAccount.mjs <repo> <dist> [C1..C3|all] [outDir]
import fs from 'node:fs';
import { open, check, results, sleep } from './lib.mjs';

const [repo, dist, only = 'all', outDir = '/tmp/eventmap-account'] = process.argv.slice(2);
const run = (k) => only === 'all' || only.split(',').includes(k);
fs.mkdirSync(outDir, { recursive: true });
const P = { repo, dist };

if (run('C1')) {
  const h = await open({ ...P });
  await h.go('/settings', 9000);
  const t = await h.text();
  check('C1 settings lists the notification preferences', /notification/i.test(t), t.match(/[^\n]*notification[^\n]*/i)?.[0] ?? t.slice(0, 160));
  const before = h.count('PATCH profiles');
  const clicked = await h.click('New follower');
  await sleep(1800);
  check('C1 a preference toggle is reachable and saves', clicked === 'ok' && h.count('PATCH profiles') === before + 1,
    `click=${clicked} ${before} → ${h.count('PATCH profiles')}`);
  check('C1 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/C1-notifications.png`);
  await h.close();
}

if (run('C2')) {
  // Blocked users: the screen exists so unblocking does not require finding
  // the person's profile again.
  const blocked = [{ id: '00000000-0000-4000-8000-0000000000c1', name: 'Blocked Bob', avatar_url: null }];
  const h = await open({
    ...P,
    overrides: {
      '/rest/v1/user_blocks': (r) => (r.method === 'GET'
        ? { json: blocked.map((b) => ({ blocked_id: b.id, created_at: new Date().toISOString() })) }
        : { json: [] }),
      '/rest/v1/rpc/get_profiles_display': () => ({ json: blocked }),
    },
  });
  await h.go('/blocked-users', 9000);
  const t = await h.text();
  check('C2 the blocked list names who is blocked', /Blocked Bob/.test(t), t.slice(0, 160));
  const before = h.count((r) => r.method === 'DELETE' && /user_blocks/.test(r.path));
  const clicked = await h.click('Unblock', false);
  await sleep(900);
  // Unblocking confirms first ("Unblock <name>?"), so accept the dialog.
  await h.click('Unblock', true);
  await sleep(1800);
  check('C2 unblocking is possible from here',
    clicked === 'ok' && h.count((r) => r.method === 'DELETE' && /user_blocks/.test(r.path)) > before,
    `click=${clicked}`);
  check('C2 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/C2-blocked.png`);
  await h.close();
}

if (run('C3')) {
  // Deleting the account must confirm first and must not fire the RPC until
  // the user confirms.
  const h = await open({
    ...P,
    overrides: { '/rest/v1/rpc/delete_account': () => ({ json: null }) },
  });
  await h.go('/settings', 9000);
  const clicked = await h.click('Delete account');
  await sleep(1200);
  const t = await h.text();
  check('C3 delete is reachable in settings', clicked === 'ok', String(clicked));
  check('C3 it asks for confirmation first', /delete account\?|permanently|can't be undone|cannot be undone/i.test(t),
    t.match(/[^\n]*(permanently|undone|Delete account\?)[^\n]*/i)?.[0] ?? t.slice(0, 200));
  check('C3 nothing is deleted before confirming',
    h.count((r) => /delete_account/.test(r.path)) === 0,
    String(h.count((r) => /delete_account/.test(r.path))));
  check('C3 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/C3-delete.png`);
  await h.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\nSUITE ACCOUNT: ${passed}/${results.length} passed — screenshots in ${outDir}`);
process.exit(passed === results.length ? 0 : 1);
