// Flow 9 — visual consistency sweep, the automatable half.
//
//   node scripts/fake-backend-e2e/suiteVisual.mjs <repo> <dist> [all] [outDir]
//
// Captures every main screen at 390 px and 1280 px into <outDir> so the two
// widths can be compared side by side by a human (that comparison is the part
// a suite cannot do), and asserts the things that are objective:
//   * no horizontal overflow at either width;
//   * a visible heading on every screen;
//   * empty / loading / error states actually render something;
//   * switches use the brand colour rather than the platform default
//     (docs/ISSUES.md listed a teal "on" state; this pins the fix).
// The design-token inventory is `node scripts/design-token-audit.mjs`.
import fs from 'node:fs';
import { open, check, results, sleep } from './lib.mjs';

const [repo, dist, only = 'all', outDir = '/tmp/eventmap-visual'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });

const SCREENS = [
  ['discover', '/discover'],
  ['saved', '/saved-events'],
  ['joined', '/joined-events'],
  ['notifications', '/notifications'],
  ['profile', '/profile'],
  ['settings', '/settings'],
  ['create', '/create'],
  ['collections', '/collections'],
  ['my-events', '/my-events'],
  ['calendar', '/calendar'],
  ['premium-plans', '/premium/plans'],
];

const overflow = (h) => h.eval(`(() => {
  const d = document.documentElement;
  const widest = [...document.querySelectorAll('*')]
    .map((e) => { const r = e.getBoundingClientRect(); return Math.round(r.right); })
    .reduce((a, b) => Math.max(a, b), 0);
  return JSON.stringify({ scroll: d.scrollWidth, client: d.clientWidth, widest });
})()`);

const headingText = (h) => h.eval(`(() => {
  const el = document.querySelector('[role=heading],h1,h2,h3');
  return el ? (el.innerText || '').trim().slice(0, 60) : '';
})()`);

for (const width of [390, 1280]) {
  const h = await open({ repo, dist, dataOpts: { business: true }, viewport: { width, height: 900 } });
  for (const [name, route] of SCREENS) {
    await h.go(route, 7000);
    const o = JSON.parse(await overflow(h));
    check(`V ${name} @${width} no horizontal overflow`, o.scroll <= o.client + 2, JSON.stringify(o));
    const heading = await headingText(h);
    check(`V ${name} @${width} has a heading`, heading.length > 0, heading);
    const t = await h.text();
    check(`V ${name} @${width} renders content (not a blank or error screen)`,
      t.trim().length > 20 && !/Something went wrong/i.test(t), t.trim().slice(0, 60).replace(/\n/g, ' '));
    await h.shot(`${outDir}/${name}@${width}.png`);
  }

  // Brand colour on a switched-on control (the old teal "on" state).
  await h.go('/settings', 8000);
  // RN-web renders a Switch as a transparent <input role="switch"> laid over
  // the visible track, so read the nearest ancestor that actually paints.
  const sw = await h.eval(`(() => {
    const el = [...document.querySelectorAll('[role=switch]')].find((e) => e.checked);
    if (!el) return 'none';
    const parse = (c) => (String(c).match(/[0-9.]+/g) || []).map(Number);
    const opaque = (c) => { const p = parse(c); return p.length >= 3 && (p.length < 4 || p[3] > 0.1); };
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      for (const cand of [n, ...n.children]) {
        const c = getComputedStyle(cand).backgroundColor;
        if (opaque(c)) return c;
      }
    }
    return 'none';
  })()`);
  // Brand red (#B41924, possibly alpha-blended) has red as the dominant
  // channel; the platform default "on" is green/teal, where it is not.
  const rgb = String(sw).match(/\d+/g)?.slice(0, 3).map(Number) ?? [];
  check(`V settings @${width} an "on" switch uses the brand colour, not the platform teal`,
    rgb.length === 3 && rgb[0] > rgb[1] && rgb[0] > rgb[2], String(sw));
  await h.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\nSUITE VISUAL: ${passed}/${results.length} passed — screenshots (390 px and 1280 px) in ${outDir}`);
process.exit(passed === results.length ? 0 : 1);
