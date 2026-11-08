/**
 * Decides what a failed token refresh at startup means for the stored
 * session. Pure module, unit-tested under node.
 *
 * supabase-js (auth-js 2.98) removes the stored session for ANY refresh
 * error that is not a network failure or a 502/503/504. That includes a 500
 * from the auth server, a 429 rate limit, and a 4xx with a JSON body from a
 * proxy in front of it — none of which prove the refresh token is bad. The
 * app used to treat that removal as a sign-out and delete the user's queued
 * writes, drafts, chat outboxes and cache. Now only a *definitive* rejection
 * does; everything else keeps the user signed in on the stored session
 * (`sessionStale`) and tries again later.
 */

export type RefreshVerdict =
  /** The server says this refresh token is invalid, used, revoked or the user is gone. */
  | 'rejected'
  /** Anything else: connection, 5xx, rate limit, garbage body, unknown. Keep the session. */
  | 'inconclusive';

/** GoTrue error codes that mean the stored tokens can never work again. */
const REJECTION_CODES = new Set([
  'refresh_token_not_found',
  'refresh_token_already_used',
  'invalid_grant',
  'session_not_found',
  'session_expired',
  'user_not_found',
  'user_banned',
  'bad_jwt',
  'invalid_credentials',
]);

/** 4xx statuses that are about the request or the server's state, not our token. */
const INCONCLUSIVE_4XX = new Set([408, 425, 429]);

type ErrorLike = { name?: unknown; status?: unknown; code?: unknown };

export function classifyRefreshFailure(error: unknown): RefreshVerdict {
  if (error == null || typeof error !== 'object') return 'inconclusive';
  const e = error as ErrorLike;
  const name = typeof e.name === 'string' ? e.name : '';
  const status = typeof e.status === 'number' ? e.status : null;
  const code = typeof e.code === 'string' ? e.code : null;

  // No tokens to refresh with: nothing to keep.
  if (name === 'AuthSessionMissingError') return 'rejected';
  // Network / 502-504 / unparsable body: auth-js keeps the session, so do we.
  if (name === 'AuthRetryableFetchError' || name === 'AuthUnknownError') return 'inconclusive';
  if (code && REJECTION_CODES.has(code)) return 'rejected';
  if (status !== null) {
    if (status >= 500) return 'inconclusive';
    if (INCONCLUSIVE_4XX.has(status)) return 'inconclusive';
    // A 4xx the server answered about this token. GoTrue uses 400 for
    // invalid_grant and 401/403 for revoked or banned users.
    if (status >= 400 && name === 'AuthApiError') return 'rejected';
  }
  return 'inconclusive';
}

/**
 * What startup should do once supabase-js has settled without a session.
 * `error` is the refresh failure if we have it (from getSession or from
 * re-trying the launch tokens); `hadStoredSession` says whether a session
 * was stored when the app launched.
 */
export type StartupSessionAction =
  /** Nobody was signed in on this device. */
  | 'none'
  /** Server rejected the stored tokens: sign out and clear device snapshots. */
  | 'sign-out'
  /** Keep the stored session as stale and retry the refresh later. */
  | 'keep-stale';

export function startupActionForRefreshFailure(error: unknown, hadStoredSession: boolean): StartupSessionAction {
  if (!hadStoredSession) return 'none';
  return classifyRefreshFailure(error) === 'rejected' ? 'sign-out' : 'keep-stale';
}
