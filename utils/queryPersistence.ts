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
 * Upper bound for the serialized cache. AsyncStorage on Android and
 * localStorage on web allow ~5-6 MB in total, shared with everything else.
 */
export const PERSIST_MAX_CHARS = 1_500_000;
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
];

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
  const { promise: _promise, ...rest } = query as DehydratedQuery & { promise?: unknown };
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

/**
 * The string written to storage: queries normalized and trimmed, mutations
 * dropped, per-prefix caps applied (newest kept), and the oldest queries
 * left out until it fits `maxChars`.
 */
const hasPrefix = (key: readonly unknown[], prefix: readonly unknown[]) =>
  prefix.every((part, i) => key[i] === part);

export function serializeForStorage(
  client: PersistedClient,
  { maxChars = PERSIST_MAX_CHARS, maxPages = PERSIST_MAX_PAGES, limits = PERSIST_LIMITS } = {}
): string {
  const queries = client.clientState.queries.map((q) => normalizeQuery(q, maxPages));
  const base = { ...client, clientState: { ...client.clientState, queries: [] as DehydratedQuery[], mutations: [] } };
  const overhead = JSON.stringify(base).length;

  // Newest first; keep adding while the budget allows.
  const sized = queries
    .map((q) => ({ q, size: JSON.stringify(q).length }))
    .sort((a, b) => b.q.state.dataUpdatedAt - a.q.state.dataUpdatedAt);
  const kept: DehydratedQuery[] = [];
  const perLimit = limits.map(() => 0);
  let total = overhead;
  for (const { q, size } of sized) {
    const limitIndex = limits.findIndex((l) => hasPrefix(q.queryKey, l.prefix));
    if (limitIndex >= 0 && perLimit[limitIndex] >= limits[limitIndex].max) continue;
    const cost = size + (kept.length > 0 ? 1 : 0); // separating comma
    if (total + cost > maxChars) continue;
    kept.push(q);
    total += cost;
    if (limitIndex >= 0) perLimit[limitIndex] += 1;
  }
  return JSON.stringify({ ...base, clientState: { ...base.clientState, queries: kept } });
}
