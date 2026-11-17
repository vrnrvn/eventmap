import { describe, expect, it } from 'vitest';
import { filterEventsByDateRange, isEventOnDate, type RecurrencePattern } from '@/utils/recurrence';

/**
 * filterEventsByDateRange (Discover "Today" / "This weekend", Category
 * Browse). Review round 2, 2026-11-16: recurring events are now judged by real
 * occurrence instants on the event's own calendar.
 */

type Ev = {
  id: string;
  start_datetime: string;
  is_recurring?: boolean;
  recurrence_pattern?: RecurrencePattern | null;
  timezone?: string | null;
};

/** The previous implementation, verbatim, as the reference for zone-less events. */
function oldFilter<T extends Ev>(events: T[], startDate: Date, endDate: Date): T[] {
  const result: T[] = [];
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);
  for (const event of events) {
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (isEventOnDate(event, d)) {
        result.push(event);
        break;
      }
    }
  }
  return result;
}

const PATTERNS: RecurrencePattern[] = [
  { frequency: 'daily', interval: 1 },
  { frequency: 'daily', interval: 4 },
  { frequency: 'weekly', interval: 1 },
  { frequency: 'weekly', interval: 3 },
  { frequency: 'weekly', interval: 2, byWeekday: [2, 4] },
  { frequency: 'weekly', interval: 1, byWeekday: [6, 0] },
  { frequency: 'monthly', interval: 1 },
  { frequency: 'monthly', interval: 2, monthly: 'nthWeekday' },
  { frequency: 'weekly', interval: 1, endDate: '2026-12-01' },
];

const STARTS = ['2026-01-31T18:00:00', '2026-10-29T23:30:00', '2026-11-20T07:00:00', '2027-01-05T12:00:00'];

describe('zone-less events behave exactly as before', () => {
  // Single days and short ranges across a month end, a DST change and a year end.
  const ranges: [Date, Date][] = [
    [new Date(2026, 10, 16), new Date(2026, 10, 16)],
    [new Date(2026, 10, 21), new Date(2026, 10, 22)],
    [new Date(2026, 10, 28), new Date(2026, 11, 4)],
    [new Date(2027, 2, 6), new Date(2027, 2, 16)],
    [new Date(2026, 11, 30), new Date(2027, 0, 2)],
  ];

  it('matches the previous implementation for every pattern, start and range', () => {
    let id = 0;
    const events: Ev[] = [];
    for (const p of PATTERNS) for (const s of STARTS) events.push({ id: `e${id++}`, start_datetime: s, is_recurring: true, recurrence_pattern: p, timezone: null });
    for (const s of STARTS) events.push({ id: `o${id++}`, start_datetime: s });
    for (const [a, b] of ranges) {
      const got = filterEventsByDateRange(events, a, b).map((e) => e.id);
      expect(got, `${a.toDateString()}–${b.toDateString()}`).toEqual(oldFilter(events, a, b).map((e) => e.id));
    }
  });
});

describe('zoned series are judged on their real instants', () => {
  // 13:30 Tokyo every Tuesday. Tokyo has no DST; New York does.
  const tokyo: Ev = {
    id: 'tokyo',
    start_datetime: '2026-01-06T04:30:00Z', // Tue 6 Jan 2026 13:30 JST
    is_recurring: true,
    recurrence_pattern: { frequency: 'weekly', interval: 1 },
    timezone: 'Asia/Tokyo',
  };
  const inNewYork = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York' }).resolvedOptions().timeZone ===
    Intl.DateTimeFormat().resolvedOptions().timeZone;

  it.skipIf(!inNewYork)('New York, summer: the class falls on Tuesday 00:30, not Monday', () => {
    // Tue 14 Jul 2026 13:30 JST = Tue 00:30 EDT.
    expect(filterEventsByDateRange([tokyo], new Date(2026, 6, 14), new Date(2026, 6, 14)).map((e) => e.id)).toEqual(['tokyo']);
    expect(filterEventsByDateRange([tokyo], new Date(2026, 6, 13), new Date(2026, 6, 13))).toEqual([]);
    // The old filter put it on Monday all year.
    expect(oldFilter([tokyo], new Date(2026, 6, 13), new Date(2026, 6, 13)).map((e) => e.id)).toEqual(['tokyo']);
  });

  it.skipIf(!inNewYork)('New York, winter: the same class falls on Monday 23:30', () => {
    // Tue 12 Jan 2027 13:30 JST = Mon 11 Jan 23:30 EST.
    expect(filterEventsByDateRange([tokyo], new Date(2027, 0, 11), new Date(2027, 0, 11)).map((e) => e.id)).toEqual(['tokyo']);
    expect(filterEventsByDateRange([tokyo], new Date(2027, 0, 12), new Date(2027, 0, 12))).toEqual([]);
  });

  it('a range before the series starts, or after it ends, excludes it', () => {
    const ending: Ev = { ...tokyo, id: 'ending', recurrence_pattern: { frequency: 'weekly', interval: 1, endDate: '2026-03-01' } };
    expect(filterEventsByDateRange([tokyo], new Date(2025, 11, 1), new Date(2025, 11, 31))).toEqual([]);
    expect(filterEventsByDateRange([ending], new Date(2026, 5, 1), new Date(2026, 5, 30))).toEqual([]);
  });
});

/* ─────────── Skipped dates in a date-filtered list (O-1) ─────────── */

import { hasEffectiveDateInRange, type OccurrenceException } from '@/utils/occurrences';

const weekly = (id: string, startIso: string, tz: string | null = null) => ({
  id,
  start_datetime: startIso,
  end_datetime: new Date(new Date(startIso).getTime() + 2 * 3600_000).toISOString(),
  is_recurring: true,
  recurrence_pattern: { frequency: 'weekly' as const, interval: 1 },
  timezone: tz,
});

const ex = (date: string, kind: 'cancelled' | 'rescheduled', newStart?: string): OccurrenceException => ({
  event_id: 'e1',
  occurrence_date: date,
  kind,
  new_start: newStart ?? null,
  new_end: newStart ? new Date(new Date(newStart).getTime() + 2 * 3600_000).toISOString() : null,
  note: null,
});

describe('hasEffectiveDateInRange', () => {
  // Thursdays 19:00 local, from 1 Oct 2026. Thu 19 Nov is in range below.
  const series = weekly('e1', new Date(2026, 9, 1, 19).toISOString());
  const thatThursday: [Date, Date] = [new Date(2026, 10, 19, 0, 0, 0), new Date(2026, 10, 19, 23, 59, 59, 999)];

  it('true with no exceptions, false when that date is skipped', () => {
    expect(hasEffectiveDateInRange(series, [], ...thatThursday)).toBe(true);
    expect(hasEffectiveDateInRange(series, [ex('2026-11-19', 'cancelled')], ...thatThursday)).toBe(false);
  });

  it('a date moved out of the window drops it; moved into the window keeps it', () => {
    const movedOut = ex('2026-11-19', 'rescheduled', new Date(2026, 10, 24, 19).toISOString());
    expect(hasEffectiveDateInRange(series, [movedOut], ...thatThursday)).toBe(false);
    // The 26th moved back onto the 19th.
    const movedIn = ex('2026-11-26', 'rescheduled', new Date(2026, 10, 19, 15).toISOString());
    expect(hasEffectiveDateInRange(series, [ex('2026-11-19', 'cancelled'), movedIn], ...thatThursday)).toBe(true);
  });

  it('a skipped date does not hide a live one later in the same window', () => {
    const week: [Date, Date] = [new Date(2026, 10, 16), new Date(2026, 10, 29, 23, 59, 59, 999)];
    // 19 Nov skipped, 26 Nov still on.
    expect(hasEffectiveDateInRange(series, [ex('2026-11-19', 'cancelled')], ...week)).toBe(true);
    expect(
      hasEffectiveDateInRange(series, [ex('2026-11-19', 'cancelled'), ex('2026-11-26', 'cancelled')], ...week)
    ).toBe(false);
  });

  it('one-off events are judged on their own start', () => {
    const oneOff = { id: 'o', start_datetime: new Date(2026, 10, 19, 19).toISOString(), end_datetime: new Date(2026, 10, 19, 21).toISOString() };
    expect(hasEffectiveDateInRange(oneOff, [], ...thatThursday)).toBe(true);
    expect(hasEffectiveDateInRange(oneOff, [], new Date(2026, 10, 20), new Date(2026, 10, 20, 23, 59))).toBe(false);
  });
});
