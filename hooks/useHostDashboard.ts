import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/hooks/queryKeys';
import { useRefetchOnFocus } from '@/hooks/useRefetchOnFocus';
import { useScreenState } from '@/hooks/useScreenState';
import { eventsService } from '@/services/events';
import { hostToolsService } from '@/services/hostTools';
import { occurrencesService } from '@/services/occurrences';
import { PERSISTED_QUERY } from '@/utils/queryPersistence';
import type { Event } from '@/types/database';
import type { OccurrenceException } from '@/utils/occurrences';
import { parseHostDashboardRpc } from '@/utils/hostDashboardRpc';
import {
  AGENDA_EVENT_LIMIT,
  agendaWindow,
  buildAgenda,
  buildAttentionQueue,
  overviewTargets,
  seriesDatesInAgenda,
  summarizeAgenda,
  type AgendaCounts,
  type AgendaDay,
  type AgendaSummary,
  type AttentionItem,
  type AttentionOverview,
} from '@/utils/hostDashboard';

/**
 * What the dashboard keeps on the device. Plain JSON (no Maps or Dates), so
 * it survives the persisted cache (docs/OFFLINE_PLAN.md §3.5) and the agenda
 * is rebuilt from it against the current time on every render.
 */
export type HostDashboardData = {
  events: Event[];
  counts: Record<string, AgendaCounts>;
  exceptions: OccurrenceException[];
  dateGoing: Record<string, Record<string, number>>;
  /** The upcoming query hit its limit; later events may be missing. */
  truncated: boolean;
  /** Going counts could not be loaded; the agenda shows no numbers. */
  countsUnavailable: boolean;
  /**
   * 'rpc' = one `get_host_dashboard` request (C3), whose attention facts
   * live in the in-memory `attentionRpcKey` entry; absent = the N-call path.
   * Optional so caches persisted before C3 still restore.
   */
  source?: 'rpc';
};

/**
 * Where the RPC path keeps "Needs you". Deliberately NOT persisted (no
 * PERSIST_META): a restored "4 requests waiting" could be days old.
 */
const attentionRpcKey = (businessId: string | undefined) =>
  [...queryKeys.hostDashboard(businessId), 'attention', 'rpc'] as const;

/**
 * C3: the whole dashboard in one request where `get_host_dashboard` is
 * deployed, else the N-call path below. The window is the agenda's own
 * (local midnight onward), so sessions earlier today still get per-date
 * counts — the RPC's default window starts at now().
 */
async function loadHostDashboard(businessId: string, queryClient: QueryClient): Promise<HostDashboardData> {
  const raw = await hostToolsService.getHostDashboard(businessId, agendaWindow(new Date()));
  // Not deployed (null), or a payload that is not the RPC's object: keep the
  // N-call path rather than render an empty week from it.
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return loadHostDashboardByCalls(businessId);
  const { data, attention } = parseHostDashboardRpc(raw);
  queryClient.setQueryData<AttentionData>(attentionRpcKey(businessId), attention);
  return data;
}

/**
 * Fallback where `get_host_dashboard` is not deployed (hosted projects until
 * the C3 migration ships there). C1 data plan (docs/HOST_DASHBOARD_PLAN.md
 * §4): three batched requests,
 * plus one per-date count request per series that appears in the window
 * (at most MAX_SERIES_DATE_COUNTS).
 *
 * Failure policy: the event rows and the exceptions are required — without
 * the exceptions a skipped date would be shown as happening, which is worse
 * than showing the last good copy with a freshness note. Counts are
 * decoration and degrade to "unknown".
 */
async function loadHostDashboardByCalls(businessId: string): Promise<HostDashboardData> {
  const events = await eventsService.getBusinessEvents(businessId, {
    scope: 'upcoming',
    limit: AGENDA_EVENT_LIMIT,
  });
  const live = events.filter((e) => e.status !== 'cancelled');
  const seriesIds = live.filter((e) => e.is_recurring).map((e) => e.id);

  const [countsMap, exceptions] = await Promise.all([
    hostToolsService.getEventsCounts(live.map((e) => e.id)).catch(() => null),
    occurrencesService.listExceptionsForEvents(seriesIds),
  ]);

  const counts: Record<string, AgendaCounts> = {};
  countsMap?.forEach((c, id) => {
    counts[id] = { going: c.going, waitlist: c.waitlist };
  });

  // Which series dates are actually in the window decides which per-date
  // counts are worth asking for.
  const wanted = seriesDatesInAgenda(buildAgenda({ events, counts, exceptions, now: new Date() }));
  const dateGoing: Record<string, Record<string, number>> = {};
  await Promise.all(
    Object.entries(wanted).map(async ([id, keys]) => {
      try {
        const { going } = await occurrencesService.getDateGoingCounts(id, keys);
        if (Object.keys(going).length > 0) dateGoing[id] = going;
      } catch {
        // Per-date counts are optional; the series count stands in.
      }
    })
  );

  return {
    events,
    counts,
    exceptions,
    dateGoing,
    truncated: events.length >= AGENDA_EVENT_LIMIT,
    countsUnavailable: countsMap === null,
  };
}

/** Drafts + the bounded overview fan-out behind the "Needs you" list (C2). */
export type AttentionData = {
  drafts: Event[];
  overviews: Record<string, AttentionOverview>;
  /** How many events were inspected, and how many could have been. */
  inspected: number;
  eligible: number;
};

/**
 * Per-event facts the batched RPCs do not expose: pending requests and open
 * chat reports. Until `get_host_dashboard` exists (C3) these cost one call
 * each, so only MAX_OVERVIEW_TARGETS events are inspected (DC5).
 *
 * Each call goes through Manage event's own query key, so the dashboard
 * warms the screen it links to instead of keeping a second copy, and that
 * screen's mutations invalidate this data too.
 *
 * Not persisted: a stale "4 requests waiting" would be worse than silence.
 */
function useAttentionQuery(
  businessId: string | undefined,
  events: Event[] | undefined,
  now: Date,
  source: HostDashboardData['source']
) {
  const queryClient = useQueryClient();
  const viaRpc = source === 'rpc';
  const targets = useMemo(() => (events ? overviewTargets(events, now) : []), [events, now]);
  const eligible = useMemo(
    () => (events ? overviewTargets(events, now, Number.MAX_SAFE_INTEGER).length : 0),
    [events, now]
  );
  const key = targets.join(',');

  return useQuery({
    queryKey: viaRpc ? attentionRpcKey(businessId) : [...queryKeys.hostDashboard(businessId), 'attention', key],
    enabled: !!businessId && !!events,
    // RPC path: filled by every dashboard fetch via setQueryData, so it is
    // never stale on its own.
    ...(viaRpc ? { staleTime: Infinity } : {}),
    queryFn: async (): Promise<AttentionData> => {
      if (viaRpc) {
        // Only reached when the entry is missing, i.e. the dashboard came
        // from the persisted cache. One dashboard fetch fills it (and is
        // shared with a focus refetch already in flight).
        await queryClient.fetchQuery({
          queryKey: queryKeys.hostDashboard(businessId),
          queryFn: () => loadHostDashboard(businessId!, queryClient),
          staleTime: 0,
        });
        return (
          queryClient.getQueryData<AttentionData>(attentionRpcKey(businessId)) ?? {
            drafts: [],
            overviews: {},
            inspected: 0,
            eligible: 0,
          }
        );
      }
      const [drafts, rows] = await Promise.all([
        // Drafts come back newest-first, and the stale-draft rule wants the
        // OLDEST; 50 keeps them in range for all but very prolific hosts.
        eventsService.getBusinessEvents(businessId!, { scope: 'drafts', limit: 50 }).catch(() => [] as Event[]),
        Promise.all(
          targets.map(async (id) => {
            try {
              const overview = await queryClient.fetchQuery({
                queryKey: ['host', 'event', id, 'overview'],
                queryFn: () => hostToolsService.getOverview(id),
                staleTime: 60_000,
              });
              return [id, overview as AttentionOverview] as const;
            } catch {
              // One event's facts missing only costs that event's rows.
              return null;
            }
          })
        ),
      ]);
      const overviews: Record<string, AttentionOverview> = {};
      for (const row of rows) if (row) overviews[row[0]] = row[1];
      return { drafts, overviews, inspected: targets.length, eligible };
    },
  });
}

function useDashboardQuery(businessId: string | undefined, enabled: boolean) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.hostDashboard(businessId),
    ...PERSISTED_QUERY,
    queryFn: () => loadHostDashboard(businessId!, queryClient),
    enabled: !!businessId && enabled,
  });
}

/**
 * The clock the agenda is built against. Refreshed whenever the screen
 * regains focus, so "Today" and "live" are right after the app sat in the
 * background, without a timer running while nobody is looking.
 */
function useFocusNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useFocusEffect(
    useCallback(() => {
      setNow(new Date());
    }, [])
  );
  // ...and at the next local midnight, so a screen left open overnight does
  // not keep yesterday's "Today" (O-3). One timer, re-armed each day; no
  // polling while the day is unchanged.
  useEffect(() => {
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    const ms = midnight - Date.now();
    // Guard a clock that jumped backwards (or a stale `now`): never schedule
    // a zero-delay timer, which would re-render in a loop.
    const timer = setTimeout(() => setNow(new Date()), Math.max(ms, 1000) + 500);
    return () => clearTimeout(timer);
  }, [now]);
  return now;
}

export type HostDashboard = {
  query: ReturnType<typeof useDashboardQuery>;
  data: HostDashboardData | undefined;
  days: AgendaDay[];
  summary: AgendaSummary;
  /** "Needs you", most urgent first (C2). Empty until its query resolves. */
  attention: AttentionItem[];
  /** True when more events exist than the fan-out cap inspected (DC5). */
  attentionTruncated: boolean;
  state: ReturnType<typeof useScreenState>['state'];
  freshness: string | null;
  refresh: () => Promise<unknown>;
};

/** The full dashboard: fetches, refreshes on focus, rebuilds the agenda. */
export function useHostDashboard(businessId: string | undefined): HostDashboard {
  const query = useDashboardQuery(businessId, true);
  useRefetchOnFocus(query.refetch, !!businessId, queryKeys.hostDashboard(businessId));
  const now = useFocusNow();
  const data = query.data;

  const days = useMemo(
    () =>
      data
        ? buildAgenda({ events: data.events, counts: data.counts, exceptions: data.exceptions, dateGoing: data.dateGoing, now })
        : [],
    [data, now]
  );
  const summary = useMemo(() => summarizeAgenda(days), [days]);

  const attentionQuery = useAttentionQuery(businessId, data?.events, now, data?.source);
  const attentionData = attentionQuery.data;
  const attention = useMemo(
    () =>
      data && attentionData
        ? buildAttentionQueue({
            events: data.events,
            drafts: attentionData.drafts,
            counts: data.counts,
            overviews: attentionData.overviews,
            now,
          })
        : [],
    [data, attentionData, now]
  );

  // The agenda decides the screen's state; an empty week with something in
  // the queue is still worth showing.
  const { state, freshness } = useScreenState(query, {
    hasData: data !== undefined,
    isEmpty: days.length === 0 && attention.length === 0,
  });

  // On the RPC path one dashboard fetch refreshes "Needs you" too.
  const viaRpc = data?.source === 'rpc';
  const refresh = useCallback(async () => {
    await Promise.all([query.refetch(), viaRpc ? null : attentionQuery.refetch()]);
  }, [query, attentionQuery, viaRpc]);

  return {
    query,
    data,
    days,
    summary,
    attention,
    attentionTruncated: !!attentionData && attentionData.eligible > attentionData.inspected,
    state,
    freshness,
    refresh,
  };
}

/**
 * Summary for the Profile "Today" card, from whatever the dashboard last
 * cached — it never fetches, so a host's Profile tab costs no extra requests.
 * Null until the dashboard has been opened once on this device.
 */
/**
 * How old the cache may be before the Profile card stops quoting it. The card
 * never fetches, so without a limit a host who last opened the dashboard two
 * weeks ago would see a week built from two-week-old rows — events created
 * since are missing, and "Nothing on this week" could be false.
 */
export const CARD_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function useCachedHostDashboardSummary(businessId: string | undefined): AgendaSummary | null {
  const query = useDashboardQuery(businessId, false);
  const now = useFocusNow();
  const data = query.data;
  const updatedAt = query.dataUpdatedAt;
  return useMemo(() => {
    if (!data) return null;
    // Too old to quote: fall back to the card's invitation copy.
    if (!updatedAt || now.getTime() - updatedAt > CARD_CACHE_MAX_AGE_MS) return null;
    return summarizeAgenda(
      buildAgenda({ events: data.events, counts: data.counts, exceptions: data.exceptions, dateGoing: data.dateGoing, now })
    );
  }, [data, now, updatedAt]);
}
