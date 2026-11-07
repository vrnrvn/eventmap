import { describe, it, expect } from 'vitest';
import type { PersistedClient } from '@tanstack/query-persist-client-core';
import {
  PERSIST_LIMITS,
  PERSIST_MAX_BYTES,
  PERSIST_MAX_PAGES,
  isPersistRelevantCacheEvent,
  queriesToTrim,
  serializeForStorage,
  utf8ByteLength,
} from '../utils/queryPersistence';

/**
 * Fuzz / property / stress coverage for the persisted-cache serializer
 * (perf refactor: UTF-8 byte budget, single stringify per query, caps applied
 * before serializing). A seeded PRNG keeps every run reproducible; the seed
 * is in each assertion message.
 */

// ── Seeded PRNG ─────────────────────────────────────────────────────────────
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T,>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

/** Code-unit pools: ASCII, controls/NUL, Latin-1, CJK, RTL + bidi marks, emoji (pairs), combining, lone surrogates. */
const POOLS: (string | ((r: Rng) => string))[] = [
  'abcdefghijklmnopqrstuvwxyz ABC0123456789-_.,:;"\'\\/{}[]',
  '\u0000\u0001\u0007\b\t\n\r\u001f\u007f',
  'éüñçßøåÆÐþ×÷£¥©®°±',
  '東京大阪漢字かなカナ한국어中文',
  'שלוםעבריתالعربيةمرحبا‏‎‮‭⁦⁩',
  (r) => pick(r, ['😀', '🎉', '👩‍👩‍👧', '🏳️‍🌈', '🇵🇹', '𝔘𝔫𝔦', '🧑🏽‍💻', '\u{10FFFF}']),
  '́̈​‍﻿�',
  (r) => String.fromCharCode(int(r, 0xd800, 0xdfff)), // lone surrogate (either half)
];

function randString(r: Rng, maxLen = 24): string {
  const len = int(r, 0, maxLen);
  let s = '';
  for (let i = 0; i < len; i++) {
    const pool = pick(r, POOLS);
    s += typeof pool === 'string' ? pool[int(r, 0, pool.length - 1)] : pool(r);
  }
  return s;
}

function randValue(r: Rng, depth = 0): unknown {
  const k = int(r, 0, depth >= 3 ? 4 : 7);
  switch (k) {
    case 0:
      return null;
    case 1:
      return r() < 0.5;
    case 2:
      return pick(r, [0, -0, 1, -1, 3.14159, 1e308, -1e-308, Number.MAX_SAFE_INTEGER, int(r, -1e6, 1e6)]);
    case 3:
    case 4:
      return randString(r);
    case 5:
    case 6: {
      const n = int(r, 0, 5);
      return Array.from({ length: n }, () => randValue(r, depth + 1));
    }
    default: {
      const o: Record<string, unknown> = {};
      for (let i = int(r, 0, 5); i > 0; i--) o[randString(r, 8)] = randValue(r, depth + 1);
      return o;
    }
  }
}

function randData(r: Rng): unknown {
  if (r() < 0.3) {
    // Infinite-query shape; sometimes with mismatched pageParams.
    const pages = Array.from({ length: int(r, 0, 8) }, () => randValue(r, 1));
    const pageParams =
      r() < 0.85 ? pages.map((_, i) => i) : Array.from({ length: int(r, 0, 8) }, (_, i) => `c${i}`);
    return { pages, pageParams };
  }
  return randValue(r);
}

type Q = PersistedClient['clientState']['queries'][number];

const KEY_SHAPES: ((r: Rng) => unknown[])[] = [
  (r) => ['event', 'details', `e${int(r, 0, 60)}`],
  (r) => ['user-profile', `u${int(r, 0, 40)}`, pick(r, ['own', 'public'])],
  (r) => ['business-page', `b${int(r, 0, 40)}`],
  (r) => ['chat', 'room', `e${int(r, 0, 20)}`],
  (r) => ['events', 'calendar', 'u1', 'range', `2026-${int(r, 1, 12)}`, 'x', 'going'],
  (r) => ['events', 'joined', 'u1', pick(r, ['upcoming', 'past'])],
  (r) => ['notifications', `u${int(r, 0, 3)}`],
  (r) => [randString(r, 6), randValue(r, 2)],
];

let hashSeq = 0;
function randQuery(r: Rng, maxTs = 50): Q {
  const queryKey = pick(r, KEY_SHAPES)(r);
  const q: Record<string, unknown> = {
    dehydratedAt: int(r, 0, 1e12),
    state: {
      data: randData(r),
      dataUpdateCount: int(r, 0, 5),
      dataUpdatedAt: int(r, 0, maxTs), // small range → many ties
      error: r() < 0.2 ? { message: randString(r) } : null,
      errorUpdateCount: 0,
      errorUpdatedAt: 0,
      fetchFailureCount: int(r, 0, 3),
      fetchFailureReason: null,
      fetchMeta: null,
      isInvalidated: r() < 0.3,
      status: pick(r, ['success', 'error', 'pending']),
      fetchStatus: pick(r, ['idle', 'fetching', 'paused']),
    },
    queryKey,
    // Unique hash so pieces are distinguishable even with equal keys.
    queryHash: `${JSON.stringify(queryKey)}#${hashSeq++}`,
    meta: { persist: true },
  };
  if (r() < 0.2) q.promise = Promise.resolve('in-flight');
  return q as unknown as Q;
}

const clientOf = (queries: Q[], buster = 'v1:1', timestamp = 1730000000000): PersistedClient => ({
  buster,
  timestamp,
  clientState: { queries, mutations: [{ state: {} } as never] },
});

/** The exact JSON piece the serializer emits for one query (no caps, no budget). */
function pieceOf(q: Q, maxPages: number): string {
  const out = serializeForStorage(clientOf([q]), { maxBytes: Infinity, maxPages, limits: [] });
  const open = out.indexOf('"queries":[') + '"queries":['.length;
  return out.slice(open, out.length - ']}}'.length);
}

/** Reference greedy model using Buffer.byteLength (the "true" UTF-8 size). */
function referenceKeptHashes(
  client: PersistedClient,
  maxBytes: number,
  maxPages: number,
  limits: readonly { prefix: readonly unknown[]; max: number }[]
): string[] {
  const shell = serializeForStorage({ ...client, clientState: { queries: [], mutations: [] } }, { maxBytes: Infinity });
  let total = Buffer.byteLength(shell, 'utf8');
  const ordered = client.clientState.queries
    .map((q, i) => ({ q, i }))
    .sort((a, b) => b.q.state.dataUpdatedAt - a.q.state.dataUpdatedAt || a.i - b.i)
    .map((x) => x.q);
  const per = limits.map(() => 0);
  const kept: string[] = [];
  for (const q of ordered) {
    const li = limits.findIndex((l) => l.prefix.every((p, j) => q.queryKey[j] === p));
    if (li >= 0 && per[li] >= limits[li].max) continue;
    const cost = Buffer.byteLength(pieceOf(q, maxPages), 'utf8') + (kept.length ? 1 : 0);
    if (total + cost > maxBytes) continue;
    kept.push(q.queryHash);
    total += cost;
    if (li >= 0) per[li]++;
  }
  return kept;
}

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

// ── utf8ByteLength ──────────────────────────────────────────────────────────

describe('utf8ByteLength — property vs Buffer.byteLength', () => {
  it('agrees with Buffer for 10k random well-formed strings; lone surrogates count 2 (Buffer: 3, as U+FFFD)', () => {
    const r = mulberry32(0xbeef);
    let withLone = 0;
    for (let i = 0; i < 10_000; i++) {
      const s = randString(r, 40);
      const lone = (s.match(new RegExp(LONE_SURROGATE.source, 'g')) ?? []).length;
      if (lone) withLone++;
      // Documented divergence: each LONE surrogate is 2 here, 3 in Buffer
      // (encoded as EF BF BD). Paired surrogates are 4 bytes in both.
      expect(utf8ByteLength(s) + lone, JSON.stringify(s)).toBe(Buffer.byteLength(s, 'utf8'));
    }
    expect(withLone).toBeGreaterThan(500); // the generator really exercises the case
  });

  it('boundary code points', () => {
    for (const [s, n] of [
      ['', 0],
      ['\u0000', 1],
      ['\u007f', 1],
      ['\u0080', 2],
      ['߿', 2],
      ['ࠀ', 3],
      ['퟿', 3],
      ['', 3],
      ['￿', 3],
      ['\u{10000}', 4],
      ['\u{10FFFF}', 4],
    ] as const) {
      expect(utf8ByteLength(s), JSON.stringify(s)).toBe(n);
      expect(Buffer.byteLength(s), JSON.stringify(s)).toBe(n);
    }
    // Reversed pair = two lone surrogates: ours 4, Buffer 6.
    expect(utf8ByteLength('\udc00\ud800')).toBe(4);
    expect(Buffer.byteLength('\udc00\ud800')).toBe(6);
  });

  it('JSON.stringify never emits a lone surrogate, so the serializer only measures well-formed text', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 2000; i++) {
      const s = JSON.stringify(randValue(r));
      if (s === undefined) continue;
      expect(LONE_SURROGATE.test(s)).toBe(false);
      expect(utf8ByteLength(s)).toBe(Buffer.byteLength(s));
    }
  });
});

// ── serializeForStorage fuzz ────────────────────────────────────────────────

describe('serializeForStorage — fuzz', () => {
  const RUNS = 300;

  it(`${RUNS} random caches: valid JSON, ≤ maxBytes (Buffer), exact match with a Buffer-based greedy reference`, () => {
    for (let seed = 1; seed <= RUNS; seed++) {
      const r = mulberry32(seed);
      const queries = Array.from({ length: int(r, 0, 80) }, () => randQuery(r));
      const maxBytes = pick(r, [0, 50, 300, 1_000, 4_000, 20_000, PERSIST_MAX_BYTES]);
      const maxPages = pick(r, [0, 1, 2, PERSIST_MAX_PAGES, 10]);
      const client = clientOf(queries);
      const out = serializeForStorage(client, { maxBytes, maxPages });
      const msg = `seed=${seed} maxBytes=${maxBytes} maxPages=${maxPages}`;

      const parsed = JSON.parse(out) as PersistedClient;
      expect(LONE_SURROGATE.test(out), msg).toBe(false);
      const shellBytes = Buffer.byteLength(
        serializeForStorage({ ...client, clientState: { queries: [], mutations: [] } }, { maxBytes: Infinity })
      );
      // Under budget, unless even the empty envelope doesn't fit.
      if (maxBytes >= shellBytes) expect(Buffer.byteLength(out), msg).toBeLessThanOrEqual(maxBytes);
      expect(parsed.clientState.mutations, msg).toEqual([]);
      expect(parsed.buster).toBe(client.buster);
      expect(parsed.timestamp).toBe(client.timestamp);

      // Newest first (stable for ties), per-prefix caps, normalized state.
      const kept = parsed.clientState.queries;
      for (let i = 1; i < kept.length; i++) {
        expect(kept[i - 1].state.dataUpdatedAt, msg).toBeGreaterThanOrEqual(kept[i].state.dataUpdatedAt);
      }
      for (const limit of PERSIST_LIMITS) {
        const n = kept.filter((q) => limit.prefix.every((p, j) => q.queryKey[j] === p)).length;
        expect(n, `${msg} prefix=${limit.prefix.join('/')}`).toBeLessThanOrEqual(limit.max);
      }
      const inputByHash = new Map(queries.map((q) => [q.queryHash, q]));
      for (const q of kept) {
        expect('promise' in q, msg).toBe(false);
        expect('dehydratedAt' in q, msg).toBe(false);
        expect(q.state.status).toBe('success');
        expect(q.state.fetchStatus).toBe('idle');
        expect(q.state.error).toBeNull();
        expect(q.state.isInvalidated).toBe(false);
        expect(q.state.fetchFailureCount).toBe(0);
        const original = inputByHash.get(q.queryHash)!;
        const d = original.state.data as { pages?: unknown[]; pageParams?: unknown[] } | null;
        if (d && typeof d === 'object' && Array.isArray(d.pages) && Array.isArray(d.pageParams)) {
          const kd = q.state.data as { pages: unknown[]; pageParams: unknown[] };
          if (d.pages.length > maxPages) {
            expect(kd.pages.length, msg).toBe(maxPages);
            expect(kd.pageParams.length, msg).toBe(Math.min(maxPages, d.pageParams.length));
            expect(kd.pages, msg).toEqual(JSON.parse(JSON.stringify(d.pages.slice(0, maxPages))));
          } else {
            expect(kd.pages.length, msg).toBe(d.pages.length);
          }
        }
      }

      // Exact selection: the same greedy rule measured with Buffer.
      expect(
        kept.map((q) => q.queryHash),
        msg
      ).toEqual(referenceKeptHashes(client, maxBytes, maxPages, PERSIST_LIMITS));
    }
  });

  it('output is identical for identical input with different dehydratedAt (and with/without promise)', () => {
    for (let seed = 1000; seed < 1100; seed++) {
      const r = mulberry32(seed);
      const queries = Array.from({ length: int(r, 1, 30) }, () => randQuery(r));
      const restamped = queries.map((q) => {
        const copy = { ...q, dehydratedAt: (q as { dehydratedAt?: number }).dehydratedAt! + 12345 } as Q & {
          promise?: unknown;
        };
        if (copy.promise) delete copy.promise;
        else copy.promise = Promise.resolve();
        return copy as Q;
      });
      expect(serializeForStorage(clientOf(restamped)), `seed=${seed}`).toBe(serializeForStorage(clientOf(queries)));
    }
  });

  it('empty cache → a valid, empty envelope', () => {
    const out = serializeForStorage(clientOf([]));
    expect(JSON.parse(out)).toEqual({
      buster: 'v1:1',
      timestamp: 1730000000000,
      clientState: { mutations: [], queries: [] },
    });
    // Envelope larger than the budget: nothing can be dropped, still valid JSON.
    expect(() => JSON.parse(serializeForStorage(clientOf([]), { maxBytes: 0 }))).not.toThrow();
  });

  it('a single query larger than the budget is skipped whole (not truncated) and older ones are still kept', () => {
    const base = (key: string, data: unknown, at: number) =>
      ({
        queryKey: [key],
        queryHash: key,
        meta: { persist: true },
        state: { data, dataUpdatedAt: at, status: 'success', fetchStatus: 'idle' },
      }) as unknown as Q;
    const huge = base('huge', '😀'.repeat(5_000), 100); // ~20 KB, newest
    const small = [base('a', 'é'.repeat(50), 50), base('b', ['x'], 10), base('c', { t: '東京' }, 5)];
    const out = serializeForStorage(clientOf([...small, huge]), { maxBytes: 2_000 });
    const kept = (JSON.parse(out) as PersistedClient).clientState.queries;
    expect(kept.map((q) => q.queryHash)).toEqual(['a', 'b', 'c']);
    expect(out.includes('😀')).toBe(false);
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(2_000);
  });

  it('budget counts UTF-8 bytes, not UTF-16 units: an emoji-heavy cache stays under the cap', () => {
    const qs = Array.from(
      { length: 200 },
      (_, i) =>
        ({
          queryKey: ['k', i],
          queryHash: `k${i}`,
          meta: { persist: true },
          state: { data: '🎉'.repeat(300), dataUpdatedAt: i },
        }) as unknown as Q
    );
    const out = serializeForStorage(clientOf(qs), { maxBytes: 100_000 });
    expect(out.length).toBeLessThan(100_000 / 1.5); // UTF-16 length is well under…
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(100_000); // …the byte cap is what binds
    expect(Buffer.byteLength(out)).toBeGreaterThan(95_000); // and it was actually filled
  });

  it('lone surrogates in data never push the Buffer-measured output over maxBytes', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const r = mulberry32(seed * 31);
      const qs = Array.from(
        { length: 60 },
        (_, i) =>
          ({
            queryKey: ['lone', i, String.fromCharCode(int(r, 0xd800, 0xdfff))],
            queryHash: `lone${i}`,
            meta: { persist: true },
            state: {
              data: Array.from({ length: 40 }, () => String.fromCharCode(int(r, 0xd800, 0xdfff)) + 'x').join(''),
              dataUpdatedAt: i,
            },
          }) as unknown as Q
      );
      const maxBytes = int(r, 500, 30_000);
      const out = serializeForStorage(clientOf(qs), { maxBytes });
      // JSON.stringify escapes lone surrogates (\udXXX, ASCII), so our 2-byte
      // count is never applied to one and the cap holds.
      expect(Buffer.byteLength(out), `seed=${seed}`).toBeLessThanOrEqual(maxBytes);
      expect(utf8ByteLength(out)).toBe(Buffer.byteLength(out));
    }
  });

  it('maxPages trimming: only infinite shapes with BOTH arrays are trimmed', () => {
    const q = (data: unknown) =>
      ({ queryKey: ['p'], queryHash: 'p', meta: { persist: true }, state: { data, dataUpdatedAt: 1 } }) as unknown as Q;
    const read = (data: unknown, maxPages: number) =>
      (JSON.parse(serializeForStorage(clientOf([q(data)]), { maxPages })) as PersistedClient).clientState.queries[0]
        .state.data;
    expect(read({ pages: [1, 2, 3, 4], pageParams: [0, 1, 2, 3], extra: 'kept' }, 2)).toEqual({
      pages: [1, 2],
      pageParams: [0, 1],
      extra: 'kept',
    });
    expect(read({ pages: [1, 2, 3], pageParams: [0] }, 2)).toEqual({ pages: [1, 2], pageParams: [0] });
    expect(read({ pages: [1, 2, 3] }, 1)).toEqual({ pages: [1, 2, 3] }); // no pageParams → not infinite
    expect(read({ pages: 'x', pageParams: [] }, 0)).toEqual({ pages: 'x', pageParams: [] });
    expect(read([1, 2, 3, 4, 5], 1)).toEqual([1, 2, 3, 4, 5]); // plain arrays untouched
    expect(read({ pages: [1, 2], pageParams: [0, 1] }, 0)).toEqual({ pages: [], pageParams: [] });
    expect(read(null, 0)).toBeNull();
  });
});

// Real bug, kept out of the passing set (see report): the envelope's size is
// counted in UTF-16 units (`open.length`), so a non-ASCII buster (app
// version) under-counts and the output can exceed maxBytes.
describe('FIXED: non-ASCII buster is counted in bytes', () => {
  it('stays ≤ maxBytes with a non-ASCII buster', () => {
    const qs = Array.from(
      { length: 50 },
      (_, i) =>
        ({ queryKey: ['k', i], queryHash: `k${i}`, meta: { persist: true }, state: { data: 'x'.repeat(50), dataUpdatedAt: i } }) as unknown as Q
    );
    const out = serializeForStorage(clientOf(qs, '版本'.repeat(100)), { maxBytes: 2_000 });
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(2_000); // actual: 2,338
  });
});

// ── Stress ──────────────────────────────────────────────────────────────────

describe('serializeForStorage — stress', () => {
  /** 5,000 queries of mixed-script text, ~1 KB each. `uncapped` puts every key outside PERSIST_LIMITS (worst case: every query is stringified). */
  function bigClient(seed: number, uncapped: boolean) {
    const r = mulberry32(seed);
    const filler = (n: number) => {
      let s = '';
      while (s.length < n) s += pick(r, ['lorem ipsum ', 'café ', '東京 ', '🎉 ', 'שלום ', 'data-row ']);
      return s;
    };
    const queries: Q[] = [];
    for (let i = 0; i < 5_000; i++) {
      const key = uncapped ? ['events', 'joined', `u${i}`] : pick(r, KEY_SHAPES.slice(0, 7))(r).concat(i);
      const infinite = i % 5 === 0;
      const row = () => ({ id: `id-${i}-${int(r, 0, 1e6)}`, title: filler(80), body: filler(260), n: i });
      queries.push({
        dehydratedAt: Date.now(),
        queryKey: key,
        queryHash: JSON.stringify(key),
        meta: { persist: true },
        state: {
          data: infinite ? { pages: [[row()], [row()], [row()], [row()]], pageParams: [0, 1, 2, 3] } : [row()],
          dataUpdatedAt: int(r, 0, 1e9),
          status: 'success',
          fetchStatus: 'idle',
          error: null,
        },
      } as unknown as Q);
    }
    return clientOf(queries);
  }

  for (const uncapped of [false, true]) {
    it(`5,000 queries / ~5 MB input (${uncapped ? 'all uncapped keys' : 'app-like key mix'}): < 1.5 s, under the byte budget`, () => {
      const client = bigClient(42, uncapped);
      const inputBytes = Buffer.byteLength(JSON.stringify(client));
      expect(inputBytes).toBeGreaterThan(4_000_000);

      serializeForStorage(client); // warm-up (JIT), then measure the median of 5
      const times: number[] = [];
      let out = '';
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        out = serializeForStorage(client);
        times.push(performance.now() - t0);
      }
      const ms = times.sort((a, b) => a - b)[2];
      const outBytes = Buffer.byteLength(out);
      console.info(
        `[stress] serializeForStorage (${uncapped ? 'uncapped' : 'mixed'}): 5000 queries, input ${(inputBytes / 1e6).toFixed(2)} MB → ` +
          `output ${(outBytes / 1e6).toFixed(3)} MB, ${JSON.parse(out).clientState.queries.length} kept, ` +
          `median ${ms.toFixed(1)} ms (max ${times[4].toFixed(1)} ms)`
      );
      expect(times[4]).toBeLessThan(1_500);
      expect(outBytes).toBeLessThanOrEqual(PERSIST_MAX_BYTES);
      if (uncapped) expect(outBytes).toBeGreaterThan(PERSIST_MAX_BYTES * 0.99);
    });
  }
});

// ── isPersistRelevantCacheEvent truth table ─────────────────────────────────

describe('isPersistRelevantCacheEvent — full truth table', () => {
  const types = [
    'added',
    'removed',
    'updated',
    'observerAdded',
    'observerRemoved',
    'observerResultsUpdated',
    'observerOptionsUpdated',
    'bogus',
  ];
  const metas: (Record<string, unknown> | undefined)[] = [
    undefined,
    {},
    { persist: true },
    { persist: false },
    { persist: 'true' },
    { persist: 1 },
  ];
  const datas = [undefined, null, 0, '', [], { a: 1 }];
  const actions = [
    undefined,
    'success',
    'setState',
    'fetch',
    'error',
    'invalidate',
    'pause',
    'continue',
    'failed',
  ];

  it('matches the specification for every combination', () => {
    let n = 0;
    for (const type of types)
      for (const meta of metas)
        for (const data of datas)
          for (const action of actions) {
            const persisted = meta?.persist === true;
            const expected =
              type === 'added' || type === 'removed'
                ? persisted && data !== undefined
                : type === 'updated'
                  ? persisted && (action === 'success' || action === 'setState')
                  : false;
            const event = { type, query: { meta, state: { data } }, action: action ? { type: action } : undefined };
            expect(isPersistRelevantCacheEvent(event), JSON.stringify(event)).toBe(expected);
            n++;
          }
    expect(n).toBe(types.length * metas.length * datas.length * actions.length);
  });
});

// ── queriesToTrim ───────────────────────────────────────────────────────────

type TQ = { id: string; queryKey: unknown[]; meta?: Record<string, unknown>; state: { dataUpdatedAt: number }; getObserversCount: () => number };
// Persisted by default: in the app every entry under a capped prefix is
// persisted (query defaults / PERSISTED_QUERY); non-persisted ones are tested
// explicitly in the FIXED block below.
const tq = (id: string, queryKey: unknown[], at: number, observers = 0): TQ => ({
  id,
  queryKey,
  meta: { persist: true },
  state: { dataUpdatedAt: at },
  getObserversCount: () => observers,
});

describe('queriesToTrim', () => {
  it('keeps observed entries even when over the cap; trims only unobserved beyond it', () => {
    const qs = [
      tq('a', ['event', 'details', 'a'], 5, 1),
      tq('b', ['event', 'details', 'b'], 4),
      tq('c', ['event', 'details', 'c'], 3, 2),
      tq('d', ['event', 'details', 'd'], 2),
      tq('e', ['event', 'details', 'e'], 1),
    ];
    const out = queriesToTrim(qs, [{ prefix: ['event', 'details'], max: 2 }]);
    expect(out.map((q) => q.id)).toEqual(['d', 'e']); // c is beyond the cap but observed
  });

  it('ties in dataUpdatedAt: input order decides (stable sort), same as the serializer', () => {
    const qs = ['a', 'b', 'c', 'd'].map((id) => tq(id, ['x', id], 7));
    expect(queriesToTrim(qs, [{ prefix: ['x'], max: 2 }]).map((q) => q.id)).toEqual(['c', 'd']);
    expect(queriesToTrim([...qs].reverse(), [{ prefix: ['x'], max: 2 }]).map((q) => q.id)).toEqual(['b', 'a']);
  });

  it('multiple prefixes are capped independently; unrelated keys untouched', () => {
    const qs = [
      ...Array.from({ length: 4 }, (_, i) => tq(`p${i}`, ['chat', 'room', i], i)),
      ...Array.from({ length: 4 }, (_, i) => tq(`u${i}`, ['user-profile', i], i)),
      tq('other', ['chat', 'list'], 0),
      tq('short', ['chat'], 0),
    ];
    const out = queriesToTrim(qs, [
      { prefix: ['chat', 'room'], max: 1 },
      { prefix: ['user-profile'], max: 3 },
    ]).map((q) => q.id);
    expect(out.sort()).toEqual(['p0', 'p1', 'p2', 'u0']);
  });

  it('cap 0 trims every unobserved match', () => {
    const qs = [tq('a', ['k', 1], 1), tq('b', ['k', 2], 2, 1), tq('c', ['k', 3], 3)];
    expect(queriesToTrim(qs, [{ prefix: ['k'], max: 0 }]).map((q) => q.id)).toEqual(['c', 'a']);
  });

  it('empty input / no limits → nothing', () => {
    expect(queriesToTrim([])).toEqual([]);
    expect(queriesToTrim([tq('a', ['event', 'details', 1], 1)], [])).toEqual([]);
  });

  it('the default limits do not overlap (a key is counted under one cap only, as in the serializer)', () => {
    for (const a of PERSIST_LIMITS)
      for (const b of PERSIST_LIMITS) {
        if (a === b) continue;
        const aUnderB = b.prefix.every((p, i) => a.prefix[i] === p);
        expect(aUnderB, `${a.prefix} under ${b.prefix}`).toBe(false);
      }
  });

  it('property: for persisted unobserved caches, trimmed = exactly what the serializer drops for caps', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = mulberry32(seed + 5000);
      const qs = Array.from({ length: int(r, 0, 120) }, () => randQuery(r, 20));
      const trimmed = new Set(
        queriesToTrim(qs.map((q) => ({ ...q, getObserversCount: () => 0 }))).map((q) => q.queryHash)
      );
      const kept = new Set(
        (JSON.parse(serializeForStorage(clientOf(qs), { maxBytes: Infinity })) as PersistedClient).clientState.queries.map(
          (q) => q.queryHash
        )
      );
      for (const q of qs) {
        expect(trimmed.has(q.queryHash) !== kept.has(q.queryHash), `seed=${seed} ${q.queryHash}`).toBe(true);
      }
    }
  });
});

// Real (minor) divergence, kept out of the passing set (see report):
// queriesToTrim counts EVERY cached query under a capped prefix, the
// serializer only persisted ones. A newer non-persisted query under the
// prefix (e.g. ['event','details',id] first created by ManageEvent, which
// doesn't spread PERSISTED_QUERY) evicts a persisted entry from memory — and
// so from storage — that the serializer would have kept.
describe('FIXED: memory trim only counts persisted queries toward the cap', () => {
  it('does not evict a persisted entry the serializer would keep', () => {
    const limits = [{ prefix: ['event', 'details'], max: 2 }];
    const persisted = (id: string, at: number) => ({ ...tq(id, ['event', 'details', id], at), meta: { persist: true } });
    const nonPersisted = { ...tq('np', ['event', 'details', 'np'], 99), meta: undefined };
    const out = queriesToTrim([persisted('a', 1), persisted('b', 2), nonPersisted], limits);
    expect(out.map((q) => q.id)).toEqual([]);
  });
});
