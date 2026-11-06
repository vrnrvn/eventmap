/**
 * Shapes for what the app keeps on the device so a signed-in user can start
 * it offline (docs/OFFLINE_PLAN.md §3.6): the stored auth session written by
 * supabase-js, and per-user snapshots of the profile, business and premium
 * state. Pure module — parsing only, no storage — unit-tested under node.
 *
 * Every parser is defensive: anything malformed, from another user, or from
 * an older snapshot version reads as "no snapshot", never as a wrong one.
 */

/** Bump when a snapshot's shape changes; older ones are then ignored. */
export const SNAPSHOT_VERSION = 1;

export const snapshotKeys = {
  profile: (userId: string) => `eventmap.snapshot.profile.${userId}`,
  business: (userId: string) => `eventmap.snapshot.business.${userId}`,
  premium: (businessId: string) => `eventmap.snapshot.premium.${businessId}`,
  /** The persisted React Query cache (services/queryCache.ts). */
  queryCache: (userId: string) => `eventmap.queryCache.${userId}`,
  /** Writes waiting for a connection (services/pendingWrites.ts). */
  pendingWrites: (userId: string) => `eventmap.pendingWrites.${userId}`,
};

type Envelope<T> = { v: number; owner: string; savedAt: number; data: T };

export function serializeSnapshot<T>(owner: string, data: T, now = Date.now()): string {
  const envelope: Envelope<T> = { v: SNAPSHOT_VERSION, owner, savedAt: now, data };
  return JSON.stringify(envelope);
}

/**
 * The snapshot's data, or undefined when there is no usable snapshot for
 * `owner`. (`null` data is a valid snapshot, e.g. "this user has no
 * business".)
 */
export function parseSnapshot<T>(
  raw: string | null | undefined,
  owner: string,
  isValid: (data: unknown) => data is T
): { data: T; savedAt: number } | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<Envelope<unknown>>;
    if (parsed?.v !== SNAPSHOT_VERSION || parsed.owner !== owner) return undefined;
    if (typeof parsed.savedAt !== 'number' || !isValid(parsed.data)) return undefined;
    return { data: parsed.data, savedAt: parsed.savedAt };
  } catch {
    return undefined;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export type ProfileSnapshotData<P> = { profile: P; isBanned: boolean };

/**
 * Only an onboarded profile for the same user is usable: starting from an
 * un-onboarded one would route into onboarding, which overwrites the user's
 * preferences on completion.
 */
export function isProfileSnapshot<P extends { id: string; has_completed_onboarding?: boolean }>(
  userId: string
) {
  return (data: unknown): data is ProfileSnapshotData<P> =>
    isObject(data) &&
    typeof data.isBanned === 'boolean' &&
    isObject(data.profile) &&
    data.profile.id === userId &&
    data.profile.has_completed_onboarding === true;
}

export type BusinessSnapshotData<B> = { business: B | null };

export function isBusinessSnapshot<B extends { id: string; owner_id: string }>(userId: string) {
  return (data: unknown): data is BusinessSnapshotData<B> =>
    isObject(data) &&
    'business' in data &&
    (data.business === null ||
      (isObject(data.business) && typeof data.business.id === 'string' && data.business.owner_id === userId));
}

// ── Stored auth session ─────────────────────────────────────────────────────

/** The parts of a supabase-js session the offline restore relies on. */
export type StoredSessionLike = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  user: { id: string } & Record<string, unknown>;
};

/**
 * Reads the session supabase-js persists under its storage key. Current
 * versions store the session object itself; very old ones wrapped it as
 * `{ currentSession }`. Returns null when there is nothing usable (no
 * refresh token means it could never be renewed, so it isn't restored).
 */
export function parseStoredSession(raw: string | null | undefined): StoredSessionLike | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const candidate = isObject(parsed) && isObject(parsed.currentSession) ? parsed.currentSession : parsed;
    if (!isObject(candidate)) return null;
    const { access_token, refresh_token, user } = candidate;
    if (typeof access_token !== 'string' || !access_token) return null;
    if (typeof refresh_token !== 'string' || !refresh_token) return null;
    if (!isObject(user) || typeof user.id !== 'string' || !user.id) return null;
    return candidate as StoredSessionLike;
  } catch {
    return null;
  }
}
