import { describe, it, expect } from 'vitest';
import type { PersistedClient } from '@tanstack/query-persist-client-core';
import {
  CACHE_SCHEMA,
  PERSISTED_QUERY,
  PERSIST_MAX_AGE_MS,
  cacheBuster,
  isPersistRelevantCacheEvent,
  utf8ByteLength,
  queriesToTrim,
  serializeForStorage,
  shouldPersistQuery,
} from '../utils/queryPersistence';
import { formatUpdated, freshnessNote, resolveScreenState } from '../utils/screenState';

/** docs/OFFLINE_PLAN.md step 3: persisted query cache and screen-state rule. */

type Q = PersistedClient['clientState']['queries'][number];

const query = (key: string, data: unknown, over: Partial<Q['state']> = {}): Q =>
  ({
    queryKey: [key],
    queryHash: JSON.stringify([key]),
    meta: { persist: true },
    state: {
      data,
      dataUpdateCount: 1,
      dataUpdatedAt: 1000,
      error: null,
      errorUpdateCount: 0,
      errorUpdatedAt: 0,
      fetchFailureCount: 0,
      fetchFailureReason: null,
      fetchMeta: null,
      isInvalidated: false,
      status: 'success',
      fetchStatus: 'idle',
      ...over,
    },
  }) as Q;

const client = (queries: Q[]): PersistedClient => ({
  timestamp: 1,
  buster: 'b',
  clientState: { queries, mutations: [{ state: {} } as never] },
});

const parse = (raw: string) => JSON.parse(raw) as PersistedClient;

describe('shouldPersistQuery', () => {
  it('keeps opted-in queries that have data, even after a failed refetch', () => {
    expect(shouldPersistQuery({ meta: { persist: true }, state: { data: [1] } })).toBe(true);
    expect(shouldPersistQuery({ meta: { persist: true }, state: { data: [] } })).toBe(true);
  });

  it('skips queries without opt-in or without data', () => {
    expect(shouldPersistQuery({ meta: undefined, state: { data: [1] } })).toBe(false);
    expect(shouldPersistQuery({ meta: { persist: true }, state: { data: undefined } })).toBe(false);
  });

  it('PERSISTED_QUERY pairs the opt-in with a gcTime as long as the storage lifetime', () => {
    expect(PERSISTED_QUERY.meta.persist).toBe(true);
    expect(PERSISTED_QUERY.gcTime).toBe(PERSIST_MAX_AGE_MS);
  });

  it('buster changes with the app version and the schema', () => {
    expect(cacheBuster('1.0.0')).toBe(`1.0.0:${CACHE_SCHEMA}`);
    expect(cacheBuster('1.0.1')).not.toBe(cacheBuster('1.0.0'));
  });
});

describe('serializeForStorage', () => {
  it('stores a failed-refetch query as plain cached data', () => {
    const out = parse(
      serializeForStorage(
        client([query('saved', ['a'], { status: 'error', error: new Error('offline') as never, fetchFailureCount: 2 })])
      )
    );
    const state = out.clientState.queries[0].state;
    expect(state.data).toEqual(['a']);
    expect(state.status).toBe('success');
    expect(state.error).toBeNull();
    expect(state.fetchStatus).toBe('idle');
    expect(state.fetchFailureCount).toBe(0);
  });

  it('never stores mutations or in-flight promises', () => {
    const withPromise = { ...query('x', [1]), promise: Promise.resolve() } as Q;
    const out = parse(serializeForStorage(client([withPromise])));
    expect(out.clientState.mutations).toEqual([]);
    expect('promise' in out.clientState.queries[0]).toBe(false);
  });

  it('keeps only the first pages of infinite lists', () => {
    const pages = { pages: [[1], [2], [3], [4], [5]], pageParams: [0, 20, 40, 60, 80] };
    const out = parse(serializeForStorage(client([query('joined', pages)]), { maxPages: 2 }));
    expect(out.clientState.queries[0].state.data).toEqual({ pages: [[1], [2]], pageParams: [0, 20] });
  });

  it('drops the oldest queries first when over budget', () => {
    const big = 'x'.repeat(400);
    const queries = [
      query('old', big, { dataUpdatedAt: 1 }),
      query('mid', big, { dataUpdatedAt: 2 }),
      query('new', big, { dataUpdatedAt: 3 }),
    ];
    // Room for exactly two of the three.
    const two = serializeForStorage(client(queries.slice(0, 2))).length;
    const out = parse(serializeForStorage(client(queries), { maxBytes: two }));
    expect(out.clientState.queries.map((q) => q.queryKey[0])).toEqual(['new', 'mid']);
  });
});

describe('serializeForStorage (save cost)', () => {
  it('output is stable for unchanged data: no per-save dehydratedAt stamp', () => {
    const q = (at: number) => ({ ...query('saved', ['a']), dehydratedAt: at }) as Q;
    const a = serializeForStorage(client([q(111)]));
    const b = serializeForStorage(client([q(222)]));
    expect(a).toBe(b);
    expect('dehydratedAt' in parse(a).clientState.queries[0]).toBe(false);
  });

  it('applies per-prefix caps before the size budget, keeping the newest', () => {
    const detail = (n: number) => ({
      ...query('event', { n }, { dataUpdatedAt: n }),
      queryKey: ['event', 'details', `e${n}`],
    }) as Q;
    const queries = [1, 2, 3, 4, 5].map(detail);
    const out = parse(
      serializeForStorage(client(queries), { limits: [{ prefix: ['event', 'details'], max: 2 }] })
    );
    expect(out.clientState.queries.map((q) => q.queryKey[2])).toEqual(['e5', 'e4']);
  });

  it('produces valid JSON for an empty cache, keeping buster and timestamp', () => {
    const out = parse(serializeForStorage(client([])));
    expect(out).toEqual({ timestamp: 1, buster: 'b', clientState: { mutations: [], queries: [] } });
  });
});

describe('isPersistRelevantCacheEvent', () => {
  const persisted = { meta: { persist: true }, state: { data: [1] } };
  const plain = { meta: undefined, state: { data: [1] } };

  it('schedules a save when persisted data changes or a persisted query goes away', () => {
    expect(isPersistRelevantCacheEvent({ type: 'updated', query: persisted, action: { type: 'success' } })).toBe(true);
    expect(isPersistRelevantCacheEvent({ type: 'updated', query: persisted, action: { type: 'setState' } })).toBe(true);
    expect(isPersistRelevantCacheEvent({ type: 'removed', query: persisted })).toBe(true);
    expect(isPersistRelevantCacheEvent({ type: 'added', query: persisted })).toBe(true);
  });

  it('ignores fetch lifecycle, observers and non-persisted queries', () => {
    for (const action of ['fetch', 'failed', 'pause', 'continue', 'invalidate', 'error']) {
      expect(isPersistRelevantCacheEvent({ type: 'updated', query: persisted, action: { type: action } })).toBe(false);
    }
    expect(isPersistRelevantCacheEvent({ type: 'observerAdded', query: persisted })).toBe(false);
    expect(isPersistRelevantCacheEvent({ type: 'observerResultsUpdated', query: persisted })).toBe(false);
    expect(isPersistRelevantCacheEvent({ type: 'updated', query: plain, action: { type: 'success' } })).toBe(false);
    expect(isPersistRelevantCacheEvent({ type: 'removed', query: plain })).toBe(false);
    expect(
      isPersistRelevantCacheEvent({ type: 'added', query: { meta: { persist: true }, state: { data: undefined } } })
    ).toBe(false);
  });
});

describe('resolveScreenState', () => {
  const base = { hasData: false, isEmpty: true, isError: false, isOffline: false };

  it('shows data whenever there is any, whatever the connection', () => {
    expect(resolveScreenState({ ...base, hasData: true, isEmpty: false, isError: true, isOffline: true })).toBe('content');
    expect(resolveScreenState({ ...base, hasData: true, isEmpty: true, isOffline: true })).toBe('empty');
  });

  it('without data: restoring → loading, then offline, then error, else loading', () => {
    expect(resolveScreenState({ ...base, isOffline: true, isRestoring: true })).toBe('loading');
    expect(resolveScreenState({ ...base, isOffline: true, isError: true })).toBe('offline');
    expect(resolveScreenState({ ...base, isError: true })).toBe('error');
    expect(resolveScreenState(base)).toBe('loading');
  });
});

describe('freshnessNote', () => {
  const now = 10 * 60 * 60 * 1000;
  const at = now - 3 * 60 * 60 * 1000;

  it('explains why data may be out of date and how old it is', () => {
    expect(freshnessNote({ hasData: true, dataUpdatedAt: at, isError: false, connectivity: 'offline' }, now)).toBe(
      'Offline · Updated 3 h ago'
    );
    expect(freshnessNote({ hasData: true, dataUpdatedAt: at, isError: false, connectivity: 'degraded' }, now)).toBe(
      'Weak connection · Updated 3 h ago'
    );
    expect(freshnessNote({ hasData: true, dataUpdatedAt: at, isError: true, connectivity: 'online' }, now)).toBe(
      "Couldn't refresh · Updated 3 h ago"
    );
  });

  it('stays hidden for current data or no data', () => {
    expect(freshnessNote({ hasData: true, dataUpdatedAt: at, isError: false, connectivity: 'online' }, now)).toBeNull();
    expect(freshnessNote({ hasData: false, dataUpdatedAt: 0, isError: true, connectivity: 'offline' }, now)).toBeNull();
  });

  it('formats ages', () => {
    expect(formatUpdated(now - 10_000, now)).toBe('Updated just now');
    expect(formatUpdated(now - 5 * 60_000, now)).toBe('Updated 5 min ago');
    expect(formatUpdated(now - 30 * 60 * 60_000, now)).toBe('Updated yesterday');
    expect(formatUpdated(now - 3 * 24 * 60 * 60_000, now)).toBe('Updated 3 days ago');
  });
});

describe('queriesToTrim', () => {
  const q = (key: unknown[], at: number, observers = 0) => ({
    queryKey: key,
    meta: { persist: true },
    state: { dataUpdatedAt: at },
    getObserversCount: () => observers,
  });

  it('drops only unobserved entries beyond the cap, oldest first', () => {
    const qs = [
      q(['event', 'details', 'a'], 1),
      q(['event', 'details', 'b'], 2, 1), // over cap but on screen: kept
      q(['event', 'details', 'c'], 3),
      q(['event', 'details', 'd'], 4),
      q(['other'], 0),
    ];
    const out = queriesToTrim(qs, [{ prefix: ['event', 'details'], max: 2 }]);
    expect(out.map((x) => x.queryKey[2])).toEqual(['a']);
  });

  it('caps calendar ranges by default', async () => {
    const { PERSIST_LIMITS } = await import('../utils/queryPersistence');
    expect(PERSIST_LIMITS.some((l) => l.prefix.join('/') === 'events/calendar')).toBe(true);
  });
});

describe('utf8ByteLength / byte budget', () => {
  it('counts UTF-8 bytes, not UTF-16 units', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('café')).toBe(5);
    expect(utf8ByteLength('€')).toBe(3);
    expect(utf8ByteLength('🎉')).toBe(4);
    expect(utf8ByteLength('a🎉é')).toBe(Buffer.byteLength('a🎉é', 'utf8'));
  });

  it('a non-ASCII cache stays within the byte cap', () => {
    const queries = Array.from({ length: 20 }, (_, i) =>
      query(`q${i}`, '🎉é'.repeat(200), { dataUpdatedAt: i })
    );
    const raw = serializeForStorage(client(queries), { maxBytes: 5000 });
    expect(Buffer.byteLength(raw, 'utf8')).toBeLessThanOrEqual(5000);
    expect(parse(raw).clientState.queries.length).toBeGreaterThan(0);
  });
});
