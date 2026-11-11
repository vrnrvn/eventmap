// UI/UX review of the host workflow against the FAKE backend (no database).
//   node scripts/fake-backend-e2e/suiteHostUi.mjs "$PWD" <dist> [all|U1,..] [outDir]
// Env: HOST_UI_WIDTHS="390,320" (default) — e.g. "1280,640" for desktop and
//      200 % zoom of a 1280 px window (WCAG 1.4.4 / 1.4.10 reflow);
//      AXE=<path to axe.min.js> adds an axe-core WCAG A/AA pass per screen.
//
// Checks each host screen for: unlabeled controls, touch targets under 44 px
// (and the hard 24 px floor), a heading, horizontal overflow, and runtime
// errors — at 390 px and at 320 px. Screenshots go to outDir for a visual pass.
import { open, check, results, sleep, UID } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

const VIEWPORTS = (process.env.HOST_UI_WIDTHS || '390,320')
  .split(',')
  .map((w) => Number(w.trim()))
  .filter((w) => w > 0)
  .map((w) => [w, w >= 1000 ? 800 : w >= 600 ? 800 : w >= 375 ? 844 : 568]);
const axeSrc = process.env.AXE && fs.existsSync(process.env.AXE) ? fs.readFileSync(process.env.AXE, 'utf8') : null;
// Same ignore rules as suiteA11y.mjs: these reflect React Native Web's DOM
// model (no landmarks / document outline), not the app.
const AXE_IGNORE = new Set(['region', 'landmark-one-main', 'page-has-heading-one', 'bypass']);
const AXE_WARN = new Set(['nested-interactive', 'label-content-name-mismatch']);
async function axe(h) {
  if (!axeSrc) return null;
  await h.send('Runtime.evaluate', { expression: axeSrc });
  const r = await h.eval(`axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] }).then((r) => JSON.stringify(r.violations.map((v) => ({ id: v.id, impact: v.impact, count: v.nodes.length, sample: v.nodes.slice(0, 2).map((n) => n.html.slice(0, 120)) }))))`);
  try { return JSON.parse(r).filter((v) => !AXE_IGNORE.has(v.id)); } catch { return [{ id: 'axe-failed', impact: 'unknown', count: 0, sample: [String(r).slice(0, 120)] }]; }
}

const [repo, dist, only, outDir] = process.argv.slice(2);
const P = { repo, dist };
const run = (k) => !only || only === 'all' || only.split(',').includes(k);
const NEW_EVENT_ID = '00000000-0000-4000-8000-0000000000ee';

const INSPECT = `JSON.stringify((() => {
  const ROLE_SEL = '[role=button],[role=link],[role=tab],[role=checkbox],[role=radio],[role=switch],[role=progressbar],button,a[href],input,textarea,select,[tabindex]:not([tabindex="-1"])';
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < innerHeight; };
  const name = (e) => (e.getAttribute('aria-label') || e.getAttribute('title') || e.getAttribute('placeholder') || e.innerText || e.value || '').trim().replace(/\\s+/g, ' ');
  const els = [...document.querySelectorAll(ROLE_SEL)].filter((e) => vis(e) && e.getAttribute('aria-hidden') !== 'true' && !e.disabled);
  const sized = els.filter((e) => !['input','textarea','select'].includes(e.tagName.toLowerCase()) && e.getAttribute('role') !== 'progressbar')
    .map((e) => { const r = e.getBoundingClientRect(); return { name: name(e).slice(0, 48), w: Math.round(r.width), h: Math.round(r.height) }; });
  return {
    controls: els.length,
    unlabeled: els.filter((e) => !name(e)).map((e) => e.outerHTML.slice(0, 120)),
    small: sized.filter((x) => x.h < 44 && x.w < 44),
    tiny: sized.filter((x) => x.h < 24 || x.w < 24),
    headings: [...document.querySelectorAll('[role=heading],h1,h2,h3')].filter(vis).map((e) => e.innerText.trim().slice(0, 48)),
    overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    clipped: [...document.querySelectorAll('div,span')].filter((e) => vis(e) && e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX === 'hidden' && e.innerText && e.innerText.length < 60).map((e) => e.innerText.trim().slice(0, 40)).slice(0, 5),
  };
})())`;

const hostOverrides = (getData, shape) => ({
  '/rest/v1/rpc/get_user_business': () => ({ json: [{ ...getData().biz, ...shape }] }),
  '/rest/v1/events': (r) =>
    r.method === 'HEAD' && /business_id=eq/.test(r.query)
      ? { json: null, raw: '', headers: { 'content-range': '*/0' } }
      : r.method === 'PATCH'
        ? { json: [], status: 200 }
        : undefined,
  '/rest/v1/rpc/create_event_with_limit_check': () => ({ json: NEW_EVENT_ID }),
  '/rest/v1/rpc/get_host_onboarding_status': () => ({
    json: { has_logo: false, has_description: false, notifications_enabled: true,
      published_events: 0, events_with_capacity: 0, recurring_events: 0, announcements: 0 },
  }),
});

async function review(h, label, width) {
  const r = JSON.parse(await h.eval(INSPECT));
  check(`${label} [${width}] controls are labeled`, r.unlabeled.length === 0, r.unlabeled.slice(0, 2).join(' | '));
  check(`${label} [${width}] no target under 24 px`, r.tiny.length === 0, JSON.stringify(r.tiny.slice(0, 3)));
  check(`${label} [${width}] targets at least 44 px`, r.small.length === 0, JSON.stringify(r.small.slice(0, 3)));
  check(`${label} [${width}] has a heading`, r.headings.length > 0, JSON.stringify(r.headings.slice(0, 3)));
  check(`${label} [${width}] no horizontal overflow`, r.overflowX === 0, `${r.overflowX}px`);
  check(`${label} [${width}] no clipped labels`, r.clipped.length === 0, JSON.stringify(r.clipped));
  check(`${label} [${width}] no runtime errors`, h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  const violations = await axe(h);
  if (violations) {
    const failing = violations.filter((v) => !AXE_WARN.has(v.id));
    const warned = violations.filter((v) => AXE_WARN.has(v.id));
    if (warned.length) console.log(`WARN ${label} [${width}] axe (known RN-web): ${warned.map((v) => v.id).join(', ')}`);
    check(`${label} [${width}] axe WCAG A/AA`, failing.length === 0, JSON.stringify(failing.slice(0, 3)));
  }
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    await h.shot(path.join(outDir, `${label.replace(/\W+/g, '-')}-${width}.png`));
  }
  return r;
}

for (const [width, height] of VIEWPORTS) {
  if (run('U1')) { // Start hosting landing (no host profile)
    const h = await open({ ...P, dataOpts: { business: false }, viewport: [width, height] });
    await h.go('/create', 9000);
    await review(h, 'U1 start-hosting', width);
    await h.close();
  }

  if (run('U2')) { // Host setup wizard, first step
    const h = await open({ ...P, dataOpts: { business: false }, viewport: [width, height] });
    await h.go('/business/onboarding', 9000);
    const r = await review(h, 'U2 host-setup', width);
    check(`U2 host-setup [${width}] shows step progress`, /Step 1 of 5/.test(await h.text()), JSON.stringify(r.headings));
    await h.close();
  }

  if (run('U3')) { // Create with the guided card + presets (venue)
    let D;
    const h = await open({ ...P, dataOpts: { business: true }, viewport: [width, height], overrides: hostOverrides(() => D, { host_type: 'venue', location_kind: 'fixed' }) });
    D = h.data;
    await h.go('/create', 9000);
    await review(h, 'U3 create-guided', width);
    await h.close();
  }

  if (run('U4')) { // My Events with the checklist card
    let D;
    const h = await open({ ...P, dataOpts: { business: true }, viewport: [width, height], overrides: hostOverrides(() => D, { host_type: 'organiser', location_kind: 'area' }) });
    D = h.data;
    await h.go('/my-events', 9000);
    await review(h, 'U4 my-events-checklist', width);
    await h.close();
  }

  if (run('U5')) { // Settings → Host profile
    let D;
    const h = await open({
      ...P,
      dataOpts: { business: true },
      viewport: [width, height],
      // Host sections only render in hosting mode.
      seedExtra: { [`eventmap.userMode.${UID}`]: 'business' },
      overrides: hostOverrides(() => D, { host_type: 'organiser', location_kind: 'area' }),
    });
    D = h.data;
    await h.go('/settings', 9000);
    await h.scrollEnd();
    await sleep(1200);
    const t = await h.text();
    // innerText reflects text-transform, so the section label reads HOST PROFILE.
    check(`U5 host-profile [${width}] section present`, /host profile/i.test(t), t.slice(0, 80));
    check(`U5 host-profile [${width}] no business wording for an organiser`,
      !/business settings|business name|business profile/i.test(t),
      (t.match(/.{0,24}business (settings|name|profile).{0,24}/i) || [''])[0]);
    await review(h, 'U5 settings-host-profile', width);
    await h.close();
  }

  if (run('U7')) { // Manage event with a one-time tip
    let D;
    const h = await open({
      ...P,
      dataOpts: { business: true },
      viewport: [width, height],
      overrides: {
        ...hostOverrides(() => D, { host_type: 'venue', location_kind: 'fixed' }),
        '/rest/v1/rpc/get_event_host_overview': () => ({
          json: { going: 1, interested: 0, waitlist: 0, removed: 0, requested: 0, saves: 0,
            views_total: 0, views_7d: 0, announcements_today: 0,
            chat: { locked: false, slow_mode_seconds: 0, open_reports: 0, blocked_count: 0, message_count: 0 } },
        }),
        '/rest/v1/rpc/get_event_details': (r, data) => {
          const e = data.ev.find((x) => x.id === JSON.parse(r.body || '{}').p_event_id) || data.ev[0];
          return { json: { event: { ...e, max_attendees: 50 }, business: data.biz,
            category: data.categories.find((c) => c.id === e.category_id), links: [], photos: [],
            rsvp_count: 1, save_count: 0, user_rsvp: null, user_saved: false, user_following_business: false } };
        },
      },
    });
    D = h.data;
    await h.go(`/business/manage-event/${h.data.ev[0].id}`, 9000);
    const t = await h.text();
    check(`U7 hub-tip [${width}] tip is shown`, t.includes('Your first attendee'), t.slice(0, 60));
    await review(h, 'U7 manage-event-tip', width);
    await h.close();
  }

  if (run('U6')) { // Preview + published sheets
    let D;
    const h = await open({ ...P, dataOpts: { business: true }, viewport: [width, height], overrides: hostOverrides(() => D, { host_type: 'venue', location_kind: 'fixed' }) });
    D = h.data;
    await h.go('/create', 9000);
    await h.typeInto('input[placeholder="Event name"]', 'Rooftop social');
    await h.typeInto("textarea[placeholder=\"What's this event about?\"]", 'Drinks and music.');
    await h.click('Music');
    await sleep(400);
    await h.click('Preview how your event will look');
    await sleep(1500);
    await review(h, 'U6 preview-sheet', width);
    await h.click('Publish', true);
    await sleep(5000);
    await review(h, 'U6 published-sheet', width);
    await h.close();
  }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nsuiteHostUi: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
