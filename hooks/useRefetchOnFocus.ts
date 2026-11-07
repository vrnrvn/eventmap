import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { getEventDataVersion } from '@/utils/eventDataVersion';

/**
 * Re-runs a React Query `refetch` each time the screen regains focus, except
 * on the very first focus (the query's own mount fetch covers that). Lists
 * that can change elsewhere — RSVPs, saves — stay fresh without a full
 * skeleton reload, because React Query keeps the cached data visible while
 * the refetch is in flight.
 *
 * The latest `refetch` is read through a ref, so the focus effect depends only
 * on `enabled`. `useFocusEffect` re-runs whenever its callback changes while
 * the screen is focused; if a caller passes a callback whose identity changes
 * each render (e.g. one closing over `useQuery` results, which are new objects
 * every render in TanStack v5), depending on it directly would refetch on
 * every render — and each refetch renders again, looping for as long as the
 * screen stays open.
 */
export function useRefetchOnFocus(
  refetch: (opts?: { cancelRefetch?: boolean }) => unknown,
  enabled = true,
  /**
   * When given, the focus refetch is skipped while that query is still fresh
   * (within staleTime and not invalidated). `refetch()` itself ignores
   * staleTime, and for infinite lists it replays EVERY loaded page serially,
   * so a quick tab hop used to cost N requests. Writes that change these
   * lists invalidate them (queryKeys.markAttendanceListsStale), so a stale
   * mark always gets its refetch.
   */
  queryKey?: QueryKey
) {
  const queryClient = useQueryClient();
  const keyRef = useRef(queryKey);
  keyRef.current = queryKey;
  const firstFocus = useRef(true);
  // Write version (utils/eventDataVersion) when this screen last loaded:
  // any event write since — create, edit, cancel, RSVP, host action, from
  // any screen — forces the refetch even if the query is still "fresh".
  const versionRef = useRef(getEventDataVersion());
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      const key = keyRef.current;
      const version = getEventDataVersion();
      if (key && version === versionRef.current) {
        const query = queryClient.getQueryCache().find({ queryKey: key, exact: true });
        if (query && !query.isStale()) return;
      }
      versionRef.current = version;
      // Don't restart a fetch that an invalidation (e.g. from EventDetail)
      // already has in flight; just make sure one happens.
      void refetchRef.current({ cancelRefetch: false });
    }, [enabled, queryClient])
  );
}
