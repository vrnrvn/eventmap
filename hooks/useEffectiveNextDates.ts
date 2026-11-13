import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { occurrencesService } from '@/services/occurrences';
import { effectiveNextStartIso, type OccurrenceException } from '@/utils/occurrences';
import type { RecurrencePattern } from '@/utils/recurrence';

type SeriesRow = {
  id: string;
  start_datetime: string;
  end_datetime: string;
  is_recurring?: boolean;
  recurrence_pattern?: RecurrencePattern | null;
  timezone?: string | null;
  next_start_datetime?: string | null;
};

const EMPTY: OccurrenceException[] = [];

/**
 * For the series in a list, the date to show as "next" with skipped and
 * moved dates applied and never a time already past (E-R1 / G2 on the
 * client). One batched query per distinct set of series ids; [] before
 * migration 20261109140000, in which case the server/plain value is used.
 *
 * Returns id → ISO; one-off events are not in the map (use start_datetime).
 */
/**
 * Exceptions of every series in a list, grouped by event id, in one batched
 * query (shared with useEffectiveNextDates through the same key). Series
 * without exceptions are absent from the map.
 */
export function useOccurrenceExceptionsForEvents(
  rows: readonly SeriesRow[] | undefined,
  enabled = true
): { byEvent: Map<string, OccurrenceException[]>; series: SeriesRow[] } {
  const series = useMemo(() => (rows ?? []).filter((r) => r.is_recurring && r.recurrence_pattern), [rows]);
  const ids = useMemo(() => [...new Set(series.map((r) => r.id))].sort(), [series]);
  const query = useQuery({
    queryKey: ['event', 'occurrence-exceptions', 'many', ids.join(',')],
    enabled: enabled && ids.length > 0,
    queryFn: () => occurrencesService.listExceptionsForEvents(ids),
    staleTime: 60 * 1000,
  });
  const byEvent = useMemo(() => {
    const map = new Map<string, OccurrenceException[]>();
    for (const x of query.data ?? EMPTY) map.set(x.event_id, [...(map.get(x.event_id) ?? []), x]);
    return map;
  }, [query.data]);
  return { byEvent, series };
}

export function useEffectiveNextDates(rows: readonly SeriesRow[] | undefined, enabled = true): Map<string, string> {
  const { byEvent, series } = useOccurrenceExceptionsForEvents(rows, enabled);
  return useMemo(() => {
    const now = new Date();
    const out = new Map<string, string>();
    for (const r of series) out.set(r.id, effectiveNextStartIso(r, byEvent.get(r.id) ?? EMPTY, now));
    return out;
  }, [series, byEvent]);
}
