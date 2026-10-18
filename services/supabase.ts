import 'react-native-url-polyfill/auto';
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
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
