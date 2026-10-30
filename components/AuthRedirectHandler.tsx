import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import { router } from 'expo-router';
import { supabase } from '@/services/supabase';
import { notify } from '@/utils/notify';

WebBrowser.maybeCompleteAuthSession();

function isAuthCallbackUrl(url: string): boolean {
  try {
    // Only the dedicated auth-callback path/host may carry session tokens.
    // Strip query/fragment before matching so token payloads can't influence it.
    const withoutParams = url.split(/[?#]/)[0].toLowerCase();

    // Web: auth emails (recovery, signup confirmation) redirect to our own
    // origin with tokens in the fragment. Accept same-origin URLs only.
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (withoutParams.startsWith('http://') || withoutParams.startsWith('https://')) {
        return new URL(url).origin === window.location.origin;
      }
    }

    // Native universal links (app.json applinks): https://eventmap.pro/...
    // A reset requested on web can open in the native app via the applinks
    // domain, so accept our own production host here too.
    if (Platform.OS !== 'web' && withoutParams.startsWith('https://')) {
      return new URL(withoutParams).hostname === 'eventmap.pro';
    }

    // Registered scheme host (app.json): eventmap://auth-callback
    if (withoutParams.startsWith('eventmap://')) {
      const rest = withoutParams.slice('eventmap://'.length).replace(/\/+$/, '');
      return rest === 'auth-callback';
    }

    // Expo dev URLs: exp://<host>:<port>/--/auth-callback
    if (withoutParams.startsWith('exp://') || withoutParams.startsWith('exps://')) {
      const pathPart = withoutParams.split('/--/')[1] ?? '';
      return pathPart.replace(/\/+$/, '') === 'auth-callback';
    }

    return false;
  } catch {
    return false;
  }
}

/** Scrub auth params (code / token fragment) from the web address bar and history. */
function scrubWebUrl() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.history.replaceState(null, '', window.location.pathname);
  }
}

/**
 * PKCE code exchange failed because the code_verifier stored at request time
 * is missing or doesn't match — the classic symptom of opening the link on a
 * different device/browser than the one that requested it.
 * supabase-js surfaces this as an AuthApiError: GoTrue rejects with
 * error_code `bad_code_verifier` ("code challenge does not match previously
 * saved code verifier"), or — when no verifier exists locally at all — a 400
 * "invalid request: both auth code and code verifier should be non-empty".
 */
function isMissingVerifierError(error: unknown): boolean {
  const err = error as { code?: string; message?: string } | null;
  if (!err) return false;
  if (err.code === 'bad_code_verifier') return true;
  const message = typeof err.message === 'string' ? err.message.toLowerCase() : '';
  return message.includes('code verifier') || message.includes('invalid request');
}

async function createSessionFromUrl(url: string) {
  if (!isAuthCallbackUrl(url)) return;
  const { params, errorCode } = QueryParams.getQueryParams(url);
  if (errorCode) throw new Error(errorCode);

  // PKCE flow: the redirect carries a one-time `?code=` which is only usable
  // together with the code_verifier stored on this device. Password-recovery
  // links are routed via the PASSWORD_RECOVERY auth event (see listener in
  // AuthRedirectHandler) because the exchanged URL carries no `type` we can
  // trust; signup/oauth callbacks land on the root.
  if (params.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(params.code);
    scrubWebUrl();
    if (error) {
      // Log only the message — never the URL or token values.
      console.error('[AuthRedirect] Code exchange failed:', error.message);
      if (isMissingVerifierError(error)) {
        // Cross-device: the verifier is bound to the requesting device, so
        // the link can never work here. Tell the user how to proceed.
        notify.error(
          'This link must be opened on the device where you requested it. Request a new link to use this device.'
        );
      } else {
        notify.error('That link could not be verified. It may have expired — request a new one.');
      }
      router.replace('/(auth)/login');
      return;
    }
    router.replace('/');
    return;
  }

  // TODO-remove: legacy implicit-flow fallback (`#access_token=` fragments)
  // kept only for auth emails/links issued before the PKCE switch. Delete once
  // in-flight links have expired.
  const { access_token, refresh_token, type } = params;
  if (!access_token) return;
  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  scrubWebUrl();
  if (error) throw error;
  if (type === 'recovery') {
    // Password-recovery link: the user must set a new password before
    // continuing — never drop them straight into the app.
    router.replace('/(auth)/reset-password');
  } else {
    router.replace('/');
  }
}

export function AuthRedirectHandler() {
  useEffect(() => {
    const handleUrl = async (url: string | null) => {
      if (!url) return;
      try {
        await createSessionFromUrl(url);
      } catch (err) {
        // Log only the message — never the URL or token values.
        console.error(
          '[AuthRedirect] Failed to create session:',
          err instanceof Error ? err.message : 'unknown error'
        );
        // Anything thrown here came from an allow-listed auth-callback URL
        // (non-auth URLs return early without throwing), so land the user
        // somewhere sane instead of leaving a silent dead end.
        notify.error('That link could not be verified. It may have expired — request a new one.');
        router.replace('/(auth)/login');
      }
    };

    Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, []);

  // PKCE recovery links don't expose `type=recovery` in a trustworthy way;
  // supabase-js fires PASSWORD_RECOVERY when the exchanged session originated
  // from a resetPasswordForEmail link. Route from the event so both the PKCE
  // and legacy paths land on the reset screen. The callback stays synchronous
  // (no awaited Supabase calls) to avoid the supabase-js listener deadlock.
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setTimeout(() => router.replace('/(auth)/reset-password'), 0);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  return null;
}
