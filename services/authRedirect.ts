import { Platform } from 'react-native';
import * as AuthSession from 'expo-auth-session';

/**
 * OAuth redirect URL for Supabase signInWithOAuth.
 * - Web: current origin (e.g. http://localhost:8081 or https://eventmap.pro).
 * - Native dev: exp://<LAN_IP>:8081.
 * - Native prod: eventmap://auth-callback.
 */
export function getAuthRedirectUrl(): string {
  if (Platform.OS === 'web') {
    return AuthSession.makeRedirectUri();
  }
  if (__DEV__) {
    return AuthSession.makeRedirectUri();
  }
  return 'eventmap://auth-callback';
}
