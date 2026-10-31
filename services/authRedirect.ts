import { Platform } from 'react-native';
import * as AuthSession from 'expo-auth-session';

/**
 * OAuth redirect URL for Supabase signInWithOAuth.
 * - Web: current origin (e.g. http://localhost:8081 or https://eventmap.pro).
 * - Native dev: exp://<LAN_IP>:8081/--/auth-callback.
 * - Native prod: eventmap://auth-callback.
 *
 * The native-dev URL must carry the `auth-callback` path: the usual path reads
 * the result straight off `WebBrowser.openAuthSessionAsync`, but if the
 * redirect instead arrives through `Linking` (app backgrounded mid-flow, or the
 * auth session resolving as `dismiss`), AuthRedirectHandler's allow-list only
 * accepts `exp://` URLs whose path is exactly `auth-callback` — a bare
 * `exp://<LAN_IP>:8081` would be silently dropped along with its `?code=`.
 */
export function getAuthRedirectUrl(): string {
  if (Platform.OS === 'web') {
    return AuthSession.makeRedirectUri();
  }
  if (__DEV__) {
    return AuthSession.makeRedirectUri({ path: 'auth-callback' });
  }
  return 'eventmap://auth-callback';
}

/**
 * Redirect target for Supabase auth emails (password recovery, signup
 * confirmation). Supabase appends the session tokens plus `type=recovery` /
 * `type=signup` in the URL fragment, which AuthRedirectHandler consumes.
 * - Web: current origin (the handler accepts same-origin URLs on web).
 * - Native dev: exp://<LAN_IP>:8081/--/auth-callback.
 * - Native prod: eventmap://auth-callback.
 */
export function getAuthEmailRedirectUrl(): string {
  if (Platform.OS === 'web') {
    return AuthSession.makeRedirectUri();
  }
  if (__DEV__) {
    return AuthSession.makeRedirectUri({ path: 'auth-callback' });
  }
  return 'eventmap://auth-callback';
}
