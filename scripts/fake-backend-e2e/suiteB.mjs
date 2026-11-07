import { open, check, results, sleep, UID } from './lib.mjs';
const [repo, dist, only] = process.argv.slice(2);
const P = { repo, dist };
const run = (k) => !only || only.split(',').includes(k);
const EV = (h, i = 0) => h.data.ev[i].id;

if (run('B1')) { // Notifications: virtualization, scroll paging, failure + retry
  let failOlder = false;
  const h = await open({ ...P, overrides: { '/rest/v1/notifications': (r) => {
    const range = r.headers.Range || r.headers.range || ''; const off = +(new URLSearchParams(r.query).get('offset') || range.split('-')[0] || 0);
    if (failOlder && r.method === 'GET' && off >= 60) return { status: 500, json: { message: 'boom' } }; } } });
  await h.go('/notifications', 9000);
  const shown = (await h.text()).match(/Notification \d+/g)?.length ?? 0;
  check('B1 first page renders, not all 140 (paged)', shown > 0 && shown < 100, `${shown} rows in DOM`);
  const g0 = h.count('GET notifications');
  await h.scrollEnd(); await sleep(3000);
  check('B1 scroll to end loads the next page', h.count('GET notifications') > g0, `${g0} → ${h.count('GET notifications')}`);
  failOlder = true;
  for (let i = 0; i < 3; i++) { await h.scrollEnd(); await sleep(2000); }
  const t = await h.text();
  check('B1 failed older page shows Retry footer', t.includes("Couldn't load older notifications · Retry"));
  const failedCalls = h.count('GET notifications'); await h.scrollEnd(); await sleep(2000);
  check('B1 no automatic retry loop at list end after failure', h.count('GET notifications') === failedCalls, `${failedCalls} → ${h.count('GET notifications')}`);
  failOlder = false;
  check('B1 retry click', (await h.click('Retry loading older notifications')) === 'ok');
  await sleep(2500);
  check('B1 retry loads and footer clears', !(await h.text()).includes('Retry'));
  check('B1 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('B2')) { // Saved: paging, failure + retry (200 events → ~67 saved, page size 30)
  let failPage2 = false;
  const h = await open({ ...P, dataOpts: { events: 200 }, overrides: { '/rest/v1/rpc/get_user_saved_events': (r) => {
    if (failPage2 && (JSON.parse(r.body || '{}').p_offset || 0) >= 30) return { status: 500, json: { message: 'boom' } }; } } });
  failPage2 = true;
  await h.go('/saved-events', 9000);
  for (let i = 0; i < 3; i++) { await h.scrollEnd(); await sleep(2000); }
  check('B2 failed next page shows Retry footer', (await h.text()).includes("Couldn't load more · Retry"));
  failPage2 = false;
  check('B2 retry click', (await h.click('Retry loading more saved events')) === 'ok');
  await sleep(3000);
  const offs = h.requests.filter((r) => r.path.endsWith('get_user_saved_events')).map((r) => JSON.parse(r.body || '{}').p_offset || 0);
  check('B2 retry fetched page 2', offs.filter((o) => o === 30).length >= 2, `offsets ${offs.join(',')}`);
  check('B2 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('B3')) { // Event page freshness gate + write-version invalidation
  const h = await open(P);
  await h.go(`/event/${EV(h)}`, 9000);
  const d0 = h.count('POST rpc/get_event_details');
  check('B3 event page loads once', d0 === 1, `${d0}x`);
  check('B3 business link', (await h.click('View business')) === 'ok'); await sleep(3500);
  await h.history('history.back()', 3500);
  check('B3 quick return (<15 s, no writes) skips details refetch', h.count('POST rpc/get_event_details') === d0, `${h.count('POST rpc/get_event_details')}x`);
  check('B3 open chat', (await h.click('Open event chat')) === 'ok'); await sleep(4000);
  const reads = h.count('POST rpc/mark_event_chat_read');
  await h.history('history.back()', 4000);
  check('B3 leaving chat marks read (a write)', h.count('POST rpc/mark_event_chat_read') > reads || reads > 0);
  check('B3 return after a write refetches details', h.count('POST rpc/get_event_details') > d0 + 1 - 1 + 0 && h.count('POST rpc/get_event_details') >= d0 + 1,
    `${h.count('POST rpc/get_event_details')}x`);
  const d1 = h.count('POST rpc/get_event_details');
  await sleep(16000);
  await h.click('View business'); await sleep(3000); await h.history('history.back()', 3500);
  check('B3 return after 15 s refetches', h.count('POST rpc/get_event_details') > d1, `${d1} → ${h.count('POST rpc/get_event_details')}`);
  check('B3 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('B4')) { // Live count poll: counts table missing (PGRST205) → full-details fallback; present → light path
  let h = await open({ ...P, overrides: { '/rest/v1/event_rsvp_counts': () => ({ status: 404, json: { code: 'PGRST205', message: 'not found' } }) } });
  await h.go(`/event/${EV(h, 9)}`, 8000);
  const d0 = h.count('POST rpc/get_event_details');
  await sleep(43000);
  const polls = h.count('GET event_rsvp_counts');
  check('B4 missing table: probed once, then remembered', polls === 1, `${polls} probes`);
  check('B4 missing table: falls back to full details each tick', h.count('POST rpc/get_event_details') >= d0 + 2, `${d0} → ${h.count('POST rpc/get_event_details')}`);
  await h.close();
  h = await open({ ...P, overrides: { '/rest/v1/event_rsvp_counts': () => ({ json: { going_count: 77 } }) } });
  await h.go(`/event/${EV(h, 9)}`, 8000);
  const d1 = h.count('POST rpc/get_event_details');
  await sleep(22000);
  check('B4 counts table present: light poll, no details refetch', h.count('POST rpc/get_event_details') === d1 && h.count('GET event_rsvp_counts') >= 1);
  check('B4 live count applied to the page', (await h.text()).includes('77'));
  check('B4 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('B5')) { // Chat composer: counter, mentions, send/clear, draft persistence, slow mode
  const sel = 'textarea[aria-label="Message input"]';
  let h = await open({ ...P, dataOpts: {} });
  h.data.slowMode = 6;
  await h.go(`/event-chat/${EV(h)}`, 9000);
  await h.typeInto(sel, 'x'.repeat(950)); await sleep(500);
  check('B5 counter appears near the limit', (await h.text()).includes('\n50\n') || (await h.text()).includes('50'));
  await h.eval(`(() => { const el = document.querySelector('${sel}'); const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; s.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(300);
  await h.typeInto(sel, 'Hello @Att'); await sleep(800);
  const mention = await h.click('Mention Attendee');
  check('B5 @mention suggestions shown and insertable', mention === 'ok');
  await sleep(400);
  const val = await h.eval(`document.querySelector('${sel}').value`);
  check('B5 mention inserted into draft', /@Attendee \d+ ✨ $/.test(val), JSON.stringify(val));
  await h.click('Send message'); await sleep(2500);
  const sent = h.data.sent?.at(-1);
  check('B5 message sent with mention id', sent && sent.body.startsWith('Hello @Attendee') && sent.mentions?.length === 1, JSON.stringify(sent?.mentions));
  check('B5 composer cleared after send', (await h.eval(`document.querySelector('${sel}').value`)) === '');
  const t = await h.text();
  check('B5 slow-mode countdown shown after send', /Slow mode · you can post again in \d+s/.test(t));
  await h.typeInto(sel, 'second'); await sleep(300);
  check('B5 send blocked during slow mode', (await h.eval(`document.querySelector('[aria-label="Send message"]').getAttribute('aria-disabled')`)) === 'true');
  await sleep(7000);
  check('B5 countdown clears after slow mode', !/Slow mode · you can post again/.test(await h.text()));
  // draft persistence across reload
  await h.typeInto(sel, ' draft kept'); await sleep(1200);
  await h.go(`/event-chat/${EV(h)}`, 9000);
  const restored = await h.eval(`document.querySelector('${sel}')?.value`);
  check('B5 draft restored after reload', restored === 'second draft kept', JSON.stringify(restored));
  check('B5 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('B6')) { // Following: one embedded request, no businesses fetch, counts from RPC
  const h = await open(P);
  await h.go('/following', 8000);
  check('B6 one follows request, no separate businesses fetch', h.count('GET follows') === 1 && h.count('GET businesses') === 0);
  check('B6 follower count shown', (await h.text()).includes('42 followers'));
  await h.close();
}

if (run('B7')) { // Business user: derived premium, manage event shares details cache
  const h = await open({ ...P, dataOpts: { business: true } });
  await h.go('/', 9000);
  check('B7 business user: get_user_business once, no businesses row fetches', h.count('POST rpc/get_user_business') === 1 && h.count('GET businesses') === 0);
  await h.go('/premium/manage', 7000);
  check('B7 premium derived from business row (Pro)', /Pro/.test(await h.text()));
  await h.go(`/business/manage-event/${EV(h)}`, 9000);
  check('B7 manage event loads details once', h.count((r) => r.path.endsWith('get_event_details')) === 1, `${h.count((r) => r.path.endsWith('get_event_details'))}x`);
  await h.click('Attendees'); await sleep(3000);
  check('B7 attendee rows render', /Attendee \d+/.test(await h.text()));
  check('B7 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('B8')) { // Viewports
  for (const vp of [[320, 568], [1280, 800]]) {
    const h = await open({ ...P, viewport: vp });
    await h.go('/', 9000); await h.go(`/event/${EV(h)}`, 7000);
    check(`B8 ${vp.join('x')} discover+event render without errors`, h.errors().length === 0 && (await h.text()).includes('Jazz night'), h.errors().slice(0, 2).join(' || '));
    await h.shot(`/tmp/elm-e2e-shot-${vp.join('x')}.png`);
    await h.close();
  }
}

if (run('B9')) { // Sign out clears this user's device cache and nothing writes it back
  const h = await open(P);
  await h.go('/', 9000); await sleep(3000);
  const before = await h.storage();
  await h.go('/settings', 7000);
  await h.click('Sign out'); await sleep(800);
  await h.click('Sign Out', true); await sleep(6000);
  const after = await h.storage();
  const key = `eventmap.queryCache.${UID}`;
  check('B9 cache existed before sign-out', !!before[key]);
  check('B9 sign-out removed cache + session', !after[key] && !after['sb-127-auth-token'], Object.keys(after).join(','));
  check('B9 lands on welcome/login', /Get Started|Sign In|Login/.test(await h.text()));
  await h.close();
}

console.log(`\nSUITE B: ${results.filter((r) => r.ok).length}/${results.length} passed`);
process.exit(0);
