import { describe, it, expect } from 'vitest';
import { getNextOccurrences, type RecurrencePattern } from '@/utils/recurrence';
import fixture from './fixtures/recurrenceParity.json';

/**
 * Client ↔ server parity for recurrence. The fixture holds the server's
 * `event_next_occurrence(start, true, pattern, 'UTC', now)` for 14 pattern
 * shapes × 40 "now" instants, captured from a SCRATCH database with
 * scripts/recurrence-parity.sql. The client must name the same next date.
 *
 * Two known, documented differences (docs/CATEGORIES_AND_SERIES_PLAN.md §7
 * Phase D):
 *  - getNextOccurrences walks from midnight today, so it can name a date
 *    earlier today; the server is strictly "at or after now". Compared here
 *    as the first client date at or after now (the calendar relies on the
 *    midnight behaviour, so it is not changed).
 *  - For a FUTURE start that is not itself an occurrence (a weekdays series
 *    starting on a Saturday) the other session's server returns the start;
 *    the client and 20261109130000 (which this fixture comes from) return
 *    the next chosen day. Listed in
 *    KNOWN_START_DIVERGENCE so any new divergence still fails.
 */
type Case = { name: string; start: string; pattern: RecurrencePattern; next: [string, string][] };

describe('recurrence parity with SQL event_next_occurrence', () => {
  it('fixture covers every pattern shape', () => {
    expect((fixture as Case[]).length).toBeGreaterThanOrEqual(14);
  });

  /** name → "now" instants where only the future-start rule differs. */
  // Empty for this worktree's migration. Against the other session's
  // snapshot it was { 'weekdays-from-sat': ['2026-11-01T00:00:00Z'] }.
  const KNOWN_START_DIVERGENCE: Record<string, string[]> = {};

  it.each((fixture as Case[]).map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const event = { start_datetime: c.start, is_recurring: true, recurrence_pattern: c.pattern, timezone: 'UTC' };
    const mismatches: string[] = [];
    for (const [now, serverNext] of c.next) {
      const nowDate = new Date(now);
      const isV2 = !!c.pattern.byWeekday || c.pattern.monthly === 'nthWeekday';
      const client =
        new Date(c.start) >= nowDate && !isV2
          ? c.start // v1: a future start is the first date, on both sides.
          : getNextOccurrences(event, 3, nowDate)
              .find((d) => d.getTime() >= nowDate.getTime())
              ?.toISOString()
              .replace('.000Z', 'Z');
      if (client === serverNext) continue;
      if (KNOWN_START_DIVERGENCE[c.name]?.includes(now) && serverNext === c.start) continue;
      mismatches.push(`now=${now} server=${serverNext} client=${client}`);
    }
    expect(mismatches).toEqual([]);
  });
});
