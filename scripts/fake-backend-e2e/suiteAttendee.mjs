// Flow 5 — the attendee journey on a busy event, with the emphasis on the
// part nothing covered before: what happens *after* the event ends.
//
//   node scripts/fake-backend-e2e/suiteAttendee.mjs <repo> <dist> [A1..A4|all] [outDir]
//
// A1 an event the viewer attended, now over: the page says so, the RSVP
//    controls are gone, and the review affordance is offered.
// A2 the same event in the attendee's history (profile counters + Joined).
// A3 a full event offers the waitlist instead of Join.
// A4 an approval-mode event asks to request, and shows the pending state.
import fs from 'node:fs';
import { open, check, results, sleep } from './lib.mjs';

const [repo, dist, only = 'all', outDir = '/tmp/eventmap-attendee'] = process.argv.slice(2);
const run = (k) => only === 'all' || only.split(',').includes(k);
fs.mkdirSync(outDir, { recursive: true });
const P = { repo, dist };
const iso = (h) => new Date(Date.now() + h * 3600_000).toISOString();

/** Shape one fake event (and its ranked row) into the state under test. */
function setEvent(h, i, patch, rankedPatch = {}) {
  Object.assign(h.data.ev[i], patch);
  const ranked = h.data.ranked.find((r) => r.id === h.data.ev[i].id);
  if (ranked) Object.assign(ranked, patch, rankedPatch);
  return h.data.ev[i].id;
}

if (run('A1')) {
  const h = await open({ ...P });
  const id = setEvent(h, 0, { start_datetime: iso(-26), end_datetime: iso(-24), is_recurring: false, recurrence_pattern: null },
    { has_ended: true, user_rsvp: 'going' });
  await h.go(`/event/${id}`, 9000);
  const t = await h.text();
  check('A1 the page says the event is over', /has ended/i.test(t), t.match(/[^\n]*has ended[^\n]*/)?.[0] ?? t.slice(0, 160));
  check('A1 it points at the attendance history', /attendance history/i.test(t), t.match(/[^\n]*attendance history[^\n]*/)?.[0] ?? '');
  check('A1 the attendee is credited with attending', /You attended/i.test(t), t.match(/You attended[^\n]*/)?.[0] ?? '');
  check('A1 no join / RSVP control is offered any more',
    !/\bJoin\b|Mark as interested/i.test(t), (t.match(/\bJoin\b[^\n]*|Mark as interested[^\n]*/) ?? [''])[0]);
  check('A1 a review can be written from here', /review/i.test(t), t.match(/[^\n]*review[^\n]*/)?.[0] ?? '');
  check('A1 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/A1-ended.png`);
  await h.close();
}

if (run('A2')) {
  const h = await open({ ...P });
  await h.go('/profile', 9000);
  let t = await h.text();
  check('A2 the profile shows an attended counter', /Attended/i.test(t), t.match(/[^\n]*Attended[^\n]*/)?.[0] ?? t.slice(0, 160));
  await h.go('/joined-events', 9000);
  t = await h.text();
  check('A2 the joined screen separates what is past', /attended|past/i.test(t), t.match(/[^\n]*(attended|past)[^\n]*/i)?.[0] ?? t.slice(0, 160));
  check('A2 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/A2-history.png`);
  await h.close();
}

if (run('A3')) {
  const h = await open({
    ...P,
    overrides: {
      '/rest/v1/rpc/get_event_details': (r, data) => {
        // waitlist_mode must be on, or a full event simply says "full".
        const e = { ...data.ev[1], max_attendees: 2, waitlist_mode: 'notify' };
        return { json: { event: e, business: data.biz, category: data.categories[0], links: [], photos: [],
          rsvp_count: 2, save_count: 1, user_rsvp: null, user_saved: false, user_following_business: false,
          // The page reads a `waitlist` object (count / position / notified_at),
          // not flat keys; position 0 means "not on it yet".
          waitlist: { count: 3, position: 0, notified_at: null } } };
      },
    },
  });
  await h.go(`/event/${h.data.ev[1].id}`, 9000);
  const t = await h.text();
  check('A3 a full event offers the waitlist', /waitlist/i.test(t), t.match(/[^\n]*waitlist[^\n]*/i)?.[0] ?? t.slice(0, 200));
  check('A3 and says it is full rather than just failing', /full|sold out|no spots/i.test(t), t.match(/[^\n]*(full|sold out)[^\n]*/i)?.[0] ?? '');
  check('A3 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/A3-waitlist.png`);
  await h.close();
}

if (run('A4')) {
  const h = await open({
    ...P,
    overrides: {
      '/rest/v1/rpc/get_event_details': (r, data) => {
        const e = { ...data.ev[2], rsvp_mode: 'approval' };
        return { json: { event: e, business: data.biz, category: data.categories[0], links: [], photos: [],
          rsvp_count: 4, save_count: 1, user_rsvp: null, user_saved: false, user_following_business: false } };
      },
    },
  });
  await h.go(`/event/${h.data.ev[2].id}`, 9000);
  const t = await h.text();
  check('A4 an approval event asks to request rather than join', /request/i.test(t), t.match(/[^\n]*request[^\n]*/i)?.[0] ?? t.slice(0, 200));
  check('A4 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/A4-approval.png`);
  await h.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\nSUITE ATTENDEE: ${passed}/${results.length} passed — screenshots in ${outDir}`);
process.exit(passed === results.length ? 0 : 1);
