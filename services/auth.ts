import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { supabase, supabaseStorageKey, storedSessionAtLaunch } from './supabase';
import { parseStoredSession } from '@/utils/offlineSnapshot';
import { getAuthRedirectUrl, getAuthEmailRedirectUrl } from './authRedirect';
import { oauthEnabled } from './runtime';

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() || '';

const isExpoGo = Constants.appOwnership === 'expo';

export const authService = {
  async signInWithOAuth(provider: 'google' | 'facebook') {
    if (!oauthEnabled) throw new Error('Social sign-in is not configured. Please sign in with email.');
    const useNativeGoogle =
      provider === 'google' &&
      Platform.OS === 'android' &&
      GOOGLE_WEB_CLIENT_ID &&
      !isExpoGo;
    if (useNativeGoogle) {
      return authService.signInWithGoogleNative();
    }
    return authService.signInWithOAuthWeb(provider);
  },

  async signInWithGoogleNative() {
    const { GoogleSignin, statusCodes } = await import(
      '@react-native-google-signin/google-signin'
    );
    GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });

    try {
      await GoogleSignin.hasPlayServices();
      await GoogleSignin.signOut();
      const response = await GoogleSignin.signIn();

      if (response.type !== 'success' || !response.data?.idToken) {
        throw new Error('OAuth was cancelled or failed');
      }

      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: response.data.idToken,
      });

      if (error) throw error;
      if (!data.user) throw new Error('No user data returned');
      return data;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err) {
        const code = (err as { code: string }).code;
        if (code === statusCodes.SIGN_IN_CANCELLED) {
          throw new Error('OAuth was cancelled or failed');
        }
        if (code === statusCodes.IN_PROGRESS) {
          throw new Error('Sign in already in progress');
        }
        if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
          throw new Error('Google Play Services not available');
        }
      }
      throw err;
    }
  },

  async signInWithOAuthWeb(provider: 'google' | 'facebook') {
    const redirectTo = getAuthRedirectUrl();

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        skipBrowserRedirect: true,
        ...(provider === 'google' && {
          queryParams: { prompt: 'select_account' },
        }),
      },
    });

    if (error) throw error;
    if (!data?.url) throw new Error('No OAuth URL returned');

    if (Platform.OS === 'web') {
      window.location.href = data.url;
      return;
    }

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

    if (result.type !== 'success' || !result.url) {
      throw new Error('OAuth was cancelled or failed');
    }

    const { params, errorCode } = QueryParams.getQueryParams(result.url);

    if (errorCode) throw new Error(errorCode);

    // PKCE flow: the redirect carries a one-time `?code=`.
    if (params.code) {
      const { data: sessionData, error: exchangeError } =
        await supabase.auth.exchangeCodeForSession(params.code);
      if (exchangeError) throw exchangeError;
      return sessionData;
    }

    // TODO-remove: legacy implicit-flow fallback (tokens in the fragment),
    // kept for redirects issued before the PKCE switch.
    const { access_token, refresh_token } = params;

    if (!access_token) throw new Error('No access token in redirect');

    const { data: sessionData, error: setError } =
      await supabase.auth.setSession({ access_token, refresh_token });

    if (setError) throw setError;
    return sessionData;
  },

  async signUp(email: string, password: string, name: string) {
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
        emailRedirectTo: getAuthEmailRedirectUrl(),
      },
    });

    if (authError) throw authError;
    if (!authData.user) throw new Error('No user data returned');

    return authData;
  },

  async signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;
    return data;
  },

  /**
   * Best-effort sign-out: the server-side token revoke can fail offline, but
   * the local session must always be cleared so the user is never stranded
   * signed-in. Never throws.
   *
   * Scoped to this device. The supabase-js default is `global`, which revokes
   * every session the user has — signing out on a phone would also sign them
   * out on their tablet and on the web. A deliberate "sign out everywhere"
   * action would pass `{ scope: 'global' }` instead.
   */
  async signOut() {
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
    } catch (err) {
      // Local-scope sign-out only clears stored tokens, so there is nothing
      // left to retry. AuthContext clears in-memory state regardless, and the
      // tabs guard routes to welcome — the user is never stranded signed-in.
      console.error(
        'Sign-out failed; clearing in-memory session anyway:',
        err instanceof Error ? err.message : err
      );
    }
  },

  /**
   * Re-verifies the current user's password. Supabase's `updateUser` does not
   * ask for the existing password, so this is what stands between someone
   * holding an unlocked, signed-in phone and taking the account over.
   *
   * Uses `signInWithPassword` against the session's own email: on success the
   * returned session simply replaces the equivalent current one; on failure it
   * throws without disturbing the existing session.
   */
  async verifyCurrentPassword(password: string): Promise<boolean> {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    const email = userData.user?.email;
    if (!email) {
      throw new Error('This account has no email to verify against. Sign in again and retry.');
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) return true;
    // Wrong password is the expected negative result, not an exception.
    const message = error.message?.toLowerCase() ?? '';
    if (message.includes('invalid login credentials') || error.status === 400) return false;
    throw error;
  },

  /**
   * Whether this account signs in with a password at all. An OAuth-only user
   * (Google, no email identity) has nothing to re-verify — asking them for a
   * "current password" would lock them out of setting their first one.
   */
  async hasPasswordIdentity(): Promise<boolean> {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    const identities = data.user?.identities;
    // Older sessions may not populate `identities`; assume password-backed
    // rather than silently skipping the re-verification.
    if (!identities) return true;
    return identities.some((identity) => identity.provider === 'email');
  },

  async resetPassword(email: string) {
    // The recovery link redirects to the auth callback carrying a PKCE
    // `?code=`; AuthRedirectHandler exchanges it and routes to reset-password
    // via the PASSWORD_RECOVERY auth event (legacy fragment links use
    // `type=recovery`).
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getAuthEmailRedirectUrl(),
    });
    if (error) throw error;
  },

  async updatePassword(newPassword: string) {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (error) throw error;
  },

  /**
   * Starts an email change. Supabase sends a confirmation email to the new
   * address (and, depending on config, the old one); the change applies only
   * after confirmation.
   */
  async updateEmail(newEmail: string) {
    const { error } = await supabase.auth.updateUser(
      { email: newEmail },
      { emailRedirectTo: getAuthEmailRedirectUrl() }
    );
    if (error) throw error;
  },

  async getSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  },

  async getUser() {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    return data.user;
  },

  /**
   * The session supabase-js last persisted, read straight from storage with
   * no refresh and no network. Used to keep a signed-in user signed in when
   * the startup refresh can't reach the server (docs/OFFLINE_PLAN.md §3.6).
   * The access token may be expired: callers treat it as "unverified".
   */
  async readStoredSession(): Promise<Session | null> {
    try {
      const stored = parseStoredSession(await AsyncStorage.getItem(supabaseStorageKey));
      return stored as unknown as Session | null;
    } catch {
      return null;
    }
  },

  /** The user id of the session stored when the app launched, if any. */
  async storedUserIdAtLaunch(): Promise<string | null> {
    return parseStoredSession(await storedSessionAtLaunch)?.user.id ?? null;
  },

  /** The session stored when the app launched (tokens included), if any. */
  async storedSessionAtLaunch(): Promise<Session | null> {
    return (parseStoredSession(await storedSessionAtLaunch) as unknown as Session | null) ?? null;
  },

  /**
   * Re-tries a refresh with a stored token pair and reports the server's
   * answer. supabase-js's startup refresh swallows its error and removes the
   * session for anything it does not call retryable (a 500, a 429, a proxy
   * 4xx); this is how the app learns whether the token was actually
   * rejected before it treats the launch as a sign-out. On success
   * supabase-js adopts the session and fires SIGNED_IN.
   */
  async refreshStoredSession(stored: Session): Promise<{ session: Session | null; error: unknown }> {
    const { data, error } = await supabase.auth.setSession({
      access_token: stored.access_token,
      refresh_token: stored.refresh_token,
    });
    return { session: data.session ?? null, error: error ?? null };
  },

  onAuthStateChange(callback: (session: Session | null, event: AuthChangeEvent) => void) {
    return supabase.auth.onAuthStateChange((event, session) => {
      callback(session, event);
    });
  },
};
