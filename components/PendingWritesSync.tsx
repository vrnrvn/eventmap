import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import {
  flushPendingWrites,
  getPendingWriteCount,
  setPendingWritesSessionVerified,
  setPendingWritesUser,
  subscribePendingWrites,
} from '@/services/pendingWrites';
import { queryKeys } from '@/hooks/queryKeys';
import { getConnectivity, subscribeConnectivity } from '@/utils/connectivity';
import { notify } from '@/utils/notify';
import { describeWrite, shouldFlushOnTransition } from '@/utils/pendingWrites';

/**
 * Replays writes queued offline (services/pendingWrites.ts) once they can
 * succeed: at sign-in, when the connection returns, when the app comes to
 * the foreground, and (Phase F) once shortly after a write was queued while
 * the device still reported online — a single refused request does not
 * reach 'degraded', so nothing else would trigger a replay until the next
 * foreground. Never while the session is unverified (sessionStale): those
 * requests would go out with the anonymous key and be refused.
 * Mounted once in app/_layout.tsx; renders nothing.
 */

/** Delay before the one-shot retry of writes queued on an "online" device. */
export const QUEUED_WHILE_ONLINE_RETRY_MS = 15_000;
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
      if (kinds.has('collectionItem')) {
        // Counts / covers on the home, every collection page, and the per-event membership.
        void queryClient.invalidateQueries({ queryKey: ['events', 'collections'] });
        void queryClient.invalidateQueries({ queryKey: ['event', 'collections'] });
      }
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
      const replay = shouldFlushOnTransition(previous, status);
      previous = status;
      if (replay) void flush();
    });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void flush();
    });
    // One-shot retry: the queue grew while the device looked online (a
    // request failed on a connection the OS still reports as up). Debounced
    // so a burst of queued writes schedules one replay, not one each.
    let retry: ReturnType<typeof setTimeout> | null = null;
    let lastCount = getPendingWriteCount();
    const unsubscribeQueue = subscribePendingWrites((count) => {
      const grew = count > lastCount;
      lastCount = count;
      if (!grew || getConnectivity() !== 'online') return;
      if (retry) clearTimeout(retry);
      retry = setTimeout(() => {
        retry = null;
        if (getConnectivity() === 'online' && getPendingWriteCount() > 0) void flush();
      }, QUEUED_WHILE_ONLINE_RETRY_MS);
    });
    return () => {
      unsubscribe();
      unsubscribeQueue();
      appState.remove();
      if (retry) clearTimeout(retry);
    };
  }, [userId, sessionStale, queryClient]);

  return null;
}
