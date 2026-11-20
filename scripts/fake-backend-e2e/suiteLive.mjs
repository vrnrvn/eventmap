// Live events page (roadmap phase 3) against the FAKE backend — no database.
//   node scripts/fake-backend-e2e/suiteLive.mjs <repo> <dist> [LV1,..|all] [outDir]
//
// LV1 fallback (RPC absent, like the local DB): a running one-off and a
//     running series session appear under "Happening now"; one starting in
//     30 min under "Starting soon"; a skipped-today series stays out; rows
//     carry Live/Soon badges and ends-in/starts-in lines.
// LV2 with get_live_events deployed: ONE request, none of the fallback's
//     ranked/exceptions calls, same page.
// LV3 nothing nearby: the empty state points back to Discover.
// LV4 Discover's "Happening now" strip appears when a fetched row is live,
//     and opens /live.
// LV5 layout: 320 px and 1.6× text — no sideways overflow or clipped text,
//     44 px back button and strip.
// LV6 between refreshes: when a "soon" start passes it moves to Happening
//     now, and a session that ends drops out — without a refetch.
import fs from 'node:fs';
import { open, check, results, sleep, noonUtc, isoFrom, pinClock, PINNED, scaleText, layoutFacts } from './lib.mjs';

const [repo, dist, only = 'all', outDir = '/tmp/eventmap-live'] = process.argv.slice(2);
const run = (k) => only === 'all' || only.split(',').includes(k);
fs.mkdirSync(outDir, { recursive: true });
const P = { repo, dist };

function setEvent(h, i, patch, rankedPatch = {}) {
  Object.assign(h.data.ev[i], patch);
  const ranked = h.data.ranked.find((r) => r.id === h.data.ev[i].id);
  if (ranked) Object.assign(ranked, patch, rankedPatch);
  return h.data.ev[i].id;
}

/** Fixtures pinned to noon UTC: one live one-off, a live series (today
 * skipped for `skipToday`), a 30-min-out one-off, a 3-h-out one-off. */
function liveFixtures(h, T, { skipToday = false } = {}) {
  const liveId = setEvent(h, 0, { title: 'Street food market', start_datetime: isoFrom(T, -1), end_datetime: isoFrom(T, 1),
    is_recurring: false, recurrence_pattern: null, timezone: 'UTC' }, { has_ended: false, user_rsvp: null });
  const seriesId = setEvent(h, 1, { title: 'Morning yoga', start_datetime: isoFrom(T, -169), end_datetime: isoFrom(T, -167),
    is_recurring: true, recurrence_pattern: { frequency: 'weekly', interval: 1 }, timezone: 'UTC' }, { has_ended: false, user_rsvp: null });
  const soonId = setEvent(h, 2, { title: 'Pub quiz', start_datetime: isoFrom(T, 0.5), end_datetime: isoFrom(T, 2.5),
    is_recurring: false, recurrence_pattern: null, timezone: 'UTC' }, { has_ended: false, user_rsvp: null });
  const laterId = setEvent(h, 3, { title: 'Jazz evening', start_datetime: isoFrom(T, 3), end_datetime: isoFrom(T, 5),
    is_recurring: false, recurrence_pattern: null, timezone: 'UTC' }, { has_ended: false, user_rsvp: null });
  if (skipToday) {
    h.data.exceptions = (h.data.exceptions || []).concat({ event_id: seriesId,
      occurrence_date: isoFrom(T, 0).slice(0, 10), kind: 'cancelled', new_start: null, new_end: null, note: null });
  }
  return { liveId, seriesId, soonId, laterId };
}

if (run('LV1')) {
  const T = noonUtc();
  const h = await open({ ...P, ...PINNED });
  liveFixtures(h, T);
  await pinClock(h, T);
  await h.go('/live', 9000);
  const t = await h.text();
  check('LV1 heading and sections render', /Live near you/.test(t) && /Happening now/.test(t) && /Starting soon/.test(t), t.slice(0, 120));
  const liveBlock = t.split('Starting soon')[0];
  check('LV1 running one-off is under Happening now', /Street food market/.test(liveBlock));
  check('LV1 running series session is under Happening now', /Morning yoga/.test(liveBlock));
  check('LV1 30-min-out event is under Starting soon', /Pub quiz/.test(t.split('Starting soon')[1] || ''));
  check('LV1 3-h-out event is not listed', !/Jazz evening/.test(t));
  check('LV1 ends-in and starts-in lines', /Ends in 60 min/.test(t) && /Starts in 30 min/.test(t),
    (t.match(/[^\n]*(Ends|Starts) in[^\n]*/g) || []).join(' // '));
  check('LV1 says the location is approximate (no permission in the harness)', /Showing events around your area/.test(t));
  check('LV1 fallback asked for exceptions', h.count((r) => r.path === '/rest/v1/event_occurrence_exceptions') >= 1);
  check('LV1 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/LV1-fallback.png`);
  await h.close();
}

if (run('LV1b')) { // a skipped-today series is not "Happening now" (fallback path)
  const T = noonUtc();
  const h = await open({ ...P, ...PINNED });
  liveFixtures(h, T, { skipToday: true });
  await pinClock(h, T);
  await h.go('/live', 9000);
  const t = await h.text();
  check('LV1b skipped-today series stays out', !/Morning yoga/.test(t), (t.match(/[^\n]*Morning yoga[^\n]*/) || [''])[0]);
  check('LV1b the rest is unaffected', /Street food market/.test(t) && /Pub quiz/.test(t));
  check('LV1b no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.close();
}

if (run('LV2')) { // RPC path: one request, no fallback calls
  const T = noonUtc();
  const calls = [];
  const h = await open({ ...P, ...PINNED, overrides: {
    '/rest/v1/rpc/get_live_events': (r, data) => {
      calls.push(JSON.parse(r.body || '{}'));
      const live = data.ranked[0], soon = data.ranked[2];
      return { json: [
        { ...live, title: 'RPC live row', occ_start: isoFrom(T, -1), occ_end: isoFrom(T, 1), live_status: 'live' },
        { ...soon, title: 'RPC soon row', occ_start: isoFrom(T, 0.5), occ_end: isoFrom(T, 2.5), live_status: 'soon' },
      ] };
    },
  } });
  await pinClock(h, T);
  // pinClock lands on '/', i.e. Discover, whose own ranked fetch is not the
  // live page's; count only what /live adds.
  const before = { ranked: h.count('POST rpc/get_ranked_events'), exc: h.count((r) => r.path === '/rest/v1/event_occurrence_exceptions') };
  await h.go('/live', 9000);
  const t = await h.text();
  check('LV2 rows come from the RPC', /RPC live row/.test(t) && /RPC soon row/.test(t), t.slice(0, 160));
  check('LV2 one RPC request, nothing from the fallback', calls.length === 1
    && h.count('POST rpc/get_ranked_events') === before.ranked
    && h.count((r) => r.path === '/rest/v1/event_occurrence_exceptions') === before.exc,
    JSON.stringify({ calls: calls.length, before, ranked: h.count('POST rpc/get_ranked_events') }));
  check('LV2 the seed and window are sent', !!calls[0] && typeof calls[0].p_seed === 'string' && calls[0].p_soon_minutes === 60,
    JSON.stringify(calls[0]));
  check('LV2 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.close();
}

if (run('LV3')) { // nothing nearby
  const T = noonUtc();
  const h = await open({ ...P, ...PINNED });
  // Everything far in the future: nothing live, nothing soon.
  [0, 1, 2, 3].forEach((i) => setEvent(h, i, { start_datetime: isoFrom(T, 100), end_datetime: isoFrom(T, 102),
    is_recurring: false, recurrence_pattern: null }, { has_ended: false }));
  await pinClock(h, T);
  await h.go('/live', 9000);
  const t = await h.text();
  check('LV3 empty state explains and points to Discover', /Nothing on right now/.test(t) && /Browse upcoming events/.test(t), t.slice(0, 200));
  check('LV3 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/LV3-empty.png`);
  await h.close();
}

if (run('LV4')) { // Discover strip
  const T = noonUtc();
  const h = await open({ ...P, ...PINNED, viewport: [390, 844] });
  liveFixtures(h, T);
  await pinClock(h, T);
  await h.go('/discover', 9000);
  const t = await h.text();
  check('LV4 strip shows a live count', /Happening now · \d+ live nearby/.test(t), (t.match(/[^\n]*Happening now[^\n]*/) || [''])[0]);
  const r = await h.click('Happening now', false);
  await sleep(4000);
  const url = await h.eval('location.pathname');
  check('LV4 strip opens /live', r === 'ok' && url === '/live', `${r} ${url}`);
  check('LV4 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.close();
}

if (run('LV5')) { // layout at 320 px and with large text
  const T = noonUtc();
  for (const [vw, scale] of [[320, 1], [390, 1.6]]) {
    const h = await open({ ...P, ...PINNED, viewport: [vw, 800] });
    liveFixtures(h, T);
    await pinClock(h, T);
    await h.go('/live', 9000);
    if (scale !== 1) { await scaleText(h, scale); await sleep(900); }
    const r = await layoutFacts(h);
    check(`LV5 [${vw}px ${scale}×] no sideways overflow`, r.overflowX === 0, `overflowX=${r.overflowX}`);
    check(`LV5 [${vw}px ${scale}×] no clipped text`, r.clipped.length === 0 && r.clippedVertically.length === 0,
      JSON.stringify({ sideways: r.clipped, below: r.clippedVertically }));
    const back = await h.eval(`(() => { const e = document.querySelector('[aria-label="Back"]'); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; })()`);
    check(`LV5 [${vw}px ${scale}×] back button is at least 44 × 44`, Array.isArray(back) && back[0] >= 44 && back[1] >= 44, JSON.stringify(back));
    check(`LV5 [${vw}px ${scale}×] no runtime errors`, h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
    await h.shot(`${outDir}/LV5-${vw}-x${String(scale).replace('.', '_')}.png`);
    await h.close();
  }
  // The Discover strip's target.
  const h = await open({ ...P, ...PINNED, viewport: [320, 800] });
  liveFixtures(h, T);
  await pinClock(h, T);
  await h.go('/discover', 9000);
  const strip = await h.eval(`(() => { const e = document.querySelector('[data-testid="live-strip"]'); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; })()`);
  check('LV5 Discover strip is at least 44 px tall', Array.isArray(strip) && strip[1] >= 44, JSON.stringify(strip));
  await h.close();
}

if (run('LV6')) { // the list stays truthful between refreshes
  const T = noonUtc();
  // The "server" keeps answering with the buckets it computed at T — as a
  // cached answer would — so only the page's own re-bucketing can fix them.
  const h = await open({ ...P, ...PINNED, overrides: {
    '/rest/v1/rpc/get_live_events': (r, data) => ({ json: [
      { ...data.ranked[0], title: 'Ending soon market', occ_start: isoFrom(T, -1), occ_end: isoFrom(T, 40 / 60), live_status: 'live' },
      { ...data.ranked[2], title: 'Pub quiz', occ_start: isoFrom(T, 20 / 60), occ_end: isoFrom(T, 2), live_status: 'soon' },
    ] }),
  } });
  await pinClock(h, T);
  await h.go('/live', 9000);
  let t = await h.text();
  check('LV6 before: market live, quiz soon', /Ending soon market/.test(t.split('Starting soon')[0]) && /Pub quiz/.test(t.split('Starting soon')[1] || ''), t.slice(0, 200));
  await h.clock.advance(45 * 60_000);
  await sleep(62_000); // one countdown tick
  t = await h.text();
  check('LV6 after: the ended market dropped out', !/Ending soon market/.test(t), (t.match(/[^\n]*market[^\n]*/i) || [''])[0]);
  check('LV6 after: the quiz moved up to Happening now', /Happening now/.test(t) && /Pub quiz/.test(t) && !/Starting soon/.test(t), t.slice(0, 200));
  check('LV6 after: its line now counts down to the end', /Ends in 7[45] min/.test(t), (t.match(/[^\n]*(Ends|Starts) in[^\n]*/g) || []).join(' // '));
  check('LV6 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\nsuiteLive: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
