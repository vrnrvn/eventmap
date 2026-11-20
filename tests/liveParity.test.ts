import { describe, expect, it } from 'vitest';
import { occurrenceInProgress } from '@/utils/occurrences';
import { isEventInProgress } from '@/utils/eventStatus';
import fixture from './fixtures/liveParity.json';

/**
 * Client ↔ server parity for "which session is running right now" — the rule
 * the live events page stands on. The fixture holds the server's
 * event_occurrence_in_progress (prepared, supabase/prepared/2026-11-20_live_events)
 * for series shapes × probe instants, captured in a throwaway PG17 container
 * with scripts/live-parity.sql. The client must name the same running window.
 */
type Row = {
  name: string;
  start: string;
  end: string;
  tz: string;
  recurring: boolean;
  pattern: Record<string, unknown> | null;
  exceptions: { date: string; kind: string; new_start?: string; new_end?: string }[];
  at: string;
  running_start: string | null;
  running_end: string | null;
};

const rows = fixture as Row[];
const iso = (v: string | null) => (v == null ? null : new Date(v).toISOString());

describe('live parity with SQL event_occurrence_in_progress', () => {
  it('fixture covers every shape', () => {
    expect(new Set(rows.map((r) => r.name)).size).toBeGreaterThanOrEqual(8);
    expect(rows.length).toBeGreaterThanOrEqual(25);
  });

  it.each(rows.map((r) => [`${r.name} @ ${r.at}`, r] as const))('%s', (_label, r) => {
    const event = {
      id: r.name,
      start_datetime: iso(r.start)!,
      end_datetime: iso(r.end)!,
      is_recurring: r.recurring,
      recurrence_pattern: r.pattern as never,
      timezone: r.tz,
    };
    const exceptions = r.exceptions.map((x) => ({
      event_id: r.name,
      occurrence_date: x.date,
      kind: x.kind as 'cancelled' | 'rescheduled',
      new_start: x.new_start ?? null,
      new_end: x.new_end ?? null,
      note: null,
    }));
    const now = new Date(r.at);

    if (!r.recurring) {
      // One-offs: the client decides with isEventInProgress; the window is
      // the event's own.
      expect(isEventInProgress(event, now)).toBe(r.running_start != null);
      return;
    }

    const occ = occurrenceInProgress(event as never, exceptions, now);
    expect({ start: occ ? occ.start.toISOString() : null, end: occ ? occ.end.toISOString() : null }).toEqual({
      start: iso(r.running_start),
      end: iso(r.running_end),
    });
    expect(isEventInProgress(event, now, exceptions)).toBe(r.running_start != null);
  });
});
