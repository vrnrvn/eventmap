// Plan B (docs/PLAN_B_PLAN.md, P1 — client only, no migration).
//
//   node scripts/fake-backend-e2e/suitePlanB.mjs <repo> <dist> [PB1..PB6|all] [outDir]
//
// PB1 cancelled event (T1): "Still want to go out?" with three picks, the
//     same-category one first, its reasons shown; one ranked request centred
//     on the venue at 10 km with a date window; a pick opens its event.
// PB2 a cancelled series date the viewer was going to (T2): "<day> is
//     cancelled — here's what else is on" under the dates, picks from that
//     evening.
// PB3 full event (T3): "Full — here's what else is on then", the full
//     state still on the page.
// PB4 nothing fits: no section at all (no empty state), the request made.
// PB5 "Can't make it?" (T5) for a goer 20 min before the start: the row,
//     the sheet with picks running now, "Free my spot" → one DELETE of the
//     RSVP, "Your spot is free." and the picks stay.
// PB6 a normal event: no Plan B request, no section, no row.
//
// Real clock: every fixture is dated from Date.now() like makeData's own.
import fs from 'node:fs';
import { open, check, results, sleep } from './lib.mjs';

const [repo, dist, only = 'all', outDir = '/tmp/eventmap-planb'] = process.argv.slice(2);
const run = (k) => only === 'all' || only.split(',').includes(k);
fs.mkdirSync(outDir, { recursive: true });
const P = { repo, dist };
const at = (h) => new Date(Date.now() + h * 3600e3).toISOString();

/** Re-date a ranked row (what get_ranked_events returns) into a window. */
function candidate(h, i, startH, endH, over = {}) {
  Object.assign(h.data.ranked[i], {
    start_datetime: at(startH), end_datetime: at(endH), next_start_datetime: at(startH),
    is_recurring: false, recurrence_pattern: null, status: 'active', user_rsvp: null, max_attendees: null, ...over,
  });
  return h.data.ranked[i];
}
/** Set the event under test in both the details row and its ranked twin. */
function setEvent(h, i, fields, rankedOver = {}) {
  Object.assign(h.data.ev[i], fields);
  Object.assign(h.data.ranked[i], fields, rankedOver);
  return h.data.ev[i];
}
const planBRequests = (h) =>
  h.requests.filter((r) => r.path === '/rest/v1/rpc/get_ranked_events' && /"start_date"/.test(r.body || ''));

if (run('PB1')) {
  const h = await open(P);
  const e = setEvent(h, 1, { status: 'cancelled', start_datetime: at(5), end_datetime: at(8) });
  const same = candidate(h, 2, 5.25, 7, { category_id: e.category_id, distance_km: 0.6 });
  const b = candidate(h, 3, 5, 7, { distance_km: 1.2 });
  const c = candidate(h, 6, 6, 8, { distance_km: 2.5 });
  candidate(h, 7, 8.5, 10, { distance_km: 9 });
  await h.go(`/event/${e.id}`, 9000);
  await sleep(1500);
  const t = await h.text();
  check('PB1 the page says cancelled', /This event was cancelled/.test(t));
  check('PB1 "Still want to go out?"', /Still want to go out\?/.test(t), t.match(/[^\n]*go out[^\n]*/)?.[0] ?? '');
  const order = [same.title, b.title, c.title].map((x) => t.indexOf(x));
  check('PB1 three picks, same category first', order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], JSON.stringify(order));
  check('PB1 reasons are shown', /Also [a-z]/.test(t) && /Starts 15 min later/.test(t), (t.match(/[^\n]*Also [^\n]*/) ?? [''])[0]);
  const reqs = planBRequests(h);
  const args = reqs[0] ? JSON.parse(reqs[0].body) : {};
  check('PB1 ONE ranked request around the venue, 10 km, with a date window', reqs.length === 1
    && args.user_lat === e.lat && args.user_lng === e.lng && args.radius_km === 10 && !!args.start_date && !!args.end_date,
    JSON.stringify({ n: reqs.length, ...args }));
  check('PB1 "See more nearby" link', /See more nearby/.test(t));
  await h.shot(`${outDir}/PB1-cancelled.png`);
  check('PB1 a pick opens its event', (await h.click(same.title)) === 'ok');
  await sleep(2500);
  const path = await h.eval('location.pathname');
  check('PB1 … on its own page', path === `/event/${same.id}`, path);
  check('PB1 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.close();
}

if (run('PB2')) {
  const h = await open(P);
  // ev[0]: weekly series the viewer is going to; its second date (start +7 d)
  // is cancelled in the fixture ("Venue closed").
  const e = h.data.ev[0];
  const s7 = Date.parse(e.start_datetime) + 7 * 86400e3;
  const hoursTo = (ms) => (ms - Date.now()) / 3600e3;
  const pick = candidate(h, 2, hoursTo(s7) + 0.25, hoursTo(s7) + 2, { distance_km: 0.8 });
  candidate(h, 3, hoursTo(s7), hoursTo(s7) + 2, { distance_km: 3 });
  await h.go(`/event/${e.id}`, 9000);
  await sleep(1500);
  const t = await h.text();
  check('PB2 the cancelled date is listed', /cancelled/.test(t));
  check('PB2 "<day> is cancelled — here\'s what else is on"', /is cancelled — here's what else is on/.test(t),
    (t.match(/[^\n]*what else is on[^\n]*/) ?? [''])[0]);
  check('PB2 picks from that evening', t.includes(pick.title));
  check('PB2 no T1/T3 section on an active series', !/Still want to go out\?|Full — here's what else/.test(t));
  await h.shot(`${outDir}/PB2-date-cancelled.png`);
  check('PB2 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.close();
}

if (run('PB3')) {
  const h = await open(P);
  // ev[9]: capacity 2, two going, the viewer not among them.
  const e = setEvent(h, 9, { start_datetime: at(5), end_datetime: at(7), is_recurring: false, recurrence_pattern: null,
    status: 'active', max_attendees: 2 }, { rsvp_count: 2, user_rsvp: null });
  const pick = candidate(h, 2, 5, 7, { distance_km: 0.5 });
  candidate(h, 3, 5.5, 7, { distance_km: 1 });
  await h.go(`/event/${e.id}`, 9000);
  await sleep(1500);
  const t = await h.text();
  check('PB3 still says full', /Event full/.test(t), (t.match(/[^\n]*Event full[^\n]*/) ?? [''])[0]);
  check('PB3 "Full — here\'s what else is on then"', /Full — here's what else is on then/.test(t));
  check('PB3 a pick shown', t.includes(pick.title));
  await h.shot(`${outDir}/PB3-full.png`);
  check('PB3 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.close();
}

if (run('PB4')) {
  const h = await open(P);
  const e = setEvent(h, 1, { status: 'cancelled', start_datetime: at(5), end_datetime: at(8) });
  // Nothing re-dated: no other row falls in the window.
  await h.go(`/event/${e.id}`, 9000);
  await sleep(2500);
  const t = await h.text();
  check('PB4 asked (the narrow then the wide radius)', planBRequests(h).length >= 1, String(planBRequests(h).length));
  check('PB4 no section, no empty state', !/Still want to go out\?|See more nearby/.test(t));
  check('PB4 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.close();
}

if (run('PB5')) {
  const h = await open(P);
  const e = setEvent(h, 1, { status: 'active', start_datetime: at(1 / 3), end_datetime: at(3), is_recurring: false,
    recurrence_pattern: null, max_attendees: null }, { user_rsvp: 'going' });
  const liveNow = candidate(h, 2, -1, 2, { distance_km: 0.7 });
  candidate(h, 3, 0.6, 2, { distance_km: 1.5 });
  await h.go(`/event/${e.id}`, 9000);
  await sleep(1500);
  let t = await h.text();
  check('PB5 the "Can\'t make it?" row', /Can't make it\?/.test(t));
  check('PB5 open the sheet', (await h.click("Can't make it?")) === 'ok');
  await sleep(3500);
  t = await h.text();
  check('PB5 sheet explains freeing the spot', /Free your spot so someone waiting can have it/.test(t));
  check('PB5 picks: what\'s on now nearby', /Here's what's on later nearby/.test(t) && t.includes(liveNow.title)
    && /Happening now/.test(t), (t.match(/[^\n]*on later nearby[^\n]*/) ?? [''])[0]);
  await h.shot(`${outDir}/PB5-sheet.png`);
  const before = h.count((r) => r.method === 'DELETE' && r.path === '/rest/v1/rsvps');
  check('PB5 free my spot', (await h.click('Free my spot', true)) === 'ok');
  await sleep(2500);
  t = await h.text();
  check('PB5 exactly one RSVP delete', h.count((r) => r.method === 'DELETE' && r.path === '/rest/v1/rsvps') === before + 1);
  check('PB5 "Your spot is free." and the picks stay', /Your spot is free\./.test(t) && t.includes(liveNow.title));
  await h.shot(`${outDir}/PB5-freed.png`);
  check('PB5 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.close();
}

if (run('PB6')) {
  const h = await open(P);
  const e = setEvent(h, 1, { status: 'active', start_datetime: at(7), end_datetime: at(9), max_attendees: null }, { user_rsvp: null });
  await h.go(`/event/${e.id}`, 9000);
  await sleep(2500);
  const t = await h.text();
  check('PB6 no Plan B request on a normal page', planBRequests(h).length === 0, String(planBRequests(h).length));
  check('PB6 no section, no row', !/Still want to go out\?|Full — here's what else|Can't make it\?/.test(t));
  check('PB6 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.close();
}

const pass = results.filter((r) => r.ok).length;
console.log(`\nSUITE PLANB: ${pass}/${results.length} passed — screenshots in ${outDir}`);
process.exit(pass === results.length ? 0 : 1);
