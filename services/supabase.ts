import 'react-native-url-polyfill/auto';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type User } from '@supabase/supabase-js';
import { Database } from '@/types/database';
import { isLocalBackend } from './runtime';
import { createTimeoutFetch } from '@/utils/timeoutFetch';
import { reportRequestFailed, reportRequestSucceeded } from '@/utils/connectivity';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing backend configuration. Run npm run backend:start and npm run backend:env.');
}
if (isLocalBackend && new URL(supabaseUrl).hostname.endsWith('.supabase.co')) {
  throw new Error('Local mode cannot connect to hosted Supabase. Run npm run backend:env, or explicitly select hosted mode.');
}

// Every REST, RPC, auth and storage request gets a time limit (so a dead
// connection fails instead of spinning forever) and reports its outcome to
// the connectivity store, which drives the offline banner. Realtime runs
// over its own WebSocket and is unaffected.
const timeoutFetch = createTimeoutFetch({
  baseFetch: (...args) => fetch(...args),
  onSuccess: reportRequestSucceeded,
  onConnectionFailure: reportRequestFailed,
});

/**
 * Where supabase-js persists the session: its default key, derived from the
 * project URL. Set explicitly below so services/auth can read the stored
 * session directly when an offline start can't refresh it.
 */
export const supabaseStorageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

/**
 * The raw stored session as it was at launch, read before the client below
 * starts its own startup refresh (which removes a session the server
 * rejects). Lets AuthContext know who was signed in, to clear their device
 * snapshots when that happens.
 */
export const storedSessionAtLaunch: Promise<string | null> = AsyncStorage.getItem(supabaseStorageKey).catch(
  () => null
);

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  global: { fetch: timeoutFetch },
  auth: {
    // Native has no localStorage; without an explicit adapter, sessions fall
    // back to memory and are lost on every app restart. AsyncStorage is
    // localStorage-backed on web, so one adapter covers both platforms.
    storage: AsyncStorage,
    storageKey: supabaseStorageKey,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // PKCE: auth redirects carry a one-time `?code=` bound to a locally stored
    // verifier instead of raw tokens, closing the deep-link session-fixation
    // hole. AuthRedirectHandler exchanges the code explicitly.
    flowType: 'pkce',
  },
});

// On native, JS timers freeze in the background, so the auth refresh loop
// can't tell the app was suspended. Pause it while backgrounded and restart it
// on foreground so a resume triggers an immediate token refresh (which also
// re-auths the realtime socket). Browsers handle visibility themselves.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}

/**
 * The signed-in user from the locally stored session. Services use it for the
 * caller's id instead of `auth.getUser()`, which asks the auth server on every
 * call: a second round trip, and a second way to fail on a bad connection.
 * Identity is still enforced server-side by RLS on the request's JWT.
 *
 * Throws when the session can't be restored (e.g. an expired token can't be
 * refreshed offline) so callers report a failure instead of treating the user
 * as signed out and returning empty results. Null means genuinely signed out.
 */
export async function getSessionUser(): Promise<User | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.user ?? null;
}
