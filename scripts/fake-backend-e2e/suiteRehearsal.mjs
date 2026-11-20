// "Preview as attendee" — docs/EVENT_REHEARSAL_PLAN.md Phase 2 (the core);
// Phase 5 extends this suite (scenario toggles, chat dress, a11y sweep).
//
//   node scripts/fake-backend-e2e/suiteRehearsal.mjs <repo> <dist> [V1..V8|all] [outDir]
//
// The viewer owns every fake event when dataOpts.business is true, so
// `/event/<id>?rehearse=1` exercises the real owner gate.
//
// V1 the host opening ?rehearse=1 gets the attendee page + the banner
// V2 join → "You're going", the real calendar prompt, the count moves —
//    and NOTHING is written (the zero-write assertion every tap scenario runs)
// V3 leave goes through the real confirmation, back to Join
// V4 approval mode: Join becomes a request
// V5 a full event: refused with the real copy, waitlist offered and joined
// V6 a draft is previewed as guests will meet it once published
// V7 someone who doesn't own the event gets the normal page (no preview)
// V8 Manage event → "Preview as attendee" lands here; Exit returns to the owner view
// Phase 3 — scenarios:
// V9  the Scenario panel: two named radio groups; picking one is named in the banner
// V10 join, then "Ended": the guest attended, and is offered a review
// V11 "Full" offers the waitlist; "Spots left" frees a seat on a full event
// V12 a series "Happening now" shows its running date; an open-ended series has no "Ended"
// V13 a going guest appears as "You (preview)" in the faces and in "Who's going"
// Phase 4 — chat preview and entry points:
// V14 a going guest opens the chat preview: read-only bar, no composer, no
//     moderation, and no read marker / presence / message sent
// V15 a guest who isn't going can't open the chat (the real rule)
// V16 Manage event's checklist offers "Walk through it as a guest", which opens
//     the preview and then ticks itself
// V17 a non-owner's ?rehearse=1 chat link is the normal chat (composer present)
// V18 "Add to collection" explains instead of opening the (writing) collections sheet
// V19 "Day of" now shows the attendee page's same-day cue ("Today · in 2 h")
// Phase 5 — layout and accessibility sweep (the axe WCAG pass needs axe-core,
// which is still not installed — owner item):
// V20 banner + open panel at 320 px and 390 px: no overflow or clipping, every
//     control named, ≥44 px, and inside the screen
// V21 the same at 1.3× and 1.6× text
// V22 the chat preview bar at 320 px
import fs from 'node:fs';
import { open, check, results, sleep, scaleText, layoutFacts, noonUtc, isoFrom, pinClock, PINNED, clearSeededDates } from './lib.mjs';

const [repo, dist, only = 'all', outDir = '/tmp/eventmap-rehearsal'] = process.argv.slice(2);
const run = (k) => only === 'all' || only.split(',').includes(k);
fs.mkdirSync(outDir, { recursive: true });
const P = { repo, dist };
const iso = (h) => new Date(Date.now() + h * 3600_000).toISOString();

/** Shape one fake event (and its ranked row, which feeds the details RPC). */
function setEvent(h, i, patch, rankedPatch = {}) {
  Object.assign(h.data.ev[i], patch);
  const ranked = h.data.ranked.find((r) => r.id === h.data.ev[i].id);
  if (ranked) Object.assign(ranked, patch, rankedPatch);
  return h.data.ev[i].id;
}

// Anything that would change server state, or count toward analytics.
const WRITE_RPC = /^rpc\/(join_event_with_capacity|join_event_waitlist|leave_event_waitlist|set_occurrence_rsvp|track_event_view|track_event_interaction|set_event_|host_|cancel_event|postpone_event|reschedule_event|publish_event|send_event_announcement|notify_followers|mark_event_chat_read|block_|unblock_|delete_event_chat|restore_event_chat|report_)/;
function writes(h) {
  return h.requests.filter((r) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(r.method)) return false;
    const p = r.path.replace('/rest/v1/', '');
    return p.startsWith('rpc/') ? WRITE_RPC.test(p) : true;
  });
}
const writeList = (h) => writes(h).map((r) => `${r.method} ${r.path.replace('/rest/v1/', '')}`).join(', ');

async function preview(dataOpts = { business: true }, patch = {}, rankedPatch = {}, extra = {}) {
  const h = await open({ ...P, dataOpts, ...extra });
  // Fake events carry a small default capacity; scenarios start with room unless they set one.
  const id = setEvent(h, 0, { start_datetime: iso(48), end_datetime: iso(50), is_recurring: false, recurrence_pattern: null, max_attendees: null, rsvp_mode: 'open', publish_state: 'published', ...patch },
    { user_rsvp: null, rsvp_count: 3, ...rankedPatch });
  return { h, id };
}

if (run('V1')) {
  const { h, id } = await preview();
  await h.go(`/event/${id}?rehearse=1`, 9000);
  const t = await h.text();
  check('V1 the banner says what this is', /Preview as attendee/.test(t) && /Nothing you do here is saved/.test(t), t.slice(0, 160));
  check('V1 the attendee join bar is there', /Join Event/.test(t), t.match(/[^\n]*Join[^\n]*/)?.[0] ?? '');
  check('V1 host-only controls are gone', !/Manage event|Insights|Manage chat/.test(t), t.match(/[^\n]*(Manage event|Insights|Manage chat)[^\n]*/)?.[0] ?? '');
  check('V1 opening the preview sent nothing (no view tracked)', writes(h).length === 0, writeList(h));
  const exitBox = await h.eval(`(() => { const e = document.querySelector('[aria-label="Exit preview"]'); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })()`);
  check('V1 Exit is a named, ≥44 px target', Array.isArray(exitBox) && exitBox[0] >= 44 && exitBox[1] >= 44, JSON.stringify(exitBox));
  check('V1 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/V1-preview.png`);
  await h.close();
}

if (run('V2')) {
  const { h, id } = await preview();
  await h.go(`/event/${id}?rehearse=1`, 9000);
  const r = await h.click('Join Event'); await sleep(1500);
  const t = await h.text();
  check('V2 tapping Join works in the preview', r === 'ok', r);
  check('V2 the guest is now going', /You're going/.test(t), t.match(/[^\n]*going[^\n]*/i)?.[0] ?? '');
  check('V2 the real calendar prompt appears', /Add it to your calendar\?/.test(t));
  check('V2 the going count moved with the guest (3 → 4)', /4 going/.test(t), t.match(/\d+ going[^\n]*/)?.[0] ?? '');
  const add = await h.click('Add', true); await sleep(800);
  const t2 = await h.text();
  check('V2 the calendar action explains instead of exporting', add === 'ok' && /Nothing was exported/.test(t2), add);
  check('V2 NOTHING was written', writes(h).length === 0, writeList(h));
  check('V2 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/V2-joined.png`);
  await h.close();
}

if (run('V3')) {
  const { h, id } = await preview();
  await h.go(`/event/${id}?rehearse=1`, 9000);
  await h.click('Join Event'); await sleep(1200);
  const leave = await h.click('Leave event', true); await sleep(800);
  const asked = await h.text();
  check('V3 leaving asks the real question', leave === 'ok' && /Leave event\?/.test(asked) && /lose access to the event chat/.test(asked), leave);
  await h.click('Leave', true); await sleep(1200);
  const t = await h.text();
  // The earlier join's toast may still be on screen; the buttons are the signal.
  const leaveBtn = await h.eval(`[...document.querySelectorAll('[role=button]')].some((e) => e.getAttribute('aria-label') === 'Leave event')`);
  check('V3 back to Join after confirming', /Join Event/.test(t) && leaveBtn === false, `leave button: ${leaveBtn}`);
  check('V3 NOTHING was written', writes(h).length === 0, writeList(h));
  check('V3 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.close();
}

if (run('V4')) {
  const { h, id } = await preview({ business: true }, { rsvp_mode: 'approval' });
  await h.go(`/event/${id}?rehearse=1`, 9000);
  const before = await h.text();
  check('V4 an approval event asks to request', /Request to join/.test(before), before.match(/[^\n]*Request[^\n]*/)?.[0] ?? '');
  await h.click('Request to join'); await sleep(1500);
  const t = await h.text();
  check('V4 the request is "sent", with the real expectation-setting copy', /Request sent/.test(t), t.match(/[^\n]*Request sent[^\n]*/)?.[0] ?? '');
  check('V4 and can be cancelled', /Cancel request/.test(t));
  check('V4 NOTHING was written', writes(h).length === 0, writeList(h));
  await h.close();
}

if (run('V5')) {
  // Full (3 / 3), with one person already waiting.
  const { h, id } = await preview({ business: true }, { max_attendees: 3 },
    { rsvp_count: 3, waitlist: { count: 1, position: null, notified_at: null } });
  await h.go(`/event/${id}?rehearse=1`, 9000);
  const t0 = await h.text();
  const offersWaitlist = /Join waitlist/i.test(t0);
  check('V5 a full event offers the waitlist to the guest', offersWaitlist, t0.match(/[^\n]*(full|waitlist)[^\n]*/i)?.[0] ?? '');
  if (offersWaitlist) {
    const jw = await h.click('Join the waitlist'); await sleep(1500); // accessible name: "Event full. Join the waitlist"
    if (jw !== 'ok') console.log('  (waitlist click: ' + jw + ')');
    const t = await h.text();
    check('V5 the guest joins the line after the real one (#2)', /#2 on the waitlist/.test(t), t.match(/[^\n]*waitlist[^\n]*/i)?.[0] ?? '');
  }
  check('V5 NOTHING was written', writes(h).length === 0, writeList(h));
  check('V5 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.close();
}

if (run('V6')) {
  const { h, id } = await preview({ business: true }, { publish_state: 'draft' });
  await h.go(`/event/${id}?rehearse=1`, 9000);
  const t = await h.text();
  check('V6 the banner says the draft is not public yet', /Not published yet/.test(t));
  check('V6 the owner-only draft notice is not shown to the "guest"', !/only you can see|Draft —|This is a draft/i.test(t), t.match(/[^\n]*[Dd]raft[^\n]*/)?.[0] ?? '');
  check('V6 the guest can try joining it', /Join Event/.test(t));
  await h.click('Join Event'); await sleep(1200);
  check('V6 joining a draft works in the preview', /You're going/.test(await h.text()));
  check('V6 NOTHING was written', writes(h).length === 0, writeList(h));
  await h.close();
}

if (run('V7')) {
  const { h, id } = await preview({ business: false });
  await h.go(`/event/${id}?rehearse=1`, 9000);
  const t = await h.text();
  check('V7 a non-owner gets no preview banner', !/Preview as attendee/.test(t));
  check('V7 and the normal page', /Join Event/.test(t));
  await h.click('Join Event'); await sleep(1500);
  check('V7 their Join is real (one RSVP request)',
    h.requests.some((r) => r.method === 'POST' && /rpc\/join_event_with_capacity/.test(r.path)),
    writeList(h));
  await h.close();
}

if (run('V8')) {
  const { h, id } = await preview();
  await h.go(`/business/manage-event/${id}`, 9000);
  const r = await h.click('Preview as attendee'); await sleep(6000);
  const url = await h.eval('location.pathname + location.search');
  const t = await h.text();
  check('V8 Manage event → "Preview as attendee" opens the preview', r === 'ok' && /rehearse=1/.test(url) && /Nothing you do here is saved/.test(t), `${r} ${url}`);
  const ex = await h.click('Exit preview', true); await sleep(5000);
  const url2 = await h.eval('location.pathname + location.search');
  const t2 = await h.text();
  check('V8 Exit returns to the owner view', ex === 'ok' && !/rehearse/.test(url2) && !/Preview as attendee/.test(t2) && /Manage event/.test(t2), `${ex} ${url2}`);
  check('V8 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.close();
}

const openScenario = async (h) => { const r = await h.click('Try a scenario', true); await sleep(600); return r; };
const pick = async (h, label) => { const r = await h.click(label, true); await sleep(1200); return r; };

if (run('V9')) {
  const { h, id } = await preview();
  await h.go(`/event/${id}?rehearse=1`, 9000);
  check('V9 the panel opens', (await openScenario(h)) === 'ok');
  const radios = await h.eval(`[...document.querySelectorAll('[role=radiogroup]')].map((g) => g.getAttribute('aria-label') + ':' + g.querySelectorAll('[role=radio]').length).join(',')`);
  check('V9 two named radio groups: When (5) and Spots (3)', radios === 'When:5,Spots:3', radios);
  const checkedNow = await h.eval(`[...document.querySelectorAll('[role=radio][aria-checked=true]')].map((e) => e.getAttribute('aria-label')).join(',')`);
  check('V9 the real state is selected by default', checkedNow === 'Right now,Spots: As it is', checkedNow);
  await pick(h, 'Happening now');
  const t = await h.text();
  check('V9 the page is now "Happening now"', /·\s+Happening now/.test(t), t.match(/[^\n]*Happening now[^\n]*/)?.[0] ?? '');
  await openScenario(h); // collapse
  const t2 = await h.text();
  check('V9 the collapsed banner names the simulated moment', /Simulating: Happening now/.test(t2));
  check('V9 NOTHING was written', writes(h).length === 0, writeList(h));
  check('V9 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/V9-scenario.png`);
  await h.close();
}

if (run('V10')) {
  const { h, id } = await preview();
  await h.go(`/event/${id}?rehearse=1`, 9000);
  await h.click('Join Event'); await sleep(1200);
  await openScenario(h); await pick(h, 'Ended');
  const t = await h.text();
  check('V10 the page says it is over', /This event has ended\. It now lives in your attendance history\./.test(t));
  check('V10 the guest is credited', /You attended/.test(t));
  check('V10 RSVP controls are gone', !/Leave event|Join Event/.test(t));
  check('V10 the guest who went is offered a review', /Write a review/.test(t));
  check('V10 NOTHING was written', writes(h).length === 0, writeList(h));
  await h.shot(`${outDir}/V10-ended.png`);
  await h.close();
}

if (run('V11')) {
  const { h, id } = await preview({ business: true }, {}, { rsvp_count: 3, waitlist: { count: 0, position: null, notified_at: null } });
  await h.go(`/event/${id}?rehearse=1`, 9000);
  await openScenario(h); await pick(h, 'Spots: Full');
  const t = await h.text();
  check('V11 "Full" fills the event and offers the waitlist', /Event full/.test(t) && /Join waitlist/i.test(t), t.match(/[^\n]*(full|waitlist)[^\n]*/i)?.[0] ?? '');
  check('V11 with an invented limit at today\'s count (3 / 3)', /3 \/ 3 going/.test(t), t.match(/\d+ \/ \d+ going/)?.[0] ?? '');
  await h.close();
  // A genuinely full event, previewed with a seat free.
  const b = await preview({ business: true }, { max_attendees: 3 }, { rsvp_count: 3 });
  await b.h.go(`/event/${b.id}?rehearse=1`, 9000);
  await openScenario(b.h); await pick(b.h, 'Spots: Spots left');
  const t2 = await b.h.text();
  check('V11 "Spots left" frees a seat on a full event', /Join Event/.test(t2) && /2 \/ 3 going/.test(t2), t2.match(/[^\n]*(Join|going)[^\n]*/)?.[0] ?? '');
  check('V11 NOTHING was written', writes(b.h).length === 0 && writes(h).length === 0, writeList(b.h));
  await b.h.close();
}

if (run('V12')) {
  // Pinned to 12:00 UTC: against the real clock, "in 3 h" crossed the UTC
  // date after 21:00 UTC and the date-row check failed by time of day.
  const T = noonUtc();
  const today = new Date(T + 3 * 3600_000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  // Weekly, first date a week ago; this week's date is later today (starts in 3 h).
  const { h, id } = await preview({ business: true }, { start_datetime: isoFrom(T, -165), end_datetime: isoFrom(T, -163), is_recurring: true,
    recurrence_pattern: { frequency: 'weekly', interval: 1 }, timezone: 'UTC' }, {}, PINNED);
  clearSeededDates(h, id);
  await pinClock(h, T);
  await h.go(`/event/${id}?rehearse=1`, 9000);
  await openScenario(h);
  const radios = await h.eval(`[...document.querySelectorAll('[role=radio]')].map((e) => e.getAttribute('aria-label')).join(',')`);
  check('V12 an open-ended series offers no "Ended"', !/,Ended,/.test(',' + radios + ','), radios);
  await pick(h, 'Happening now');
  const t = await h.text();
  const header = t.match(/[^\n]*·\s+Happening now/)?.[0] ?? '';
  check('V12 the series is live on its running date', header.includes(today), `${header} (want ${today})`);
  check('V12 and that date\'s row says so', /· happening now/.test(t));
  await h.close();
}

if (run('V13')) {
  const { h, id } = await preview();
  await h.go(`/event/${id}?rehearse=1`, 9000);
  await h.click('Join Event'); await sleep(1500);
  // The face is an initials bubble ("Y") or the host's photo; either way the pile gained one.
  const bubbles = await h.eval(`[...document.querySelectorAll('div')].filter((e) => e.children.length <= 1 && /^(Y|Y\\()$/.test((e.innerText || '').trim())).map((e) => e.innerText.trim()).join(',')`);
  check('V13 the going guest is one of the faces, as "Y" (not "Y(")', /(^|,)Y(,|$)/.test(bubbles) && !/Y\(/.test(bubbles), bubbles);
  const opened = await h.click("see who's coming"); await sleep(2500);
  const t = await h.text();
  check('V13 and listed first in "Who\'s going"', opened === 'ok' && /You \(preview\)/.test(t), opened);
  check('V13 NOTHING was written', writes(h).length === 0, writeList(h));
  await h.close();
}

// The real get_event_chat_post_status says is_host for the event's owner; the
// shared fake always says false, so the owner scenarios say it explicitly.
const hostChatStatus = {
  '/rest/v1/rpc/get_event_chat_post_status': () => ({
    json: [{ can_read: true, can_post: true, is_banned: false, is_blocked: false, is_host: true, is_admin: false,
      muted: false, locked: false, slow_mode_seconds: 0, block_expires_at: null, last_read_at: null, last_post_at: null,
      chat_mode: 'open', open_policy: 'two_going', pinned_message_id: null }],
  }),
};

if (run('V14')) {
  const { h, id } = await preview({ business: true }, {}, {}, { overrides: hostChatStatus });
  await h.go(`/event/${id}?rehearse=1`, 9000);
  await h.click('Join Event'); await sleep(1200);
  const r = await h.click('Open event chat', true); await sleep(7000);
  const url = await h.eval('location.pathname + location.search');
  const t = await h.text();
  check('V14 the going guest opens the chat preview', r === 'ok' && /\/event-chat\/.*rehearse=1/.test(url), `${r} ${url}`);
  check('V14 the preview bar replaces the composer', /this is the chat guests see/.test(t));
  const composer = await h.eval(`!!document.querySelector('[placeholder="Message the event chat"]')`);
  check('V14 no composer', composer === false);
  check('V14 no host moderation view', !/You're viewing as host|read and moderate/i.test(t));
  check('V14 messages are readable', /Message \d+/.test(t), t.slice(0, 120));
  check('V14 NOTHING was written (no read marker, no message)', writes(h).length === 0, writeList(h));
  const back = await h.click('Exit chat preview', true); await sleep(4000);
  const url2 = await h.eval('location.pathname + location.search');
  check('V14 Back returns to the event preview', back === 'ok' && /\/event\/.*rehearse=1/.test(url2), `${back} ${url2}`);
  check('V14 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/V14-chat-preview.png`);
  await h.close();
}

if (run('V15')) {
  const { h, id } = await preview();
  await h.go(`/event/${id}?rehearse=1`, 9000);
  const disabled = await h.eval(`(() => { const e = [...document.querySelectorAll('[aria-label]')].find((x) => /Event chat, join the event to unlock/.test(x.getAttribute('aria-label'))); return e ? (e.getAttribute('aria-disabled') || 'present') : 'missing'; })()`);
  check('V15 a guest who is not going sees the chat locked, with the reason', disabled === 'true' || disabled === 'present', disabled);
  await h.close();
}

if (run('V16')) {
  const { h, id } = await preview();
  await h.go(`/business/manage-event/${id}?checklist=1`, 9000);
  const t0 = await h.text();
  check('V16 the checklist offers "Walk through it as a guest"', /Walk through it as a guest/.test(t0));
  const r = await h.click('Walk through it as a guest. Preview'); await sleep(6000);
  const url = await h.eval('location.pathname + location.search');
  check('V16 it opens the preview', r === 'ok' && /rehearse=1/.test(url), `${r} ${url}`);
  await h.go(`/business/manage-event/${id}?checklist=1`, 9000);
  const ticked = await h.eval(`(() => { const e = [...document.querySelectorAll('[role=checkbox]')].find((x) => x.getAttribute('aria-label') === 'Walk through it as a guest'); return e ? e.getAttribute('aria-checked') : 'missing'; })()`);
  check('V16 and ticks itself afterwards', ticked === 'true', ticked);
  await h.close();
}

if (run('V17')) {
  const { h, id } = await preview({ business: false }, {}, { user_rsvp: 'going' });
  await h.go(`/event-chat/${id}?rehearse=1`, 9000);
  const t = await h.text();
  const composer = await h.eval(`!!document.querySelector('[placeholder="Message the event chat"]')`);
  check('V17 a non-owner gets the normal chat (composer, no preview bar)', composer === true && !/this is the chat guests see/.test(t), String(composer));
  await h.close();
}

if (run('V18')) {
  const { h, id } = await preview();
  await h.go(`/event/${id}?rehearse=1`, 9000);
  const r = await h.click('Add to collection'); await sleep(1500);
  const t = await h.text();
  check('V18 "Add to collection" explains in the preview', r === 'ok' && /file saved events into collections/.test(t), r);
  check('V18 the collections sheet did not open', !/New collection|Create a collection/i.test(t));
  check('V18 NOTHING was written', writes(h).length === 0, writeList(h));
  await h.close();
}

if (run('V19')) {
  // 18:00 UTC tomorrow, zoned UTC: "Day of" puts the clock at 16:00 the same day.
  const d = new Date(); const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 18));
  const end = new Date(start.getTime() + 2 * 3600_000);
  const { h, id } = await preview({ business: true }, { start_datetime: start.toISOString(), end_datetime: end.toISOString(), timezone: 'UTC' });
  await h.go(`/event/${id}?rehearse=1`, 9000);
  await openScenario(h); await pick(h, 'Day of');
  const t = await h.text();
  check('V19 "Day of" shows the same-day cue', /·\s+Today · in 2 h/.test(t), t.match(/[^\n]*(Today|Tomorrow|Starts in)[^\n]*/)?.[0] ?? '');
  await pick(h, 'Days before');
  check('V19 and "Days before" does not', !/Today · in|Starts in \d+ min/.test(await h.text()));
  await h.close();
}

/** The banner's controls: name, size, and whether they sit inside the screen. */
const bannerControls = (h) => h.eval(`JSON.stringify([...document.querySelectorAll('[aria-label="Exit preview"],[aria-label="Try a scenario"],[aria-label="Hide scenarios"],[role=radio],[aria-label="Exit chat preview"]')]
  .map((e) => { const r = e.getBoundingClientRect(); return { name: e.getAttribute('aria-label') || '', w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right) }; })
  // Screens behind this one stay mounted in the navigation stack, at 0×0.
  .filter((x) => x.w > 0 || x.h > 0))`).then(JSON.parse);

async function sweep(h, tag, width) {
  const r = await layoutFacts(h);
  check(`${tag} no horizontal overflow`, r.overflowX === 0, `overflowX=${r.overflowX}`);
  check(`${tag} no clipped text`, r.clipped.length === 0 && r.clippedVertically.length === 0,
    JSON.stringify({ sideways: r.clipped, below: r.clippedVertically }));
  const c = await bannerControls(h);
  const small = c.filter((x) => x.h < 44 || x.w < 44).map((x) => `${x.name} ${x.w}×${x.h}`);
  const outside = c.filter((x) => x.left < 0 || x.right > width).map((x) => `${x.name} ${x.left}–${x.right}`);
  check(`${tag} every control is named`, c.length > 0 && c.every((x) => x.name.trim().length > 0), `${c.length} controls`);
  check(`${tag} every control ≥ 44 px`, small.length === 0, small.join(', '));
  check(`${tag} every control inside the screen`, outside.length === 0, outside.join(', '));
}

if (run('V20')) {
  for (const width of [320, 390]) {
    const h = (await preview({ business: true }, {}, {}, { viewport: [width, 740] })).h;
    const id = h.data.ev[0].id;
    await h.go(`/event/${id}?rehearse=1`, 9000);
    await openScenario(h);
    const radios = (await bannerControls(h)).filter((x) => /Right now|Days before|Day of|Happening now|Ended|Spots:/.test(x.name)).length;
    check(`V20 [${width}] the panel is open (8 choices)`, radios === 8, String(radios));
    await sweep(h, `V20 [${width}]`, width);
    check(`V20 [${width}] no runtime errors`, h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
    await h.shot(`${outDir}/V20-panel-${width}.png`);
    await h.close();
  }
}

if (run('V21')) {
  for (const scale of [1.3, 1.6]) {
    const h = (await preview({ business: true }, {}, {}, { viewport: [390, 844] })).h;
    const id = h.data.ev[0].id;
    await h.go(`/event/${id}?rehearse=1`, 9000);
    // Scale only once the page is up (scaleText touches what is mounted).
    for (let i = 0; i < 20 && !/Preview as attendee/.test(await h.text()); i++) await sleep(500);
    await openScenario(h);
    const t = await scaleText(h, scale);
    await sleep(900);
    check(`V21 [${scale}×] the scale actually applied`, t.touched > 50 && t.after > t.before * (scale - 0.05),
      `${t.before}px → ${t.after}px across ${t.touched} elements`);
    await sweep(h, `V21 [${scale}×]`, 390);
    await h.shot(`${outDir}/V21-panel-x${String(scale).replace('.', '_')}.png`);
    await h.close();
  }
}

if (run('V22')) {
  const { h, id } = await preview({ business: true }, {}, {}, { overrides: hostChatStatus, viewport: [320, 740] });
  await h.go(`/event/${id}?rehearse=1`, 9000);
  await h.click('Join Event'); await sleep(1200);
  await h.click('Open event chat', true); await sleep(7000);
  check('V22 the chat preview opened at 320 px', /this is the chat guests see/.test(await h.text()));
  await sweep(h, 'V22 [320]', 320);
  await h.shot(`${outDir}/V22-chat-320.png`);
  await h.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\nSUITE REHEARSAL: ${passed}/${results.length} passed — screenshots in ${outDir}`);
process.exit(passed === results.length ? 0 : 1);
