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
// A5 EJ-3: someone the server would refuse (user_can_review_business false)
//    is told why instead of being offered a form that fails on submit.
// A6 EJ-2 "during the event": a weekly series whose date is running now is
//    "Happening now", and that date's row says so.
// A7 EJ-13: today's date of a series that finished an hour ago is neither
//    live nor offered any more.
// A8 EJ-25: a full event whose host switched the waitlist off doesn't offer
//    a waitlist the server would refuse.
// A9  D2: without the series-reviews migration the series section is hidden
//     and nothing names event_id
// A10 D2: with it, a FINISHED series' page shows its own reviews and average,
//     and an eligible attendee's review is sent with p_event_id
// A11 D2: an ineligible viewer is told when series reviews open
// A12 D2: a review of THIS series shows once — not again in the venue list
// A13 D2: a series with no reviews, for a viewer who can't review yet, shows
//     no empty series section (the venue section already explains)
import fs from 'node:fs';
import { open, check, results, sleep, noonUtc, isoFrom, pinClock, PINNED, clearSeededDates } from './lib.mjs';

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
  // Was /review/i, which the rating summary ("4.5 (12 reviews)") always met.
  check('A1 a review can be written from here', /Write a review/.test(t), t.match(/[^\n]*review[^\n]*/)?.[0] ?? '');
  check('A1 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/A1-ended.png`);
  await h.close();
}

if (run('A5')) {
  const h = await open({ ...P, overrides: { '/rest/v1/rpc/user_can_review_business': () => ({ json: false }) } });
  const id = setEvent(h, 0, { start_datetime: iso(48), end_datetime: iso(50), is_recurring: false, recurrence_pattern: null },
    { has_ended: false, user_rsvp: null });
  await h.go(`/event/${id}`, 9000);
  const t = await h.text();
  check('A5 an ineligible viewer is not offered the review form', !/Write a review/.test(t), t.match(/[^\n]*Write a review[^\n]*/)?.[0] ?? '');
  check('A5 and is told when reviews open', /Reviews open once you've attended/.test(t), t.match(/[^\n]*Reviews open[^\n]*/)?.[0] ?? '');
  check('A5 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.close();
}

if (run('A6')) {
  // Pinned to 12:00 UTC: against the real clock the running date's UTC day
  // (and so the header check) changed around midnight UTC.
  const T = noonUtc();
  const h = await open({ ...P, ...PINNED });
  // First date a week ago, 1 h before now → this week's date runs from 1 h ago to 1 h from now.
  const id = setEvent(h, 0, { start_datetime: isoFrom(T, -169), end_datetime: isoFrom(T, -167), is_recurring: true,
    recurrence_pattern: { frequency: 'weekly', interval: 1 }, timezone: 'UTC' }, { has_ended: false, user_rsvp: 'going' });
  clearSeededDates(h, id);
  await pinClock(h, T);
  await h.go(`/event/${id}`, 9000);
  const t = await h.text();
  check('A6 a running series date reads "Happening now"', /Happening now/.test(t), t.match(/[^\n]*Happening now[^\n]*/)?.[0] ?? t.slice(0, 160));
  check('A6 and its row in the dates list says so', /· happening now/.test(t), t.match(/[^\n]*happening now[^\n]*/)?.[0] ?? '');
  // The header must show the date that is running, not next week's.
  const today = new Date(T).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const header = t.match(/[^\n]*·\s+Happening now/)?.[0] ?? '';
  check('A6 the header shows the running date, not the next one', header.includes(today), `${header} (want ${today})`);
  check('A6 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/A6-series-live.png`);
  await h.close();
}

if (run('A7')) {
  // Pinned to 12:00 UTC: against the real clock the count of upcoming-date
  // chips depended on the hour the suite ran.
  const T = noonUtc();
  const h = await open({ ...P, ...PINNED });
  // This week's date ran from 3 h ago to 1 h ago.
  const id = setEvent(h, 0, { start_datetime: isoFrom(T, -171), end_datetime: isoFrom(T, -169), is_recurring: true,
    recurrence_pattern: { frequency: 'weekly', interval: 1 }, timezone: 'UTC' }, { has_ended: false, user_rsvp: null });
  clearSeededDates(h, id);
  await pinClock(h, T);
  await h.go(`/event/${id}`, 9000);
  const t = await h.text();
  check('A7 a series whose date finished is not "Happening now"', !/Happening now|· happening now/i.test(t),
    t.match(/[^\n]*appening now[^\n]*/i)?.[0] ?? '');
  const goChips = (t.match(/^Go$/gm) ?? []).length;
  check('A7 the finished date is no longer offered (5 upcoming dates, all ahead)', goChips === 5, `Go chips: ${goChips}`);
  check('A7 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.close();
}

if (run('A8')) {
  const h = await open({ ...P });
  const id = setEvent(h, 0, { start_datetime: iso(48), end_datetime: iso(50), is_recurring: false, recurrence_pattern: null,
    max_attendees: 3, waitlist_mode: 'off', rsvp_mode: 'open' }, { has_ended: false, user_rsvp: null, rsvp_count: 3,
    waitlist: { count: 0, position: null, notified_at: null } });
  await h.go(`/event/${id}`, 9000);
  const t = await h.text();
  check('A8 a full event with the waitlist off says full', /Event full/i.test(t), t.match(/[^\n]*full[^\n]*/i)?.[0] ?? '');
  check('A8 and does not offer a waitlist the server would refuse', !/Join waitlist|Join the waitlist/i.test(t), t.match(/[^\n]*waitlist[^\n]*/i)?.[0] ?? '');
  check('A8 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
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

// A finished weekly series (its endDate passed) the viewer went to.
function finishedSeries(h) {
  return setEvent(h, 0, { start_datetime: iso(-24 * 30), end_datetime: iso(-24 * 30 + 2), is_recurring: true,
    recurrence_pattern: { frequency: 'weekly', interval: 1, endDate: iso(-24 * 3).slice(0, 10) }, timezone: 'UTC' },
    { has_ended: true, user_rsvp: 'going' });
}

if (run('A9')) {
  const h = await open({ ...P });
  const id = finishedSeries(h);
  await h.go(`/event/${id}`, 9000);
  const t = await h.text();
  check('A9 no series section without the D2 migration', !/Reviews of this series/.test(t));
  check('A9 the venue reviews still render', /Write a review|Edit your review/.test(t));
  check('A9 no query names event_id', h.count((r) => /event_id=/.test(r.query || '') && r.path === '/rest/v1/reviews') === 0);
  check('A9 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.close();
}

const SERIES_REVIEW = { id: '00000000-0000-4000-8000-0000000000a1', user_id: '00000000-0000-4000-8000-0000000000b1',
  business_id: null, event_id: null, rating: 5, text: 'Every week was great', business_response: null,
  created_at: iso(-48), updated_at: iso(-48) };

function seriesOverrides(eligible, sent, { empty = false, inVenueList = false } = {}) {
  return {
    '/rest/v1/rpc/get_event_review_summary': () => ({ json: [{ average: empty ? 0 : 5, review_count: empty ? 0 : 1 }] }),
    '/rest/v1/rpc/user_can_review_event': () => ({ json: eligible }),
    '/rest/v1/rpc/submit_review': (r) => { sent.push(JSON.parse(r.body || '{}')); return { json: 'rid' }; },
    '/rest/v1/reviews': (r, data) => {
      const m = /event_id=eq\.([0-9a-f-]+)/.exec(r.query || '');
      // The venue list (business_id filter): after D2 it also holds this
      // series' reviews, which the event page must not repeat.
      if (!m && inVenueList && /business_id=eq/.test(r.query || '') && !/user_id=eq/.test(r.query || '')) {
        return { json: [{ ...SERIES_REVIEW, event_id: data.ev[0].id, business_id: data.biz?.id ?? null }] };
      }
      if (!m) return undefined;
      if (empty) return { json: /user_id=eq/.test(r.query) ? null : [], status: /user_id=eq/.test(r.query) ? 406 : 200 };
      // The viewer's own series review (user_id filter): none yet.
      if (/user_id=eq/.test(r.query)) return { json: null, status: 406 };
      return { json: [{ ...SERIES_REVIEW, event_id: m[1], business_id: data.biz?.id ?? null }] };
    },
  };
}

if (run('A10')) {
  const sent = [];
  const h = await open({ ...P, overrides: seriesOverrides(true, sent) });
  const id = finishedSeries(h);
  await h.go(`/event/${id}`, 9000);
  let t = await h.text();
  check('A10 a finished series page shows its own reviews', /Reviews of this series/.test(t), t.slice(-300));
  check('A10 with its own list', /Every week was great/.test(t));
  check('A10 the venue section is still there below it', /Reviews of |Venue reviews/.test(t.split('Reviews of this series')[1] || ''));
  const opened = await h.click('Review this series', true);
  await sleep(800);
  await h.click('Rate 4 of 5 stars', true);
  await sleep(300);
  const submitted = await h.click('Submit review', true);
  await sleep(2000);
  const body = sent[0] || {};
  check('A10 the review is sent as a series review', opened === 'ok' && submitted === 'ok'
    && body.p_event_id === id && body.p_rating === 4, JSON.stringify({ opened, submitted, body }));
  check('A10 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/A10-series-reviews.png`);
  await h.close();
}

if (run('A11')) {
  const h = await open({ ...P, overrides: seriesOverrides(false, []) });
  const id = finishedSeries(h);
  await h.go(`/event/${id}`, 9000);
  const t = await h.text();
  check('A11 an ineligible viewer is told when series reviews open',
    /Reviews of this series open once you've attended one of its sessions/.test(t));
  check('A11 and is not offered the series form', !/Review this series(?! open)/.test(t.replace('Reviews of this series', '')));
  check('A11 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.close();
}

if (run('A12')) {
  const h = await open({ ...P, overrides: seriesOverrides(true, [], { inVenueList: true }) });
  const id = finishedSeries(h);
  await h.go(`/event/${id}`, 9000);
  const t = await h.text();
  const times = (t.match(/Every week was great/g) || []).length;
  check('A12 a review of this series appears once', times === 1, `appears ${times}×`);
  check('A12 and in the series section', /Every week was great/.test(t.split(/Reviews of (?!this series)/)[0] || ''));
  check('A12 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.close();
}

if (run('A13')) {
  const h = await open({ ...P, overrides: seriesOverrides(false, [], { empty: true }) });
  const id = finishedSeries(h);
  await h.go(`/event/${id}`, 9000);
  const t = await h.text();
  check('A13 no empty series section for a viewer who cannot review yet', !/Reviews of this series/.test(t));
  check('A13 the venue section is still there', /Reviews of |Venue reviews/.test(t));
  check('A13 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\nSUITE ATTENDEE: ${passed}/${results.length} passed — screenshots in ${outDir}`);
process.exit(passed === results.length ? 0 : 1);
