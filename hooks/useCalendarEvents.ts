import { useCallback, useMemo } from 'react';
import { keepPreviousData, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/hooks/queryKeys';
import { shouldRetryQuery } from '@/utils/queryRetry';
import { PERSISTED_QUERY } from '@/utils/queryPersistence';
import { socialService } from '@/services/social';
import { eventsService } from '@/services/events';
import {
  calendarService,
  CalendarRpcUnavailableError,
  isCalendarRpcKnownUnavailable,
} from '@/services/calendar';
import type { CalendarSource, DayRange, SourcedEvent } from '@/utils/calendar';
import type { Event, RankedEvent } from '@/types/database';

/**
 * Calendar data (docs/ANALYTICS_AND_CALENDAR_PLAN.md §2.4).
 *
 * Preferred path (Phase B): one `get_user_calendar` call for the visible
 * range, which also returns pending approval requests, event zones and
 * cancelled / postponed events. While that prepared RPC is missing, fall back
 * to Phase A: one cached list per source from the RPCs the Joined / Saved /
 * My Events screens use, capped at the RPC maximum, plus the attended list
 * when the range reaches into the past. Every key lives under
 * `queryKeys.attendanceLists()`, so RSVP / save invalidation refreshes both.
 */
export const CALENDAR_PAGE_CAP = 100;

export type CalendarRow = RankedEvent | Event;

type ListSource = CalendarSource | 'goingPast' | 'requested';

async function fetchList(source: ListSource, userId: string, businessId: string | null): Promise<CalendarRow[]> {
  switch (source) {
    case 'going':
      return socialService.getUserGoingEvents(userId, 'upcoming', { limit: CALENDAR_PAGE_CAP, offset: 0 });
    case 'goingPast':
      return socialService.getUserGoingEvents(userId, 'past', { limit: CALENDAR_PAGE_CAP, offset: 0 });
    case 'requested':
      // The scope arrives with 20261104120000; older backends reject it.
      try {
        return await socialService.getUserGoingEvents(userId, 'requested', { limit: CALENDAR_PAGE_CAP, offset: 0 });
      } catch (error) {
        if (String((error as { message?: unknown })?.message ?? '').includes('Invalid scope')) return [];
        throw error;
      }
    case 'interested':
      return socialService.getUserGoingEvents(userId, 'interested', { limit: CALENDAR_PAGE_CAP, offset: 0 });
    case 'saved':
      return socialService.getUserSavedEventsWithDetails({ limit: CALENDAR_PAGE_CAP, offset: 0 });
    case 'hosting':
      if (!businessId) return [];
      return eventsService.getBusinessEvents(businessId, { scope: 'upcoming', limit: CALENDAR_PAGE_CAP, offset: 0 });
  }
}

export type CalendarEventsResult = {
  rows: SourcedEvent<CalendarRow>[];
  /** The server had more rows than it returned: some dates may be missing. */
  truncated: boolean;
  /** No data yet for the current request. */
  isPending: boolean;
  /** Some data has loaded (fresh, cached or carried over from the previous range). */
  hasData: boolean;
  /** When the shown data was fetched (oldest source in list mode); 0 if none. */
  dataUpdatedAt: number;
  isFetching: boolean;
  error: unknown;
  /** Which backend path served the data (for tests and diagnostics). */
  mode: 'range' | 'lists';
  refetch: (opts?: { cancelRefetch?: boolean }) => Promise<unknown>;
};

/** Fetch time of the oldest source that has data; 0 when none has. */
function oldestUpdate(queries: { data?: unknown; dataUpdatedAt: number }[]): number {
  const times = queries.filter((q) => q.data !== undefined).map((q) => q.dataUpdatedAt);
  return times.length > 0 ? Math.min(...times) : 0;
}

export function useCalendarEvents(
  userId: string | undefined,
  enabledSources: readonly CalendarSource[],
  businessId: string | null,
  range: DayRange,
  /** Start of today in the viewer zone; past attended events load only for ranges before it. */
  todayStart: Date
): CalendarEventsResult {
  const queryClient = useQueryClient();
  const sourcesKey = useMemo(() => [...enabledSources].sort().join(','), [enabledSources]);
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  // ── Phase B: range RPC ─────────────────────────────────────────────────────
  const knownMissing = isCalendarRpcKnownUnavailable();
  const rangeQuery = useQuery({
    queryKey: queryKeys.calendarRange(userId, fromIso, toIso, sourcesKey),
    // Kept on the device so the calendar opens offline after a restart.
    ...PERSISTED_QUERY,
    enabled: !!userId && !knownMissing && enabledSources.length > 0,
    queryFn: () => calendarService.getUserCalendar(new Date(fromIso), new Date(toIso), enabledSources),
    // Month / agenda changes keep the previous rows visible while loading.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: (count, error) => !(error instanceof CalendarRpcUnavailableError) && shouldRetryQuery(count, error),
  });
  const useLists = knownMissing || rangeQuery.error instanceof CalendarRpcUnavailableError;

  // ── Phase A fallback: per-source lists ─────────────────────────────────────
  const listSources = useMemo<ListSource[]>(() => {
    if (!useLists) return [];
    const out: ListSource[] = [...enabledSources];
    if (enabledSources.includes('going')) {
      out.push('requested');
      if (range.from.getTime() < todayStart.getTime()) out.push('goingPast');
    }
    return out;
  }, [useLists, enabledSources, range.from, todayStart]);

  const lists = useQueries({
    queries: listSources.map((source) => ({
      queryKey: queryKeys.calendarSource(userId, source),
      ...PERSISTED_QUERY,
      enabled: !!userId && (source !== 'hosting' || !!businessId),
      queryFn: () => fetchList(source, userId!, businessId),
      staleTime: 30_000,
    })),
    combine: (queries) => {
      const rows: SourcedEvent<CalendarRow>[] = [];
      queries.forEach((q, index) => {
        const listSource = listSources[index];
        const source: CalendarSource =
          listSource === 'goingPast' || listSource === 'requested' ? 'going' : listSource;
        const pending = listSource === 'requested';
        for (const event of q.data ?? []) rows.push(pending ? { event, source, pending } : { event, source });
      });
      return {
        rows,
        truncated: queries.some((q) => (q.data?.length ?? 0) >= CALENDAR_PAGE_CAP),
        isPending: queries.some((q) => q.isPending && q.fetchStatus !== 'idle'),
        hasData: queries.some((q) => q.data !== undefined),
        dataUpdatedAt: oldestUpdate(queries),
        isFetching: queries.some((q) => q.isFetching),
        error: queries.find((q) => q.isError)?.error ?? null,
      };
    },
  });

  // Stable identity: refetches every calendar query for this user at once.
  const refetch = useCallback(
    (opts?: { cancelRefetch?: boolean }) =>
      queryClient.refetchQueries({ queryKey: queryKeys.calendarPrefix(userId), type: 'active', ...opts }),
    [queryClient, userId]
  );

  if (useLists) {
    return { ...lists, mode: 'lists', refetch };
  }
  return {
    rows: rangeQuery.data?.rows ?? [],
    truncated: rangeQuery.data?.truncated ?? false,
    isPending: rangeQuery.isPending && rangeQuery.fetchStatus !== 'idle',
    hasData: rangeQuery.data !== undefined,
    dataUpdatedAt: rangeQuery.dataUpdatedAt,
    isFetching: rangeQuery.isFetching,
    error: rangeQuery.error,
    mode: 'range',
    refetch,
  };
}
