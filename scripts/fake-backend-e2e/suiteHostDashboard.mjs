// Host dashboard (docs/HOST_DASHBOARD_PLAN.md, phase C1) against the FAKE
// backend — no database. Run in the foreground:
//   node scripts/fake-backend-e2e/suiteHostDashboard.mjs "$PWD" <dist> [all|H1,..] [outDir]
//
// H1  agenda renders: one-off, a series expanded into dates, a skipped date
//     (struck, "Skipped"), a moved date ("Moved"), per-date vs series counts
// H2  My Events header link opens the dashboard
// H3  Profile "Today" card: invitation before the first visit, the cached
//     summary after it — and the card itself makes no requests
// H4  layout at 390 and 320 px: heading, labelled controls, 44 px targets,
//     no horizontal overflow, no runtime errors
// H5  empty week and a failed load (error state with Retry)
// H6  "Needs you" (C2): rules, urgency order, deep link into Manage's tab
// H7  fan-out cap of 10 overview calls (DC5), stated on screen
// H8  a quiet week shows no queue at all
// H9  C5: skip a date from the schedule (sheet → confirm → don't notify)
// H10 C5: restore a skipped date; the sheet offers only Restore
// H11 C5: the move picker opens for the right date and Cancel sends nothing
// H12 regression: Manage event's "Upcoming dates" skips via the shared hook
// H13 C6 web: axe WCAG A/AA (schedule, queue, and the date sheet open),
//     keyboard walk, Escape closing both overlays, focus moving into them
// H14 C6 web: 1280 px wide and 640 px (200 % zoom of 1280) reflow
// H15 C6 web: large text (every font size scaled 1.3× and 1.6×)
//
// Pass AXE=node_modules/axe-core/axe.min.js to enable the axe pass.
//
// The four endpoints the dashboard calls are answered with deterministic
// rows built relative to the time of the run, so nothing depends on the
// fake's PostgREST filter parsing.
import { open, check, results, sleep, UID, scaleText, layoutFacts } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

const [repo, dist, only, outDir] = process.argv.slice(2);
const P = { repo, dist };
const run = (k) => !only || only === 'all' || only.split(',').includes(k);

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const now = Date.now();
/** UTC date key, matching the series' 'UTC' zone. */
const keyAt = (ms) => new Date(ms).toISOString().slice(0, 10);
const todayKeyUtc = keyAt(now);
const utcMidnight = Date.parse(`${todayKeyUtc}T00:00:00.000Z`);

const SERIES_ID = '00000000-0000-4000-8000-00000000d501';
const ONEOFF_ID = '00000000-0000-4000-8000-00000000d502';

function dashboardRows(bizId) {
  // A daily series at 12:00 UTC that began a month ago.
  const seriesStart = new Date(utcMidnight - 30 * DAY + 12 * HOUR).toISOString();
  const series = {
    id: SERIES_ID, business_id: bizId, title: 'Morning yoga',
    start_datetime: seriesStart, end_datetime: new Date(Date.parse(seriesStart) + HOUR).toISOString(),
    is_recurring: true, recurrence_pattern: { frequency: 'daily', interval: 1 }, timezone: 'UTC',
    status: 'active', publish_state: 'published', rsvp_mode: 'open', max_attendees: null,
    description: 'Daily class', address: '1 Test St', latitude: 0, longitude: 0, category_id: null,
    cover_image_url: null, created_at: seriesStart, updated_at: seriesStart,
  };
  const oneOffStart = new Date(now + 3 * DAY).toISOString();
  const oneOff = {
    ...series, id: ONEOFF_ID, title: 'Spring market', is_recurring: false, recurrence_pattern: null,
    timezone: null, max_attendees: 150, start_datetime: oneOffStart,
    end_datetime: new Date(Date.parse(oneOffStart) + 4 * HOUR).toISOString(),
  };
  return [series, oneOff];
}

const skipKey = keyAt(utcMidnight + 2 * DAY);
const moveKey = keyAt(utcMidnight + 4 * DAY);
const exceptions = [
  { event_id: SERIES_ID, occurrence_date: skipKey, kind: 'cancelled', new_start: null, new_end: null, note: 'Studio closed' },
  {
    event_id: SERIES_ID, occurrence_date: moveKey, kind: 'rescheduled',
    new_start: new Date(utcMidnight + 4 * DAY + 15 * HOUR).toISOString(),
    new_end: new Date(utcMidnight + 4 * DAY + 16 * HOUR).toISOString(), note: null,
  },
];

/** Overrides for the dashboard's endpoints. `state.events` can be swapped per scenario. */
function dashboardOverrides(state) {
  return {
    '/rest/v1/events': (r, data) => {
      if (r.method === 'HEAD') return { json: null, raw: '', headers: { 'content-range': `*/${state.events(data).length}` } };
      if (r.method === 'GET' && /publish_state=eq\.draft/.test(r.query)) {
        return { json: state.draftsFor ? state.draftsFor(data) : state.drafts || [] };
      }
      if (r.method === 'GET' && /business_id=eq/.test(r.query)) {
        if (state.failEvents) return { status: 500, json: { message: 'boom' } };
        return { json: state.events(data) };
      }
      return undefined;
    },
    '/rest/v1/rpc/get_host_events_counts': () => ({
      json: [
        { event_id: SERIES_ID, going: 40, interested: 0, waitlist: 0 },
        { event_id: ONEOFF_ID, going: 112, interested: 3, waitlist: 4 },
      ],
    }),
    '/rest/v1/event_occurrence_exceptions': () => ({ json: state.exceptions }),
    '/rest/v1/rpc/get_event_details': (r, data) => {
      // get_event_details takes `event_uuid` (services/rpcArgs), not p_event_id.
      const body = JSON.parse(r.body || '{}');
      const id = body.event_uuid ?? body.p_event_id;
      const e = state.events(data).concat(state.drafts || []).find((x) => x.id === id);
      if (!e) return undefined;
      return {
        json: { event: e, business: data.biz, category: null, links: [], photos: [],
          rsvp_count: 0, save_count: 0, user_rsvp: null, user_saved: false, user_following_business: false },
      };
    },
    '/rest/v1/rpc/get_event_host_overview': (r) => {
      const { p_event_id: id } = JSON.parse(r.body || '{}');
      state.overviewCalls.push(id);
      const o = (state.overviews || {})[id];
      return {
        json: {
          going: 0, interested: 0, waitlist: 0, removed: 0, requested: o?.requested ?? 0,
          saves: 0, views_total: 0, views_7d: 0, announcements_today: 0,
          chat: { locked: false, slow_mode_seconds: 0, message_count: 0, blocked_count: 0,
            open_reports: o?.open_reports ?? 0 },
        },
      };
    },
    '/rest/v1/rpc/skip_occurrence': (r) => {
      const b = JSON.parse(r.body || '{}');
      (state.opCalls ||= []).push({ fn: 'skip', ...b });
      state.exceptions = [...state.exceptions.filter((x) => x.occurrence_date !== b.p_date),
        { event_id: b.p_event_id, occurrence_date: b.p_date, kind: 'cancelled', new_start: null, new_end: null, note: null }];
      return { json: { status: 'cancelled', date: b.p_date, notified: b.p_notify ? 3 : 0 } };
    },
    '/rest/v1/rpc/restore_occurrence': (r) => {
      const b = JSON.parse(r.body || '{}');
      (state.opCalls ||= []).push({ fn: 'restore', ...b });
      state.exceptions = state.exceptions.filter((x) => x.occurrence_date !== b.p_date);
      return { json: { status: 'scheduled', date: b.p_date, notified: 0 } };
    },
    '/rest/v1/rpc/get_occurrence_going_counts': (r) => {
      const { p_dates = [] } = JSON.parse(r.body || '{}');
      // Only tomorrow has a per-date count; other dates fall back to the series.
      const tomorrow = keyAt(utcMidnight + DAY);
      return { json: p_dates.includes(tomorrow) ? [{ occurrence_date: tomorrow, going_count: 28, waitlist_count: 0 }] : [] };
    },
  };
}

const defaultState = (extra = {}) => ({
  events: (data) => dashboardRows(data.biz.id),
  exceptions, failEvents: false, drafts: [], overviews: {}, overviewCalls: [],
  ...extra,
});

const INSPECT = `JSON.stringify((() => {
  const SEL = '[role=button],[role=link],[role=tab],button,a[href],[tabindex]:not([tabindex="-1"])';
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < innerHeight; };
  const name = (e) => (e.getAttribute('aria-label') || e.innerText || '').trim();
  const els = [...document.querySelectorAll(SEL)].filter((e) => vis(e) && e.getAttribute('aria-hidden') !== 'true');
  const sized = els.map((e) => { const r = e.getBoundingClientRect(); return { name: name(e).slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) }; });
  return {
    unlabeled: els.filter((e) => !name(e)).length,
    small: sized.filter((x) => x.h < 44 && x.w < 44),
    headings: [...document.querySelectorAll('[role=heading],h1,h2,h3')].filter(vis).map((e) => e.innerText.trim()),
    overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
  };
})())`;


/* ───────────────────── C6 (web half) helpers ───────────────────── */
const axeSrc = process.env.AXE && fs.existsSync(process.env.AXE) ? fs.readFileSync(process.env.AXE, 'utf8') : null;
// Same rules the other suites ignore/warn on: they reflect React Native Web's
// DOM model (no landmarks or document outline), not this screen.
const AXE_IGNORE = new Set(['region', 'landmark-one-main', 'page-has-heading-one', 'bypass']);
const AXE_WARN = new Set(['nested-interactive', 'label-content-name-mismatch']);

async function axe(h) {
  if (!axeSrc) return null;
  await h.send('Runtime.evaluate', { expression: axeSrc });
  const r = await h.eval(`axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa'] }, resultTypes: ['violations'] }).then((r) => JSON.stringify(r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length, sample: v.nodes.slice(0, 2).map((n) => n.html.slice(0, 140)) }))))`);
  try { return JSON.parse(r).filter((v) => !AXE_IGNORE.has(v.id)); }
  catch { return [{ id: 'axe-failed', impact: 'critical', help: String(r).slice(0, 160), count: 0, sample: [] }]; }
}

async function axeCheck(h, label) {
  const v = await axe(h);
  if (!v) { console.log(`SKIP ${label} axe (set AXE=node_modules/axe-core/axe.min.js)`); return; }
  const warned = v.filter((x) => AXE_WARN.has(x.id));
  if (warned.length) console.log(`WARN ${label} axe (reviewed): ${warned.map((x) => `${x.id}×${x.count}`).join(', ')}`);
  const serious = v.filter((x) => ['serious', 'critical'].includes(x.impact) && !AXE_WARN.has(x.id));
  check(`${label} axe: no serious/critical violations`, serious.length === 0,
    serious.map((x) => `${x.id}×${x.count}: ${x.sample[0] || ''}`).join(' || '));
  const moderate = v.filter((x) => !['serious', 'critical'].includes(x.impact) && !AXE_WARN.has(x.id));
  if (moderate.length) console.log(`NOTE ${label} axe (minor): ${moderate.map((x) => `${x.id}×${x.count}`).join(', ')}`);
}

const key = async (h, k, code, vk, mods = 0) => {
  await h.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods });
  await h.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods });
};
const tab = (h) => key(h, 'Tab', 'Tab', 9);
const escape = (h) => key(h, 'Escape', 'Escape', 27);

const ACTIVE = `(() => { const e = document.activeElement; if (!e || e === document.body) return { body: true };
  const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
  const name = (e.getAttribute('aria-label') || e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 50);
  const focusRing = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none';
  return { name, role: e.getAttribute('role') || e.tagName.toLowerCase(), x: Math.round(r.x), y: Math.round(r.y),
    focusRing, offscreen: r.bottom < 0 || r.top > innerHeight }; })()`;

async function tabWalk(h, steps = 22) {
  await h.eval('document.body.focus(); document.activeElement && document.activeElement.blur()');
  const seq = [];
  for (let i = 0; i < steps; i++) { await tab(h); await sleep(55); seq.push(await h.eval(ACTIVE)); }
  const reached = seq.filter((x) => !x.body);
  const uniq = new Set(reached.map((x) => `${x.role}|${x.name}|${x.x},${x.y}`)).size;
  return {
    reached: reached.length, unique: uniq,
    unnamed: reached.filter((x) => !x.name).length,
    noRing: reached.filter((x) => !x.focusRing).length,
    offscreen: reached.filter((x) => x.offscreen).length,
    stuck: reached.length > 3 && uniq <= 2,
    names: reached.map((x) => x.name),
  };
}

/** Layout facts at the current viewport / font settings. */
const LAYOUT = `JSON.stringify((() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const els = [...document.querySelectorAll('[role=button],[role=link],[role=tab],button,a[href]')].filter(vis);
  const name = (e) => (e.getAttribute('aria-label') || e.innerText || '').trim();
  return {
    overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    unlabeled: els.filter((e) => !name(e)).length,
    tiny: els.map((e) => { const r = e.getBoundingClientRect(); return { n: name(e).slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; })
           .filter((x) => x.h < 24 || x.w < 24),
    headings: [...document.querySelectorAll('[role=heading],h1,h2,h3')].filter(vis).map((e) => e.innerText.trim()).slice(0, 6),
    // Text cut off by a fixed-height/overflow-hidden box.
    clipped: [...document.querySelectorAll('div,span')].filter((e) => vis(e) && e.innerText && e.innerText.length < 80
      && e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX === 'hidden')
      .map((e) => e.innerText.trim().slice(0, 40)).slice(0, 6),
  };
})())`;

async function shot(h, label) {
  if (!outDir) return;
  fs.mkdirSync(outDir, { recursive: true });
  await h.shot(path.join(outDir, `${label}.png`));
}

if (run('H1')) {
  const state = defaultState();
  const h = await open({ ...P, dataOpts: { business: true }, viewport: [390, 844], overrides: dashboardOverrides(state) });
  await h.go('/hosting', 9000);
  const t = await h.text();
  check('H1 heading "Hosting" is shown', /Hosting/.test(t), t.slice(0, 80));
  check('H1 one-off listed with capacity and waitlist', /Spring market/.test(t) && /112 \/ 150 going · 4 waiting/.test(t),
    (t.match(/.{0,20}Spring market.{0,60}/s) || [''])[0].replace(/\s+/g, ' '));
  const yogaRows = (t.match(/Morning yoga/g) || []).length;
  // 7 window days, minus today's slot if 12:00 UTC has passed in a way that ends it — at least 5.
  check('H1 series expanded into its dates', yogaRows >= 5, `rows=${yogaRows}`);
  check('H1 skipped date shown as Skipped with the host note', /Skipped/.test(t) && /Studio closed/.test(t));
  check('H1 moved date marked Moved', /Moved/.test(t));
  check('H1 per-date count used where available', /28 going(?! to the series)/.test(t));
  check('H1 series count labelled as such elsewhere', /40 going to the series/.test(t));
  check('H1 summary strip present', /this week/.test(t) && /today/.test(t));
  const struck = await h.eval(`[...document.querySelectorAll('div,span')].some((e) => e.innerText === 'Morning yoga' && getComputedStyle(e).textDecorationLine.includes('line-through'))`);
  check('H1 skipped date title is struck through', struck === true);
  const requests = {
    events: h.count((r) => r.method === 'GET' && r.path === '/rest/v1/events' && /business_id=eq/.test(r.query)),
    counts: h.count('POST rpc/get_host_events_counts'),
    exceptions: h.count((r) => r.path === '/rest/v1/event_occurrence_exceptions'),
    perDate: h.count('POST rpc/get_occurrence_going_counts'),
  };
  check('H1 data plan: one events, one counts, one exceptions, one per-date call per series',
    requests.events >= 1 && requests.counts === 1 && requests.exceptions === 1 && requests.perDate === 1, JSON.stringify(requests));
  const opened = await h.click('Spring market');
  await sleep(4000);
  const url = await h.eval('location.pathname');
  check('H1 a row opens Manage event', opened === 'ok' && url.includes(`/business/manage-event/${ONEOFF_ID}`), `${opened} ${url}`);
  check('H1 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await shot(h, 'H1-agenda-390');
  await h.close();
}

if (run('H2')) {
  const state = defaultState();
  const h = await open({ ...P, dataOpts: { business: true }, viewport: [390, 844], overrides: dashboardOverrides(state) });
  await h.go('/my-events', 9000);
  const r = await h.click("This week's schedule", true);
  await sleep(5000);
  const url = await h.eval('location.pathname');
  check('H2 My Events header link opens /hosting', r === 'ok' && url === '/hosting', `${r} ${url}`);
  check('H2 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('H3')) {
  const state = defaultState();
  const h = await open({
    ...P,
    dataOpts: { business: true },
    viewport: [390, 844],
    seedExtra: { [`eventmap.userMode.${UID}`]: 'business' },
    overrides: dashboardOverrides(state),
  });
  await h.go('/profile', 9000);
  const before = await h.text();
  check('H3 card invites before the first dashboard visit', /Your hosting week/.test(before), (before.match(/.{0,40}hosting.{0,40}/i) || [''])[0]);
  check('H3 Profile alone makes no dashboard requests', h.count('POST rpc/get_host_events_counts') === 0 && h.count((r) => r.path === '/rest/v1/event_occurrence_exceptions') === 0);
  const r = await h.click('Hosting schedule');
  await sleep(6000);
  check('H3 card opens /hosting', r === 'ok' && (await h.eval('location.pathname')) === '/hosting', r);
  await h.eval('history.back()');
  await sleep(4000);
  const after = await h.text();
  check('H3 card shows the cached week after a visit', /\d+ this week/.test(after), (after.match(/.{0,40}this week.{0,40}/) || [''])[0]);
  // With nothing today the next item is on a later day, and the card must
  // say which ("Next: Tomorrow 12:00 PM …"), never a bare time.
  const nextLine = (after.match(/Next: [^\n]*/) || [''])[0];
  const nothingToday = !/\d+ today · /.test(after);
  check('H3 card names the day of the next item when it is not today',
    !nothingToday || /^Next: (Tomorrow|[A-Z][a-z]{2}) /.test(nextLine), nextLine);
  check('H3 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await shot(h, 'H3-profile-card');
  await h.close();
}

if (run('H4')) {
  for (const [w, ht] of [[390, 844], [320, 568]]) {
    const state = defaultState();
    const h = await open({ ...P, dataOpts: { business: true }, viewport: [w, ht], overrides: dashboardOverrides(state) });
    await h.go('/hosting', 9000);
    const r = JSON.parse(await h.eval(INSPECT));
    check(`H4 [${w}] heading present`, r.headings.some((x) => /Hosting/.test(x)), JSON.stringify(r.headings.slice(0, 4)));
    check(`H4 [${w}] every control labelled`, r.unlabeled === 0, `unlabeled=${r.unlabeled}`);
    check(`H4 [${w}] targets ≥ 44 px`, r.small.length === 0, JSON.stringify(r.small.slice(0, 3)));
    check(`H4 [${w}] no horizontal overflow`, r.overflowX === 0, `overflowX=${r.overflowX}`);
    check(`H4 [${w}] no runtime errors`, h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
    await shot(h, `H4-agenda-${w}`);
    await h.close();
  }
}

if (run('H5')) {
  {
    const state = { ...defaultState(), events: () => [] };
    const h = await open({ ...P, dataOpts: { business: true }, viewport: [390, 844], overrides: dashboardOverrides(state) });
    await h.go('/hosting', 9000);
    const t = await h.text();
    check('H5 empty week explained, with Create event', /Nothing on this week/.test(t) && /Create event/.test(t), t.slice(0, 120));
    check('H5 empty: no exceptions or per-date calls', h.count((r) => r.path === '/rest/v1/event_occurrence_exceptions') === 0 && h.count('POST rpc/get_occurrence_going_counts') === 0);
    await h.close();
  }
  {
    const state = { ...defaultState(), failEvents: true };
    const h = await open({ ...P, dataOpts: { business: true }, viewport: [390, 844], overrides: dashboardOverrides(state) });
    await h.go('/hosting', 12000);
    const t = await h.text();
    check('H5 failed load shows an error with Retry', /Couldn.t load your schedule/.test(t) && /Retry|Try again/i.test(t), t.slice(0, 120));
    await h.close();
  }
}


if (run('H6')) { // Needs you: rules, ordering, deep links
  const mk = (bizId) => {
  const approval = {
    id: '00000000-0000-4000-8000-00000000d503', business_id: bizId, title: 'Board game night',
    start_datetime: new Date(now + 2 * DAY).toISOString(), end_datetime: new Date(now + 2 * DAY + 3 * HOUR).toISOString(),
    is_recurring: false, recurrence_pattern: null, timezone: null, status: 'active', publish_state: 'published',
    rsvp_mode: 'approval', max_attendees: null, description: '', address: '1 Test St', latitude: 0, longitude: 0,
    category_id: null, cover_image_url: null, created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(),
  };
  const postponed = { ...approval, id: '00000000-0000-4000-8000-00000000d504', title: 'Rained-off picnic', status: 'postponed', rsvp_mode: 'open' };
  const staleDraft = {
    ...approval, id: '00000000-0000-4000-8000-00000000d505', title: 'Spring market draft', publish_state: 'draft',
    rsvp_mode: 'open', start_datetime: new Date(now + 10 * DAY).toISOString(),
    updated_at: new Date(now - 9 * DAY).toISOString(),
  };
    return { approval, postponed, staleDraft };
  };
  const seed = mk('seed');
  const state = defaultState({
    events: (data) => { const m = mk(data.biz.id); return [m.approval, m.postponed]; },
    exceptions: [],
    drafts: [],
    overviews: { [seed.approval.id]: { requested: 4, open_reports: 2 } },
  });
  // Drafts are served from the same builder, once the business id is known.
  state.draftsFor = (data) => [mk(data.biz.id).staleDraft];
  const approval = seed.approval;
  const h = await open({ ...P, dataOpts: { business: true }, viewport: [390, 844], overrides: dashboardOverrides(state) });
  await h.go('/hosting', 9000);
  const t = await h.text();
  check('H6 section header present', /Needs you/i.test(t), t.slice(0, 100));
  check('H6 chat reports listed', /2 chat reports/.test(t));
  check('H6 requests listed', /4 requests waiting/.test(t));
  check('H6 postponed listed', /needs a new date/i.test(t));
  check('H6 stale draft listed', /Draft not published yet/.test(t));
  const order = ['chat reports', 'requests waiting', 'needs a new date', 'Draft not published'].map((x) => t.indexOf(x));
  check('H6 ordered by urgency', order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), JSON.stringify(order));
  check('H6 overview fan-out stays within the cap', state.overviewCalls.length <= 10 && state.overviewCalls.length >= 1,
    `calls=${state.overviewCalls.length}`);
  check('H6 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await shot(h, 'H6-needs-you');

  const r = await h.click('4 requests waiting');
  await sleep(5000);
  const url = await h.eval('location.pathname + location.search');
  check('H6 request row opens Manage › Attendees › Requests', r === 'ok' && url.includes(`/business/manage-event/${approval.id}`) && /tab=attendees/.test(url) && /seg=requested/.test(url), `${r} ${url}`);
  await sleep(2500);
  const onTab = await h.text();
  // The hub opens on Attendees with the Requests segment selected, not Overview.
  const selected = await h.eval(`JSON.stringify([...document.querySelectorAll('[role=tab],[role=button]')].filter((e) => e.getAttribute('aria-selected') === 'true').map((e) => (e.getAttribute('aria-label') || e.innerText || '').trim()))`);
  check('H6 the Requests segment is actually open', /Requests/.test(selected), `${selected} | ${onTab.slice(0, 80).replace(/\n/g, ' ')}`);
  await h.close();
}

if (run('H7')) { // Fan-out cap: many events, at most 10 overview calls, with a note
  const manyFor = (bizId) => Array.from({ length: 14 }, (_, i) => ({
    id: `00000000-0000-4000-8000-0000000006${String(i).padStart(2, '0')}`, business_id: bizId,
    title: `Event ${i}`, start_datetime: new Date(now + (i + 1) * DAY).toISOString(),
    end_datetime: new Date(now + (i + 1) * DAY + HOUR).toISOString(), is_recurring: false,
    recurrence_pattern: null, timezone: null, status: 'active', publish_state: 'published',
    rsvp_mode: 'open', max_attendees: null, description: '', address: '1 Test St', latitude: 0, longitude: 0,
    category_id: null, cover_image_url: null, created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(),
  }));
  const many = manyFor('seed');
  const state = defaultState({ events: (data) => manyFor(data.biz.id), exceptions: [] });
  const h = await open({ ...P, dataOpts: { business: true }, viewport: [390, 844], overrides: dashboardOverrides(state) });
  await h.go('/hosting', 10000);
  check('H7 at most ten overview calls (DC5)', state.overviewCalls.length === 10, `calls=${state.overviewCalls.length}`);
  check('H7 the soonest events are the ones inspected', state.overviewCalls[0] === many[0].id, state.overviewCalls[0]);
  const t = await h.text();
  check('H7 the limit is stated, not implied', /Checked your next 10 events/.test(t), (t.match(/Checked[^\n]*/) || [''])[0]);
  check('H7 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('H8')) { // A quiet week: no section, no false "0"
  // The default fixture's one-off has a waitlist of 4 with room to spare,
  // which legitimately needs the host; a quiet week has none of that.
  const state = defaultState();
  const quiet = dashboardOverrides(state);
  quiet['/rest/v1/rpc/get_host_events_counts'] = () => ({
    json: [
      { event_id: SERIES_ID, going: 40, interested: 0, waitlist: 0 },
      { event_id: ONEOFF_ID, going: 112, interested: 3, waitlist: 0 },
    ],
  });
  const h = await open({ ...P, dataOpts: { business: true }, viewport: [390, 844], overrides: quiet });
  await h.go('/hosting', 9000);
  const t = await h.text();
  check('H8 no "Needs you" section when nothing needs the host', !/Needs you/i.test(t), (t.match(/.{0,40}Needs you.{0,40}/i) || [''])[0]);
  check('H8 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

// C5 helpers: find a row's options button / the sheet, by accessible name.
const optionsButtons = (h) => h.eval(`JSON.stringify([...document.querySelectorAll('[role=button]')].map((e) => e.getAttribute('aria-label') || '').filter((l) => l.startsWith('Date options for ')))`).then(JSON.parse);

if (run('H9')) { // Skip a date from the schedule, telling nobody
  const state = defaultState({ exceptions: [] });
  const h = await open({ ...P, dataOpts: { business: true }, viewport: [390, 844], overrides: dashboardOverrides(state) });
  await h.go('/hosting', 9000);
  const buttons = await optionsButtons(h);
  check('H9 series rows offer date options', buttons.length >= 5 && buttons.every((l) => l.includes('Morning yoga')), `${buttons.length}: ${buttons[0] || ''}`);
  check('H9 the one-off has no date options', !buttons.some((l) => l.includes('Spring market')));
  check('H9 every options button has a distinct label (names the date)', new Set(buttons).size === buttons.length, JSON.stringify(buttons.slice(0, 2)));
  check('H9 open the first series date', (await h.click(buttons[0], true)) === 'ok');
  await sleep(1200);
  const sheet = await h.text();
  check('H9 sheet offers change time, skip and Manage', /Change this date.s time/.test(sheet) && /Skip this date/.test(sheet) && /Open Manage event/.test(sheet) && !/Restore the original date/.test(sheet));
  check('H9 choose Skip', (await h.click('Skip this date', true)) === 'ok');
  await sleep(1000);
  check('H9 confirm the skip', (await h.click('Skip date', true)) === 'ok');
  await sleep(800);
  check('H9 decline to notify', (await h.click('Don’t notify', true)) === 'ok');
  await sleep(4000);
  const call = (state.opCalls || []).find((c) => c.fn === 'skip');
  check('H9 skip_occurrence sent for that date, without notifying', !!call && /^\d{4}-\d{2}-\d{2}$/.test(call.p_date) && call.p_notify === false && call.p_event_id === SERIES_ID, JSON.stringify(call));
  const after = await h.text();
  check('H9 the schedule refreshes to show it skipped', /Skipped/.test(after) && /Date skipped\./.test(after), (after.match(/Date skipped[^\n]*/) || [''])[0]);
  check('H9 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await shot(h, 'H9-after-skip');
  await h.close();
}

if (run('H10')) { // Restore a skipped date
  const state = defaultState(); // fixture already has a skipped date (skipKey)
  const h = await open({ ...P, dataOpts: { business: true }, viewport: [390, 844], overrides: dashboardOverrides(state) });
  await h.go('/hosting', 9000);
  // The skipped row is the one whose sheet offers Restore; find it by opening each until it does.
  let found = false;
  for (const label of await optionsButtons(h)) {
    await h.click(label, true); await sleep(900);
    const t = await h.text();
    if (/Restore the original date/.test(t) && /· skipped/.test(t)) { found = true; break; }
    await h.click('Close', true); await sleep(600);
  }
  check('H10 the skipped date offers Restore (and not Skip)', found);
  const sheet = await h.text();
  check('H10 restore sheet has no Skip or Change time', !/Skip this date/.test(sheet) && !/Change this date.s time/.test(sheet));
  // Label in Name (WCAG 2.5.3): every sheet row's accessible name equals its visible text.
  const mismatched = await h.eval(`JSON.stringify([...document.querySelectorAll('[data-testid=agenda-date-actions] [role=button]')].map((e) => [e.getAttribute('aria-label'), e.innerText.trim()]).filter(([a, t]) => a && t && a !== t))`).then(JSON.parse);
  check('H10 sheet rows: accessible name matches visible text', mismatched.length === 0, JSON.stringify(mismatched));
  await h.click('Restore the original date', true); await sleep(900);
  await h.click('Restore', true); await sleep(700);
  await h.click('Don’t notify', true); await sleep(4000);
  const call = (state.opCalls || []).find((c) => c.fn === 'restore');
  check('H10 restore_occurrence sent for the skipped date', !!call && call.p_date === skipKey, JSON.stringify(call));
  const t = await h.text();
  check('H10 the schedule no longer shows it skipped', !/Studio closed/.test(t) && /Date restored\./.test(t));
  check('H10 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('H11')) { // Change a date's time: the picker opens, Cancel backs out with no request
  const state = defaultState({ exceptions: [] });
  const h = await open({ ...P, dataOpts: { business: true }, viewport: [390, 844], overrides: dashboardOverrides(state) });
  await h.go('/hosting', 9000);
  const [first] = await optionsButtons(h);
  await h.click(first, true); await sleep(900);
  await h.click('Change this date’s time', true); await sleep(1500);
  const t = await h.text();
  check('H11 move picker opens for that date', /Move this date/.test(t) && /Originally /.test(t), (t.match(/Originally[^\n]*/) || [''])[0]);
  check('H11 picker has a labelled date-time input', (await h.eval(`!!document.querySelector('[aria-label="New start"]')`)) === true);
  await h.click('Cancel', true); await sleep(1000);
  check('H11 Cancel closes the picker without a request', !/Move this date/.test(await h.text()) && !(state.opCalls || []).length);
  check('H11 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('H12')) { // Regression: Manage event's "Upcoming dates" still skips through the shared hook
  const state = defaultState({ exceptions: [] });
  const h = await open({ ...P, dataOpts: { business: true }, viewport: [390, 844], overrides: dashboardOverrides(state) });
  await h.go(`/business/manage-event/${SERIES_ID}`, 10000);
  await h.scrollEnd(); await sleep(1500);
  const labels = await h.eval(`JSON.stringify([...document.querySelectorAll('[role=button]')].map((e) => e.getAttribute('aria-label') || '').filter((l) => /^Skip /.test(l)))`).then(JSON.parse);
  check('H12 Upcoming dates lists Skip buttons', labels.length >= 3, `${labels.length}`);
  if (labels.length) {
    await h.click(labels[0], true); await sleep(900);
    await h.click('Skip date', true); await sleep(700);
    await h.click('Notify', true); await sleep(3500);
  }
  const call = (state.opCalls || []).find((c) => c.fn === 'skip');
  check('H12 skip_occurrence sent from Manage event, notifying', !!call && call.p_notify === true, JSON.stringify(call));
  check('H12 notified count reported in the toast', /3 people were notified/.test(await h.text()));
  check('H12 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('H13')) { // Accessibility: axe, keyboard, Escape on both overlays
  const state = defaultState({ exceptions: [] });
  const h = await open({ ...P, dataOpts: { business: true }, viewport: [390, 844], overrides: dashboardOverrides(state) });
  await h.go('/hosting', 9000);
  await axeCheck(h, 'H13 schedule [390]');

  const kb = await tabWalk(h);
  check('H13 Tab reaches named controls, none off-screen, not stuck',
    kb.reached > 0 && !kb.stuck && kb.unnamed === 0 && kb.offscreen === 0, JSON.stringify({ ...kb, names: kb.names.slice(0, 4) }));
  check('H13 every focused control shows a focus ring', kb.noRing === 0, `${kb.noRing} of ${kb.reached} without a ring`);

  // The date sheet: axe with it open, focus inside it, Escape closes it.
  const [first] = await optionsButtons(h);
  await h.click(first, true);
  await sleep(1200);
  const sheetOpen = await h.eval(`!!document.querySelector('[data-testid=agenda-date-actions]')`);
  check('H13 date sheet opens', sheetOpen === true);
  await axeCheck(h, 'H13 date sheet [390]');
  const focusInSheet = await h.eval(`(() => { const s = document.querySelector('[data-testid=agenda-date-actions]');
    const a = document.activeElement; return !!s && !!a && a !== document.body && s.contains(a); })()`);
  check('H13 focus moves into the date sheet', focusInSheet === true);
  await escape(h);
  await sleep(900);
  check('H13 Escape closes the date sheet',
    (await h.eval(`!!document.querySelector('[data-testid=agenda-date-actions]')`)) === false);

  // The move picker is a second overlay: same expectations.
  await h.click(first, true); await sleep(900);
  await h.click('Change this date’s time', true); await sleep(1400);
  check('H13 move picker opened', /Move this date/.test(await h.text()));
  await axeCheck(h, 'H13 move picker [390]');
  await escape(h); await sleep(900);
  check('H13 Escape closes the move picker', !/Move this date/.test(await h.text()));
  check('H13 nothing was changed by opening and closing', !(state.opCalls || []).length);
  check('H13 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('H14')) { // Wide and zoomed-out reflow (1280, and 640 = 200 % zoom of 1280)
  for (const [w, ht] of [[1280, 800], [640, 800]]) {
    const state = defaultState();
    const h = await open({ ...P, dataOpts: { business: true }, viewport: [w, ht], overrides: dashboardOverrides(state) });
    await h.go('/hosting', 9000);
    const r = JSON.parse(await h.eval(LAYOUT));
    check(`H14 [${w}] no horizontal overflow`, r.overflowX === 0, `overflowX=${r.overflowX}`);
    check(`H14 [${w}] every control named`, r.unlabeled === 0, `${r.unlabeled} unnamed`);
    check(`H14 [${w}] no control under 24 px`, r.tiny.length === 0, JSON.stringify(r.tiny.slice(0, 3)));
    check(`H14 [${w}] heading present`, r.headings.some((x) => /Hosting/.test(x)), JSON.stringify(r.headings));
    check(`H14 [${w}] no clipped text`, r.clipped.length === 0, JSON.stringify(r.clipped));
    check(`H14 [${w}] no runtime errors`, h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
    await axeCheck(h, `H14 schedule [${w}]`);
    await shot(h, `H14-schedule-${w}`);
    await h.close();
  }
}

if (run('H15')) { // Large text at 1.3× and 1.6× (lib.mjs scaleText — see its note)
  for (const scale of [1.3, 1.6]) {
    const state = defaultState();
    const h = await open({ ...P, dataOpts: { business: true }, viewport: [390, 844], overrides: dashboardOverrides(state) });
    await h.go('/hosting', 9000);
    const t = await scaleText(h, scale);
    await sleep(900);
    check(`H15 [${scale}×] the scale actually applied`, t.touched > 50 && t.after > t.before * (scale - 0.05),
      `${t.before}px → ${t.after}px across ${t.touched} elements`);
    const r = await layoutFacts(h);
    check(`H15 [${scale}×] no horizontal overflow`, r.overflowX === 0, `overflowX=${r.overflowX}`);
    check(`H15 [${scale}×] no clipped text`, r.clipped.length === 0 && r.clippedVertically.length === 0,
      JSON.stringify({ sideways: r.clipped, below: r.clippedVertically }));
    check(`H15 [${scale}×] content still renders`, /Hosting/.test(await h.text()));
    check(`H15 [${scale}×] no runtime errors`, h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
    await shot(h, `H15-schedule-x${String(scale).replace('.', '_')}`);
    await h.close();
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\nsuiteHostDashboard: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
