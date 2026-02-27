import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import { router } from 'expo-router';
import { supabase } from '@/services/supabase';

WebBrowser.maybeCompleteAuthSession();

function isAuthCallbackUrl(url: string): boolean {
  try {
    const u = url.toLowerCase();
    const fromEventmap = u.startsWith('eventmap://') && u.includes('auth-callback');
    const fromExpoDev = u.startsWith('exp://');
    const fromApi = u.includes('api.eventmap.pro') && (u.includes('access_token') || u.includes('#'));
    const hasTokens = u.includes('access_token');
    return fromEventmap || fromExpoDev || fromApi || hasTokens;
  } catch {
    return false;
  }
}

async function createSessionFromUrl(url: string) {
  if (!isAuthCallbackUrl(url)) return;
  const { params, errorCode } = QueryParams.getQueryParams(url);
  if (errorCode) throw new Error(errorCode);
  const { access_token, refresh_token } = params;
  if (!access_token) return;
  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) throw error;
  router.replace('/');
}

export function AuthRedirectHandler() {
  useEffect(() => {
    const handleUrl = async (url: string | null) => {
      if (!url) return;
      try {
        await createSessionFromUrl(url);
      } catch (err) {
        console.error('[AuthRedirect] Failed to create session from URL:', err);
      }
    };

    Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, []);

  return null;
}
