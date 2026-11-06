import { useIsRestoring } from '@tanstack/react-query';
import { useConnectivity } from '@/services/connectivity';
import { freshnessNote, resolveScreenState, type ScreenState } from '@/utils/screenState';

type QueryLike = {
  isError: boolean;
  dataUpdatedAt: number;
};

/**
 * What a list screen should show for `query` (utils/screenState.ts), plus
 * the "Offline · Updated 3 h ago" note for data that may be out of date.
 *
 * `hasData` / `isEmpty` come from the screen, since only it knows what
 * "empty" means for its data (e.g. pages of rows, or counts).
 */
export function useScreenState(
  query: QueryLike,
  { hasData, isEmpty }: { hasData: boolean; isEmpty: boolean }
): { state: ScreenState; freshness: string | null } {
  const connectivity = useConnectivity();
  const isRestoring = useIsRestoring();
  return {
    state: resolveScreenState({
      hasData,
      isEmpty,
      isError: query.isError,
      isOffline: connectivity === 'offline',
      isRestoring,
    }),
    freshness: freshnessNote({ hasData, dataUpdatedAt: query.dataUpdatedAt, isError: query.isError, connectivity }),
  };
}
