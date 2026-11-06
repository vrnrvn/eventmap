/**
 * One rule for what a data screen shows (docs/OFFLINE_PLAN.md §3.4), so
 * every list behaves the same with a bad connection. Pure — unit-tested
 * under node; hooks/useScreenState.ts feeds it from a query.
 *
 * | Has data?  | Situation          | Shows                                   |
 * |------------|--------------------|-----------------------------------------|
 * | yes        | anything           | the data (+ freshness note if stale)    |
 * | yes, empty | anything           | the real empty state                    |
 * | no         | offline            | "You're offline" (loads on reconnect)   |
 * | no         | failed             | error state with Retry                  |
 * | no         | loading            | skeleton / spinner                      |
 */

export type ScreenState = 'content' | 'empty' | 'loading' | 'offline' | 'error';

export type ScreenStateInput = {
  /** Data has loaded at least once (cached or fresh). */
  hasData: boolean;
  /** The loaded data has nothing to show. */
  isEmpty: boolean;
  isError: boolean;
  isOffline: boolean;
  /** The device cache is still being read; saved rows may be moments away. */
  isRestoring?: boolean;
};

export function resolveScreenState({
  hasData,
  isEmpty,
  isError,
  isOffline,
  isRestoring = false,
}: ScreenStateInput): ScreenState {
  if (hasData) return isEmpty ? 'empty' : 'content';
  if (isRestoring) return 'loading';
  if (isOffline) return 'offline';
  if (isError) return 'error';
  return 'loading';
}

export type FreshnessInput = {
  hasData: boolean;
  /** When the data on screen was fetched (ms). 0 / undefined = unknown. */
  dataUpdatedAt: number | undefined;
  /** The latest refresh failed. */
  isError: boolean;
  connectivity: 'online' | 'offline' | 'degraded';
};

/**
 * The note shown above data that may be out of date ("Offline · Updated 3h
 * ago"), or null when the data is current. Shown when offline / degraded or
 * when the latest refresh failed — not merely because data came from the
 * device cache, since a refresh normally follows within a second.
 */
export function freshnessNote(
  { hasData, dataUpdatedAt, isError, connectivity }: FreshnessInput,
  now: number = Date.now()
): string | null {
  if (!hasData) return null;
  const reason =
    connectivity === 'offline'
      ? 'Offline'
      : connectivity === 'degraded'
        ? 'Weak connection'
        : isError
          ? "Couldn't refresh"
          : null;
  if (!reason) return null;
  return dataUpdatedAt ? `${reason} · ${formatUpdated(dataUpdatedAt, now)}` : reason;
}

/** "Updated just now / 5 min ago / 3 h ago / yesterday / 3 days ago / on Oct 12". */
export function formatUpdated(at: number, now: number = Date.now()): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Updated yesterday';
  if (days < 7) return `Updated ${days} days ago`;
  return `Updated on ${new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}
