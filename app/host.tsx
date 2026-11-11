import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { markPendingHostIntent } from '@/utils/hostIntent';

/**
 * `eventmap://host` entry point (e.g. from a "host on EventMap" link).
 * Signed-out: remember the intent and go to signup. Signed-in: go to the
 * Create tab, which shows the Start hosting landing or the form.
 */
export default function HostEntry() {
  const { session, loading } = useAuth();
  useEffect(() => {
    if (!loading && !session) markPendingHostIntent();
  }, [loading, session]);
  if (loading) return null;
  if (!session) return <Redirect href={{ pathname: '/(auth)/welcome', params: { intent: 'host' } }} />;
  return <Redirect href="/(tabs)/create" />;
}
