// Flow 4 — "report → moderation → outcome", the app side, against the FAKE
// backend (no database).
//
//   node scripts/fake-backend-e2e/suiteModeration.mjs <repo> <dist> [R1..R5|all] [outDir]
//
// R1  report an event: reason sheet → one POST complaints → confirmation;
//     reporting it again is the unique violation, shown as "already reported"
//     (and no second row is created).
// R2  report a chat message: long-press → actions sheet → reason → Report;
//     same duplicate behaviour with the chat wording.
// R3  the reporter's `report_update` notification renders and opens the event.
// R4  the outcome for a banned user: write actions refuse with the suspension
//     message (read access is deliberately kept — docs/ISSUES.md "Decided").
// R5  the outcome for a user removed from a chat: a send fails and the
//     composer says they were removed, not a generic error.
//
// The admin half (acting on the complaint in the Next.js app) needs a real
// admin login and is not covered here — see docs/ISSUES.md flow 4.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { open, check, results, sleep } from './lib.mjs';

const [repo, dist, only = 'all', outDir = '/tmp/eventmap-moderation'] = process.argv.slice(2);
const run = (k) => only === 'all' || only.split(',').includes(k);
fs.mkdirSync(outDir, { recursive: true });
const P = { repo, dist };
const EV = (h, i = 0) => h.data.ev[i].id;

/**
 * Long-press, which is how the chat opens message actions. RN-web listens for
 * real pointer events, so synthesise one over the element's centre and hold.
 */
async function longPress(h, selectorText) {
  const box = await h.eval(`(() => {
    const el = [...document.querySelectorAll('div,span')].find((e) => e.innerText && e.innerText.trim() === ${JSON.stringify(selectorText)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
  })()`);
  if (!box) return 'NOT FOUND';
  const { x, y } = JSON.parse(box);
  await h.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await h.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(1600);
  await h.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 });
  await sleep(900);
  return 'ok';
}

if (run('R1')) {
  const h = await open({ ...P });
  await h.go(`/event/${EV(h)}`, 9000);
  check('R1 open the report sheet', (await h.click('Report this event')) === 'ok');
  await sleep(800);
  let t = await h.text();
  check('R1 sheet lists the reasons', t.includes('Safety concern') && t.includes('Send report'), t.slice(0, 0));
  check('R1 pick a reason', (await h.click('Safety concern')) === 'ok');
  check('R1 send', (await h.click('Send report')) === 'ok');
  await sleep(1800);
  t = await h.text();
  check('R1 one report sent', h.count('POST complaints') === 1, `${h.count('POST complaints')}x`);
  check('R1 confirmation names the review window', /Report received/.test(t) && /48 hours/.test(t), t.match(/Report received[^\n]*/)?.[0] ?? '');

  // Report the same event again: the unique violation, not a failure.
  await sleep(2500);
  await h.click('Report this event'); await sleep(800);
  await h.click('Safety concern'); await h.click('Send report'); await sleep(1800);
  t = await h.text();
  check('R1 duplicate report is attempted once more', h.count('POST complaints') === 2, `${h.count('POST complaints')}x`);
  check('R1 duplicate reads as already reported', /already reported this event/i.test(t), t.match(/already reported[^\n]*/)?.[0] ?? t.slice(0, 120));
  check('R1 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/R1-event-report.png`);
  await h.close();
}

if (run('R2')) {
  const h = await open({ ...P });
  await h.go(`/event-chat/${EV(h)}`, 9000);
  const body = h.data.messages.filter((m) => !m.deleted_at && m.sender_id !== h.data.profile.id).at(-1)?.body;
  check('R2 found someone else’s message to report', !!body, String(body).slice(0, 40));
  check('R2 long-press opens message actions', (await longPress(h, body)) === 'ok');
  let t = await h.text();
  check('R2 actions sheet offers Report message', t.includes('Report message'), t.slice(0, 0));
  check('R2 choose Report message', (await h.click('Report message')) === 'ok');
  await sleep(700);
  check('R2 pick a chat reason', (await h.click('Harassment or hate')) === 'ok');
  check('R2 confirm', (await h.click('Report', true)) === 'ok');
  await sleep(1800);
  t = await h.text();
  check('R2 one report sent', h.count('POST complaints') === 1, `${h.count('POST complaints')}x`);
  check('R2 confirmation shown', /has been reported/i.test(t), t.match(/reported[^\n]*/)?.[0] ?? t.slice(0, 120));

  await longPress(h, body);
  await h.click('Report message'); await sleep(700);
  await h.click('Harassment or hate'); await h.click('Report', true); await sleep(1800);
  t = await h.text();
  check('R2 duplicate reads as already reported', /already reported this message/i.test(t), t.match(/already reported[^\n]*/)?.[0] ?? t.slice(0, 120));
  check('R2 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/R2-chat-report.png`);
  await h.close();
}

if (run('R3')) {
  const h = await open({ ...P, dataOpts: { notifications: 0 } });
  const eventId = EV(h, 2);
  h.data.notifs = [{
    id: randomUUID(), user_id: h.data.profile.id, type: 'report_update',
    title: 'Update on your report', body: 'Thanks for flagging this — we reviewed it and took action.',
    event_id: eventId, business_id: null, read: false, created_at: new Date().toISOString(), data: {},
  }];
  await h.go('/notifications', 8000);
  const t = await h.text();
  check('R3 the reporter sees the outcome notification', t.includes('Update on your report') && t.includes('took action'), t.slice(0, 0));
  check('R3 tap it', (await h.click('Update on your report')) === 'ok');
  await sleep(2500);
  const url = await h.eval('location.pathname');
  check('R3 opens the event it was about', url === `/event/${eventId}`, url);
  check('R3 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/R3-report-update.png`);
  await h.close();
}

if (run('R4')) {
  // The moderation outcome: the account is banned. banned_users returns a row.
  const h = await open({
    ...P,
    overrides: { '/rest/v1/banned_users': () => ({ json: { id: 'ban-1', user_id: 'u1' }, status: 200 }) },
  });
  await h.go(`/event/${EV(h, 3)}`, 9000);
  const t0 = await h.text();
  check('R4 a banned user can still read the event', /./.test(t0) && !/suspended/i.test(t0), t0.slice(0, 0));
  check('R4 try to RSVP', (await h.click('Mark as interested')) === 'ok');
  await sleep(1500);
  const t = await h.text();
  check('R4 the write is refused with the suspension message', /account has been suspended/i.test(t), t.match(/suspended[^\n]*/)?.[0] ?? t.slice(0, 120));
  check('R4 no RSVP reached the server', h.count((r) => r.method === 'POST' && /rsvp/i.test(r.path)) === 0);
  check('R4 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/R4-banned.png`);
  await h.close();
}

if (run('R5')) {
  // The other outcome: removed from one event's chat. The send is refused and
  // the post status says why, so the composer must name it.
  const h = await open({
    ...P,
    overrides: {
      '/rest/v1/event_chat_messages': (r) =>
        r.method === 'POST' ? { status: 403, json: { code: '42501', message: 'new row violates row-level security policy' } } : undefined,
      '/rest/v1/rpc/get_event_chat_post_status': () => ({
        json: [{ can_read: true, can_post: false, is_banned: false, is_blocked: true, is_host: false, is_admin: false,
          muted: false, locked: false, slow_mode_seconds: 0, block_expires_at: null, last_read_at: null, last_post_at: null,
          chat_mode: 'open', open_policy: 'two_going', pinned_message_id: null }],
      }),
    },
  });
  await h.go(`/event-chat/${EV(h)}`, 9000);
  const t = await h.text();
  check('R5 a removed user is told up front, not by a send that fails',
    /removed you from this chat/i.test(t), t.match(/removed you[^\n]*/)?.[0] ?? t.slice(0, 160));
  check('R5 and is told they can still read along (read access is kept on purpose)',
    /still read along/i.test(t), t.match(/still read along[^\n]*/)?.[0] ?? '');
  check('R5 the timeline is still there to read', /Message \d+/.test(t));
  check('R5 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/R5-blocked.png`);
  await h.close();

  // The other outcome: the account itself is suspended. Chat says so in its
  // own words rather than the generic "RSVP to join".
  const hb = await open({
    ...P,
    overrides: {
      '/rest/v1/rpc/get_event_chat_post_status': () => ({
        json: [{ can_read: true, can_post: false, is_banned: true, is_blocked: false, is_host: false, is_admin: false,
          muted: false, locked: false, slow_mode_seconds: 0, block_expires_at: null, last_read_at: null, last_post_at: null,
          chat_mode: 'open', open_policy: 'two_going', pinned_message_id: null }],
      }),
    },
  });
  await hb.go(`/event-chat/${EV(hb)}`, 9000);
  const tb = await hb.text();
  check('R5 a suspended account is told it can read but not post',
    /suspended, so you can read but not post/i.test(tb), tb.match(/suspended[^\n]*/)?.[0] ?? tb.slice(0, 160));
  check('R5 no runtime errors (suspended)', hb.errors().length === 0, hb.errors().slice(0, 2).join(' | '));
  await hb.shot(`${outDir}/R5-suspended.png`);
  await hb.close();
}

if (run('R6')) {
  // EJ-4 (docs/EVENT_JOURNEY_REVIEW_2026-11-17.md): the host switched the chat
  // off while 2+ people are going, and an attendee arrives from an old chat
  // notification. The screen used to apply its own "2 going" rule, open an
  // empty room, and say "Waiting for one more attendee" — the wrong reason.
  const h = await open({
    ...P,
    overrides: {
      '/rest/v1/rpc/get_event_chat_post_status': () => ({
        json: [{ can_read: false, can_post: false, is_banned: false, is_blocked: false, is_host: false, is_admin: false,
          muted: false, locked: true, slow_mode_seconds: 0, block_expires_at: null, last_read_at: null, last_post_at: null,
          chat_mode: 'off', open_policy: 'two_going', pinned_message_id: null }],
      }),
    },
  });
  const ev = h.data.ev[0];
  ev.rsvp_count = Math.max(ev.rsvp_count ?? 0, 3);
  ev.user_rsvp = 'going';
  await h.go(`/event-chat/${ev.id}`, 9000);
  const t = await h.text();
  check('R6 an attendee of a switched-off chat is told it is off', /Chat is off/.test(t), t.match(/[^\n]*Chat is[^\n]*/)?.[0] ?? t.slice(0, 160));
  check('R6 not that it waits for another attendee', !/Waiting for one more attendee|unlocks when at least 2/i.test(t),
    t.match(/[^\n]*(Waiting for one more|unlocks when)[^\n]*/i)?.[0] ?? '');
  check('R6 no composer is offered', !/Message the group|Type a message/i.test(t));
  check('R6 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/R6-chat-off.png`);
  await h.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\nSUITE MODERATION: ${passed}/${results.length} passed — screenshots in ${outDir}`);
process.exit(passed === results.length ? 0 : 1);
