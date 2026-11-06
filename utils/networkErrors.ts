/**
 * Sorts a failure into "the connection failed" versus "the server answered
 * with an error", so screens can say "you're offline" instead of "failed to
 * update" and retries only repeat what a retry can fix. Pure module —
 * unit-tested under node (docs/OFFLINE_PLAN.md §3.2).
 *
 * Shapes it has to recognise:
 * - fetch rejections: `TypeError: Network request failed` (React Native),
 *   `Failed to fetch` (Chrome), `Load failed` (Safari), `NetworkError when
 *   attempting to fetch resource` (Firefox)
 * - postgrest-js, which catches those and returns `{ message: 'TypeError:
 *   Network request failed', code: '' }` instead of throwing
 * - supabase-js auth: `AuthRetryableFetchError` (network, or 502/503/504)
 * - our request timeout (services/supabase.ts): `RequestTimeoutError`, which
 *   postgrest-js reports as `{ message: 'TimeoutError: …' }`
 */

export type ErrorClass =
  /** The request never got an answer: offline, DNS, refused, dropped. */
  | 'network'
  /** No answer within the request timeout. */
  | 'timeout'
  /** The server answered 5xx. Retrying later may help. */
  | 'server'
  /** The server answered and refused (4xx, RLS, validation). Don't retry. */
  | 'client'
  | 'unknown';

/** Thrown by the request layer when a request runs past its time limit. */
export class RequestTimeoutError extends Error {
  constructor(ms: number) {
    super(`Request timed out after ${Math.round(ms / 1000)}s`);
    this.name = 'TimeoutError';
  }
}

type ErrorLike = { name?: unknown; message?: unknown; code?: unknown; status?: unknown; details?: unknown };

const NETWORK_PATTERN =
  /network request failed|failed to fetch|load failed|networkerror|network error|internet connection appears to be offline|could not connect|connection (refused|reset|lost)|err_internet_disconnected|err_network_changed/;
const TIMEOUT_PATTERN = /timeouterror|timed out|request timeout/;

export function classifyError(err: unknown): ErrorClass {
  if (err == null) return 'unknown';
  if (err instanceof RequestTimeoutError) return 'timeout';
  const e = (typeof err === 'object' ? err : { message: String(err) }) as ErrorLike;
  const name = typeof e.name === 'string' ? e.name : '';
  const text = [e.name, e.message, e.details]
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase();
  const status = typeof e.status === 'number' ? e.status : null;

  if (name === 'TimeoutError') return 'timeout';
  // A caller-cancelled request isn't a connection signal, but it also isn't
  // worth retrying; callers check for it before reporting anything.
  if (name === 'AbortError') return 'unknown';
  if (name === 'AuthRetryableFetchError') {
    // auth-js uses status 0 for "no response" and 502/503/504 otherwise.
    return status !== null && status >= 500 ? 'server' : 'network';
  }
  // The server answered, so this is never the user's connection, whatever
  // the text says (a 500 can read "dial tcp …: connection refused" when the
  // server's own database link failed; Postgres 57014 says "statement
  // timeout").
  if (status !== null && status >= 500) return 'server';
  if (status !== null && status >= 400) return 'client';
  // PostgREST / Postgres errors carry a code (PGRST…, 23505, 42501, P0001);
  // postgrest-js's own network failures carry code ''.
  if (typeof e.code === 'string' && e.code.length > 0) return 'client';
  if (TIMEOUT_PATTERN.test(text)) return 'timeout';
  if (NETWORK_PATTERN.test(text)) return 'network';
  return 'unknown';
}

/** The request failed because of the connection (offline or too slow). */
export function isConnectionError(err: unknown): boolean {
  const kind = classifyError(err);
  return kind === 'network' || kind === 'timeout';
}

/** Worth retrying automatically: the connection or a 5xx, never a refusal. */
export function isRetryableError(err: unknown): boolean {
  const kind = classifyError(err);
  return kind === 'network' || kind === 'timeout' || kind === 'server';
}

export const OFFLINE_MESSAGE = "You're offline. Check your connection and try again.";
export const TIMEOUT_MESSAGE = 'The connection is too slow right now. Please try again.';

/** User-facing copy for a connection failure, or null for anything else. */
export function connectionErrorMessage(err: unknown): string | null {
  const kind = classifyError(err);
  if (kind === 'network') return OFFLINE_MESSAGE;
  if (kind === 'timeout') return TIMEOUT_MESSAGE;
  return null;
}
