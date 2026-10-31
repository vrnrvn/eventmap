import { Platform } from 'react-native';

/** Mirrors React Native's `Platform.OS` union; only 'web' is treated specially. */
export type AppPlatform = typeof Platform.OS;

/** Production universal-link host (app.json applinks). */
const APP_LINK_HOST = 'eventmap.pro';

/** Registered scheme host (app.json): eventmap://auth-callback */
const CALLBACK_PATH = 'auth-callback';

/**
 * Allow-list for URLs that may carry an auth payload (PKCE `?code=`, or a
 * legacy token fragment). Everything outside this list is ignored, which is
 * what keeps a crafted deep link from driving the session-creation path.
 *
 * Pure and platform-parameterised so it can be unit-tested; `webOrigin` is the
 * current page origin on web (`window.location.origin`) and unused elsewhere.
 */
export function isAuthCallbackUrl(
  url: string,
  platform: AppPlatform = Platform.OS,
  webOrigin?: string
): boolean {
  try {
    // Strip query/fragment before matching so token payloads can't influence it.
    const withoutParams = url.split(/[?#]/)[0].toLowerCase();

    // Web: auth emails (recovery, signup confirmation) redirect to our own
    // origin with the payload in the query/fragment. Accept same-origin only.
    if (platform === 'web') {
      if (withoutParams.startsWith('http://') || withoutParams.startsWith('https://')) {
        if (!webOrigin) return false;
        return new URL(url).origin === webOrigin;
      }
    }

    // Native universal links (app.json applinks): https://eventmap.pro/...
    // A reset requested on web can open in the native app via the applinks
    // domain, so accept our own production host here too.
    if (platform !== 'web' && withoutParams.startsWith('https://')) {
      return new URL(withoutParams).hostname === APP_LINK_HOST;
    }

    // Registered scheme host: eventmap://auth-callback
    if (withoutParams.startsWith('eventmap://')) {
      const rest = withoutParams.slice('eventmap://'.length).replace(/\/+$/, '');
      return rest === CALLBACK_PATH;
    }

    // Expo dev URLs: exp://<host>:<port>/--/auth-callback
    if (withoutParams.startsWith('exp://') || withoutParams.startsWith('exps://')) {
      const pathPart = withoutParams.split('/--/')[1] ?? '';
      return pathPart.replace(/\/+$/, '') === CALLBACK_PATH;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * PKCE code exchange failed because the code_verifier stored at request time is
 * missing or doesn't match — the classic symptom of opening the link on a
 * different device/browser than the one that requested it.
 *
 * GoTrue signals this as error_code `bad_code_verifier` ("code challenge does
 * not match previously saved code verifier"), or — when no verifier exists
 * locally at all — a 400 whose message names the missing verifier. Matching the
 * bare "invalid request" prefix would swallow unrelated 400s and show the
 * wrong-device advice for failures that have nothing to do with the device.
 */
export function isMissingVerifierError(error: unknown): boolean {
  const err = error as { code?: string; message?: string } | null;
  if (!err) return false;
  if (err.code === 'bad_code_verifier') return true;
  const message = typeof err.message === 'string' ? err.message.toLowerCase() : '';
  if (message.includes('code verifier') || message.includes('code_verifier')) return true;
  return message.includes('code challenge');
}
