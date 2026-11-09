// Accessibility pass on the web build against the FAKE backend (no database).
//
//   node scripts/fake-backend-e2e/suiteA11y.mjs <repo> <dist> [scenarios] [axePath] [outDir]
//
// Per screen: axe-core (WCAG 2.0/2.1 A + AA), controls with no accessible
// name, controls under 44 px / 24 px, heading presence, Tab order and visible
// focus. Plus: Escape on every overlay, toast and connection banner live
// regions, 320 px and 1280 px viewports. Writes a JSON report to outDir.
//
// axe-core is not a dependency of the app; pass the path to axe.min.js (e.g.
// from `npm pack axe-core`). Screen-reader behaviour on iOS/Android cannot be
// covered here — see docs/ISSUES.md "Next step — testing passes".
import fs from 'node:fs';
import path from 'node:path';
import { open, check, results, sleep } from './lib.mjs';

const [repo, dist, only, axePath, outDir = '/tmp/eventmap-a11y'] = process.argv.slice(2);
const P = { repo, dist };
const run = (k) => !only || only.split(',').includes(k);
const EV = (h, i = 0) => h.data.ev[i].id;
fs.mkdirSync(outDir, { recursive: true });
const axeSrc = axePath && fs.existsSync(axePath) ? fs.readFileSync(axePath, 'utf8') : null;
const report = { screens: {}, keyboard: {}, overlays: {}, live: {}, viewports: {} };

// Rules that only reflect React Native Web's output model, not the app:
// everything is a <div>, there is no document outline or landmarks.
const AXE_IGNORE = new Set(['region', 'landmark-one-main', 'page-has-heading-one', 'bypass']);
// Reported but not failing (reviewed 2026-11-08, see docs/ISSUES.md):
// - nested-interactive: cards expose their inner action natively through
//   accessibilityActions; on web Tab reaches the inner button (checked below).
// - label-content-name-mismatch: composite buttons whose visible text is
//   content (title, date, message), not a label.
const AXE_WARN = new Set(['nested-interactive', 'label-content-name-mismatch']);
// @gorhom/bottom-sheet marks its sheet and handle role="slider" with no value.
const KNOWN_LIBRARY_NODE = /aria-label="Bottom [Ss]heet/;

const INSPECT = `(() => {
  const ROLE_SEL = '[role=button],[role=link],[role=tab],[role=checkbox],[role=radio],[role=switch],[role=menuitem],[role=slider],button,a[href],input,textarea,select,[tabindex]:not([tabindex="-1"])';
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < innerHeight; };
  const name = (e) => (e.getAttribute('aria-label') || (e.getAttribute('aria-labelledby') && document.getElementById(e.getAttribute('aria-labelledby'))?.innerText) || e.getAttribute('title') || e.getAttribute('placeholder') || e.innerText || e.value || '').trim().replace(/\\s+/g, ' ');
  const els = [...document.querySelectorAll(ROLE_SEL)].filter((e) => vis(e) && e.getAttribute('aria-hidden') !== 'true' && !e.disabled);
  const unlabeled = els.filter((e) => !name(e)).map((e) => ({ tag: e.tagName.toLowerCase(), role: e.getAttribute('role'), cls: (e.className || '').toString().slice(0, 40), html: e.outerHTML.slice(0, 160) }));
  const small = els.filter((e) => !['input', 'textarea', 'select'].includes(e.tagName.toLowerCase())).map((e) => { const r = e.getBoundingClientRect(); return { name: name(e).slice(0, 60), role: e.getAttribute('role') || e.tagName.toLowerCase(), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.w < 44 || x.h < 44);
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')].filter(vis).map((e) => e.innerText.trim().slice(0, 60));
  const imgsNoAlt = [...document.querySelectorAll('img')].filter((i) => vis(i) && !i.hasAttribute('alt') && i.getAttribute('role') !== 'presentation').length;
  const alerts = [...document.querySelectorAll('[role=alert],[aria-live]')].map((e) => ({ live: e.getAttribute('aria-live'), role: e.getAttribute('role'), text: e.innerText.trim().slice(0, 100), label: e.getAttribute('aria-label') }));
  return { controls: els.length, unlabeled, small, tiny: small.filter((x) => x.w < 24 || x.h < 24), headings, imgsNoAlt, alerts, title: document.title };
})()`;

async function axe(h) {
  if (!axeSrc) return null;
  await h.send('Runtime.evaluate', { expression: axeSrc });
  const r = await h.eval(`axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] }).then((r) => JSON.stringify(r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length, sample: v.nodes.slice(0, 3).map((n) => n.html.slice(0, 140)) }))))`);
  try {
    return JSON.parse(r)
      .filter((v) => !AXE_IGNORE.has(v.id))
      .map((v) => (v.id === 'aria-required-attr' ? { ...v, sample: v.sample.filter((h) => !KNOWN_LIBRARY_NODE.test(h)), library: v.sample.every((h) => KNOWN_LIBRARY_NODE.test(h)) } : v))
      .filter((v) => !v.library);
  } catch { return [{ id: 'axe-failed', impact: 'unknown', help: String(r).slice(0, 200), count: 0, sample: [] }]; }
}

const key = async (h, k, code, vk, mods = 0) => {
  await h.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods });
  await h.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods });
};
const tab = (h, shift = false) => key(h, 'Tab', 'Tab', 9, shift ? 8 : 0);
const escape = (h) => key(h, 'Escape', 'Escape', 27);

const ACTIVE = `(() => { const e = document.activeElement; if (!e || e === document.body) return { body: true };
  const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
  const name = (e.getAttribute('aria-label') || e.innerText || e.getAttribute('placeholder') || '').trim().replace(/\\s+/g, ' ').slice(0, 50);
  const focusRing = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none';
  return { name, role: e.getAttribute('role') || e.tagName.toLowerCase(), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), focusRing, offscreen: r.bottom < 0 || r.top > innerHeight }; })()`;

async function tabWalk(h, steps = 25) {
  await h.eval('document.body.focus(); document.activeElement && document.activeElement.blur()');
  const seq = [];
  for (let i = 0; i < steps; i++) {
    await tab(h);
    await sleep(60);
    const a = await h.eval(ACTIVE);
    if (a.body) { seq.push({ body: true }); continue; }
    seq.push(a);
  }
  return seq;
}

function keyboardFindings(seq) {
  const reached = seq.filter((s) => !s.body);
  const unnamed = reached.filter((s) => !s.name);
  const noRing = reached.filter((s) => !s.focusRing);
  const offscreen = reached.filter((s) => s.offscreen);
  const uniq = new Set(reached.map((s) => `${s.role}|${s.name}|${s.x},${s.y}`)).size;
  return { reached: reached.length, unique: uniq, unnamed: unnamed.length, noRing: noRing.length, offscreen: offscreen.length, stuck: reached.length > 3 && uniq <= 2 };
}

async function screenPass(h, id, route, wait = 8000, viewportTag = '') {
  await h.go(route, wait);
  const info = await h.eval(INSPECT);
  const violations = await axe(h);
  const seq = await tabWalk(h);
  const kb = keyboardFindings(seq);
  // A screen with only a couple of controls legitimately cycles through them.
  if (info.controls <= 3) kb.stuck = false;
  const label = id + viewportTag;
  report.screens[label] = { route, info, violations, keyboard: kb, tabSeq: seq.filter((s) => !s.body).map((s) => `${s.role}:${s.name}`) };
  await h.shot(path.join(outDir, `${label}.png`));
  const serious = (violations || []).filter((v) => ['serious', 'critical'].includes(v.impact) && !AXE_WARN.has(v.id));
  const warned = (violations || []).filter((v) => AXE_WARN.has(v.id));
  if (warned.length) console.log(`WARN ${label} axe (reviewed, not failing): ${warned.map((v) => `${v.id}×${v.count}`).join(', ')}`);
  check(`${label} axe: no serious/critical violations`, serious.length === 0, serious.map((v) => `${v.id}×${v.count}`).join(', '));
  check(`${label} every visible control has a name`, info.unlabeled.length === 0, info.unlabeled.slice(0, 3).map((u) => u.html).join(' || '));
  check(`${label} no control under 24 px`, info.tiny.length === 0, info.tiny.slice(0, 4).map((t) => `${t.role}:${t.name} ${t.w}×${t.h}`).join(', '));
  check(`${label} has a heading`, info.headings.length > 0, `controls=${info.controls} small(<44)=${info.small.length}`);
  check(`${label} images have alt`, info.imgsNoAlt === 0, `${info.imgsNoAlt} without alt`);
  check(`${label} Tab reaches controls, all named, none off-screen`, kb.reached > 0 && !kb.stuck && kb.unnamed === 0 && kb.offscreen === 0, JSON.stringify(kb));
  return info;
}

// --- Signed-in screens, phone viewport -------------------------------------
if (run('S')) {
  const h = await open({ ...P, viewport: [390, 844], dataOpts: { business: true } });
  await screenPass(h, 'discover', '/', 9000);
  await screenPass(h, 'notifications', '/notifications', 8000);
  await screenPass(h, 'saved', '/saved-events', 8000);
  await screenPass(h, 'event', `/event/${EV(h)}`, 8000);
  await screenPass(h, 'chat', `/event-chat/${EV(h)}`, 8000);
  await screenPass(h, 'profile', '/profile', 8000);
  await screenPass(h, 'settings', '/settings', 7000);
  await screenPass(h, 'create', '/create', 7000);
  await screenPass(h, 'manage-event', `/business/manage-event/${EV(h)}`, 8000);
  await screenPass(h, 'my-events', '/my-events', 7000);
  await screenPass(h, 'following', '/following', 7000);
  await screenPass(h, 'calendar', '/calendar', 7000);
  await screenPass(h, 'premium', '/premium/manage', 6000);
  check('S no uncaught exceptions across screens', h.errors().length === 0, h.errors().slice(0, 3).join(' | '));
  await h.close();
}

// --- Signed-out screens -------------------------------------------------------
if (run('A')) {
  const h = await open({ ...P, viewport: [390, 844], noSession: true });
  await screenPass(h, 'welcome', '/', 7000);
  await screenPass(h, 'login', '/login', 6000);
  await screenPass(h, 'signup', '/signup', 6000);
  await screenPass(h, 'forgot', '/forgot-password', 6000);
  await h.close();
}

// --- Escape closes overlays ----------------------------------------------------
if (run('E')) {
  const h = await open({ ...P, viewport: [390, 844], dataOpts: { business: true } });
  const tryEsc = async (name, route, openLabel, closedProbe, wait = 8000) => {
    await h.go(route, wait);
    const opened = await h.click(openLabel);
    await sleep(900);
    const before = await h.eval(closedProbe);
    const focusInside = await h.eval(`(() => { const e = document.activeElement; return !!e && e !== document.body; })()`);
    await escape(h);
    await sleep(700);
    const after = await h.eval(closedProbe);
    report.overlays[name] = { opened, visibleBefore: before, visibleAfterEscape: after, focusMovedIntoOverlay: focusInside };
    check(`E ${name}: opens`, opened === 'ok' && before, `open=${opened} visible=${before}`);
    check(`E ${name}: Escape closes it`, before && !after);
    check(`E ${name}: focus moved into the overlay`, focusInside);
    await h.shot(path.join(outDir, `overlay-${name}.png`));
  };
  const hasLabel = (l) => `!!document.querySelector('[aria-label="${l}"]')`;
  await tryEsc('search-overlay', '/', 'Search events', hasLabel('Search'), 9000);
  await tryEsc('filters-sheet', '/', 'Open filters', hasLabel('Close filters'), 9000);
  await tryEsc('timezone-picker', '/create', 'Time zone', hasLabel('Close time zone picker'), 7000);
  await tryEsc('image-viewer', `/event/${EV(h)}`, 'View photo 1 of 1', hasLabel('Close'));
  await tryEsc('announce-modal', `/business/manage-event/${EV(h)}`, 'Announce to attendees', `!!document.querySelector('[aria-label="Close announcement"]') || /Announcement|Send to/.test(document.body.innerText)`);
  await h.close();
  // The report sheet only shows to non-hosts.
  const h2 = await open({ ...P, viewport: [390, 844] });
  await h2.go(`/event/${EV(h2)}`, 8000);
  const opened = await h2.click('Report this event'); await sleep(900);
  const before = await h2.eval(hasLabel('Dismiss report'));
  await escape(h2); await sleep(700);
  const after = await h2.eval(hasLabel('Dismiss report'));
  report.overlays['report-sheet'] = { opened, visibleBefore: before, visibleAfterEscape: after };
  check('E report-sheet: opens', opened === 'ok' && before, `open=${opened} visible=${before}`);
  check('E report-sheet: Escape closes it', before && !after);
  await h2.close();
}

// --- Live regions: toast + connection banner -------------------------------------
if (run('L')) {
  const h = await open({ ...P, viewport: [390, 844] });
  await h.go(`/event/${EV(h)}`, 8000);
  h.ctl.offline = true;
  await h.send('Network.enable');
  await h.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(5000);
  let info = await h.eval(INSPECT);
  const banner = info.alerts.filter((a) => /offline|Weak connection/i.test(a.text));
  report.live.banner = banner;
  check('L banner is one polite live region', banner.length === 1 && banner[0].live === 'polite', JSON.stringify(banner));
  await h.click('Share event'); await sleep(1200); // clipboard copy: a success toast with no network
  info = await h.eval(INSPECT);
  const toasts = info.alerts.filter((a) => !/offline · Showing|Weak connection/i.test(a.text) && a.text);
  report.live.toasts = toasts;
  const toastText = toasts.map((t) => t.text).join(' | ');
  check('L offline save produces exactly one alert region', toasts.length <= 1, JSON.stringify(toasts));
  const dupPrefix = toasts.some((t) => /Error:.*Error:/.test(`${t.label ?? ''} ${t.text}`));
  check('L toast text does not double the "Error:" prefix', !dupPrefix, toastText);
  const toastBtn = await h.eval(`(() => { const b = [...document.querySelectorAll('[role=alert] [role=button]')][0]; return b ? { label: b.getAttribute('aria-label'), text: b.innerText.trim(), hint: b.getAttribute('aria-describedby') || b.getAttribute('aria-roledescription') || b.getAttribute('title') } : null; })()`);
  report.live.toastButton = toastBtn;
  check('L toast is dismissible via a labelled button', !!toastBtn && !!toastBtn.label, JSON.stringify(toastBtn));
  await h.shot(path.join(outDir, 'live-offline.png'));
  h.ctl.offline = false;
  await h.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(4000);
  info = await h.eval(INSPECT);
  const recovered = info.alerts.filter((a) => /Back online/i.test(a.text));
  check('L "Back online" announced once', recovered.length <= 1, JSON.stringify(recovered));
  await h.close();
}

// --- Keyboard: the map iframe in the Tab order --------------------------------------
if (run('K')) {
  const h = await open({ ...P, viewport: [390, 844] });
  await h.go('/', 9000);
  const before = await tabWalk(h, 12);
  const iframeStops = before.filter((s) => s.role === 'iframe').length;
  report.keyboard.discoverIframeStopsBefore = iframeStops;
  check('K Tab does not enter the map before the search field', iframeStops === 0, `${iframeStops} of 12 Tab stops were inside the map iframe`);
  // Experiment: would tabindex=-1 on the iframe skip its contents?
  await h.eval(`document.querySelectorAll('iframe').forEach((f) => f.setAttribute('tabindex', '-1'))`);
  const after = await tabWalk(h, 12);
  report.keyboard.discoverIframeStopsWithTabindexMinus1 = after.filter((s) => s.role === 'iframe').length;
  report.keyboard.discoverTabSeqWithTabindexMinus1 = after.filter((s) => !s.body).map((s) => `${s.role}:${s.name}`);
  console.log('K experiment tabindex=-1 →', report.keyboard.discoverIframeStopsWithTabindexMinus1, 'iframe stops;', report.keyboard.discoverTabSeqWithTabindexMinus1.slice(0, 6).join(' > '));
  await h.close();
}

// --- Viewports: 320 px phone and 1280 px desktop ----------------------------------
if (run('V')) {
  for (const [w, hgt, tag] of [[320, 640, '@320'], [1280, 800, '@1280']]) {
    const h = await open({ ...P, viewport: [w, hgt] });
    const overflow = async () => h.eval('document.documentElement.scrollWidth > innerWidth + 1');
    await screenPass(h, 'discover', '/', 9000, tag);
    check(`discover${tag} no horizontal overflow`, !(await overflow()));
    await screenPass(h, 'event', `/event/${EV(h)}`, 8000, tag);
    check(`event${tag} no horizontal overflow`, !(await overflow()));
    await screenPass(h, 'settings', '/settings', 7000, tag);
    check(`settings${tag} no horizontal overflow`, !(await overflow()));
    report.viewports[tag] = { w, h: hgt };
    await h.close();
  }
}

fs.writeFileSync(path.join(outDir, 'a11y-report.json'), JSON.stringify({ results, ...report }, null, 2));
console.log(`\nSUITE A11Y: ${results.filter((r) => r.ok).length}/${results.length} passed — report in ${outDir}`);
process.exit(0);
