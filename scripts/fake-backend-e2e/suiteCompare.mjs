// Event comparison (docs/EVENT_COMPARISON_PLAN.md) against the fake backend.
//
//   node scripts/fake-backend-e2e/suiteCompare.mjs <repo> <dist> [C1..C6|all] [outDir]
//
// C1 the tray on Saved: compare mode, ticks, the refusal at the cap, exit.
// C2 the table: default mode, header cells, identical rows hidden, ★ marks,
//    header and footer following the body's horizontal scroll.
// C3 actions from the footer: Join → "You're going", the bookmark flipping;
//    then Cards mode with the same events.
// C4 Discover: long-press selects a card (badge + tray), nothing else changes.
// C5 a shared link: /compare?ids= hydrates, drops an unknown id and an
//    unlisted event the viewer never saw, and says how many were dropped.
// C6 accessibility and layout at 320 and 390 px: every control labelled,
//    44 px targets, no document overflow (the table scrolls inside itself).
import fs from 'node:fs';
import { open, check, results, sleep } from './lib.mjs';

const [repo, dist, only = 'all', outDir = '/tmp/eventmap-compare'] = process.argv.slice(2);
const run = (k) => only === 'all' || only.split(',').includes(k);
fs.mkdirSync(outDir, { recursive: true });
const P = { repo, dist };

const labels = (h, role = 'button') =>
  h.eval(`[...document.querySelectorAll('[role=${role}]')].map((e) => e.getAttribute('aria-label') || '')`);
const tabs = (h) => h.eval(`[...document.querySelectorAll('[role=tab]')].map((e) => (e.getAttribute('aria-label') || '') + '=' + e.getAttribute('aria-selected'))`);

/** Enter compare mode on Saved and tick the first `n` rows. */
async function shortlist(h, n) {
  await h.go('/saved-events', 9000);
  await sleep(500);
  await h.click('Compare events');
  await sleep(300);
  const boxes = (await labels(h, 'checkbox')).filter((l) => l.startsWith('Compare '));
  for (const l of boxes.slice(0, n)) { await h.click(l); await sleep(200); }
  return boxes;
}

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
  await sleep(900);
  await h.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 });
  await sleep(700);
  return 'ok';
}

if (run('C1')) {
  const h = await open({ ...P, viewport: [390, 844] });
  const boxes = await shortlist(h, 3);
  let t = await h.text();
  check('C1 compare mode shows a checkbox per row', boxes.length >= 5, `${boxes.length}`);
  check('C1 tray counts the shortlist', /3 of 4/.test(t) && /Compare 3 events/.test(t), (t.match(/Compare \d events/) ?? [''])[0]);
  await h.click(boxes[3]); await sleep(200);
  check('C1 fourth tick accepted', /4 of 4/.test(await h.text()));
  await h.click(boxes[4]); await sleep(400);
  t = await h.text();
  check('C1 fifth tick is refused, not evicted', /Comparing up to 4 events\. Remove one/.test(t) && /4 of 4/.test(t));
  await h.shot(`${outDir}/C1-tray.png`);
  // Two controls say "Exit compare mode" — the header toggle and the tray's
  // ×. Both must leave the mode *and* drop the selection (the suite found the
  // header only turning the checkboxes off and leaving the tray up).
  check('C1 exit clears the selection and the mode', (await h.click('Exit compare mode')) === 'ok');
  await sleep(400);
  t = await h.text();
  check('C1 tray gone and row actions back', !/\d of 4/.test(t) && (await labels(h)).some((l) => /from saved events$/.test(l)), (t.match(/\d of 4/) ?? ['no tray'])[0]);
  check('C1 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.close();
}

if (run('C2')) {
  const h = await open({ ...P, viewport: [390, 844] });
  await shortlist(h, 3);
  await h.click('Compare 3 selected events'); await sleep(1500);
  const t = await h.text();
  check('C2 table is the default mode', (await tabs(h)).includes('Side by side table=true'), (await tabs(h)).join(' '));
  check('C2 three header cells', (t.match(/Jazz night #1|Yoga in the park #4|Jazz night #7/g) || []).length === 3);
  check('C2 rows the events differ on are shown', ['When', 'Spots left', 'Type', 'Going', 'How to join'].every((k) => t.includes(k)));
  check('C2 identical rows are hidden behind a toggle', /1 identical row hidden · Show/.test(t), (t.match(/\d+ identical rows? hidden[^\n]*/) ?? [''])[0]);
  check('C2 best values are marked', (t.match(/★/g) || []).length >= 2, `${(t.match(/★/g) || []).length} marks`);
  check('C2 each cell is labelled for a screen reader', (await h.eval(`[...document.querySelectorAll('[aria-label]')].filter((e) => /^(When|Distance|Price|Spots left|Type|Going|How to join), /.test(e.getAttribute('aria-label'))).length`)) >= 15);
  // Header and footer are scrollEnabled={false} ScrollViews (overflow hidden
  // on web), so find scrollers by content width, not by overflow style.
  const sync = await h.eval(`(() => {
    const sv = [...document.querySelectorAll('div')].filter((d) => d.clientWidth > 120 && d.scrollWidth > d.clientWidth + 50 && d.scrollWidth < 2000);
    const wide = sv.filter((d) => !sv.some((o) => o !== d && d.contains(o)));
    if (wide.length < 3) return 'scrollers:' + wide.length;
    const body = wide.reduce((a, b) => (b.scrollHeight > a.scrollHeight ? b : a));
    body.scrollLeft = 120; body.dispatchEvent(new Event('scroll'));
    return new Promise((res) => setTimeout(() => res(wide.map((d) => d.scrollLeft).join(',')), 400));
  })()`);
  check('C2 header and footer follow the body horizontally', /^120(,120)+$/.test(String(sync)), String(sync));
  await h.shot(`${outDir}/C2-table.png`);
  const show = (await labels(h)).find((l) => l.startsWith('Show the '));
  check('C2 showing identical rows reveals the host', show && (await h.click(show)) === 'ok' && /Hide identical rows/.test(await h.text()));
  check('C2 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.close();
}

if (run('C3')) {
  const h = await open({ ...P, viewport: [390, 844] });
  await shortlist(h, 3);
  await h.click('Compare 3 selected events'); await sleep(1500);
  const before = await labels(h);
  const join = before.find((l) => /^Join /.test(l));
  check('C3 a column offers a one-tap Join', !!join, join);
  if (join) {
    await h.click(join); await sleep(1200);
    const t = await h.text();
    const title = join.replace(/^Join /, '');
    check('C3 joining confirms and the column reads going', new RegExp(`You're going to ${title.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`).test(t) && (await labels(h)).includes(`You're going to ${title}`));
    check('C3 join went to the capacity RPC', h.count('POST rpc/join_event_with_capacity') === 1, `${h.count('POST rpc/join_event_with_capacity')}`);
  }
  const unsave = before.find((l) => /^Remove .* from saved events$/.test(l));
  check('C3 a saved event offers removal', !!unsave, unsave);
  if (unsave) {
    await h.click(unsave); await sleep(900);
    const title = unsave.replace(/^Remove (.*) from saved events$/, '$1');
    check('C3 the bookmark flips to Save', (await labels(h)).includes(`Save ${title}`));
  }
  await h.shot(`${outDir}/C3-actions.png`);
  check('C3 cards mode', (await h.click('One card per event')) === 'ok');
  await sleep(500);
  const t = await h.text();
  check('C3 cards carry the same events and a Remove each', (t.match(/Remove/g) || []).length >= 3 && (await tabs(h)).includes('One card per event=true'));
  await h.shot(`${outDir}/C3-cards.png`);
  check('C3 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.close();
}

if (run('C4')) {
  const h = await open({ ...P, viewport: [390, 844] });
  await h.go('/', 9000);
  await sleep(1200);
  const title = h.data.ranked[0].title;
  check('C4 long-press on a Discover card', (await longPress(h, title)) === 'ok');
  const t = await h.text();
  check('C4 the card is badged and the tray appears', /COMPARING/.test(t) && /1 of 4/.test(t), (t.match(/\d of 4/) ?? [''])[0]);
  check('C4 the card announces its state', (await labels(h)).some((l) => l.includes(title) && /selected for comparison/.test(l)));
  check('C4 no event page was opened by the long-press', !/Add to calendar/.test(t));
  await h.shot(`${outDir}/C4-discover.png`);
  check('C4 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.close();
}

if (run('C5')) {
  const h = await open({ ...P, viewport: [390, 844] });
  h.data.ev[2].visibility = 'unlisted';
  const ids = [h.data.ev[0].id, h.data.ev[1].id, h.data.ev[2].id, '00000000-0000-4000-8000-0000000dead0'];
  await h.go(`/compare?ids=${ids.join(',')}`, 9000);
  // The toast arrives when the four details requests settle; poll for it.
  let t = '', reported = false;
  for (let i = 0; i < 12 && !reported; i++) { await sleep(400); t = await h.text(); reported = /2 events in this link aren't available/.test(t); }
  check('C5 the link hydrates the public events', t.includes(h.data.ev[0].title) && t.includes(h.data.ev[1].title));
  check('C5 the never-seen unlisted event is dropped', !t.includes(h.data.ev[2].title));
  check('C5 the drop is reported', reported, (t.match(/[^\n]*in this link[^\n]*/) ?? [''])[0]);
  check('C5 one details call per linked id', h.count('POST rpc/get_event_details') === ids.length, `${h.count('POST rpc/get_event_details')}`);
  check('C5 share is offered', (await labels(h)).includes('Share this comparison'));
  await h.shot(`${outDir}/C5-link.png`);
  check('C5 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.close();
}

if (run('C6')) {
  for (const width of [320, 390]) {
    const h = await open({ ...P, viewport: [width, width >= 375 ? 844 : 568] });
    const ids = [h.data.ev[0].id, h.data.ev[1].id, h.data.ev[3].id];
    await h.go(`/compare?ids=${ids.join(',')}`, 9000);
    await sleep(1800);
    const r = JSON.parse(await h.eval(`(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const controls = [...document.querySelectorAll('[role=button],[role=tab],[role=checkbox]')].filter(vis);
      const unlabeled = controls.filter((e) => !(e.getAttribute('aria-label') || e.innerText || '').trim()).length;
      const small = controls.map((e) => e.getBoundingClientRect()).filter((b) => b.height < 44 && b.width < 44).length;
      return JSON.stringify({ controls: controls.length, unlabeled, small, overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth) });
    })()`));
    check(`C6 [${width}] controls are labelled`, r.unlabeled === 0, JSON.stringify(r));
    check(`C6 [${width}] targets at least 44 px`, r.small === 0, JSON.stringify(r));
    check(`C6 [${width}] no document overflow (the table scrolls inside)`, r.overflowX === 0, `${r.overflowX}px`);
    await h.shot(`${outDir}/C6-${width}.png`);
    await h.click('One card per event'); await sleep(400);
    const r2 = JSON.parse(await h.eval(`JSON.stringify({ overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth) })`));
    check(`C6 [${width}] cards mode has no overflow either`, r2.overflowX === 0, `${r2.overflowX}px`);
    check(`C6 [${width}] no runtime errors`, h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
    await h.close();
  }
}

const passed = results.filter((r) => r.ok).length;
console.log(`\nSUITE COMPARE: ${passed}/${results.length} passed — screenshots in ${outDir}`);
process.exit(passed === results.length ? 0 : 1);
