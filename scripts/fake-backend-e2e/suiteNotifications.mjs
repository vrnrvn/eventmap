// Flow 3 — "notification → the right screen", for every notification type,
// from the in-app list, against the FAKE backend (no database).
//
//   node scripts/fake-backend-e2e/suiteNotifications.mjs <repo> <dist> [N1,N2|all] [outDir]
//
// N1  one unread notification per type; tap each and assert the URL the app
//     lands on (host notices → the hub, chat → the thread with the message
//     anchor, profile-level host notices → Settings, business-only → the venue,
//     nothing → Discover). The push-tap path resolves through the same
//     function (utils/notificationRoute.routeFromPushData), pinned by
//     tests/notificationRoute.test.ts — tapping a real push is a device item.
// N2  tapping marks the row read (one PATCH) and the destination renders
//     without runtime errors.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { open, check, results, sleep } from './lib.mjs';

const [repo, dist, only = 'all', outDir = '/tmp/eventmap-notif'] = process.argv.slice(2);
const run = (k) => only === 'all' || only.split(',').includes(k);
fs.mkdirSync(outDir, { recursive: true });
const P = { repo, dist };

/** Expo Router on web drops the `(tabs)` group from the URL. */
const webPath = (route) => route.replace('/(tabs)', '');

/** Every type the client knows (services/notifications.ts NotificationType). */
function plan(h) {
  const ev = h.data.ev;
  const biz = h.data.biz.id;
  const e = (i) => ev[i % ev.length].id;
  const msg = randomUUID();
  return [
    { type: 'event_reminder', event_id: e(1), expect: `/event/${e(1)}` },
    { type: 'event_update', event_id: e(2), expect: `/event/${e(2)}` },
    { type: 'rsvp', event_id: e(3), business_id: biz, expect: `/event/${e(3)}` },
    { type: 'waitlist', event_id: e(4), expect: `/event/${e(4)}` },
    { type: 'moderation', event_id: e(5), expect: `/event/${e(5)}` },
    { type: 'report_update', event_id: e(6), expect: `/event/${e(6)}` },
    { type: 'host_announcement', event_id: e(7), expect: `/event/${e(7)}` },
    { type: 'nearby_event', event_id: e(8), expect: `/event/${e(8)}` },
    { type: 'interest_event', event_id: e(9), expect: `/event/${e(9)}` },
    { type: 'new_event_from_followed', event_id: e(10), business_id: biz, expect: `/event/${e(10)}` },
    { type: 'chat_message', event_id: e(11), expect: `/event-chat/${e(11)}` },
    { type: 'chat_mention', event_id: e(12), data: { messageId: msg }, expect: `/event-chat/${e(12)}?messageId=${msg}` },
    { type: 'host_day_of', event_id: e(13), business_id: biz, expect: `/business/manage-event/${e(13)}` },
    { type: 'host_post_event_summary', event_id: e(14), business_id: biz, expect: `/business/manage-event/${e(14)}?checklist=1` },
    { type: 'host_verification_update', business_id: biz, expect: '/settings' },
    { type: 'host_standing_update', business_id: biz, expect: '/settings' },
    { type: 'new_follower', business_id: biz, expect: `/business/${biz}` },
    { type: 'promotion', expect: webPath('/(tabs)/discover') },
  ];
}

function rows(items) {
  return items.map((n, i) => ({
    id: randomUUID(), user_id: undefined, type: n.type, title: `N ${n.type}`, body: `tap test ${i + 1}`,
    event_id: n.event_id ?? null, business_id: n.business_id ?? null, read: false,
    created_at: new Date(Date.now() - i * 60000).toISOString(), data: n.data ?? {},
  }));
}

if (run('N1') || run('N2')) {
  // business: true makes the viewer the owner, so the host hub is reachable.
  const h = await open({
    ...P,
    dataOpts: { business: true, notifications: 0 },
    // The host hub asks for the getting-started status on arrival; the base
    // fake has no handler (suites register one, as suiteHost/suiteHostUi do).
    overrides: {
      '/rest/v1/rpc/get_host_onboarding_status': () => ({
        json: { has_logo: false, has_description: false, notifications_enabled: true,
          published_events: 0, events_with_capacity: 0, recurring_events: 0, announcements: 0 },
      }),
    },
  });
  const all = plan(h);
  // Six rows per list so every row is rendered (no virtualisation surprises).
  for (let start = 0; start < all.length; start += 6) {
    const batch = all.slice(start, start + 6);
    h.data.notifs = rows(batch);
    for (const n of batch) {
      await h.go('/notifications', 7000);
      const before = h.count('PATCH notifications');
      const clicked = await h.click(`N ${n.type}`);
      await sleep(3000);
      const url = await h.eval('location.pathname + location.search');
      if (run('N1')) {
        check(`N1 ${n.type} → ${webPath(n.expect)}`, clicked === 'ok' && url === webPath(n.expect), `click=${clicked} url=${url}`);
      }
      if (run('N2')) {
        check(`N2 ${n.type} tap marks it read (one PATCH)`, h.count('PATCH notifications') === before + 1, `${before} → ${h.count('PATCH notifications')}`);
        const errs = h.errors();
        check(`N2 ${n.type} destination renders without runtime errors`, errs.length === 0, errs.slice(0, 2).join(' | ').slice(0, 160));
      }
      await h.shot(`${outDir}/${n.type}.png`);
    }
  }
  check('N1 no unknown backend calls', h.unknown.length === 0, h.unknown.slice(0, 3).join(', '));
  await h.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\nSUITE NOTIFICATIONS: ${passed}/${results.length} passed — screenshots in ${outDir}`);
process.exit(passed === results.length ? 0 : 1);
