// Flow 6 — the premium lifecycle as the host sees it: free quota → limit hit
// → premium → lapse → back to free. The logic is unit-tested
// (utils/premiumState, businessesService.checkEventLimit); what was never
// walked is the screens across a lapse.
//
//   node scripts/fake-backend-e2e/suitePremium.mjs <repo> <dist> [Q1..Q5|all] [outDir]
import fs from 'node:fs';
import { open, check, results, sleep } from './lib.mjs';

const [repo, dist, only = 'all', outDir = '/tmp/eventmap-premium'] = process.argv.slice(2);
const run = (k) => only === 'all' || only.split(',').includes(k);
fs.mkdirSync(outDir, { recursive: true });
const P = { repo, dist };
const iso = (d) => new Date(Date.now() + d * 86400_000).toISOString();

/** A host whose plan and usage are set before the screen loads. */
async function host(tier, used, expiresDays) {
  const h = await open({ repo, dist, dataOpts: { business: true } });
  Object.assign(h.data.biz, {
    subscription_tier: tier,
    subscription_expires_at: expiresDays == null ? null : iso(expiresDays),
    events_created_this_month: used,
    last_reset_date: new Date().toISOString().slice(0, 10),
  });
  return h;
}

if (run('Q1')) {
  const h = await host('free', 2, null); // free allowance is 2/month
  await h.go('/create', 9000);
  const t = await h.text();
  check('Q1 a free host at the cap is told the month is used up',
    /used this month's events|limit reached/i.test(t), t.match(/[^\n]*(used this month|limit reached)[^\n]*/i)?.[0] ?? t.slice(0, 200));
  check('Q1 and is offered the upgrade', /premium|upgrade/i.test(t), t.match(/[^\n]*(premium|upgrade)[^\n]*/i)?.[0] ?? '');
  check('Q1 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/Q1-free-capped.png`);
  await h.close();
}

if (run('Q2')) {
  const h = await host('free', 0, null);
  await h.go('/create', 9000);
  const t = await h.text();
  check('Q2 a free host with slots left gets the form, not the wall',
    !/used this month's events/i.test(t), t.match(/[^\n]*used this month[^\n]*/i)?.[0] ?? '');
  check('Q2 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/Q2-free-room.png`);
  await h.close();
}

if (run('Q3')) {
  const h = await host('premium', 3, 20); // active premium: 30/month
  await h.go('/create', 9000);
  const t = await h.text();
  check('Q3 an active premium host past the free cap is not blocked',
    !/used this month's events/i.test(t), t.match(/[^\n]*used this month[^\n]*/i)?.[0] ?? '');
  check('Q3 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/Q3-premium.png`);
  await h.close();
}

if (run('Q4')) {
  // The case the plan called out: premium that has lapsed must behave as free
  // on the client too (utils/premiumState `lapsed`), not keep 30/month.
  const h = await host('premium', 2, -1);
  await h.go('/create', 9000);
  const t = await h.text();
  check('Q4 a lapsed premium host is back on the free cap',
    /used this month's events|limit reached/i.test(t), t.match(/[^\n]*(used this month|limit reached)[^\n]*/i)?.[0] ?? t.slice(0, 200));
  check('Q4 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/Q4-lapsed.png`);
  await h.close();
}

if (run('Q5')) {
  for (const [tier, days, label] of [['premium', 20, 'active'], ['premium', -1, 'lapsed'], ['free', null, 'free']]) {
    const h = await host(tier, 1, days);
    await h.go('/premium/manage', 9000);
    let t = await h.text();
    check(`Q5 the manage screen renders for a ${label} plan`, t.trim().length > 0 && !/^Something went wrong/i.test(t), t.slice(0, 80));
    if (label === 'lapsed') {
      // "No Active Subscription" is the correct lapsed copy — assert that,
      // not the absence of the word "Active".
      check('Q5 a lapsed plan is presented as lapsed, not active',
        /No Active Subscription|free plan/i.test(t), t.match(/[^\n]*(No Active Subscription|free plan)[^\n]*/i)?.[0] ?? t.slice(0, 120));
    }
    await h.go('/premium/plans', 8000);
    t = await h.text();
    check(`Q5 the plans screen renders for a ${label} plan`, /premium|plan/i.test(t), t.slice(0, 80));
    check(`Q5 no runtime errors (${label})`, h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
    await h.shot(`${outDir}/Q5-${label}.png`);
    await h.close();
  }
}

const passed = results.filter((r) => r.ok).length;
console.log(`\nSUITE PREMIUM: ${passed}/${results.length} passed — screenshots in ${outDir}`);
process.exit(passed === results.length ? 0 : 1);
