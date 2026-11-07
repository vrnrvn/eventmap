import { open, check, results, sleep } from './lib.mjs';
const [repo, dist, only] = process.argv.slice(2);
const P = { repo, dist };
const run = (k) => !only || only.split(',').includes(k);

if (run('C1')) { // 5,000 notifications: scroll-page aggressively
  const h = await open({ ...P, dataOpts: { notifications: 5000 } });
  await h.go('/notifications', 9000);
  const t0 = Date.now();
  for (let i = 0; i < 25; i++) { await h.scrollEnd(); await sleep(450); }
  await sleep(2000);
  const pages = h.count('GET notifications');
  const ids = (await h.text()).match(/Notification \d+/g) || [];
  check('C1 rapid scrolling pages through many pages', pages >= 8, `${pages} page requests in ${Date.now() - t0} ms`);
  const offs = h.requests.filter((r) => r.path.endsWith('/notifications') && r.method === 'GET').map((r) => new URLSearchParams(r.query).get('offset') || (r.headers.Range || r.headers.range || '').split('-')[0] || '0');
  check('C1 no duplicate page requests (no concurrent loadMore)', new Set(offs).size === offs.length, offs.join(','));
  check('C1 DOM stays virtualized', ids.length < 400, `${ids.length} rows in DOM`);
  check('C1 no runtime errors (incl. duplicate keys)', h.errors().length === 0 && !h.log.some((l) => /same key|unique "key"/.test(l)), h.log.filter((l) => /key/.test(l)).slice(0, 2).join(' || '));
  await h.close();
}

if (run('C2')) { // 400 events on Discover: map markers + list paging
  const h = await open({ ...P, dataOpts: { events: 400 } });
  await h.go('/', 12000);
  for (let i = 0; i < 6; i++) { await h.scrollEnd(); await sleep(1500); }
  const pages = h.requests.filter((r) => r.path.endsWith('get_ranked_events')).map((r) => JSON.parse(r.body || '{}').p_offset);
  check('C2 discover pages through ranked events', pages.length >= 1, `offsets ${pages.join(',')}`);
  check('C2 no runtime errors with 400 events', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('C3')) { // Chat history paging (250 messages, page 100) via real wheel gestures (inverted list)
  const h = await open(P);
  await h.go(`/event-chat/${h.data.ev[0].id}`, 9000);
  for (let i = 0; i < 12; i++) { await h.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 215, y: 400, deltaX: 0, deltaY: -2500 }); await sleep(700); }
  await sleep(2000);
  const older = h.requests.filter((r) => r.path.endsWith('get_event_chat_messages') && JSON.parse(r.body || '{}').p_before_created_at).length;
  const t = await h.text(); const msgs = t.match(/Message \d+/g) || [];
  check('C3 older chat pages load on scroll', older >= 1, `${older} older-page requests`);
  check('C3 reaches the beginning of the chat', t.includes('Beginning of the event chat'));
  check('C3 no duplicated messages after paging', msgs.length === new Set(msgs).size);
  check('C3 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('C4')) { // Rapid tab hopping: focus gating must keep requests bounded
  const h = await open(P);
  await h.go('/profile', 8000);
  const base = h.requests.length;
  const hops = ['Saved', 'Following'];
  for (let i = 0; i < 6; i++) {
    for (const hop of hops) { const r = await h.click(hop, true); if (r === 'ok') { await sleep(1200); await h.history('history.back()', 1200); } }
  }
  const extra = h.requests.slice(base).filter((r) => !r.path.startsWith('/storage'));
  const overview = extra.filter((r) => /get_user_going_events|get_user_attendance_counts/.test(r.path)).length;
  check('C4 profile overview not refetched on every quick return', overview <= 4, `${overview} overview requests over 12 returns`);
  check('C4 no runtime errors while hopping', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('C5')) { // Chat keystroke cost (CDP round trip per character)
  const h = await open(P);
  await h.go(`/event-chat/${h.data.ev[0].id}`, 9000);
  await h.eval(`document.querySelector('textarea[aria-label="Message input"]').focus()`);
  const N = 300; const t0 = performance.now();
  for (let i = 0; i < N; i++) await h.send('Input.insertText', { text: 'a' });
  const ms = (performance.now() - t0) / N;
  await sleep(500);
  const len = await h.eval(`document.querySelector('textarea[aria-label="Message input"]').value.length`);
  check('C5 every keystroke landed', len === N, `${len}/${N}`);
  console.log(`C5_MS_PER_KEY ${ms.toFixed(2)}`);
  await h.close();
}
console.log(`\nSUITE C: ${results.filter((r) => r.ok).length}/${results.length} passed`);
process.exit(0);
