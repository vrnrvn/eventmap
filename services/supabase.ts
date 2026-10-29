import 'react-native-url-polyfill/auto';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';
import { isLocalBackend } from './runtime';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing backend configuration. Run npm run backend:start and npm run backend:env.');
}
if (isLocalBackend && new URL(supabaseUrl).hostname.endsWith('.supabase.co')) {
  throw new Error('Local mode cannot connect to hosted Supabase. Run npm run backend:env, or explicitly select hosted mode.');
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Native has no localStorage; without an explicit adapter, sessions fall
    // back to memory and are lost on every app restart. AsyncStorage is
    // localStorage-backed on web, so one adapter covers both platforms.
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
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
