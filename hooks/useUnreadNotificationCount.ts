import { useEffect, useState } from 'react';
import { getConnectivity, subscribeConnectivity } from '@/utils/connectivity';
import { AppState } from 'react-native';
import {
  getUnreadNotificationCount,
  subscribeToNotifications,
} from '@/services/notifications';

const BADGE_REFETCH_DEBOUNCE_MS = 400;

/**
 * Lightweight unread-notification count for the tab badge.
 * Uses an exact head-only count query (not a windowed row fetch, so counts
 * above the screen's 100-row page stay correct), refetched on realtime
 * changes (the notifications screen writes read-state to the DB, so updates
 * flow back here without any shared context) and on app foreground.
 */
export function useUnreadNotificationCount(userId: string | undefined): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!userId) {
      setCount(0);
      return;
    }
    let active = true;

    const fetchCount = () => {
      getUnreadNotificationCount()
        .then((unread) => {
          if (active) setCount(unread);
        })
        .catch(() => {
          // Badge is best-effort.
        });
    };

    // Coalesce bursts: "mark all read" (or a batch of inserts) delivers one
    // realtime event per row, which used to fire one count request per row.
    // A short trailing debounce turns that into a single request.
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const refetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        fetchCount();
      }, BADGE_REFETCH_DEBOUNCE_MS);
    };

    fetchCount();

    // Any insert/update/delete can change the unread total; the head-only
    // count query is cheap, so just refetch instead of mirroring row state.
    const unsubscribe = subscribeToNotifications(
      userId,
      {
        onInsert: refetch,
        onUpdate: refetch,
        onDelete: refetch,
        // Rejoined after a drop: changes in between were never delivered.
        onResubscribed: refetch,
      },
      // Distinct channel topic so this badge subscription can coexist with
      // the notifications screen's subscription for the same user.
      '-badge'
    );

    // Realtime pauses while backgrounded; refresh when the app returns.
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refetch();
    });

    // Back from offline: refresh without waiting for the socket to rejoin.
    let previous = getConnectivity();
    const unsubscribeConnectivity = subscribeConnectivity((status) => {
      const wasOffline = previous === 'offline';
      previous = status;
      if (wasOffline && status !== 'offline') refetch();
    });

    return () => {
      active = false;
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubscribe();
      appStateSub.remove();
      unsubscribeConnectivity();
    };
  }, [userId]);

  return count;
}
