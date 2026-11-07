import type { PersistedClient } from '@tanstack/query-persist-client-core';

/**
 * Rules for keeping React Query's cache on the device between launches
 * (docs/OFFLINE_PLAN.md §3.3). Pure module — no storage, no React Native —
 * unit-tested under node; services/queryCache.ts wires it to AsyncStorage.
 *
 * Only queries that opt in with `meta: PERSIST_META` are written, so screens
 * decide what is worth keeping (list rows, never images).
 */

/** Bump when a persisted query's data shape changes; older caches are dropped. */
export const CACHE_SCHEMA = 1;
/** Older caches are discarded on restore. */
export const PERSIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Infinite lists keep their first pages only. */
export const PERSIST_MAX_PAGES = 3;
/**
 * Upper bound for the serialized cache, in UTF-8 BYTES. Android's
 * AsyncStorage reads each row through a ~2 MB SQLite CursorWindow: a larger
 * row fails to restore at all. The old cap counted UTF-16 characters
 * (1.5M), which non-ASCII text (emoji, accented titles: 2-4 bytes each) could
 * push past that limit. 1 MB keeps a wide margin and halves the restore
 * read + JSON.parse that every cold start waits on; a heavy cache measures
 * ~130 KB, so nothing realistic is dropped.
 */
export const PERSIST_MAX_BYTES = 1_000_000;

const NON_ASCII = /[^\x00-\x7f]/;

/** UTF-8 byte length of a JS string (fast path for ASCII-only strings). */
export function utf8ByteLength(str: string): number {
  if (!NON_ASCII.test(str)) return str.length;
  let bytes = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdfff) bytes += 2; // each surrogate half; a pair = 4
    else bytes += 3;
  }
  return bytes;
}
/** At most one write per this interval while the cache churns. */
export const PERSIST_THROTTLE_MS = 2000;

/**
 * Caps on how many queries under one key prefix are stored (newest kept),
 * for keys with one entry per item, e.g. one per opened event.
 */
export const PERSIST_LIMITS: readonly { prefix: readonly unknown[]; max: number }[] = [
  { prefix: ['event', 'details'], max: 30 },
  { prefix: ['user-profile'], max: 20 },
  { prefix: ['business-page'], max: 20 },
  { prefix: ['chat', 'room'], max: 5 },
  // One entry per browsed month/range; uncapped before.
  { prefix: ['events', 'calendar'], max: 12 },
];

type TrimmableQuery = {
  queryKey: readonly unknown[];
  meta?: Record<string, unknown>;
  state: { dataUpdatedAt: number };
  getObserversCount: () => number;
};

/**
 * Queries to drop from MEMORY: for each capped prefix, the entries beyond the
 * cap (oldest first) that no screen is observing. They would not survive a
 * restart anyway (the serializer keeps only the newest `max`), but with a
 * 7-day gcTime they otherwise accumulated for the whole session — every
 * event, profile and business page opened.
 */
export function queriesToTrim<Q extends TrimmableQuery>(
  queries: readonly Q[],
  limits = PERSIST_LIMITS
): Q[] {
  const out: Q[] = [];
  for (const limit of limits) {
    // Only persisted entries count toward the cap, exactly as the serializer
    // counts them; a non-persisted query under the same prefix (e.g. a
    // screen-local ['event','details',id] without PERSISTED_QUERY) must not
    // push a persisted entry out of memory that storage would have kept.
    const matching = queries
      .filter((q) => q.meta?.persist === true && hasPrefix(q.queryKey, limit.prefix))
      .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
    for (const q of matching.slice(limit.max)) {
      if (q.getObserversCount() === 0) out.push(q);
    }
  }
  return out;
}

/** Marks a query to be kept on the device. */
export const PERSIST_META = { persist: true } as const;

/**
 * Spread into a query's options to keep it on the device. The long gcTime
 * matters: every save rewrites the whole cache, so a list that React Query
 * dropped from memory (default: 5 minutes unused) would also vanish from
 * storage on the next save.
 */
export const PERSISTED_QUERY = { meta: PERSIST_META, gcTime: PERSIST_MAX_AGE_MS } as const;

export function cacheBuster(appVersion: string): string {
  return `${appVersion}:${CACHE_SCHEMA}`;
}

type QueryLike = { meta?: Record<string, unknown>; state: { data: unknown } };

/**
 * Opted-in queries with data. Deliberately not "status === success": a
 * refetch that fails offline leaves the data in place with an error status,
 * and since every save rewrites the whole cache, skipping it there would
 * delete the saved copy exactly when it is needed.
 */
export function shouldPersistQuery(query: QueryLike): boolean {
  return query.meta?.persist === true && query.state.data !== undefined;
}

type DehydratedQuery = PersistedClient['clientState']['queries'][number];

type CacheEventLike = {
  type: string;
  query: QueryLike;
  action?: { type: string };
};

/**
 * Whether a query-cache event can change what is stored, i.e. whether a save
 * needs scheduling. Most cache traffic (fetch started, observers mounting,
 * invalidation, errors — all normalized away on save) and anything about
 * non-persisted queries is ignored.
 */
export function isPersistRelevantCacheEvent(event: CacheEventLike): boolean {
  switch (event.type) {
    case 'added':
    case 'removed':
      return shouldPersistQuery(event.query);
    case 'updated':
      return (
        event.query.meta?.persist === true &&
        (event.action?.type === 'success' || event.action?.type === 'setState')
      );
    default:
      return false;
  }
}

function trimPages(data: unknown, maxPages: number): unknown {
  if (typeof data !== 'object' || data === null) return data;
  const { pages, pageParams } = data as { pages?: unknown; pageParams?: unknown };
  if (!Array.isArray(pages) || !Array.isArray(pageParams) || pages.length <= maxPages) return data;
  return { ...data, pages: pages.slice(0, maxPages), pageParams: pageParams.slice(0, maxPages) };
}

/**
 * A stored query restores as plain cached data: no error, no fetch in
 * flight, nothing to resume. (Errors don't serialize meaningfully, and a
 * restored "error" would show an error state over good data.)
 */
function normalizeQuery(query: DehydratedQuery, maxPages: number): DehydratedQuery {
  // `dehydratedAt` is stamped with the current time on every dehydrate; hydrate
  // only reads it alongside an in-flight `promise`, which is never stored.
  // Dropping both keeps the output stable when the data hasn't changed.
  const {
    promise: _promise,
    dehydratedAt: _dehydratedAt,
    ...rest
  } = query as DehydratedQuery & { promise?: unknown; dehydratedAt?: number };
  return {
    ...rest,
    state: {
      ...query.state,
      data: trimPages(query.state.data, maxPages),
      status: 'success',
      error: null,
      fetchStatus: 'idle',
      fetchFailureCount: 0,
      fetchFailureReason: null,
      isInvalidated: false,
    },
  } as DehydratedQuery;
}

const hasPrefix = (key: readonly unknown[], prefix: readonly unknown[]) =>
  prefix.every((part, i) => key[i] === part);

/**
 * The string written to storage: queries normalized and trimmed, mutations
 * dropped, per-prefix caps applied (newest kept), and the oldest queries
 * left out until it fits `maxBytes` (UTF-8).
 *
 * Runs on the JS thread on every save, so the work is kept proportional to
 * what is actually stored: the per-prefix caps are applied before anything is
 * serialized (in-memory caches hold far more entries than are kept, e.g.
 * every event opened in the last 7 days), each kept query is stringified
 * exactly once, and the result is assembled from those pieces instead of
 * stringifying everything a second time.
 */
export function serializeForStorage(
  client: PersistedClient,
  { maxBytes = PERSIST_MAX_BYTES, maxPages = PERSIST_MAX_PAGES, limits = PERSIST_LIMITS } = {}
): string {
  const { clientState: _clientState, ...rest } = client;
  const head = JSON.stringify(rest);
  const open = `${head === '{}' ? '{' : `${head.slice(0, -1)},`}"clientState":{"mutations":[],"queries":[`;
  const close = ']}}';

  // Newest first, so caps and the size budget both keep the most recent.
  const ordered = [...client.clientState.queries].sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
  const perLimit = limits.map(() => 0);
  const pieces: string[] = [];
  let total = utf8ByteLength(open) + utf8ByteLength(close);
  for (const query of ordered) {
    const limitIndex = limits.findIndex((l) => hasPrefix(query.queryKey, l.prefix));
    if (limitIndex >= 0 && perLimit[limitIndex] >= limits[limitIndex].max) continue;
    const piece = JSON.stringify(normalizeQuery(query, maxPages));
    const cost = utf8ByteLength(piece) + (pieces.length > 0 ? 1 : 0); // separating comma
    if (total + cost > maxBytes) continue;
    pieces.push(piece);
    total += cost;
    if (limitIndex >= 0) perLimit[limitIndex] += 1;
  }
  return open + pieces.join(',') + close;
}
