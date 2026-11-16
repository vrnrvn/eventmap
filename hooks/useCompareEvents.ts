import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { EventDetails } from '@/types/database';
import { queryKeys } from '@/hooks/queryKeys';
import { eventsService } from '@/services/events';
import { useEffectiveNextDates } from '@/hooks/useEffectiveNextDates';
import { fromEventDetails, type CompareInput } from '@/utils/compare';

export type CompareColumn = {
  /** The best data we have: full details when loaded, else the tray's snapshot. */
  input: CompareInput;
  /** Details are on their way; the snapshot is rendering meanwhile. */
  loading: boolean;
  /** The details request failed; the snapshot stays and a retry is offered. */
  error: boolean;
  /** The server returned nothing — cancelled, unpublished or gone for this viewer. */
  missing: boolean;
  refetch: () => void;
};

/**
 * Full details for every selected event (docs/EVENT_COMPARISON_PLAN.md §3.5).
 *
 * One `get_event_details` per column through `queryKeys.eventDetails`, the
 * same key the event page writes, so an event the viewer already opened is
 * instant (and available offline) and at most four requests fire otherwise.
 * Columns render from the tray's snapshot until the details arrive, then
 * switch to the authoritative row — which also carries the viewer's own
 * RSVP and save state for the per-column actions.
 *
 * Series get their *effective* next date from `useEffectiveNextDates` over
 * the fetched rows (plan §3.6); until then the snapshot's date stands.
 */
export function useCompareEvents(items: readonly CompareInput[]): CompareColumn[] {
  const queries = useQueries({
    queries: items.map((item) => ({
      queryKey: queryKeys.eventDetails(item.id),
      queryFn: () => eventsService.getEventDetails(item.id),
      staleTime: 60 * 1000,
    })),
  });

  // useQueries hands back a new array each render; key the memo on what
  // actually changes so the series rows (and the hook behind them) settle.
  const detailsKey = queries.map((q) => `${q.dataUpdatedAt}:${q.status}`).join('|');
  const details = useMemo(
    () => queries.map((q) => (q.data ?? null) as EventDetails | null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detailsKey]
  );
  const seriesRows = useMemo(
    () =>
      details.flatMap((d) =>
        d && d.event.is_recurring
          ? [
              {
                id: d.event.id,
                start_datetime: d.event.start_datetime,
                end_datetime: d.event.end_datetime,
                is_recurring: d.event.is_recurring,
                recurrence_pattern: d.event.recurrence_pattern,
                timezone: d.event.timezone,
              },
            ]
          : []
      ),
    [details]
  );
  const nextById = useEffectiveNextDates(seriesRows);

  return items.map((item, i) => {
    const q = queries[i];
    const d = details[i];
    return {
      input: d ? fromEventDetails(d, nextById.get(item.id)) : item,
      loading: q.isPending,
      error: q.isError,
      missing: q.isSuccess && d === null,
      refetch: () => void q.refetch(),
    };
  });
}
