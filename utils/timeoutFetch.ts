import { RequestTimeoutError, classifyError } from './networkErrors';

/**
 * Wraps fetch with a per-request time limit and reports each outcome, for
 * the Supabase client's `global.fetch` (docs/OFFLINE_PLAN.md §3.2). Pure —
 * the base fetch and the reporters are injected, so it is unit-tested under
 * node.
 *
 * - The limit covers waiting for the response headers. Once headers arrive
 *   the timer stops, so reading a large body is never cut off.
 * - A caller's own AbortSignal still works and is never reported as a
 *   connection failure.
 * - Any HTTP response, even a 4xx/5xx, proves the server is reachable.
 */

export const DEFAULT_TIMEOUT_MS = 12_000;
export const UPLOAD_TIMEOUT_MS = 60_000;

type FetchFn = typeof fetch;

export type TimeoutFetchOptions = {
  baseFetch: FetchFn;
  onSuccess?: () => void;
  onConnectionFailure?: () => void;
  timeoutFor?: (url: string, init?: RequestInit) => number;
};

function requestUrl(input: unknown): string {
  if (typeof input === 'string') return input;
  if (typeof URL !== 'undefined' && input instanceof URL) return input.href;
  return String((input as { url?: unknown })?.url ?? '');
}

/** Storage writes carry whole images; everything else gets the short limit. */
export function defaultTimeoutFor(url: string, init?: RequestInit): number {
  const method = (init?.method ?? 'GET').toUpperCase();
  if (url.includes('/storage/v1/object') && (method === 'POST' || method === 'PUT')) {
    return UPLOAD_TIMEOUT_MS;
  }
  return DEFAULT_TIMEOUT_MS;
}

export function createTimeoutFetch({
  baseFetch,
  onSuccess,
  onConnectionFailure,
  timeoutFor = defaultTimeoutFor,
}: TimeoutFetchOptions): FetchFn {
  return async (input, init) => {
    const ms = timeoutFor(requestUrl(input), init);
    const controller = new AbortController();
    const callerSignal = init?.signal ?? null;
    let timedOut = false;

    const forwardAbort = () => controller.abort(callerSignal?.reason);
    if (callerSignal) {
      if (callerSignal.aborted) forwardAbort();
      else callerSignal.addEventListener('abort', forwardAbort);
    }
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);

    try {
      const response = await baseFetch(input, { ...init, signal: controller.signal });
      onSuccess?.();
      return response;
    } catch (err) {
      if (timedOut) {
        onConnectionFailure?.();
        throw new RequestTimeoutError(ms);
      }
      if (!callerSignal?.aborted && classifyError(err) === 'network') {
        onConnectionFailure?.();
      }
      throw err;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', forwardAbort);
    }
  };
}
