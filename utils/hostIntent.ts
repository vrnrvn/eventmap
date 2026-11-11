import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * "What brings you here?" answer from onboarding (HOST_ONBOARDING_PLAN.md
 * Stage 1). Drives host nudges only; it never gates anything.
 *
 * Stored in three places, in order of authority:
 *   1. `profiles.intent` (migration 20261110100000, may be unapplied),
 *   2. a per-user AsyncStorage copy, so the client works without the column,
 *   3. a pre-auth "pending" flag set by the `eventmap://host` deep link or
 *      `?intent=host` on the welcome/signup screens, consumed by onboarding.
 */
export type UserIntent = 'attend' | 'host' | 'both';

export const USER_INTENTS: readonly UserIntent[] = ['attend', 'host', 'both'];

export const userIntentKey = (userId: string) => `eventmap.userIntent.${userId}`;
export const PENDING_HOST_INTENT_KEY = 'eventmap.pendingHostIntent';

export function parseUserIntent(value: unknown): UserIntent | null {
  return typeof value === 'string' && (USER_INTENTS as readonly string[]).includes(value)
    ? (value as UserIntent)
    : null;
}

/** True when the user said they want to host (alone or alongside attending). */
export function wantsToHost(intent: UserIntent | null | undefined): boolean {
  return intent === 'host' || intent === 'both';
}

/** Accepts a route param (string | string[] | undefined) and returns true for `host`. */
export function isHostIntentParam(param: unknown): boolean {
  const v = Array.isArray(param) ? param[0] : param;
  return v === 'host';
}

/**
 * PostgREST reports an unknown column in an update as PGRST204; Postgres
 * itself uses 42703. Either means the intent migration is not applied yet.
 */
export function isMissingColumnError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'PGRST204' || code === '42703';
}

export async function markPendingHostIntent(): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_HOST_INTENT_KEY, '1');
  } catch {
    // Best-effort: losing the flag only loses a preselection.
  }
}

/** Reads and clears the pre-auth host flag. */
export async function consumePendingHostIntent(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(PENDING_HOST_INTENT_KEY);
    if (v) await AsyncStorage.removeItem(PENDING_HOST_INTENT_KEY);
    return v === '1';
  } catch {
    return false;
  }
}

export async function readLocalIntent(userId: string): Promise<UserIntent | null> {
  try {
    return parseUserIntent(await AsyncStorage.getItem(userIntentKey(userId)));
  } catch {
    return null;
  }
}

export async function writeLocalIntent(userId: string, intent: UserIntent): Promise<void> {
  try {
    await AsyncStorage.setItem(userIntentKey(userId), intent);
  } catch {
    // Best-effort.
  }
}

/**
 * Persist the intent locally, then try the server. A missing column is
 * expected until the migration lands and is swallowed; any other server
 * error is also swallowed because intent is non-critical, but reported back
 * so callers/tests can tell what happened.
 */
export async function saveUserIntent(
  userId: string,
  intent: UserIntent,
  writeServer: (intent: UserIntent) => Promise<void>
): Promise<'saved' | 'local-only' | 'failed'> {
  await writeLocalIntent(userId, intent);
  try {
    await writeServer(intent);
    return 'saved';
  } catch (err) {
    return isMissingColumnError(err) ? 'local-only' : 'failed';
  }
}
