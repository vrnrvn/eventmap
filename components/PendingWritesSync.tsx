import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { flushPendingWrites, setPendingWritesSessionVerified, setPendingWritesUser } from '@/services/pendingWrites';
import { queryKeys } from '@/hooks/queryKeys';
import { getConnectivity, subscribeConnectivity } from '@/utils/connectivity';
import { notify } from '@/utils/notify';
import { describeWrite } from '@/utils/pendingWrites';

/**
 * Replays writes queued offline (services/pendingWrites.ts) once they can
 * succeed: at sign-in, when the connection returns and when the app comes to
 * the foreground. Never while the session is unverified (sessionStale):
 * those requests would go out with the anonymous key and be refused.
 * Mounted once in app/_layout.tsx; renders nothing.
 */
export function PendingWritesSync() {
  const { user, sessionStale } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();

  useEffect(() => {
    setPendingWritesUser(userId);
  }, [userId]);

  useEffect(() => {
    setPendingWritesSessionVerified(!sessionStale);
  }, [sessionStale]);

  useEffect(() => {
    if (!userId || sessionStale) return;
    const flush = async () => {
      if (getConnectivity() === 'offline') return;
      const { done, dropped } = await flushPendingWrites();
      if (done.length + dropped.length === 0) return;
      // Lists and pages built from these rows refetch with the synced state.
      const kinds = new Set([...done, ...dropped].map((w) => w.kind));
      // A flush happens on reconnect, often while a list is on screen:
      // refetch the visible ones now (others refresh on their next focus).
      if (kinds.has('save')) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.attendanceLists(), refetchType: 'active' });
      }
      if (kinds.has('save') || kinds.has('follow')) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.eventDetailsPrefix() });
      }
      if (kinds.has('follow')) void queryClient.invalidateQueries({ queryKey: ['business-page'] });
      if (kinds.has('notificationRead') || kinds.has('notificationDelete')) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.notificationsPrefix() });
      }
      if (dropped.length === 1) {
        notify.error(`Couldn't ${describeWrite(dropped[0])}. Please try again.`);
      } else if (dropped.length > 1) {
        notify.error(`${dropped.length} changes made offline couldn't be saved. Please check and try again.`);
      }
    };
    void flush();
    let previous = getConnectivity();
    const unsubscribe = subscribeConnectivity((status) => {
      const wasOffline = previous === 'offline';
      previous = status;
      if (wasOffline && status !== 'offline') void flush();
    });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void flush();
    });
    return () => {
      unsubscribe();
      appState.remove();
    };
  }, [userId, sessionStale, queryClient]);

  return null;
}
