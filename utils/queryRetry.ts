import { getConnectivity } from './connectivity';
import { classifyError, isRetryableError } from './networkErrors';

/**
 * React Query `retry` rule shared by the app's queries
 * (docs/OFFLINE_PLAN.md §3.2). Retries only what a retry can fix (a dropped
 * connection or a 5xx), and never while offline: with networkMode
 * 'offlineFirst' a retry requested while offline parks the query as
 * "paused", which would leave a first load on its spinner indefinitely.
 * Returning false instead surfaces the error now, and React Query refetches
 * once the connection returns. A timeout isn't retried either: the user has
 * already waited the full limit once.
 */
export function shouldRetryQuery(failureCount: number, error: unknown, maxRetries = 2): boolean {
  if (getConnectivity() === 'offline') return false;
  if (!isRetryableError(error) || classifyError(error) === 'timeout') return false;
  return failureCount < maxRetries;
}
