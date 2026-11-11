// Host onboarding Stages 1–3 against the FAKE backend (no database).
//   node scripts/fake-backend-e2e/suiteHost.mjs "$PWD" <dist> [H1,H2,H3,H4] [outDir]
// Short and targeted: each scenario is one fresh browser, ~20–40 s.
import { open, check, results, sleep, UID } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

const [repo, dist, only, outDir] = process.argv.slice(2);
const P = { repo, dist };
const run = (k) => !only || only === 'all' || only.split(',').includes(k);
const shot = async (h, name) => {
  if (!outDir) return;
  fs.mkdirSync(outDir, { recursive: true });
  await h.shot(path.join(outDir, `${name}.png`));
};
const NEW_EVENT_ID = '00000000-0000-4000-8000-0000000000ee';

/** Host profile shape overrides for get_user_business, plus the create path. */
function hostOverrides(getData, shape, { totalEvents = 0 } = {}) {
  return {
    '/rest/v1/rpc/get_user_business': () => ({ json: [{ ...getData().biz, ...shape }] }),
    '/rest/v1/businesses': (r) => (r.method === 'GET' ? { json: { ...getData().biz, ...shape } } : undefined),
    // "Has this host ever made an event?" (HEAD count) answers 0, so the
    // first-event guide shows; the fake keeps its other data intact.
    '/rest/v1/events': (r) =>
      r.method === 'HEAD' && /business_id=eq/.test(r.query)
        ? { json: null, raw: '', headers: { 'content-range': `*/${totalEvents}` } }
        : r.method === 'PATCH'
          ? { json: [], status: 200 }
          : undefined,
    '/rest/v1/rpc/create_event_with_limit_check': (r) => {
      getData().created = JSON.parse(r.body || '{}');
      return { json: NEW_EVENT_ID };
    },
  };
}

async function fillBasics(h) {
  await h.typeInto('input[placeholder="Event name"]', 'Sunday picnic');
  await h.typeInto('textarea[placeholder="What\'s this event about?"]', 'Bring a blanket.');
  await h.click('Music');
  await sleep(500);
}

if (run('H1')) { // Not a host: Create tab is visible and shows the Start hosting landing
  const h = await open({ ...P, dataOpts: { business: false } });
  await h.go('/create', 8000);
  const t = await h.text();
  check('H1 Create shows Start hosting for non-hosts', t.includes('Start hosting') && t.includes('Set Up Hosting'));
  check('H1 Create tab visible in tab bar', t.includes('Create'));
  await shot(h, 'H1-start-hosting');
  check('H1 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('H2')) { // Venue, first event: guided card, suggested preset, preset merge, preview
  let D;
  const h = await open({ ...P, dataOpts: { business: true }, overrides: hostOverrides(() => D, { host_type: 'venue', location_kind: 'fixed' }) });
  D = h.data;
  await h.go('/create', 9000);
  let t = await h.text();
  check('H2 guided card for a host with no events', t.includes('Your first event: three things that matter'));
  check('H2 Event size presets shown', t.includes('Casual meetup') && t.includes('Large event'));
  check('H2 venue gets Venue show suggested, nothing applied', t.includes('Suggested for you: Venue show'));
  check('H2 venue keeps venue wording', t.includes('venue address'));
  const capBefore = await h.eval('document.querySelector(\'input[placeholder="Unlimited"]\')?.value');
  check('H2 suggestion did not prefill capacity', capBefore === '', JSON.stringify(capBefore));
  await shot(h, 'H2-guided');
  await h.click('Class or workshop');
  await sleep(600);
  const cap1 = await h.eval('document.querySelector(\'input[placeholder="Unlimited"]\')?.value');
  check('H2 preset prefills capacity', cap1 === '20', cap1);
  await h.click('Large event');
  await sleep(600);
  const cap2 = await h.eval('document.querySelector(\'input[placeholder="Unlimited"]\')?.value');
  check('H2 switching preset replaces its own value', cap2 === '500', cap2);
  await fillBasics(h);
  await h.click('Preview how your event will look');
  await sleep(1500);
  t = await h.text();
  check('H2 preview sheet renders the Discover card', t.includes('How your event appears on Discover') && t.includes('Sunday picnic'));
  check('H2 preview lists missing cover photo', t.includes('a cover photo'));
  await shot(h, 'H2-preview');
  check('H2 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('H3')) { // Organiser with a home area: no venue wording, must pick a place
  let D;
  const h = await open({
    ...P,
    dataOpts: { business: true },
    overrides: hostOverrides(() => D, { host_type: 'organiser', location_kind: 'area', address: 'Mission District' }),
  });
  D = h.data;
  await h.go('/create', 9000);
  let t = await h.text();
  check('H3 organiser: Casual meetup suggested', t.includes('Suggested for you: Casual meetup'));
  // ("Venue show" is a preset name, so check the location copy specifically.)
  check('H3 organiser: no venue/business wording on location',
    !/venue address|business address|set venue on map/i.test(t) && t.includes('Set where this event happens. Attendees navigate'),
    (t.match(/.{0,30}(venue address|business address|set venue).{0,30}/i) || [''])[0]);
  check('H3 home area is not used as the event address', !t.includes('Mission District'));
  await fillBasics(h);
  await h.click('Publish Event');
  await sleep(1500);
  t = await h.text();
  check('H3 publishing without a place is refused', t.includes('Set where this event happens'));
  check('H3 nothing was created', !D.created);
  await shot(h, 'H3-needs-place');
  check('H3 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('H4')) { // Venue, guided publish: Publish → preview → Publish → published sheet
  let D;
  const h = await open({ ...P, dataOpts: { business: true }, overrides: hostOverrides(() => D, { host_type: 'venue', location_kind: 'fixed' }) });
  D = h.data;
  await h.go('/create', 9000);
  await h.click('Casual meetup');
  await fillBasics(h);
  await h.click('Publish Event');
  await sleep(1500);
  check('H4 guided Publish opens the preview first', (await h.text()).includes('How your event appears on Discover'));
  await h.click('Publish', true);
  await sleep(5000);
  const t = await h.text();
  check('H4 create RPC called once with the venue address', D.created && /Market St/.test(D.created.p_address ?? ''), JSON.stringify(D.created?.p_address));
  check('H4 published sheet for the first event', t.includes('Your first event is live'));
  check('H4 sheet offers share / followers / calendar / manage',
    ['Share the link', 'Notify your followers', 'Add to my calendar', 'Open Manage event'].every((s) => t.includes(s)));
  const typed = h.requests.find((r) => r.method === 'PATCH' && r.path.endsWith('/events') && (r.body || '').includes('event_type'));
  check('H4 preset id recorded on the event', !!typed && typed.body.includes('casual'));
  const waitlist = h.requests.find((r) => r.path.endsWith('rpc/host_set_event_settings'));
  check('H4 casual preset turns the waitlist off after create', !!waitlist && (waitlist.body || '').includes('"off"'));
  await shot(h, 'H4-published');
  await h.click('View Event');
  await sleep(3000);
  check('H4 View Event lands on the event page', (await h.eval('location.pathname')).includes(NEW_EVENT_ID));
  check('H4 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('H5')) { // Getting-started checklist: fresh host expanded, progress, dismiss
  let D;
  const h = await open({
    ...P,
    dataOpts: { business: true },
    overrides: {
      ...hostOverrides(() => D, { host_type: 'organiser', location_kind: 'area', logo_url: null, description: '' }),
      '/rest/v1/rpc/get_host_onboarding_status': () => ({
        json: { has_logo: false, has_description: false, notifications_enabled: true,
          published_events: 0, events_with_capacity: 0, recurring_events: 0, announcements: 0 },
      }),
    },
  });
  D = h.data;
  await h.go('/my-events', 9000);
  let t = await h.text();
  check('H5 checklist card shows for a brand-new host', t.includes('Getting started'));
  check('H5 expanded with the first steps', t.includes('Publish your first event') && t.includes('Add a logo and description'));
  check('H5 organisers get the series step', t.includes('Set up a recurring series'));
  check('H5 notifications step hidden where push is unavailable (web)', !t.includes('Turn on host notifications'));
  check('H5 progress counts the done items', /\d+ of \d+ done/.test(t), (t.match(/\d+ of \d+ done/) || [''])[0]);
  await shot(h, 'H5-checklist');
  check('H5 dismiss', (await h.click('Hide getting started')) === 'ok');
  await sleep(1200);
  check('H5 dismissed card disappears', !(await h.text()).includes('Getting started'));
  await h.go('/profile', 7000);
  await sleep(1500);
  check('H5 stays dismissed on Profile', !(await h.text()).includes('Getting started'));
  check('H5 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('H6')) { // A host with history starts collapsed, not told to publish a first event
  let D;
  const h = await open({
    ...P,
    dataOpts: { business: true },
    overrides: {
      ...hostOverrides(() => D, { host_type: 'venue', location_kind: 'fixed' }),
      '/rest/v1/rpc/get_host_onboarding_status': () => ({
        json: { has_logo: true, has_description: true, notifications_enabled: true,
          published_events: 12, events_with_capacity: 4, recurring_events: 1, announcements: 2 },
      }),
    },
  });
  D = h.data;
  await h.go('/my-events', 9000);
  let t = await h.text();
  check('H6 collapsed for an established host', t.includes('Getting started') && !t.includes('Add a logo and description'));
  // innerText reflects text-transform, so the label reads NEXT here.
  check('H6 shows the next step only', /\bNEXT\b/i.test(t) && t.includes('Share an event'));
  await shot(h, 'H6-collapsed');
  check('H6 expand', (await h.click('Expand getting started')) === 'ok');
  await sleep(1200);
  t = await h.text();
  check('H6 expanded shows done items ticked', t.includes('Publish your first event') && t.includes('Post an announcement'));
  check('H6 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('H7')) { // Missing RPC: fallback keeps the card honest (no unknown items shown)
  let D;
  const h = await open({
    ...P,
    dataOpts: { business: true },
    overrides: {
      ...hostOverrides(() => D, { host_type: 'venue', location_kind: 'fixed' }),
      '/rest/v1/rpc/get_host_onboarding_status': () => ({ status: 404, json: { code: 'PGRST202', message: 'missing' } }),
    },
  });
  D = h.data;
  await h.go('/my-events', 9000);
  const t = await h.text();
  check('H7 card still renders without the RPC', t.includes('Getting started'));
  check('H7 unknown items are hidden, not shown as to-do',
    !t.includes('Post an announcement') && !t.includes('Set an attendee limit'));
  check('H7 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

// ── Stage 5: one-time tips ────────────────────────────────────────────────
const detailsOverride = (eventOver, detailOver = {}) => ({
  '/rest/v1/rpc/get_event_details': (r, data) => {
    const e = data.ev.find((x) => x.id === JSON.parse(r.body || '{}').p_event_id) || data.ev[0];
    const rk = data.ranked.find((x) => x.id === e.id) || data.ranked[0];
    return { json: { event: { ...e, ...eventOver }, business: data.biz,
      category: data.categories.find((c) => c.id === e.category_id), links: [], photos: [],
      rsvp_count: rk.rsvp_count, save_count: rk.save_count, user_rsvp: null, user_saved: false,
      user_following_business: false, ...detailOver } };
  },
});

const overviewOverride = (over) => ({
  '/rest/v1/rpc/get_event_host_overview': () => ({
    json: { going: 0, interested: 0, waitlist: 0, removed: 0, requested: 0, saves: 0,
      views_total: 0, views_7d: 0, announcements_today: 0,
      chat: { locked: false, slow_mode_seconds: 0, open_reports: 0, blocked_count: 0, message_count: 0 },
      ...over },
  }),
});

if (run('H8')) { // First attendee, then the full-event tip, each shown once
  let D;
  const h = await open({
    ...P,
    dataOpts: { business: true },
    overrides: {
      ...hostOverrides(() => D, { host_type: 'venue', location_kind: 'fixed' }),
      ...overviewOverride({ going: 1 }),
      // The default fixture event is capped at 2, which would make 1 attendee
      // "nearly full"; this scenario is about the first attendee only.
      ...detailsOverride({ max_attendees: 50 }),
    },
  });
  D = h.data;
  await h.go(`/business/manage-event/${h.data.ev[0].id}`, 9000);
  let t = await h.text();
  check('H8 first-attendee tip on the hub', t.includes('Your first attendee'));
  await shot(h, 'H8-first-rsvp');
  check('H8 tip action goes to Attendees', (await h.click('See who’s coming')) === 'ok');
  await sleep(2000);
  check('H8 dismissing via the action records it', !(await h.text()).includes('Your first attendee'));
  await h.go(`/business/manage-event/${h.data.ev[0].id}`, 8000);
  await sleep(1500);
  check('H8 tip does not come back', !(await h.text()).includes('Your first attendee'));
  check('H8 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('H9')) { // Full event: waitlist tip wins over the first-attendee tip
  let D;
  const h = await open({
    ...P,
    dataOpts: { business: true },
    overrides: {
      ...hostOverrides(() => D, { host_type: 'venue', location_kind: 'fixed' }),
      ...overviewOverride({ going: 20 }),
      ...detailsOverride({ max_attendees: 20 }, { rsvp_count: 20 }),
    },
  });
  D = h.data;
  await h.go(`/business/manage-event/${h.data.ev[0].id}`, 9000);
  const t = await h.text();
  check('H9 full-event tip takes priority', t.includes('Your event is full') && !t.includes('Your first attendee'));
  check('H9 explains the waitlist', /waitlist/i.test(t));
  await shot(h, 'H9-capacity');
  check('H9 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('H10')) { // A report waiting outranks everything else
  let D;
  const h = await open({
    ...P,
    dataOpts: { business: true },
    overrides: {
      ...hostOverrides(() => D, { host_type: 'venue', location_kind: 'fixed' }),
      ...overviewOverride({ going: 3, chat: { locked: false, slow_mode_seconds: 0, open_reports: 2, blocked_count: 0, message_count: 5 } }),
      ...detailsOverride({ max_attendees: 50 }),
    },
  });
  D = h.data;
  await h.go(`/business/manage-event/${h.data.ev[0].id}`, 9000);
  const t = await h.text();
  check('H10 report tip comes first', t.includes('Someone reported a message') && !t.includes('Your first attendee'));
  check('H10 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('H11')) { // Free plan with one slot left (host has history, so no guide)
  let D;
  const h = await open({
    ...P,
    dataOpts: { business: true },
    overrides: hostOverrides(
      () => D,
      { host_type: 'venue', location_kind: 'fixed',
        subscription_tier: 'free', subscription_expires_at: null, events_created_this_month: 1 },
      { totalEvents: 7 }
    ),
  });
  D = h.data;
  await h.go('/create', 9000);
  const t = await h.text();
  check('H11 last-free-event tip on Create', t.includes('One event left this month'));
  check('H11 no first-event guide for an established host', !t.includes('three things that matter'));
  check('H11 quota pill agrees', /1\/2 this month/.test(t), (t.match(/\d+\/\d+ this month/) || [''])[0]);
  await shot(h, 'H11-last-free');
  check('H11 dismiss', (await h.click('Dismiss tip: One event left this month')) === 'ok');
  await sleep(1200);
  check('H11 dismissed tip stays gone', !(await h.text()).includes('One event left this month'));
  check('H11 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('H12')) { // A brand-new host sees one piece of guidance, not two
  let D;
  const h = await open({
    ...P,
    dataOpts: { business: true },
    overrides: hostOverrides(() => D, {
      host_type: 'venue', location_kind: 'fixed',
      subscription_tier: 'free', subscription_expires_at: null, events_created_this_month: 1,
    }),
  });
  D = h.data;
  await h.go('/create', 9000);
  let t = await h.text();
  check('H12 first-event guide shows', t.includes('Your first event: three things that matter'));
  check('H12 the free-plan tip waits its turn', !t.includes('One event left this month'));
  check('H12 the quota pill still shows the count', /1\/2 this month/.test(t));
  await shot(h, 'H12-one-guidance');
  check('H12 hide the guide', (await h.click('Hide first event tips')) === 'ok');
  await sleep(1500);
  t = await h.text();
  check('H12 the tip appears once the guide is gone', t.includes('One event left this month'));
  check('H12 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

// ── Stage 6: trust ─────────────────────────────────────────────────────────
if (run('H13')) { // Restricted host: told why, Publish disabled, drafts still possible
  let D;
  const h = await open({
    ...P,
    dataOpts: { business: true },
    overrides: hostOverrides(() => D, {
      host_type: 'venue', location_kind: 'fixed',
      standing: 'restricted', standing_reason: 'Repeated misleading listings.',
    }, { totalEvents: 5 }),
  });
  D = h.data;
  await h.go('/create', 9000);
  const t = await h.text();
  check('H13 restriction banner with the reason', t.includes('Publishing is paused') && t.includes('Repeated misleading listings.'));
  check('H13 Publish button says why it is off', t.includes('Publishing paused'));
  const disabled = await h.eval(`(() => { const b = [...document.querySelectorAll('[role=button]')].find((e) => (e.innerText || '').trim() === 'Publishing paused'); return b ? (b.getAttribute('aria-disabled') === 'true' || b.hasAttribute('disabled')) : 'missing'; })()`);
  check('H13 Publish is disabled', disabled === true, String(disabled));
  check('H13 Save as draft stays available', t.includes('Save as draft'));
  await shot(h, 'H13-restricted');
  check('H13 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('H14')) { // Guidelines required at publish: accept, then it publishes
  let D;
  let creates = 0;
  const h = await open({
    ...P,
    dataOpts: { business: true },
    overrides: {
      ...hostOverrides(() => D, { host_type: 'venue', location_kind: 'fixed', host_terms_version: null }, { totalEvents: 5 }),
      '/rest/v1/rpc/create_event_with_limit_check': () => {
        creates += 1;
        return creates === 1
          ? { status: 403, json: { code: '42501', message: 'guidelines_required: accept the host guidelines to publish' } }
          : { json: NEW_EVENT_ID };
      },
      '/rest/v1/businesses': (r) =>
        r.method === 'PATCH' ? ((D.termsPatch = r.body), { json: [], status: 200 }) : { json: { ...D.biz, host_type: 'venue', location_kind: 'fixed' } },
    },
  });
  D = h.data;
  await h.go('/create', 9000);
  await fillBasics(h);
  await h.click('Publish Event');
  await sleep(2500);
  let t = await h.text();
  check('H14 refused publish shows the guidelines', t.includes('Accept the host guidelines') && t.includes('List events honestly'));
  check('H14 says the event is kept', t.includes('Your event is kept'));
  await shot(h, 'H14-guidelines');
  check('H14 accept', (await h.click('Accept and publish')) === 'ok');
  await sleep(5000);
  t = await h.text();
  check('H14 acceptance saved', /host_terms_version/.test(D.termsPatch || ''), D.termsPatch || 'none');
  check('H14 retried and published', creates === 2 && t.includes('Event published'), `creates=${creates}`);
  check('H14 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('H15')) { // Settings: request verification, see it pending
  let D;
  let latest = [];
  const h = await open({
    ...P,
    dataOpts: { business: true },
    seedExtra: { [`eventmap.userMode.${UID}`]: 'business' },
    overrides: {
      ...hostOverrides(() => D, { host_type: 'organiser', location_kind: 'area', verified: false, standing: 'good' }),
      '/rest/v1/host_verification_requests': () => ({ json: latest.length ? latest[0] : null }),
      '/rest/v1/rpc/submit_verification_request': (r) => {
        D.verifyBody = r.body;
        latest = [{ id: 'req-1', business_id: D.biz.id, status: 'pending', evidence_url: 'https://instagram.com/club',
          note: null, reviewer_note: null, reviewed_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }];
        return { json: 'req-1' };
      },
    },
  });
  D = h.data;
  await h.go('/settings', 9000);
  await h.scrollEnd();
  await sleep(1500);
  let t = await h.text();
  check('H15 offers verification', t.includes('Get verified') && t.includes('Request Verification'));
  check('H15 open the form', (await h.click('Request Verification')) === 'ok');
  await sleep(800);
  await h.typeInto('input[placeholder="yoursite.com or instagram.com/you"]', 'instagram.com/club');
  check('H15 send', (await h.click('Send Request')) === 'ok');
  await sleep(3000);
  t = await h.text();
  check('H15 sends a normalised https link', /https:\/\/instagram\.com\/club/.test(D.verifyBody || ''), D.verifyBody || 'none');
  check('H15 now shows as pending', t.includes('Verification requested'));
  await shot(h, 'H15-verification');
  check('H15 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('H16')) { // Stage 7: stop hosting, then reopen
  let D;
  let archived = null;
  const h = await open({
    ...P,
    dataOpts: { business: true },
    seedExtra: { [`eventmap.userMode.${UID}`]: 'business' },
    overrides: {
      '/rest/v1/rpc/get_user_business': () => ({
        json: [{ ...D.biz, host_type: 'venue', location_kind: 'fixed', standing: 'good', archived_at: archived }],
      }),
      '/rest/v1/host_verification_requests': () => ({ json: null }),
      '/rest/v1/rpc/archive_business': () => ((archived = new Date().toISOString()), { json: 3 }),
      '/rest/v1/rpc/reopen_business': () => ((archived = null), { json: null }),
    },
  });
  D = h.data;
  await h.go('/settings', 9000);
  await h.scrollEnd();
  await sleep(1500);
  let t = await h.text();
  check('H16 stop hosting is offered', t.includes('Stop hosting') && t.includes('Cancels your upcoming events'));
  check('H16 tap stop', (await h.click('Stop Hosting')) === 'ok');
  await sleep(1200);
  check('H16 confirmation explains the consequence', (await h.text()).includes('everyone going is told'));
  check('H16 confirm', (await h.click('Stop hosting', true)) === 'ok');
  await sleep(3000);
  t = await h.text();
  check('H16 says how many events were cancelled', /3 upcoming events cancelled/.test(t), (t.match(/cancelled[^.]*/) || [''])[0]);
  check('H16 now offers reopening', t.includes('Hosting is closed') || t.includes('Reopen Hosting'));
  await shot(h, 'H16-stopped');
  check('H16 reopen', (await h.click('Reopen Hosting')) === 'ok');
  await sleep(2500);
  check('H16 back to offering stop', (await h.text()).includes('Stop hosting'));
  check('H16 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nsuiteHost: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
