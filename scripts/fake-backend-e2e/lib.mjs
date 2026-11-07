import { startHarness, sleep } from './harness.mjs';
import { makeData, makeRouter, UID } from './fakebackend.mjs';
import { sessionSeed } from './seed.mjs';
export { sleep, UID };
export const results = [];
export function check(name, ok, detail = '') { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); }
export async function open({ repo, dist, dataOpts = {}, seedExtra = {}, expOffsetS = 3600, overrides = {}, viewport, offline = false, noSession = false }) {
  const data = makeData(dataOpts); const unknown = [];
  const base = makeRouter(data, { unknown, overrides });
  const ctl = { offline };
  const h = await startHarness({ repo, dist, viewport, backendOrigin: 'http://127.0.0.1:9',
    seed: noSession ? null : sessionSeed(seedExtra, expOffsetS), route: (r) => (ctl.offline ? { abort: true } : base(r)) });
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
