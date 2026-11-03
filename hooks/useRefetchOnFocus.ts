import { useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';

/**
 * Re-runs a React Query `refetch` each time the screen regains focus, except
 * on the very first focus (the query's own mount fetch covers that). Lists
 * that can change elsewhere — RSVPs, saves — stay fresh without a full
 * skeleton reload, because React Query keeps the cached data visible while
 * the refetch is in flight.
 */
export function useRefetchOnFocus(
  refetch: (opts?: { cancelRefetch?: boolean }) => unknown,
  enabled = true
) {
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      // Don't restart a fetch that an invalidation (e.g. from EventDetail)
      // already has in flight; just make sure one happens.
      void refetch({ cancelRefetch: false });
    }, [refetch, enabled])
  );
}
