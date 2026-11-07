import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import type { PersistedClient } from '@tanstack/query-persist-client-core';
import {
  PERSIST_MAX_AGE_MS,
  PERSIST_META,
  PERSIST_THROTTLE_MS,
  cacheBuster,
  serializeForStorage,
} from '../utils/queryPersistence';
import { snapshotKeys } from '../utils/offlineSnapshot';

/**
 * services/queryCache.ts startQueryPersistence against a REAL QueryClient.
 * Native surfaces are mocked: AppState (listener captured), AsyncStorage
 * (in-memory map; getItem can be gated, setItem can be made to reject) and
 * expo-constants (app version → cache buster).
 */

const h = vi.hoisted(() => {
  type Listener = (state: string) => void;
  const appState = {
    listeners: new Set<Listener>(),
    addEventListener: (_type: string, l: Listener) => {
      appState.listeners.add(l);
      return { remove: () => appState.listeners.delete(l) };
    },
    emit: (state: string) => {
      for (const l of [...appState.listeners]) l(state);
    },
  };
  const storage = {
    map: new Map<string, string>(),
    getGate: null as Promise<void> | null,
    setItemFailures: 0,
    calls: { getItem: 0, setItem: [] as { key: string; value: string }[], removeItem: [] as string[] },
    api: {
      getItem: async (key: string) => {
        storage.calls.getItem++;
        if (storage.getGate) await storage.getGate;
        return storage.map.get(key) ?? null;
      },
      setItem: async (key: string, value: string) => {
        storage.calls.setItem.push({ key, value });
        if (storage.setItemFailures > 0) {
          storage.setItemFailures--;
          throw new Error('disk full');
        }
        storage.map.set(key, value);
      },
      removeItem: async (key: string) => {
        storage.calls.removeItem.push(key);
        storage.map.delete(key);
      },
    },
  };
  return { appState, storage };
});

vi.mock('react-native', () => ({
  AppState: { addEventListener: h.appState.addEventListener },
  Platform: { OS: 'ios', select: (s: Record<string, unknown>) => s.ios ?? s.default },
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: h.storage.api }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '9.9.9' } } }));

const { startQueryPersistence } = await import('../services/queryCache');

const USER = 'user-1';
const KEY = snapshotKeys.queryCache(USER);
const BUSTER = cacheBuster('9.9.9');
const T0 = new Date('2026-11-06T12:00:00Z').getTime();

const writes = () => h.storage.calls.setItem.filter((c) => c.key === KEY);
const lastWrite = () => JSON.parse(writes().at(-1)!.value) as PersistedClient;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** A stored cache as a previous session would have written it. */
function storedCache(entries: { key: unknown[]; data: unknown; at?: number }[], timestamp = T0): string {
  return serializeForStorage({
    buster: BUSTER,
    timestamp,
    clientState: {
      mutations: [],
      // Same key order as query-core's dehydrate (dehydratedAt, state,
      // queryKey, queryHash, meta), i.e. what a previous session wrote.
      queries: entries.map(({ key, data, at }) => ({
        dehydratedAt: timestamp,
        state: {
          data,
          dataUpdateCount: 1,
          dataUpdatedAt: at ?? T0 - 1000,
          error: null,
          errorUpdateCount: 0,
          errorUpdatedAt: 0,
          fetchFailureCount: 0,
          fetchFailureReason: null,
          fetchMeta: null,
          isInvalidated: false,
          status: 'success',
          fetchStatus: 'idle',
        },
        queryKey: key,
        queryHash: JSON.stringify(key),
        meta: { persist: true },
      })) as PersistedClient['clientState']['queries'],
    },
  });
}

function newClient() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Persisted keys opt in through query defaults (PERSISTED_QUERY in the app).
  for (const prefix of [['saved'], ['event', 'details']]) {
    qc.setQueryDefaults(prefix, { meta: PERSIST_META, gcTime: PERSIST_MAX_AGE_MS });
  }
  return qc;
}

/** Start + finish the restore + flush the post-restore save, then forget those writes. */
async function startSettled(qc: QueryClient) {
  const p = startQueryPersistence(qc, USER);
  await p.restored;
  await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
  return p;
}

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;
let active: { stop: () => void }[] = [];

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  h.storage.map.clear();
  h.storage.getGate = null;
  h.storage.setItemFailures = 0;
  h.storage.calls = { getItem: 0, setItem: [], removeItem: [] };
  h.appState.listeners.clear();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  active = [];
});

afterEach(() => {
  for (const p of active) p.stop();
  vi.useRealTimers();
  consoleError.mockRestore();
  consoleWarn.mockRestore();
});

const track = <T extends { stop: () => void }>(p: T) => (active.push(p), p);

describe('startQueryPersistence — restore', () => {
  it('nothing is written before the restore resolves (throttle, background and changes all wait)', async () => {
    const gate = deferred();
    h.storage.getGate = gate.promise;
    h.storage.map.set(KEY, storedCache([{ key: ['saved'], data: ['old'] }]));
    const qc = newClient();
    const p = track(startQueryPersistence(qc, USER));

    qc.setQueryData(['saved'], ['during-restore']);
    h.appState.emit('inactive');
    h.appState.emit('background');
    await vi.advanceTimersByTimeAsync(10 * PERSIST_THROTTLE_MS);
    expect(writes()).toHaveLength(0);

    gate.resolve();
    await p.restored;
    // The newer in-memory data wins over the older stored copy…
    expect(qc.getQueryData(['saved'])).toEqual(['during-restore']);
    expect(writes()).toHaveLength(0);
    // …and is saved once, on the throttle after the restore.
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS - 1);
    expect(writes()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes()).toHaveLength(1);
    expect(lastWrite().clientState.queries[0].state.data).toEqual(['during-restore']);
  });

  it('hydrates persisted data, stamps the 7-day gcTime, and an untouched restore is not rewritten', async () => {
    h.storage.map.set(
      KEY,
      storedCache([
        { key: ['saved'], data: [{ id: 1, title: 'Café 🎉' }], at: T0 - 5000 },
        { key: ['event', 'details', 'e1'], data: { id: 'e1' }, at: T0 - 4000 },
      ])
    );
    const qc = newClient();
    const p = track(startQueryPersistence(qc, USER));
    await p.restored;

    expect(qc.getQueryData(['saved'])).toEqual([{ id: 1, title: 'Café 🎉' }]);
    expect(qc.getQueryData(['event', 'details', 'e1'])).toEqual({ id: 'e1' });
    const q = qc.getQueryCache().find({ queryKey: ['saved'] })!;
    expect(q.gcTime).toBe(PERSIST_MAX_AGE_MS);
    expect(q.meta).toEqual({ persist: true });
    expect(q.state.dataUpdatedAt).toBe(T0 - 5000);

    await vi.advanceTimersByTimeAsync(10 * PERSIST_THROTTLE_MS);
    expect(writes()).toHaveLength(0); // re-serialized cache === stored → no write
  });

  it('expired or busted caches are removed, not hydrated, and later saves still work', async () => {
    for (const raw of [
      storedCache([{ key: ['saved'], data: ['stale'] }], T0 - PERSIST_MAX_AGE_MS - 1),
      storedCache([{ key: ['saved'], data: ['other-version'] }]).replace(BUSTER, '1.0.0:1'),
    ]) {
      h.storage.map.set(KEY, raw);
      h.storage.calls.removeItem = [];
      const qc = newClient();
      const p = startQueryPersistence(qc, USER);
      await p.restored;
      expect(qc.getQueryData(['saved'])).toBeUndefined();
      expect(h.storage.calls.removeItem).toEqual([KEY]);
      qc.setQueryData(['saved'], ['fresh']);
      await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
      expect(lastWrite().clientState.queries.map((x) => x.state.data)).toEqual([['fresh']]);
      p.stop();
    }
  });

  it('corrupt stored JSON: restore swallows the error, cache stays empty, later saves work', async () => {
    h.storage.map.set(KEY, '{"buster":"9.9.9:1","timestamp":');
    const qc = newClient();
    const p = track(startQueryPersistence(qc, USER));
    await expect(p.restored).resolves.toBeUndefined();
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
    expect(h.storage.calls.removeItem).toEqual([KEY]);

    qc.setQueryData(['saved'], ['after-corrupt']);
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    expect(writes().length).toBeGreaterThanOrEqual(1);
    expect(lastWrite().clientState.queries.map((x) => x.state.data)).toEqual([['after-corrupt']]);
  });

  it('stop() before the restore completes: no hydrate (the !open guard) and no writes, ever', async () => {
    const gate = deferred();
    h.storage.getGate = gate.promise;
    h.storage.map.set(KEY, storedCache([{ key: ['saved'], data: ['previous-user'] }]));
    const qc = newClient();
    const p = startQueryPersistence(qc, USER);
    p.stop();
    gate.resolve();
    await p.restored;

    expect(qc.getQueryCache().getAll()).toHaveLength(0);
    qc.setQueryData(['saved'], ['next-user']);
    h.appState.emit('background'); // listener removed by stop()
    await vi.advanceTimersByTimeAsync(10 * PERSIST_THROTTLE_MS);
    expect(writes()).toHaveLength(0);
    expect(h.storage.calls.removeItem).toHaveLength(0);
    expect(h.appState.listeners.size).toBe(0);
  });
});

describe('startQueryPersistence — saving', () => {
  it('fetch-only cache traffic (fetch start, observer add/remove, invalidate, non-persisted data) schedules no save', async () => {
    h.storage.map.set(KEY, storedCache([{ key: ['saved'], data: ['x'] }]));
    const qc = newClient();
    track(await startSettled(qc));
    expect(writes()).toHaveLength(0);

    // Fetch start on a persisted query (never resolves).
    void qc.prefetchQuery({ queryKey: ['saved'], queryFn: () => new Promise(() => {}) });
    // Observers mounting / unmounting.
    const obs = new QueryObserver(qc, { queryKey: ['saved'], enabled: false });
    const unsub = obs.subscribe(() => {});
    unsub();
    // Invalidation without refetch, and with (no active observers → nothing).
    await qc.invalidateQueries({ queryKey: ['saved'], refetchType: 'none' });
    void qc.invalidateQueries({ queryKey: ['saved'] });
    // Data on a non-persisted key.
    for (let i = 0; i < 50; i++) qc.setQueryData(['not-persisted', i], { i });

    await vi.advanceTimersByTimeAsync(10 * PERSIST_THROTTLE_MS);
    expect(writes()).toHaveLength(0);
  });

  it('100 rapid setQueryData on a persisted key → exactly one write, after PERSIST_THROTTLE_MS, with the last value', async () => {
    const qc = newClient();
    track(await startSettled(qc));
    const before = writes().length; // the first-launch empty-cache write

    for (let i = 0; i < 100; i++) {
      qc.setQueryData(['saved'], [i]);
      await vi.advanceTimersByTimeAsync(5);
    }
    // 500 ms elapsed since the first change; the throttle started then.
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS - 500 - 1);
    expect(writes().length - before).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes().length - before).toBe(1);
    expect(lastWrite().clientState.queries[0].state.data).toEqual([99]);
    await vi.advanceTimersByTimeAsync(10 * PERSIST_THROTTLE_MS);
    expect(writes().length - before).toBe(1);
  });

  it('identical re-save is skipped (no second setItem)', async () => {
    const qc = newClient();
    track(await startSettled(qc));
    const before = writes().length;
    qc.setQueryData(['saved'], [{ a: 1 }]);
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    expect(writes().length - before).toBe(1);

    // Churn that nets out to the stored state: a persisted query is added
    // ('added' + 'updated/success' → save scheduled) and removed again
    // before the throttle fires. The save runs, finds the same string
    // (modulo timestamp), and skips the write.
    qc.setQueryData(['event', 'details', 'tmp'], { x: 1 });
    qc.removeQueries({ queryKey: ['event', 'details', 'tmp'] });
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    // Same via the background path.
    qc.setQueryData(['event', 'details', 'tmp2'], { x: 2 });
    qc.removeQueries({ queryKey: ['event', 'details', 'tmp2'] });
    h.appState.emit('background');
    await vi.advanceTimersByTimeAsync(0);
    expect(writes().length - before).toBe(1);
  });

  it('setQueryData with structurally equal data still writes (dataUpdateCount/dataUpdatedAt change)', async () => {
    const qc = newClient();
    track(await startSettled(qc));
    const before = writes().length;
    qc.setQueryData(['saved'], [{ a: 1 }], { updatedAt: T0 });
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    qc.setQueryData(['saved'], [{ a: 1 }], { updatedAt: T0 });
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    expect(writes().length - before).toBe(2);
    expect(lastWrite().clientState.queries[0].state.dataUpdateCount).toBe(2);
  });

  it('a second session restoring what the first one wrote does not rewrite it (round trip is byte-stable)', async () => {
    const qc1 = newClient();
    const s1 = await startSettled(qc1);
    qc1.setQueryData(['saved'], [{ t: 'Ünïcödé 🎉 שלום' }]);
    for (let i = 0; i < 3; i++) qc1.setQueryData(['event', 'details', `e${i}`], { i, pages: [1] });
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    s1.stop();
    const written = h.storage.map.get(KEY)!;
    const count = writes().length;

    const qc2 = newClient();
    track(await startSettled(qc2));
    await vi.advanceTimersByTimeAsync(10 * PERSIST_THROTTLE_MS);
    expect(writes().length).toBe(count);
    expect(h.storage.map.get(KEY)).toBe(written);
    expect(qc2.getQueryData(['saved'])).toEqual([{ t: 'Ünïcödé 🎉 שלום' }]);
  });

  it("background: 'inactive' then 'background' writes at most once, deferred one tick", async () => {
    const qc = newClient();
    track(await startSettled(qc));
    const before = writes().length;

    // Nothing changed → no write at all.
    h.appState.emit('inactive');
    h.appState.emit('background');
    await vi.advanceTimersByTimeAsync(0);
    expect(writes().length - before).toBe(0);

    qc.setQueryData(['saved'], ['bg']);
    h.appState.emit('inactive');
    h.appState.emit('background');
    expect(writes().length - before).toBe(0); // deferred, not synchronous
    // A screen's own background handler writing in the same tick is included.
    qc.setQueryData(['saved'], ['bg-last']);
    await vi.advanceTimersByTimeAsync(0);
    expect(writes().length - before).toBe(1);
    expect(lastWrite().clientState.queries[0].state.data).toEqual(['bg-last']);
    // The pending throttled save was consumed.
    await vi.advanceTimersByTimeAsync(10 * PERSIST_THROTTLE_MS);
    expect(writes().length - before).toBe(1);
    // 'active' never writes.
    qc.setQueryData(['saved'], ['fg']);
    h.appState.emit('active');
    await vi.advanceTimersByTimeAsync(0);
    expect(writes().length - before).toBe(1);
  });

  it('stop() with a pending throttled save → no write', async () => {
    const qc = newClient();
    const p = await startSettled(qc);
    const before = writes().length;
    qc.setQueryData(['saved'], ['pending']);
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS / 2);
    p.stop();
    h.appState.emit('background');
    qc.setQueryData(['saved'], ['after-stop']);
    await vi.advanceTimersByTimeAsync(10 * PERSIST_THROTTLE_MS);
    expect(writes().length - before).toBe(0);
  });

  it('a setItem rejection marks dirty: retried on the next change (or background), not lost', async () => {
    const qc = newClient();
    track(await startSettled(qc));
    const before = writes().length;

    h.storage.setItemFailures = 1;
    qc.setQueryData(['saved'], ['v1'], { updatedAt: T0 + 1 });
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    expect(writes().length - before).toBe(1); // attempted, rejected
    expect(h.storage.map.has(KEY) && JSON.parse(h.storage.map.get(KEY)!).clientState.queries.length).toBeFalsy();

    // No change → no retry by itself (documented: retry waits for a trigger).
    await vi.advanceTimersByTimeAsync(10 * PERSIST_THROTTLE_MS);
    expect(writes().length - before).toBe(1);

    // Background with no data change: the identical string is NOT skipped,
    // because the failed write cleared lastWritten.
    h.appState.emit('background');
    await vi.advanceTimersByTimeAsync(0);
    expect(writes().length - before).toBe(2);
    expect(JSON.parse(h.storage.map.get(KEY)!).clientState.queries[0].state.data).toEqual(['v1']);

    // And a failure followed by a real change retries with the newest data.
    h.storage.setItemFailures = 1;
    qc.setQueryData(['saved'], ['v2']);
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    qc.setQueryData(['saved'], ['v3']);
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    expect(JSON.parse(h.storage.map.get(KEY)!).clientState.queries[0].state.data).toEqual(['v3']);
  });

  it('over-cap unobserved entries are removed from memory on save; observed ones stay; trim causes no extra save', async () => {
    const qc = newClient();
    track(await startSettled(qc));
    const before = writes().length;

    for (let i = 0; i < 35; i++) qc.setQueryData(['event', 'details', `e${i}`], { i }, { updatedAt: T0 + i });
    // The oldest entry is on screen.
    const obs = new QueryObserver(qc, { queryKey: ['event', 'details', 'e0'], enabled: false });
    const unsub = obs.subscribe(() => {});

    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    const inMemory = qc
      .getQueryCache()
      .findAll({ queryKey: ['event', 'details'] })
      .map((q) => q.queryKey[2]);
    expect(inMemory).toHaveLength(31);
    expect(inMemory).toContain('e0'); // observed: kept although over the cap
    for (const gone of ['e1', 'e2', 'e3', 'e4']) expect(inMemory).not.toContain(gone);

    expect(writes().length - before).toBe(1);
    const stored = lastWrite().clientState.queries.map((q) => q.queryKey[2]);
    expect(stored).toHaveLength(30);
    expect(stored[0]).toBe('e34');
    expect(stored).not.toContain('e0');

    // The 'removed' events fired by the trim did not schedule another save.
    await vi.advanceTimersByTimeAsync(10 * PERSIST_THROTTLE_MS);
    expect(writes().length - before).toBe(1);
    unsub();
  });

  it('removing a persisted query (removeQueries) is saved', async () => {
    h.storage.map.set(KEY, storedCache([{ key: ['saved'], data: ['x'] }, { key: ['event', 'details', 'a'], data: 1 }]));
    const qc = newClient();
    track(await startSettled(qc));
    qc.removeQueries({ queryKey: ['saved'] });
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    expect(writes()).toHaveLength(1);
    expect(lastWrite().clientState.queries.map((q) => q.queryKey)).toEqual([['event', 'details', 'a']]);
  });

  it('two users: stop(A) then start(B) on the same client never writes A data under B or vice versa', async () => {
    h.storage.map.set(KEY, storedCache([{ key: ['saved'], data: ['A'] }]));
    const qc = newClient();
    const a = await startSettled(qc);
    a.stop();
    qc.clear();
    const keyB = snapshotKeys.queryCache('user-2');
    const b = track(startQueryPersistence(qc, 'user-2'));
    await b.restored;
    qc.setQueryData(['saved'], ['B']);
    await vi.advanceTimersByTimeAsync(PERSIST_THROTTLE_MS);
    const bWrites = h.storage.calls.setItem.filter((c) => c.key === keyB);
    expect(bWrites.length).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(bWrites.at(-1)!.value).clientState.queries[0].state.data).toEqual(['B']);
    expect(JSON.parse(h.storage.map.get(KEY)!).clientState.queries[0].state.data).toEqual(['A']);
  });
});
