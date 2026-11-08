/**
 * Stops data requests from going out with the anonymous key while a user is
 * signed in but their session is momentarily unavailable to supabase-js
 * (refresh failed and the session was dropped or is still refreshing).
 *
 * supabase-js falls back to the anon key when `getSession()` has no session.
 * Under RLS those reads come back empty — "All caught up", an empty saved
 * list — and would overwrite the device cache. Failing the request with a
 * connection-class error instead keeps cached data on screen and lets the
 * normal retry / reconnect path pick it up once the session is verified.
 *
 * Pure module; AuthContext tells it whether a user is signed in.
 */

let expectUser = false;

export function setExpectedSignedIn(signedIn: boolean) {
  expectUser = signedIn;
}

export function isSignedInExpected(): boolean {
  return expectUser;
}

/** Classified as a network failure by utils/networkErrors (message text), never as a refusal. */
export class SessionNotReadyError extends Error {
  constructor() {
    super('Network request failed: session not ready');
    this.name = 'SessionNotReadyError';
  }
}

function bearer(headers: unknown): string | null {
  if (!headers) return null;
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return headers.get('authorization') ?? headers.get('Authorization');
  }
  if (Array.isArray(headers)) {
    const hit = headers.find(([k]) => String(k).toLowerCase() === 'authorization');
    return hit ? String(hit[1]) : null;
  }
  if (typeof headers === 'object') {
    const h = headers as Record<string, unknown>;
    const key = Object.keys(h).find((k) => k.toLowerCase() === 'authorization');
    return key ? String(h[key]) : null;
  }
  return null;
}

/**
 * True when a /rest/v1 request would be sent with the anon key although a
 * user is signed in. Auth, storage and realtime requests are never blocked:
 * the token endpoint itself legitimately uses the anon key.
 */
export function shouldBlockAnonRequest(
  url: string,
  headers: unknown,
  anonKey: string,
  signedInExpected: boolean = expectUser
): boolean {
  if (!signedInExpected) return false;
  if (!url.includes('/rest/v1/')) return false;
  const auth = bearer(headers);
  if (!auth) return true; // no token at all: postgrest would treat it as anon
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  return token === anonKey;
}
