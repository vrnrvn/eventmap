// Lifecycle — the browser twin of scripts/test-lifecycle.sql.
//
//   node scripts/fake-backend-e2e/suiteLifecycle.mjs <repo> <dist> [L1..L5|all] [outDir]
//
// The SQL harness must move the event because Postgres' now() is frozen per
// transaction. Here it is the other way round: ONE event keeps its dates and
// the PAGE'S CLOCK moves across them (lib.mjs `clock`), which is the piece no
// suite had — suiteAttendee re-dates its fixtures against the real clock.
// The session token is minted a week long so the walk can't out-travel it.
//
// L1 before (clock 2 days early): joinable, calendar offered, not ended.
// L2 reminder window (40 min before): the minute-precise "Starts in N min".
// L3 live (mid-event): "Happening now", still joinable (joins close at the
//    END, not the start), the chat row is still there.
// L4 ended (3 h after): the ended notice, join and chat gone, review offered.
// L5 the end passing under an OPEN page: before the reload the page is stale
//    (EJ-12's known gap — no in-page clock tick), after a reload it is over.
import fs from 'node:fs';
import { open, check, results, sleep } from './lib.mjs';

const [repo, dist, only = 'all', outDir = '/tmp/eventmap-lifecycle'] = process.argv.slice(2);
const run = (k) => only === 'all' || only.split(',').includes(k);
fs.mkdirSync(outDir, { recursive: true });
const P = { repo, dist, clock: true, expOffsetS: 7 * 24 * 3600 };

// The one event under test: a 2-hour one-off anchored at the real "now", so
// every phase is reached purely by pointing the clock somewhere else.
const T0 = Date.now();
const at = (h) => new Date(T0 + h * 3600_000).toISOString();
function fixEvent(h) {
  const e = h.data.ev[0];
  Object.assign(e, { start_datetime: at(0), end_datetime: at(2), is_recurring: false, recurrence_pattern: null, timezone: 'UTC' });
  const r = h.data.ranked.find((x) => x.id === e.id);
  Object.assign(r, e, { user_rsvp: 'going', rsvp_count: 3 });
  return e.id;
}
// Clock moves apply to the NEXT document: set, then (re)load.
async function goAt(h, id, hoursFromStart, wait = 9000) {
  await h.go('/');                       // a document, so __lcClock exists
  await h.clock.set(at(hoursFromStart));
  await h.go(`/event/${id}`, wait);
}

if (run('L1')) {
  const h = await open(P);
  const id = fixEvent(h);
  await goAt(h, id, -48);
  const t = await h.text();
  check('L1 before: not ended two days early', !/has ended/i.test(t), t.match(/[^\n]*has ended[^\n]*/)?.[0] ?? '');
  check('L1 before: the viewer reads as going', /You're Going|Going ✓|Leave/i.test(t), t.slice(0, 120));
  check('L1 before: calendar offered', /Add to calendar/i.test(t), '');
  check('L1 before: chat row present', /Event chat/i.test(t), '');
  check('L1 before: no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/L1-before.png`);
  await h.close();
}

if (run('L2')) {
  const h = await open(P);
  const id = fixEvent(h);
  await goAt(h, id, -40 / 60);           // 40 minutes before the start
  const t = await h.text();
  const m = t.match(/Starts in (\d+) min/);
  check('L2 reminder window: the minute-precise label', !!m, t.match(/[^\n]*Starts[^\n]*/)?.[0] ?? t.slice(0, 120));
  check('L2 reminder window: and it is counted from the fake clock', !!m && Math.abs(Number(m[1]) - 40) <= 2, m?.[0] ?? '');
  check('L2 reminder window: not "happening now" yet', !/Happening now/i.test(t), '');
  await h.shot(`${outDir}/L2-reminder.png`);
  await h.close();
}

if (run('L3')) {
  const h = await open(P);
  const id = fixEvent(h);
  await goAt(h, id, 1);                  // one hour in, one to go
  const t = await h.text();
  check('L3 live: happening now', /Happening now/i.test(t), t.match(/[^\n]*[Hh]appening now[^\n]*/)?.[0] ?? t.slice(0, 120));
  check('L3 live: not ended mid-event', !/has ended/i.test(t), '');
  check('L3 live: chat row still there', /Event chat/i.test(t), '');
  check('L3 live: no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/L3-live.png`);
  await h.close();
}

if (run('L4')) {
  const h = await open(P);
  const id = fixEvent(h);
  await goAt(h, id, 5);                  // three hours after the end
  const t = await h.text();
  check('L4 ended: the page says so', /has ended/i.test(t), t.match(/[^\n]*has ended[^\n]*/)?.[0] ?? t.slice(0, 160));
  check('L4 ended: join gone', !/\bJoin Event\b|Mark as interested/i.test(t), (t.match(/\bJoin Event\b[^\n]*/) ?? [''])[0]);
  check('L4 ended: chat row gone', !/Event chat/i.test(t), (t.match(/[^\n]*Event chat[^\n]*/) ?? [''])[0]);
  check('L4 ended: review offered to an attendee', /Write a review/.test(t), t.match(/[^\n]*review[^\n]*/)?.[0] ?? '');
  check('L4 ended: no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/L4-ended.png`);
  await h.close();
}

if (run('L5')) {
  const h = await open(P);
  const id = fixEvent(h);
  await goAt(h, id, 1.9);                // six minutes before the end
  let t = await h.text();
  check('L5 open page, pre-end: live', /Happening now/i.test(t), t.slice(0, 120));
  await h.clock.advance(30 * 60_000);    // the end passes under the open page
  await sleep(1500);
  t = await h.text();
  // Known gap EJ-12: nothing re-renders on a clock tick, so the open page
  // stays as it was. Pinned here as documentation, NOT as desired behaviour —
  // when an in-page clock lands, flip this check rather than deleting it.
  check('L5 open page, post-end: still stale without a reload (EJ-12, open gap)', /Happening now/i.test(t), t.slice(0, 120));
  await h.go(`/event/${id}`, 9000);      // what a user returning to the page gets
  t = await h.text();
  check('L5 after a reload: the end is reflected', /has ended/i.test(t), t.match(/[^\n]*has ended[^\n]*/)?.[0] ?? t.slice(0, 160));
  check('L5 no runtime errors across the flip', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/L5-flip.png`);
  await h.close();
}

const pass = results.filter((r) => r.ok).length;
console.log(`\nSUITE LIFECYCLE: ${pass}/${results.length} passed — screenshots in ${outDir}`);
process.exit(pass === results.length ? 0 : 1);
