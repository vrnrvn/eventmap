import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getNextOccurrences,
  parseRecurrenceEndDate,
  toRecurrenceEndDate,
  type RecurrencePattern,
} from '@/utils/recurrence';
import { hasEventEnded } from '@/utils/eventStatus';

/**
 * Exercises getNextOccurrences the way Discover's nextOccurrenceById memo does
 * (app/(tabs)/discover.tsx):
 *
 *   const [next] = getNextOccurrences(event, 1);
 *   if (next) map.set(event.id, next.toISOString());
 *   ...
 *   const displayDate = nextOccurrenceById.get(item.id) ?? item.start_datetime;
 *
 * The util reads `new Date()` internally for its "from today" walk, so each
 * test pins the clock with vi.setSystemTime. Event timestamps are local-naive
 * ISO strings so the tests are deterministic in any machine timezone.
 */

type TestEvent = {
  start_datetime: string;
  is_recurring?: boolean;
  recurrence_pattern?: RecurrencePattern | null;
};

const recurringEvent = (
  start_datetime: string,
  recurrence_pattern: RecurrencePattern
): TestEvent => ({
  start_datetime,
  is_recurring: true,
  recurrence_pattern,
});

// Monday, June 15 2026, midday.
const NOW = new Date('2026-06-15T12:00:00');
const DAY_MS = 24 * 60 * 60 * 1000;

describe('getNextOccurrences (Discover usage)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('weekly event started ~6 months ago: next occurrence is within the next 7 days and after now', () => {
    // Wednesday, Dec 17 2025, 19:00 — about six months before NOW.
    const event = recurringEvent('2025-12-17T19:00:00', {
      frequency: 'weekly',
      interval: 1,
    });

    const [next] = getNextOccurrences(event, 1);

    expect(next).toBeDefined();
    expect(next.getTime()).toBeGreaterThan(NOW.getTime());
    expect(next.getTime() - NOW.getTime()).toBeLessThanOrEqual(7 * DAY_MS);
    // Same weekday and time-of-day as the series start.
    expect(next.getDay()).toBe(new Date('2025-12-17T19:00:00').getDay());
    expect(next.getHours()).toBe(19);
    expect(next.getMinutes()).toBe(0);
  });

  it('biweekly (interval 2) started in the past lands on the correct parity week', () => {
    // Wednesday, May 6 2026. Series: May 6, May 20, Jun 3, Jun 17, Jul 1...
    // NOW is Mon Jun 15, so the even-parity Jun 17 is next — NOT Jun 24
    // (the off-parity Wednesday only one week after the last occurrence).
    const start = new Date('2026-05-06T19:00:00');
    const event = recurringEvent('2026-05-06T19:00:00', {
      frequency: 'weekly',
      interval: 2,
    });

    const [next] = getNextOccurrences(event, 1);

    expect(next).toBeDefined();
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(5); // June
    expect(next.getDate()).toBe(17);
    const weeksSinceStart = Math.round((next.getTime() - start.getTime()) / (7 * DAY_MS));
    expect(weeksSinceStart % 2).toBe(0);
  });

  it('monthly on the 31st clamps to the last day of a short month', () => {
    // From Feb 10 2026 (2026 is not a leap year) a "31st of the month"
    // series must fire on Feb 28, not skip February.
    vi.setSystemTime(new Date('2026-02-10T12:00:00'));
    const event = recurringEvent('2026-01-31T18:00:00', {
      frequency: 'monthly',
      interval: 1,
    });

    const [next] = getNextOccurrences(event, 1);

    expect(next).toBeDefined();
    expect(next.getMonth()).toBe(1); // February
    expect(next.getDate()).toBe(28);
    expect(next.getHours()).toBe(18);
  });

  it('monthly on the 31st resumes the real day in long months', () => {
    // From NOW (Jun 15) the next hit of a Jan-31st series is Jun 30 (30-day
    // month clamp); asking for two also shows Jul 31 un-clamped.
    const event = recurringEvent('2026-01-31T18:00:00', {
      frequency: 'monthly',
      interval: 1,
    });

    const [june, july] = getNextOccurrences(event, 2);

    expect(june.getMonth()).toBe(5);
    expect(june.getDate()).toBe(30);
    expect(july.getMonth()).toBe(6);
    expect(july.getDate()).toBe(31);
  });

  it('recurrence whose endDate already passed yields no occurrences (Discover falls back to raw start_datetime)', () => {
    const event = recurringEvent('2025-01-01T10:00:00', {
      frequency: 'weekly',
      interval: 1,
      endDate: '2025-06-01',
    });

    const occurrences = getNextOccurrences(event, 1);
    expect(occurrences).toEqual([]);

    // Discover's fallback shape: map.get(id) ?? start_datetime.
    const [next] = occurrences;
    const displayDate = next?.toISOString() ?? event.start_datetime;
    expect(displayDate).toBe('2025-01-01T10:00:00');
  });

  it('malformed pattern (interval 0) terminates via the 731-day cap and returns no matches', () => {
    // diffDays % 0 is NaN, so no day ever matches; the iteration cap is what
    // keeps this from spinning forever.
    const event = recurringEvent('2026-01-01T10:00:00', {
      frequency: 'daily',
      interval: 0,
    });

    expect(getNextOccurrences(event, 5)).toEqual([]);
  });

  it('malformed pattern (unknown frequency) returns bounded, empty results', () => {
    const event = recurringEvent('2026-01-01T10:00:00', {
      frequency: 'yearly' as unknown as RecurrencePattern['frequency'],
      interval: 1,
    });

    expect(getNextOccurrences(event, 5)).toEqual([]);
  });

  it('start far beyond the 731-day walk window returns no occurrences instead of looping', () => {
    const event = recurringEvent('2031-01-01T10:00:00', {
      frequency: 'weekly',
      interval: 1,
    });

    expect(getNextOccurrences(event, 1)).toEqual([]);
  });

  it('limit 1 (the Discover call shape) returns exactly the single next occurrence', () => {
    const event = recurringEvent('2026-06-01T09:00:00', {
      frequency: 'daily',
      interval: 1,
    });

    const result = getNextOccurrences(event, 1);
    expect(result).toHaveLength(1);
    // Daily series with 09:00 start: today's slot (Jun 15 09:00) is the first
    // day-walk hit even though it is earlier than NOW's clock time — Discover
    // uses it as a display date only.
    expect(result[0].getMonth()).toBe(5);
    expect(result[0].getDate()).toBe(15);
    expect(result[0].getHours()).toBe(9);
  });

  it('non-recurring events yield an empty array', () => {
    expect(getNextOccurrences({ start_datetime: '2026-07-01T10:00:00' }, 1)).toEqual([]);
    expect(
      getNextOccurrences(
        { start_datetime: '2026-07-01T10:00:00', is_recurring: true, recurrence_pattern: null },
        1
      )
    ).toEqual([]);
  });
});

describe('recurrence end date helpers', () => {
  it('formats a local date as YYYY-MM-DD without UTC rollover', () => {
    // 23:30 local on Jan 31 — toISOString() could land on Feb 1 west of UTC.
    expect(toRecurrenceEndDate(new Date(2026, 0, 31, 23, 30))).toBe('2026-01-31');
    expect(toRecurrenceEndDate(new Date(2026, 8, 5, 0, 0))).toBe('2026-09-05');
  });

  it('parses an end date to local midnight and round-trips', () => {
    const parsed = parseRecurrenceEndDate('2026-03-15');
    expect(parsed).toEqual(new Date(2026, 2, 15));
    expect(toRecurrenceEndDate(parsed!)).toBe('2026-03-15');
  });

  it('returns null for missing or malformed values', () => {
    expect(parseRecurrenceEndDate(undefined)).toBeNull();
    expect(parseRecurrenceEndDate(null)).toBeNull();
    expect(parseRecurrenceEndDate('')).toBeNull();
    expect(parseRecurrenceEndDate('next week')).toBeNull();
  });

  it('agrees with hasEventEnded about when a series is over', () => {
    const series = {
      start_datetime: new Date(2026, 0, 1, 18, 0).toISOString(),
      end_datetime: new Date(2026, 0, 1, 20, 0).toISOString(),
      is_recurring: true,
      recurrence_pattern: { frequency: 'weekly' as const, interval: 1, endDate: toRecurrenceEndDate(new Date(2026, 5, 30)) },
    };
    expect(hasEventEnded(series, new Date(2026, 5, 30, 23, 0))).toBe(false);
    expect(hasEventEnded(series, new Date(2026, 6, 1, 0, 1))).toBe(true);
  });
});

describe('time-zone aware series (20261103140000)', () => {
  it('keeps the event-zone wall clock across a DST change the device does not share', () => {
    // Weekly 19:00 Lisbon class starting in WET (UTC+0). Lisbon moves to WEST
    // (UTC+1) on 2026-03-29; the occurrence after that must be 18:00Z = 19:00 local.
    const event = {
      start_datetime: '2026-03-04T19:00:00Z',
      is_recurring: true,
      recurrence_pattern: { frequency: 'weekly', interval: 1 } as RecurrencePattern,
      timezone: 'Europe/Lisbon',
    };
    const now = new Date('2026-04-01T12:00:00Z');
    const [next] = getNextOccurrences(event, 1, now);
    expect(next.toISOString()).toBe('2026-04-01T18:00:00.000Z');
  });

  it('walks "today" on the event zone calendar, not the device one', () => {
    // 2026-11-06T03:30Z is still Nov 5 in Los Angeles but Nov 6 in Tokyo.
    const event = {
      start_datetime: '2026-10-01T10:00:00Z', // 19:00 Tokyo
      is_recurring: true,
      recurrence_pattern: { frequency: 'daily', interval: 1 } as RecurrencePattern,
      timezone: 'Asia/Tokyo',
    };
    const now = new Date('2026-11-06T03:30:00Z');
    const [next] = getNextOccurrences(event, 1, now);
    // Next Tokyo occurrence is Nov 6 19:00 JST = 10:00Z (same day in Tokyo, still ahead of now).
    expect(next.toISOString()).toBe('2026-11-06T10:00:00.000Z');
  });

  it('ends a series on the event-zone calendar day', () => {
    const base = {
      start_datetime: '2026-10-01T10:00:00Z',
      end_datetime: '2026-10-01T12:00:00Z',
      is_recurring: true,
      recurrence_pattern: { frequency: 'daily', interval: 1, endDate: '2026-11-05' } as RecurrencePattern,
    };
    // At 2026-11-06T03:30Z it is Nov 6 in Tokyo (series over) but Nov 5 in Los Angeles (last day still on).
    const now = new Date('2026-11-06T03:30:00Z');
    expect(hasEventEnded({ ...base, timezone: 'Asia/Tokyo' }, now)).toBe(true);
    expect(hasEventEnded({ ...base, timezone: 'America/Los_Angeles' }, now)).toBe(false);
  });
});
