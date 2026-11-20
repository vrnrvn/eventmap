// Lifecycle — the browser twin of scripts/test-lifecycle.sql.
//
//   node scripts/fake-backend-e2e/suiteLifecycle.mjs <repo> <dist> [L1..L7|all] [outDir]
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
// L4 ended (3 h after): the ended notice, join gone, review offered; the chat
//    row STAYS, reading "Chat open until <day>" (D1/EJ-7: posting is open for
//    7 days after the end — 20261118150000, applied).
// L5 the end passing under an OPEN page: before the reload the page is stale
//    (EJ-12's known gap — no in-page clock tick), after a reload it is over.
// L6 ended_week (8 days after): the row reads closed; the chat screen offers
//    history with a "closed on <day>" notice and no composer.
// L7 run it again (the "after" stage, duplicate_event v2): one call with the
//    date, title and an idempotency key reused across a failed attempt and
//    its retry; no follow-up writes; Manage event reads `duplicated_from`.
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
  check('L4 ended: chat row stays, open until the window closes', /Chat open until/i.test(t), (t.match(/[^\n]*Chat open[^\n]*/) ?? [''])[0]);
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

if (run('L6')) {
  const h = await open(P);
  const id = fixEvent(h);
  // 8 days after the start (the 2-hour event ended 7 days + 22 h ago): past
  // the D1 posting window. The fake can't tell virtual time, so the fixture
  // flag mirrors what the real get_event_chat_post_status would answer.
  h.data.chatPostClosed = true;
  await goAt(h, id, 8 * 24);
  let t = await h.text();
  check('L6 ended_week: the page says ended', /has ended/i.test(t), t.match(/[^\n]*has ended[^\n]*/)?.[0] ?? t.slice(0, 160));
  check('L6 ended_week: chat row reads closed, history readable', /Chat closed — you can read the history/.test(t), (t.match(/[^\n]*Chat closed[^\n]*/) ?? [''])[0]);
  await h.shot(`${outDir}/L6-ended-week-event.png`);
  await h.go(`/event-chat/${id}`, 9000);
  t = await h.text();
  check('L6 chat screen: closed-on notice', /This chat closed on /.test(t), (t.match(/[^\n]*chat closed[^\n]*/i) ?? [''])[0]);
  // The composer is an input, so its placeholder is an attribute, not page
  // text — query the DOM rather than the text dump.
  const composer = await h.eval(`!!document.querySelector('[placeholder="Message the event chat"]')`);
  check('L6 chat screen: no composer', !composer);
  check('L6 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/L6-ended-week-chat.png`);
  await h.close();
}

if (run('L7')) {
  // After the event, the host runs it again (duplicate_event v2): ONE call
  // with the chosen date, the source title and an idempotency key; a retry
  // after a failed attempt reuses the key; no follow-up writes.
  const h = await open({ ...P, dataOpts: { business: true } });
  const e = h.data.ev[0];
  Object.assign(e, { start_datetime: at(-50), end_datetime: at(-48), is_recurring: false, recurrence_pattern: null,
    timezone: 'UTC', status: 'active', publish_state: 'published' });
  await h.go('/my-events', 9000);
  check('L7 Past tab', (await h.click('Past and cancelled events', true)) === 'ok');
  await sleep(2500);
  check('L7 "Run it again" offered on the ended event', (await h.click(`Run ${e.title} again`, true)) === 'ok');
  await sleep(1200);
  h.data.failDuplicate = 1;                // the first attempt's response is lost
  check('L7 create draft (attempt 1)', (await h.click('Create draft', true)) === 'ok');
  await sleep(2500);
  let t = await h.text();
  check('L7 failure explained, sheet still open', /Could not duplicate/.test(t) && /Create draft/.test(t), (t.match(/[^\n]*duplicate[^\n]*/i) ?? [''])[0]);
  check('L7 create draft (retry)', (await h.click('Create draft', true)) === 'ok');
  await sleep(4000);
  const calls = h.data.duplicateCalls || [];
  check('L7 two attempts, ONE request key', calls.length === 2 && !!calls[0].p_client_request_id
    && calls[0].p_client_request_id === calls[1].p_client_request_id, JSON.stringify(calls.map((c) => c.p_client_request_id)));
  check('L7 the call carries the date and the source title', !!calls[1]?.p_start && !!calls[1]?.p_end
    && Date.parse(calls[1].p_start) > Date.now() && calls[1].p_title === e.title, JSON.stringify(calls[1] ?? {}));
  check('L7 exactly one draft exists', h.data.ev.filter((x) => x.duplicated_from === e.id).length === 1);
  check('L7 no follow-up PATCH of the copy', h.count((r) => r.method === 'PATCH' && r.path.startsWith('/rest/v1/events')) === 0);
  check('L7 no chat-mode carry-over call', h.count('POST rpc/set_event_chat_mode') === 0);
  const path = await h.eval('location.pathname');
  check('L7 lands on the new draft in the editor', /\/edit-event\/dddddddd-/.test(path), path);
  await h.shot(`${outDir}/L7-run-again.png`);
  // The playbook's "Run it again" step reads the lineage on any device.
  await h.go(`/business/manage-event/${e.id}`, 9000);
  const eventsReqs = h.requests.filter((r) => r.path === '/rest/v1/events');
  const asked = eventsReqs.filter((r) => decodeURIComponent(r.query).includes(`duplicated_from=eq.${e.id}`));
  check('L7 Manage event asks for copies of the ended event (duplicated_from)', asked.length >= 1,
    eventsReqs.map((r) => `${r.method} ${decodeURIComponent(r.query)}`).slice(-3).join(' | '));
  check('L7 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.close();
}

const pass = results.filter((r) => r.ok).length;
console.log(`\nSUITE LIFECYCLE: ${pass}/${results.length} passed — screenshots in ${outDir}`);
process.exit(pass === results.length ? 0 : 1);
