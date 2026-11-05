/**
 * Pure mapping between the calendar UI's sources and the `get_user_calendar`
 * RPC (20261104110000). Kept apart from services/calendar.ts so it is
 * unit-testable under node without the Supabase client.
 */
import type { CalendarSource, SourcedEvent } from '@/utils/calendar';
import type { RankedEvent } from '@/types/database';

export type CalendarRpcSource = 'going' | 'requested' | 'interested' | 'saved' | 'hosting';

/** Row shape of get_user_calendar: a list row plus zone, status note and the caller's relationships. */
export type CalendarRpcRow = RankedEvent & {
  timezone: string | null;
  status_note?: string | null;
  sources: CalendarRpcSource[];
};

/** UI sources → RPC sources. "Going" includes requests waiting for approval. */
export function toRpcSources(sources: readonly CalendarSource[]): CalendarRpcSource[] {
  const out = new Set<CalendarRpcSource>();
  for (const s of sources) {
    out.add(s);
    if (s === 'going') out.add('requested');
  }
  return [...out].sort();
}

/**
 * RPC rows → one SourcedEvent per (event, UI source). A `requested` RSVP is
 * listed under Going with `pending` set; sources the caller didn't ask for
 * are dropped.
 */
export function fromRpcRows(
  rows: readonly CalendarRpcRow[],
  wanted: readonly CalendarSource[]
): SourcedEvent<CalendarRpcRow>[] {
  const want = new Set(wanted);
  const out: SourcedEvent<CalendarRpcRow>[] = [];
  for (const row of rows) {
    const event: CalendarRpcRow = { ...row, distance_km: 0, is_premium: false };
    for (const s of row.sources ?? []) {
      if (s === 'requested') {
        if (want.has('going')) out.push({ event, source: 'going', pending: true });
      } else if (want.has(s)) {
        out.push({ event, source: s });
      }
    }
  }
  return out;
}
