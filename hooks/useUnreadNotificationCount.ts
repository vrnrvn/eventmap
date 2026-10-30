import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import {
  getUnreadNotificationCount,
  subscribeToNotifications,
} from '@/services/notifications';

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

    const refetch = () => {
      getUnreadNotificationCount()
        .then((unread) => {
          if (active) setCount(unread);
        })
        .catch(() => {
          // Badge is best-effort.
        });
    };

    refetch();

    // Any insert/update/delete can change the unread total; the head-only
    // count query is cheap, so just refetch instead of mirroring row state.
    const unsubscribe = subscribeToNotifications(
      userId,
      {
        onInsert: refetch,
        onUpdate: refetch,
        onDelete: refetch,
      },
      // Distinct channel topic so this badge subscription can coexist with
      // the notifications screen's subscription for the same user.
      '-badge'
    );

    // Realtime pauses while backgrounded; refresh when the app returns.
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refetch();
    });

    return () => {
      active = false;
      unsubscribe();
      appStateSub.remove();
    };
  }, [userId]);

  return count;
}
