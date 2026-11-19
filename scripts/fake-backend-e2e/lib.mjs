import { startHarness, sleep } from './harness.mjs';
import { makeData, makeRouter, UID } from './fakebackend.mjs';
import { sessionSeed } from './seed.mjs';
export { sleep, UID };
export const results = [];
export function check(name, ok, detail = '') { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); }

/* ───────────────────────── Test clock (lifecycle harness) ──────────────────
 * The page's idea of "now", shifted by a controllable offset — the browser
 * twin of scripts/test-lifecycle.sql's set_phase. An offset clock (not a
 * frozen one) keeps timers, animations and React Query freshness working;
 * only "when it is" moves. Runs before any app code via the seed script.
 * Suites drive it with h.clock.set(iso) / h.clock.advance(ms) — both apply to
 * documents loaded afterwards (navigate/reload), which is also how a device
 * clock change reaches a cold page.
 */
const clockScript = `(() => {
  if (globalThis.__lcClock) return;
  const Real = Date;
  let offsetMs = Number(localStorage.getItem('__lcClockOffsetMs') || 0);
  const now = () => Real.now() + offsetMs;
  class TestDate extends Real {
    constructor(...a) { a.length === 0 ? super(now()) : super(...a); }
    static now() { return now(); }
  }
  TestDate.parse = Real.parse; TestDate.UTC = Real.UTC;
  globalThis.Date = TestDate;
  globalThis.__lcClock = {
    set(iso) { offsetMs = new Real(iso).getTime() - Real.now(); localStorage.setItem('__lcClockOffsetMs', String(offsetMs)); },
    advance(ms) { offsetMs += ms; localStorage.setItem('__lcClockOffsetMs', String(offsetMs)); },
    offsetMs: () => offsetMs,
  };
})();`;

export async function open({ repo, dist, dataOpts = {}, seedExtra = {}, expOffsetS = 3600, overrides = {}, viewport, offline = false, noSession = false, clock = false }) {
  const data = makeData(dataOpts); const unknown = [];
  const base = makeRouter(data, { unknown, overrides });
  const ctl = { offline };
  const session = noSession ? '' : sessionSeed(seedExtra, expOffsetS);
  const h = await startHarness({ repo, dist, viewport, backendOrigin: 'http://127.0.0.1:9',
    seed: clock ? clockScript + '\n' + session : (noSession ? null : session), route: (r) => (ctl.offline ? { abort: true } : base(r)) });
  if (clock) {
    h.clock = {
      /** Point the page's clock at `iso`; takes effect on the next load. */
      set: (iso) => h.eval(`__lcClock.set(${JSON.stringify(iso)})`),
      advance: (ms) => h.eval(`__lcClock.advance(${ms})`),
      offsetMs: () => h.eval('__lcClock.offsetMs()'),
    };
  }
  h.data = data; h.unknown = unknown; h.ctl = ctl;
  h.count = (pred) => h.requests.filter((r) => (typeof pred === 'string' ? `${r.method} ${r.path.replace('/rest/v1/', '')}` === pred : pred(r))).length;
  h.errors = () => h.log.filter((l) => l.startsWith('EXCEPTION') || (l.startsWith('ERROR') && !/Failed to load resource|net::ERR|status of 404|Error loading|Failed to load (notifications|profile|business|following)|fetch failed|TypeError: Failed to fetch|Unable to restore session|Failed to load events/i.test(l)));
  h.storage = () => h.eval('JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])))').then(JSON.parse);
  // Scroll the largest scrollable element (FlatList/SectionList on web) to its end.
  h.scrollEnd = () => h.eval(`(() => { const els = [...document.querySelectorAll('div')].filter(e => e.scrollHeight > e.clientHeight + 20 && getComputedStyle(e).overflowY !== 'visible');
    els.sort((a, b) => b.scrollHeight - a.scrollHeight); const e = els[0]; if (!e) return 'none'; e.scrollTop = e.scrollHeight; e.dispatchEvent(new Event('scroll')); return e.scrollHeight; })()`);
  h.typeInto = async (selector, text) => { await h.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el && el.focus(); return !!el; })()`); await h.send('Input.insertText', { text }); };
  h.history = async (expr, wait = 2500) => { await h.eval(expr); await sleep(wait); };
  return h;
}

/* ───────────────────── Large text (shared, 2026-11-16) ─────────────────────
 * The web stand-in for an OS large-text setting. Chrome's minimum-font-size
 * (CDP Page.setFontSizes) does NOT affect React Native Web's inline px text
 * — verified: the render was identical — so every element's computed font
 * size is multiplied directly, which is what OS scaling does to RN's px
 * values. Elements mounted after the call are not scaled: measure right away.
 */
export async function scaleText(h, factor) {
  return h.eval(`(() => {
    const probe = document.querySelector('[role=heading]') || document.body;
    const before = parseFloat(getComputedStyle(probe).fontSize);
    let touched = 0;
    for (const el of document.querySelectorAll('*')) {
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (!px) continue;
      el.style.setProperty('font-size', (px * ${factor}).toFixed(2) + 'px', 'important');
      touched++;
    }
    return { before, after: parseFloat(getComputedStyle(probe).fontSize), touched };
  })()`);
}

/**
 * Overflow and clipping after a layout change (large text, zoom).
 *
 * CAVEAT for large-text runs: `scaleText` overrides every font size, including
 * text the app deliberately opts out of scaling (`allowFontScaling={false}`,
 * e.g. the tab bar's fixed-height labels). Clipping inside such a region is an
 * artifact of the forced scale, not something a device would show — check the
 * component before filing it.
 */
export async function layoutFacts(h) {
  return JSON.parse(await h.eval(`JSON.stringify((() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    return {
      overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      // Short text cut off by an overflow-hidden box (truncation the layout did not intend).
      clipped: [...document.querySelectorAll('div,span')].filter((e) => vis(e) && e.innerText && e.innerText.length < 80
        && e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX === 'hidden')
        .map((e) => e.innerText.trim().replace(/\\s+/g, ' ').slice(0, 40)).slice(0, 6),
      // Cut off from BELOW: a fixed-height box whose text no longer fits.
      // Line-clamped text (RN's numberOfLines) and ellipsised text are
      // deliberate truncation, not breakage, so they are excluded —
      // otherwise every card title in a large-text run is a false hit.
      clippedVertically: [...document.querySelectorAll('div,span')].filter((e) => {
        if (!vis(e) || !e.innerText || e.innerText.length >= 80) return false;
        if (e.scrollHeight <= e.clientHeight + 2) return false;
        const s = getComputedStyle(e);
        if (!['hidden', 'clip'].includes(s.overflowY)) return false;
        const clamped = s.webkitLineClamp && s.webkitLineClamp !== 'none';
        return !clamped && s.textOverflow !== 'ellipsis';
      }).map((e) => e.innerText.trim().replace(/\\s+/g, ' ').slice(0, 40)).slice(0, 6),
    };
  })())`));
}
