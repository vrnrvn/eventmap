/**
 * Pure half of the live events page (roadmap phase 3): which bucket an event
 * falls into right now. Mirrors the SQL of `get_live_events` (prepared,
 * supabase/prepared/2026-11-20_live_events); tests/liveParity.test.ts holds
 * the occurrence rule itself to the server's answers, and
 * tests/liveEvents.test.ts covers the windows here.
 */
import { listOccurrences, occurrenceInProgress, type OccurrenceException } from '@/utils/occurrences';
import type { RankedEvent } from '@/types/database';

export type LiveStatus = 'live' | 'soon';
export const SOON_WINDOW_MINUTES = 60;

/** "Ends in 40 min" / "Starts in 12 min" — hours once minutes stop reading well. */
export function minutesLabel(prefix: string, untilIso: string, now: Date): string | null {
  const mins = Math.round((new Date(untilIso).getTime() - now.getTime()) / 60_000);
  if (!Number.isFinite(mins) || mins < 0) return null;
  if (mins <= 1) return `${prefix} now`;
  if (mins < 90) return `${prefix} in ${mins} min`;
  // Multi-day sessions (a festival weekend) read in days, not "in 30 h".
  if (mins < 36 * 60) return `${prefix} in ${Math.round(mins / 60)} h`;
  const days = Math.round(mins / (24 * 60));
  return `${prefix} in ${days} days`;
}

/**
 * Re-buckets the last server answer against the CURRENT clock, so the list
 * stays truthful between refreshes: a session that ended drops out, and a
 * "soon" event whose start has passed moves up to "happening now".
 */
export function rebucket<T extends { live_status: LiveStatus; occ_start: string; occ_end: string }>(
  items: readonly T[],
  now: Date
): { live: T[]; soon: T[] } {
  const t = now.getTime();
  const live: T[] = [];
  const soon: T[] = [];
  for (const e of items) {
    const start = new Date(e.occ_start).getTime();
    const end = new Date(e.occ_end).getTime();
    if (!(end > t)) continue; // over since the last refresh
    if (e.live_status === 'live' || start <= t) live.push(e);
    else soon.push(e);
  }
  return { live, soon };
}

export function classifyLive(
  e: RankedEvent,
  exceptions: readonly OccurrenceException[],
  now: Date
): { occ_start: string; occ_end: string; live_status: LiveStatus } | null {
  const soonCutoff = now.getTime() + SOON_WINDOW_MINUTES * 60_000;
  if (!e.is_recurring || !e.recurrence_pattern) {
    const start = new Date(e.start_datetime).getTime();
    const end = new Date(e.end_datetime).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) return null;
    if (start <= now.getTime() && now.getTime() < end)
      return { occ_start: e.start_datetime, occ_end: e.end_datetime, live_status: 'live' };
    if (start > now.getTime() && start <= soonCutoff)
      return { occ_start: e.start_datetime, occ_end: e.end_datetime, live_status: 'soon' };
    return null;
  }
  const mine = exceptions.filter((x) => x.event_id === e.id);
  const running = occurrenceInProgress(e, mine, now);
  if (running)
    return { occ_start: running.start.toISOString(), occ_end: running.end.toISOString(), live_status: 'live' };
  const next = listOccurrences(e, mine, { count: 1, now, includeCancelled: false })[0];
  if (next && next.start.getTime() > now.getTime() && next.start.getTime() <= soonCutoff)
    return { occ_start: next.start.toISOString(), occ_end: next.end.toISOString(), live_status: 'soon' };
  return null;
}
