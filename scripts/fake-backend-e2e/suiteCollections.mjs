// Private collections (docs/EVENT_COLLECTIONS_PLAN.md Phase B) against the
// fake backend — the only way to exercise these screens while the migration
// stays unapplied.
//   node scripts/fake-backend-e2e/suiteCollections.mjs "$PWD" <dist> [K1,K2,...]
import { open, check, results, sleep } from './lib.mjs';
const [repo, dist, only] = process.argv.slice(2);
const P = { repo, dist };
const run = (k) => !only || only.split(',').includes(k);
const rpcBodies = (h, fn) => h.requests.filter((r) => r.path.endsWith(`rpc/${fn}`)).map((r) => JSON.parse(r.body || '{}'));
// Card names from the per-card "more" buttons: toasts ("Created “X”") also put names in body text.
const cardNames = (h) => h.eval(`[...document.querySelectorAll('[role=button]')].map((e) => e.getAttribute('aria-label') || '').filter((l) => l.startsWith('More options for ')).map((l) => l.slice('More options for '.length))`);
// Pinned rows in a collection (each has a remove button); body text also holds toast copy.
const pinnedRows = (h) => h.eval(`[...document.querySelectorAll('[role=button]')].filter((e) => (e.getAttribute('aria-label') || '').startsWith('Remove ')).length`);

if (run('K1')) { // Home: cards, counts, create, rename, delete
  const h = await open({ ...P, dataOpts: { events: 40 } });
  await h.go('/collections', 8000);
  let t = await h.text();
  check('K1 home lists both collections', t.includes('Weekend plans') && t.includes('Music'), t.slice(0, 200));
  check('K1 counts line mentions repeating series', /6 events · 1 repeating/.test(t), t.match(/\d+ events[^\n]*/g)?.join(' | '));
  check('K1 smart card is tagged', t.includes('Favourite type'));
  check('K1 open create sheet', (await h.click('New collection', true)) === 'ok'); await sleep(600);
  await h.typeInto('input', 'Date nights'); await sleep(300);
  check('K1 create', (await h.click('Create', true)) === 'ok'); await sleep(2500);
  t = await h.text();
  check('K1 new collection appears', t.includes('Date nights'));
  check('K1 create POSTed to collections', h.count('POST collections') === 1, `${h.count('POST collections')}x`);
  check('K1 duplicate name refused client-side', (await h.click('New collection', true)) === 'ok');
  await sleep(500); await h.typeInto('input', 'weekend PLANS'); await sleep(300); await h.click('Create', true); await sleep(800);
  t = await h.text();
  check('K1 duplicate shows the reason without a request', t.includes('already have a collection') && h.count('POST collections') === 1);
  await h.click('Cancel', true); await sleep(500);
  check('K1 open options', (await h.click('More options for Date nights')) === 'ok'); await sleep(600);
  check('K1 rename row', (await h.click('Rename collection')) === 'ok'); await sleep(600);
  await h.eval(`(() => { const i = document.querySelector('input'); const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(i, ''); i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await h.typeInto('input', 'Film nights'); await sleep(300);
  check('K1 save rename', (await h.click('Save', true)) === 'ok'); await sleep(2000);
  let names = await cardNames(h);
  check('K1 renamed', names.includes('Film nights') && !names.includes('Date nights') && h.count('PATCH collections') === 1, names.join(', '));
  check('K1 options for smart has no rename', (await h.click('More options for Music')) === 'ok'); await sleep(600);
  t = await h.text();
  check('K1 smart sheet explains and offers remove favourite', t.includes('follows an event type') && t.includes('Remove favourite'));
  await h.click('Close', true); await sleep(400);
  check('K1 options for manual', (await h.click('More options for Film nights')) === 'ok'); await sleep(600);
  check('K1 delete row', (await h.click('Delete collection')) === 'ok'); await sleep(800);
  check('K1 confirm delete', (await h.click('Delete', true)) === 'ok'); await sleep(2000);
  names = await cardNames(h);
  check('K1 deleted', !names.includes('Film nights') && h.count('DELETE collections') === 1, names.join(', '));
  check('K1 no unknown endpoints', h.unknown.length === 0, h.unknown.join(', '));
  check('K1 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('K2')) { // Detail: segments + sorts drive the RPC, rows, remove + undo
  const h = await open({ ...P, dataOpts: { events: 40 } });
  const manual = h.data.collections[0];
  await h.go(`/collections/${manual.id}`, 8000);
  let t = await h.text();
  check('K2 header shows the name and counts', t.includes('Weekend plans') && /6 events/.test(t));
  check('K2 default call is upcoming / next', rpcBodies(h, 'get_collection_events').some((b) => b.p_filter === 'upcoming' && b.p_sort === 'next'), JSON.stringify(rpcBodies(h, 'get_collection_events')[0]));
  check('K2 series row has a Series badge and cadence', t.includes('Series') && /weekly/i.test(t));
  check('K2 note shown', t.includes('bring a scarf'));
  check('K2 Repeating segment', (await h.click('Repeating')) === 'ok'); await sleep(2500);
  check('K2 repeating filter requested', rpcBodies(h, 'get_collection_events').some((b) => b.p_filter === 'repeating'));
  t = await h.text();
  const repeatingRows = await pinnedRows(h);
  check('K2 only series listed', repeatingRows >= 1 && (t.match(/Series/g) || []).length === repeatingRows, `${repeatingRows} rows`);
  check('K2 Past segment', (await h.click('Past')) === 'ok'); await sleep(2500);
  t = await h.text();
  check('K2 past empty state', t.includes('Nothing has happened yet'));
  check('K2 back to Upcoming', (await h.click('Upcoming')) === 'ok'); await sleep(1500);
  check('K2 sort by popularity', (await h.click('Sort by Most popular')) === 'ok'); await sleep(2500);
  check('K2 rsvp sort requested', rpcBodies(h, 'get_collection_events').some((b) => b.p_sort === 'rsvp'));
  const before = await pinnedRows(h);
  const removeLabel = await h.eval(`(() => { const el = [...document.querySelectorAll('[role=button]')].find((e) => (e.getAttribute('aria-label')||'').startsWith('Remove ')); return el ? el.getAttribute('aria-label') : 'NONE'; })()`);
  check('K2 pinned rows have a remove action', removeLabel !== 'NONE', removeLabel);
  check('K2 remove', (await h.click(removeLabel)) === 'ok'); await sleep(1500);
  const after = await pinnedRows(h);
  check('K2 row removed optimistically and DELETE sent', after === before - 1 && h.count('DELETE collection_items') === 1, `${before} → ${after}, ${h.count('DELETE collection_items')} deletes`);
  check('K2 undo', (await h.click('Undo', true)) === 'ok'); await sleep(2500);
  check('K2 undo re-pins', h.count('POST collection_items') === 1 && (await pinnedRows(h)) === before, `${await pinnedRows(h)} rows, ${h.count('POST collection_items')} posts`);
  check('K2 no unknown endpoints', h.unknown.length === 0, h.unknown.join(', '));
  check('K2 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('K3')) { // Smart collection: by-rule rows carry chips and no remove action
  const h = await open({ ...P, dataOpts: { events: 40 } });
  const smart = h.data.collections[1];
  await h.go(`/collections/${smart.id}`, 8000);
  const t = await h.text();
  check('K3 smart hero copy', t.includes('favourite event type') && t.includes('Everything you save or join'));
  check('K3 source chips', /Saved|Going/.test(t));
  const removes = await h.eval(`[...document.querySelectorAll('[role=button]')].filter((e) => (e.getAttribute('aria-label')||'').startsWith('Remove ')).length`);
  check('K3 rule members cannot be removed', removes === 0, `${removes} remove buttons`);
  check('K3 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('K4')) { // Server without the migration: a calm "coming soon", no error toast loop
  const h = await open({ ...P, overrides: { '/rest/v1/rpc/get_user_collections': () => ({ status: 404, json: { code: 'PGRST202', message: 'Could not find the function' } }) } });
  await h.go('/collections', 8000);
  const t = await h.text();
  check('K4 coming-soon state', t.includes('Collections are coming soon') && t.includes('Go to Saved'));
  check('K4 header create button hidden', (await h.click('New collection', true)) === 'NOT FOUND');
  check('K4 single request, no retry storm', h.count('POST rpc/get_user_collections') <= 2, `${h.count('POST rpc/get_user_collections')}x`);
  check('K4 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('K5')) { // Profile entry point + 320 px layout
  const h = await open({ ...P, dataOpts: { events: 40 }, viewport: [320, 700] });
  await h.go('/profile', 8000);
  check('K5 profile has a Collections link', (await h.click('Collections', true)) === 'ok'); await sleep(3000);
  const t = await h.text();
  check('K5 navigated to collections', t.includes('Weekend plans'));
  const overflow = await h.eval('document.documentElement.scrollWidth - document.documentElement.clientWidth');
  check('K5 no horizontal overflow at 320 px', overflow <= 1, `${overflow}px`);
  const small = await h.eval(`[...document.querySelectorAll('[role=button]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.width < 24 || r.height < 24); }).map((e) => e.getAttribute('aria-label') || e.innerText).slice(0, 5)`);
  check('K5 no interactive target under 24 px', small.length === 0, JSON.stringify(small));
  check('K5 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('K6')) { // B finish: mosaic, All saved row, reorder, deep-link back fallback
  const h = await open({ ...P, dataOpts: { events: 40 } });
  await h.go('/collections', 8000);
  let t = await h.text();
  check('K6 All saved row with the profile count', t.includes('All saved') && t.includes('20 events you bookmarked'), t.match(/All saved[\s\S]{0,40}/)?.[0]);
  // expo-image only mounts an <img> after a successful load (the fake's
  // storage 404s), so count its containers instead.
  const mosaicImgs = await h.eval(`(() => { const cards = [...document.querySelectorAll('[role=button]')].filter((e) => (e.getAttribute('aria-label')||'').startsWith('Weekend plans,')); return cards.length ? cards[0].querySelectorAll('[data-expoimage]').length : -1; })()`);
  check('K6 three-image cover mosaic', mosaicImgs === 3, `${mosaicImgs} images in the tile`);
  check('K6 enter reorder mode', (await h.click('Reorder collections')) === 'ok'); await sleep(800);
  t = await h.text();
  check('K6 reorder hint shown', /use the arrows, then done/i.test(t)); // the subtitle style uppercases it
  check('K6 move Music up', (await h.click('Move Music up')) === 'ok'); await sleep(400);
  check('K6 first up-arrow disabled for the top card', await h.eval(`(() => { const b = [...document.querySelectorAll('[role=button]')].find((e) => e.getAttribute('aria-label') === 'Move Music up'); return b?.getAttribute('aria-disabled') === 'true'; })()`));
  check('K6 done persists', (await h.click('Done reordering')) === 'ok'); await sleep(2000);
  const reorderCalls = rpcBodies(h, 'reorder_collections');
  check('K6 reorder RPC got the new order', reorderCalls.length === 1 && reorderCalls[0].p_ids[0] === h.data.collections[1].id, JSON.stringify(reorderCalls));
  const names = await cardNames(h);
  check('K6 new order shown', names[0] === 'Music', names.join(', '));
  // Cold-start deep link: no history, back lands on the collections home.
  await h.go(`/collections/${h.data.collections[0].id}`, 7000);
  check('K6 deep link opens the collection', (await h.text()).includes('Weekend plans'));
  check('K6 back from a cold deep link', (await h.click('Go back')) === 'ok'); await sleep(2500);
  check('K6 lands on the home, not nowhere', (await h.text()).includes('COLLECTIONS') || (await h.text()).includes('Collections'));
  check('K6 no unknown endpoints', h.unknown.length === 0, h.unknown.join(', '));
  check('K6 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('K7')) { // Phase C: add-to-collection sheet from the event page
  const h = await open({ ...P, dataOpts: { events: 40 } });
  const saved = h.data.ev[0];   // music, saved → by-rule in the smart collection
  const unsaved = h.data.ev[1]; // not saved → exercises the post-save toast
  await h.go(`/event/${saved.id}`, 9000);
  check('K7 collections row on the page', (await h.click('Add to collection', true)) === 'ok'); await sleep(2000);
  let t = await h.text();
  check('K7 sheet lists both collections', t.includes('Weekend plans') && t.includes('Music'));
  check('K7 smart membership is by rule', t.includes('Included automatically'));
  check('K7 membership RPC called for this event', rpcBodies(h, 'get_event_collection_membership').some((b) => b.p_event_id === saved.id));
  const wasPinned = await h.eval(`(() => { const el = [...document.querySelectorAll('[aria-checked]')].find((e) => (e.getAttribute('aria-label')||'').startsWith('Weekend plans')); return el?.getAttribute('aria-checked'); })()`);
  check('K7 manual checkbox reflects the pin', wasPinned === 'true', String(wasPinned)); // ev[0] is pinned in the fixtures
  check('K7 unpin from the sheet', (await h.click('Weekend plans')) === 'ok'); await sleep(1500);
  check('K7 unpin DELETEd the item', h.count('DELETE collection_items') === 1, `${h.count('DELETE collection_items')}x`);
  check('K7 re-pin', (await h.click('Weekend plans')) === 'ok'); await sleep(1500);
  check('K7 re-pin POSTed the item', h.count('POST collection_items') === 1, `${h.count('POST collection_items')}x`);
  check('K7 inline new collection', (await h.click('New collection', true)) === 'ok'); await sleep(600);
  await h.typeInto('input', 'From the sheet'); await sleep(300);
  check('K7 create and add', (await h.click('Create and add', true)) === 'ok'); await sleep(2000);
  check('K7 created and pinned', h.count('POST collections') === 1 && h.count('POST collection_items') === 2, `${h.count('POST collections')} creates, ${h.count('POST collection_items')} pins`);
  t = await h.text();
  check('K7 new collection checked in the sheet', t.includes('From the sheet'));
  check('K7 close sheet', (await h.click('Close', true)) === 'ok'); await sleep(600);
  // Post-save toast on an unsaved event.
  await h.go(`/event/${unsaved.id}`, 9000);
  check('K7 save the event', (await h.click('Save event', true)) === 'ok'); await sleep(1500);
  t = await h.text();
  check('K7 saved toast offers the sheet', t.includes('Add to collection'));
  check('K7 toast action opens the sheet', (await h.click('Add to collection', true)) === 'ok'); await sleep(1500);
  check('K7 sheet shows this event', (await h.text()).includes(unsaved.title.slice(0, 20)));
  check('K7 no unknown endpoints', h.unknown.length === 0, h.unknown.join(', '));
  check('K7 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('K8')) { // Phase C finish: Saved Events row action; a pin made on a weak connection is queued, shown as pending, and replays
  const h = await open({ ...P, dataOpts: { events: 40 } });
  await h.go('/saved-events', 8000);
  // "Yoga in the park #4" is saved (fixture: every third event) but pinned
  // nowhere and not music, so both rows start unchecked.
  const addLabel = 'Add Yoga in the park #4 to a collection';
  check('K8 saved rows have an add-to-collection action', (await h.click(addLabel, true)) === 'ok'); await sleep(2000);
  let t = await h.text();
  check('K8 sheet names the event', t.includes('Add to collection') && t.includes('Yoga in the park #4'));
  const startState = await h.eval(`(() => { const el = [...document.querySelectorAll('[aria-checked]')].find((e) => e.getAttribute('aria-label') === 'Weekend plans'); return el ? el.getAttribute('aria-checked') : null; })()`);
  check('K8 manual row starts unchecked', startState === 'false', String(startState));
  // Weak connection: the pin is refused, queued and shown as pending on its row.
  h.ctl.offline = true;
  const isPin = (r) => r.method === 'POST' && r.path.endsWith('/collection_items');
  check('K8 pin while refused', (await h.click('Weekend plans', true)) === 'ok'); await sleep(2500);
  t = await h.text();
  check('K8 queued toast', t.includes("sync when you're back online"));
  check('K8 row shows pending state', t.includes("Will sync when you're back online"));
  const pendingBusy = await h.eval(`(() => { const el = [...document.querySelectorAll('[aria-checked]')].find((e) => e.getAttribute('aria-label') === 'Weekend plans'); return el ? [el.getAttribute('aria-checked'), el.getAttribute('aria-busy')] : null; })()`);
  check('K8 row is checked + busy for assistive tech', pendingBusy && pendingBusy[0] === 'true' && pendingBusy[1] === 'true', JSON.stringify(pendingBusy));
  // A second refused write takes the connection to 'degraded' (as in D5);
  // the first successful request afterwards flips it back and replays.
  check('K8 second pin while refused', (await h.click('Music', true)) === 'ok'); await sleep(2500);
  check('K8 refused attempts recorded', h.count(isPin) === 2, `${h.count(isPin)} attempts`);
  check('K8 weak-connection banner', (await h.text()).includes('Weak connection'));
  const refused = h.count(isPin);
  h.ctl.offline = false;
  await h.click('Close', true); await sleep(500);
  check('K8 open an event', (await h.click('Jazz night #7')) === 'ok'); await sleep(6000);
  check('K8 both queued pins replayed', h.count(isPin) === refused + 2, `${refused} refused → ${h.count(isPin)} total`);
  check('K8 membership refreshed after replay', h.count('POST rpc/get_event_collection_membership') >= 1 || h.count('POST rpc/get_user_collections') >= 2);
  check('K8 no unknown endpoints', h.unknown.length === 0, h.unknown.join(', '));
  check('K8 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('K9')) { // Phase D: favourite a type from Category Browse, the rail under a smart collection, the Event type create mode
  const h = await open({ ...P, dataOpts: { events: 40 } });
  const sports = h.data.categories[2]; // not favourited in the fixtures
  await h.go(`/category/${sports.slug}`, 9000);
  let t = await h.text();
  check('K9 browse shows the favourite pill', (await h.click(`Favourite ${sports.label}`, true)) === 'ok'); await sleep(2500);
  t = await h.text();
  check('K9 favourite creates a smart collection', h.count('POST collections') === 1 && t.includes('is now a collection'));
  const created = h.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/collections')).map((r) => JSON.parse(r.body));
  check('K9 create payload is smart + category', created[0]?.kind === 'smart' && created[0]?.category_ids?.[0] === sports.id, JSON.stringify(created[0]));
  check('K9 pill flips to favourited', (await h.eval(`!![...document.querySelectorAll('[role=button]')].find((e) => e.getAttribute('aria-label') === 'Remove ${sports.label} from favourite types')`)));
  check('K9 toast opens the collection', (await h.click('Open', true)) === 'ok'); await sleep(3000);
  t = await h.text();
  check('K9 smart collection page for the type', t.includes(sports.label) && t.includes('favourite event type'));
  // Unfavourite from browse removes the collection.
  await h.go(`/category/${sports.slug}`, 8000);
  check('K9 unfavourite', (await h.click(`Remove ${sports.label} from favourite types`, true)) === 'ok'); await sleep(2500);
  check('K9 unfavourite deletes the collection', h.count('DELETE collections') === 1 && (await h.text()).includes('Removed'));
  // Rail under the fixture's Music smart collection: music events near you not already in it, with See all.
  await h.go(`/collections/${h.data.collections[1].id}`, 9000);
  t = await h.text();
  check('K9 rail heading', /More music near you/i.test(t), t.match(/More [a-z]+ near you/i)?.[0]);
  check('K9 rail fetched ranked events for the category', rpcBodies(h, 'get_ranked_events').some((b) => (b.category_ids || [])[0] === h.data.categories[0].id));
  const railRows = (t.match(/#\d+/g) || []).length;
  check('K9 rail adds rows beyond the collection', railRows > 3, `${railRows} rows on page`);
  check('K9 See all hands off to Category Browse', (await h.click('See all Music events', true)) === 'ok'); await sleep(3000);
  check('K9 on the category page', (await h.text()).includes('Show Music on the map') || (await h.eval(`location.pathname`)).includes('/category/'));
  // Create sheet, Event type mode.
  await h.go('/collections', 8000);
  check('K9 open create', (await h.click('New collection', true)) === 'ok'); await sleep(600);
  check('K9 Event type tab', (await h.click('Event type', true)) === 'ok'); await sleep(800);
  t = await h.text();
  check('K9 type mode copy', t.includes('collects everything you save or join'));
  check('K9 pick a type', (await h.click(h.data.categories[3].label, true)) === 'ok'); await sleep(300);
  check('K9 favourite type button', (await h.click('Favourite type', true)) === 'ok'); await sleep(2500);
  const names = await cardNames(h);
  check('K9 new smart collection on the home', names.includes(h.data.categories[3].label), names.join(', '));
  check('K9 no unknown endpoints', h.unknown.length === 0, h.unknown.join(', '));
  check('K9 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('K10')) { // Phase E: series rows in the Repeating segment expand to their next dates with exceptions and the viewer's per-date state
  const h = await open({ ...P, dataOpts: { events: 40 } });
  const manual = h.data.collections[0];
  await h.go(`/collections/${manual.id}`, 8000);
  check('K10 Repeating segment', (await h.click('Repeating')) === 'ok'); await sleep(2500);
  const series = h.data.ev[0];
  let t = await h.text();
  check('K10 series row collapsed by default', t.includes('Next dates') && !t.includes('cancelled'));
  check('K10 expand', (await h.click(`Show next dates of ${series.title}`, true)) === 'ok'); await sleep(2500);
  t = await h.text();
  check('K10 exceptions fetched for the series', h.count((r) => r.path.includes('event_occurrence_exceptions')) >= 1);
  check('K10 per-date overrides fetched on expand', h.count((r) => r.path.includes('rsvp_occurrences')) >= 1);
  check('K10 cancelled date marked', t.includes('cancelled'));
  check('K10 moved date marked', t.includes('moved'));
  check('K10 opt-out shown as Not going', t.includes('Not going'));
  check('K10 series RSVP shown as Going on other dates', (t.match(/\bGoing\b/g) || []).length >= 2, `${(t.match(/\bGoing\b/g) || []).length} Going chips`);
  const dateRows = await h.eval(`(() => { const box = [...document.querySelectorAll('[aria-label]')].find((e) => /^Next \\d+ dates$/.test(e.getAttribute('aria-label') || '')); return box ? box.querySelectorAll('[role=button]').length : -1; })()`);
  check('K10 five dates listed as tappable rows', dateRows === 5, `${dateRows} date rows`);
  check('K10 collapse', (await h.click(`Hide dates of ${series.title}`, true)) === 'ok'); await sleep(600);
  check('K10 collapsed again', !(await h.text()).includes('cancelled'));
  check('K10 Upcoming has no expansion', (await h.click('Upcoming')) === 'ok'); await sleep(1500);
  check('K10 no toggle outside Repeating', !(await h.text()).includes('Next dates'));
  check('K10 no unknown endpoints', h.unknown.length === 0, h.unknown.join(', '));
  check('K10 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('K11')) { // Phase F: Saved rows' collection hint, For-you chip, date deep link, calendar export, accessibility sweep
  const h = await open({ ...P, dataOpts: { events: 40 } });
  // Saved rows: "In N collections" from the batched RPC.
  await h.go('/saved-events', 8000);
  let t = await h.text();
  check('K11 batched membership called once per page', h.count('POST rpc/get_events_collection_membership') >= 1 && h.count('POST rpc/get_events_collection_membership') <= 2, `${h.count('POST rpc/get_events_collection_membership')}x`);
  check('K11 saved rows show the collections hint', /In \d+ collections?/.test(t), t.match(/In \d+ collections?/)?.[0]);
  // Discover: For you chip selects every favourited type.
  await h.go('/discover', 9000);
  check('K11 For you chip present', (await h.click('For you: your favourite event types', true)) === 'ok'); await sleep(3000);
  const ranked = h.requests.filter((r) => r.path.endsWith('rpc/get_ranked_events')).map((r) => JSON.parse(r.body || '{}'));
  const music = h.data.categories[0].id;
  check('K11 For you filters to the favourite types', ranked.some((b) => Array.isArray(b.category_ids) && b.category_ids.length === 1 && b.category_ids[0] === music), JSON.stringify(ranked.at(-1)?.category_ids));
  // Date deep link from a series row highlights that date on the event page.
  const manual = h.data.collections[0];
  await h.go(`/collections/${manual.id}`, 8000);
  await h.click('Repeating'); await sleep(2000);
  await h.click(`Show next dates of ${h.data.ev[0].title}`, true); await sleep(2500);
  const dateBtn = await h.eval(`(() => { const box = [...document.querySelectorAll('[aria-label]')].find((e) => /^Next \\d+ dates$/.test(e.getAttribute('aria-label') || '')); const b = box && box.querySelector('[role=button]'); return b ? b.getAttribute('aria-label') : 'NONE'; })()`);
  check('K11 tap a date row', dateBtn !== 'NONE' && (await h.click(dateBtn, true)) === 'ok'); await sleep(5000);
  const url = await h.eval('location.pathname + location.search');
  check('K11 event page opened with ?date=', /\/event\/.+\?date=\d{4}-\d{2}-\d{2}/.test(url), url);
  // Calendar export: the actions sheet offers it and the download is produced.
  await h.go('/collections', 8000);
  await h.eval(`(() => { window.__icsDownloads = []; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__icsDownloads.push(this.download); return; } return orig.call(this); }; })()`);
  check('K11 open options', (await h.click('More options for Weekend plans')) === 'ok'); await sleep(600);
  check('K11 export row', (await h.click('upcoming events to calendar')) === 'ok'); await sleep(3500);
  const downloads = await h.eval('JSON.stringify(window.__icsDownloads || [])');
  check('K11 .ics downloaded', downloads.includes('.ics'), downloads);
  check('K11 export read the upcoming list', rpcBodies(h, 'get_collection_events').some((b) => b.p_filter === 'upcoming' && b.p_limit === 100));
  check('K11 export toast', (await h.text()).includes('ready for your calendar'));
  // Accessibility sweep on the three collection surfaces + the sheet.
  for (const [name, path] of [['home', '/collections'], ['detail', `/collections/${manual.id}`]]) {
    await h.go(path, 7000);
    const unnamed = await h.eval(`[...document.querySelectorAll('[role=button],[role=tab],[role=checkbox]')].filter((e) => !(e.getAttribute('aria-label') || e.innerText || '').trim()).length`);
    check(`K11 a11y ${name}: every control is named`, unnamed === 0, `${unnamed} unnamed`);
    const heading = await h.eval(`!!document.querySelector('[role=heading],h1,h2,h3')`);
    check(`K11 a11y ${name}: has a heading`, heading);
    const small = await h.eval(`[...document.querySelectorAll('[role=button],[role=tab],[role=checkbox]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.width < 24 || r.height < 24); }).map((e) => e.getAttribute('aria-label') || e.innerText).slice(0, 5)`);
    check(`K11 a11y ${name}: no target under 24 px`, small.length === 0, JSON.stringify(small));
  }
  await h.go(`/event/${h.data.ev[1].id}`, 9000);
  await h.click('Add to collection', true); await sleep(1500);
  const sheetChecks = await h.eval(`(() => { const boxes = [...document.querySelectorAll('[role=checkbox]')]; return JSON.stringify({ n: boxes.length, unnamed: boxes.filter((b) => !(b.getAttribute('aria-label') || '').trim()).length, noState: boxes.filter((b) => b.getAttribute('aria-checked') === null).length }); })()`);
  const sc = JSON.parse(sheetChecks);
  check('K11 a11y sheet: checkboxes named with state', sc.n >= 2 && sc.unnamed === 0 && sc.noState === 0, sheetChecks);
  check('K11 no unknown endpoints', h.unknown.length === 0, h.unknown.join(', '));
  check('K11 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
}

if (run('K12')) { // Post-F: the calendar's "Collections" source
  const h = await open({ ...P, dataOpts: { events: 40 } });
  await h.go('/calendar', 9000);
  check('K12 Collections chip offered', (await h.click('Show collections events', true)) === 'ok'); await sleep(3500);
  const calls = rpcBodies(h, 'get_user_calendar');
  check('K12 range RPC asked for the collections source', calls.some((b) => (b.p_sources || []).includes('collections')), JSON.stringify(calls.at(-1)?.p_sources));
  const t = await h.text();
  check('K12 rows tagged Collections', (t.match(/Collections/g) || []).length >= 2, `${(t.match(/Collections/g) || []).length} mentions`);
  check('K12 a pinned event appears in the calendar', t.includes(h.data.ev[0].title.slice(0, 12)) || t.includes(h.data.ev[2].title.slice(0, 12)));
  check('K12 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' || '));
  await h.close();
  // Older backend: the source is refused once, the client retries without it and hides the chip.
  const h2 = await open({ ...P, dataOpts: { events: 40 }, overrides: { '/rest/v1/rpc/get_user_calendar': (r) => {
    const b = JSON.parse(r.body || '{}'); if ((b.p_sources || []).includes('collections')) return { status: 400, json: { code: 'P0001', message: 'invalid_source' } }; } } });
  await h2.go('/calendar', 9000);
  check('K12 old backend: chip shown before the probe', (await h2.click('Show collections events', true)) === 'ok'); await sleep(3500);
  const calls2 = rpcBodies(h2, 'get_user_calendar');
  const refused = calls2.filter((b) => (b.p_sources || []).includes('collections')).length;
  const retried = calls2.filter((b) => !(b.p_sources || []).includes('collections')).length;
  check('K12 old backend: refused once, retried without the source', refused === 1 && retried >= 1, `${refused} refused, ${retried} without`);
  check('K12 old backend: chip hidden afterwards', (await h2.click('Show collections events', true)) === 'NOT FOUND');
  check('K12 old backend: calendar still shows data, no error state', !(await h2.text()).includes("Couldn't load") && h2.errors().length === 0, h2.errors().slice(0, 2).join(' || '));
  await h2.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
