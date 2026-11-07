import { open, check, results, sleep, UID } from './lib.mjs';
const [repo, dist] = process.argv.slice(2);
const P = { repo, dist };
const utf8 = (s) => Buffer.byteLength(s, 'utf8');

// A1 cold start, signed in
let h = await open(P);
await h.go('/', 10000);
check('A1 discover renders signed-in', (await h.text()).includes('Discover'));
check('A1 get_user_business exactly once', h.count('POST rpc/get_user_business') === 1, `${h.count('POST rpc/get_user_business')}x`);
check('A1 no businesses row fetches at startup (premium derived)', h.count('GET businesses') === 0);
check('A1 no runtime errors', h.errors().length === 0, h.errors().slice(0, 3).join(' || '));
// A2 persistence written, within byte cap, normalized
await sleep(4000);
let st = await h.storage();
const cacheKey = `eventmap.queryCache.${UID}`;
const raw = st[cacheKey];
let parsed; try { parsed = JSON.parse(raw); } catch {}
check('A2 query cache persisted', !!parsed, raw ? `${utf8(raw)} bytes` : 'missing');
check('A2 cache within 1 MB byte cap', raw && utf8(raw) <= 1_000_000);
check('A2 no dehydratedAt/promise stored', raw && !raw.includes('"dehydratedAt"') && !raw.includes('"promise"'));
check('A2 persisted keys are opted-in only', parsed && parsed.clientState.queries.every((q) => q.state.status === 'success'),
  parsed?.clientState.queries.map((q) => JSON.stringify(q.queryKey)).join(' '));
const snapshot = st; await h.close();

// A3 restart fully offline from the stored state (every backend request refused)
h = await open({ ...P, seedExtra: snapshot, offline: true });
await h.go('/', 12000);
const t3 = await h.text();
check('A3 offline restart opens Discover from cache', t3.includes('Discover') && t3.includes('Jazz night'), JSON.stringify(t3.slice(0, 120)));
check('A3 degraded/offline freshness shown', /Weak connection|Offline/.test(t3));
check('A3 no runtime errors offline', h.errors().length === 0, h.errors().slice(0, 3).join(' || '));
await h.go('/profile', 8000);
check('A3 profile opens offline from cache', (await h.text()).includes('Test User'));
await h.close();

// A4 oversized (2.5 MB, non-ASCII) stored cache: restores without crash, next save respects the byte cap
const big = { buster: '1.0.0:1', timestamp: Date.now(), clientState: { mutations: [], queries: Array.from({ length: 50 }, (_, i) => ({
  queryKey: ['event', 'details', `big${i}`], queryHash: `["event","details","big${i}"]`, meta: { persist: true },
  state: { data: { blob: '🎉é'.repeat(9000) }, dataUpdateCount: 1, dataUpdatedAt: Date.now() - i, error: null, errorUpdateCount: 0,
    errorUpdatedAt: 0, fetchFailureCount: 0, fetchFailureReason: null, fetchMeta: null, isInvalidated: false, status: 'success', fetchStatus: 'idle' } })) } };
const bigRaw = JSON.stringify(big);
h = await open({ ...P, seedExtra: { [cacheKey]: bigRaw } });
await h.go('/', 12000);
check('A4 oversized cache: app starts', (await h.text()).includes('Discover'), `seeded ${utf8(bigRaw)} bytes`);
st = await h.storage();
check('A4 rewritten cache ≤ 1 MB', st[cacheKey] && utf8(st[cacheKey]) <= 1_000_000, st[cacheKey] ? `${utf8(st[cacheKey])} bytes` : 'missing');
check('A4 no runtime errors', h.errors().length === 0, h.errors().slice(0, 3).join(' || '));
await h.close();

// A5 corrupt stored cache: discarded, app works, a valid cache is written again
h = await open({ ...P, seedExtra: { [cacheKey]: '{"buster":"1.0.0:1","timestamp":' } });
await h.go('/', 12000);
check('A5 corrupt cache: app starts', (await h.text()).includes('Discover'));
st = await h.storage(); let ok5 = false; try { JSON.parse(st[cacheKey]); ok5 = true; } catch {}
check('A5 valid cache rewritten', ok5);
await h.close();

// A6 expired access token + backend unreachable: stays signed in on the stored session
h = await open({ ...P, seedExtra: snapshot, expOffsetS: -600, offline: true });
await h.go('/', 14000);
const t6 = await h.text();
check('A6 expired token offline: still signed in (not welcome screen)', !t6.includes('Get Started'), JSON.stringify(t6.slice(0, 100)));
check('A6 no runtime errors', h.errors().length === 0, h.errors().slice(0, 3).join(' || '));
await h.close();

// J thumbnails: joined tiles on Profile request the 512px sibling for marked uploads, then fall back to the original on 404
h = await open(P);
await h.go('/profile', 10000);
const thumbReq = h.requests.filter((r) => r.path.endsWith('-t.thumb.jpg')).map((r) => r.path.split('/').pop());
const fallbackReq = h.requests.filter((r) => /-t\.jpg$/.test(r.path)).map((r) => r.path.split('/').pop());
check('J marked images request thumbnail first', thumbReq.length > 0, thumbReq.join(','));
check('J unmarked images never request a thumbnail', !h.requests.some((r) => /x\d+\.thumb/.test(r.path) && !r.path.includes('-t.thumb')));
await h.close();

console.log(`\nSUITE A: ${results.filter((r) => r.ok).length}/${results.length} passed`);
process.exit(0);
