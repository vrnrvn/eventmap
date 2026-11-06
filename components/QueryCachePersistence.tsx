import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IsRestoringProvider, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { startQueryPersistence } from '@/services/queryCache';

/** Screens never wait longer than this for the device cache to load. */
const RESTORE_TIMEOUT_MS = 1500;

/**
 * Restores and saves the signed-in user's cached lists
 * (docs/OFFLINE_PLAN.md §3.3). Mounted once in app/_layout.tsx inside
 * AuthProvider.
 *
 * - While a user's cache restores, queries wait (IsRestoringProvider) rather
 *   than firing a request that fails offline and flashing an error before
 *   the saved rows appear.
 * - Switching or signing out clears the in-memory cache, so one account's
 *   lists never show for another (several query keys, e.g. saved events,
 *   don't include the user id). The stored copy is removed by
 *   clearOfflineSnapshots on sign-out.
 */
export function QueryCachePersistence({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const [restoredFor, setRestoredFor] = useState<string | null>(null);
  const previousUserRef = useRef<string | null>(null);

  useEffect(() => {
    const previous = previousUserRef.current;
    previousUserRef.current = userId;
    if (previous && previous !== userId) queryClient.clear();
    if (!userId) return;

    const { restored, stop } = startQueryPersistence(queryClient, userId);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setRestoredFor(userId);
    };
    void restored.then(finish);
    const timer = setTimeout(finish, RESTORE_TIMEOUT_MS);
    return () => {
      done = true;
      clearTimeout(timer);
      stop();
    };
  }, [userId, queryClient]);

  // Derived, so a new user's first render already waits.
  const isRestoring = userId !== null && restoredFor !== userId;
  return <IsRestoringProvider value={isRestoring}>{children}</IsRestoringProvider>;
}
