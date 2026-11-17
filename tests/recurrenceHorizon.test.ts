import { describe, it, expect } from 'vitest';
import {
  endDateAfterCount,
  getNextOccurrences,
  isEventOnDate,
  type RecurrencePattern,
} from '@/utils/recurrence';

/**
 * Long-horizon behaviour of getNextOccurrences (Roadmap A,
 * docs/HOST_DASHBOARD_AND_RECURRENCE_REVIEW_2026-11-16.md §2.1).
 *
 * The old implementation walked one calendar day at a time with a 731-day
 * cap and silently returned short lists: R1 (long intervals truncated), R2
 * (far-future start → []), R3 (endDateAfterCount → null past ~2 years).
 */

const NOW = new Date('2026-11-16T12:00:00Z');

const series = (start: string, pattern: RecurrencePattern, timezone: string | null = 'UTC') => ({
  start_datetime: start,
  end_datetime: start,
  is_recurring: true,
  recurrence_pattern: pattern,
  timezone,
});

describe('R1 — long intervals are not truncated', () => {
  it('monthly every 3 months returns all 12 requested dates', () => {
    const dates = getNextOccurrences(series('2026-11-20T19:00:00Z', { frequency: 'monthly', interval: 3 }), 12, NOW);
    expect(dates).toHaveLength(12);
    expect(dates[0].toISOString()).toBe('2026-11-20T19:00:00.000Z');
    expect(dates[11].toISOString()).toBe('2029-08-20T19:00:00.000Z');
  });

  it('the maximum legal interval (99) still yields dates', () => {
    const monthly = getNextOccurrences(series('2026-11-20T19:00:00Z', { frequency: 'monthly', interval: 99 }), 3, NOW);
    expect(monthly.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-11-20', '2035-02-20', '2043-05-20']);
    const weekly = getNextOccurrences(series('2026-11-20T19:00:00Z', { frequency: 'weekly', interval: 99, byWeekday: [5] }), 2, NOW);
    expect(weekly).toHaveLength(2);
  });

  it('nthWeekday every 30 months (beyond any two-year walk)', () => {
    // 2nd Tuesday of Nov 2026 = Nov 10; series started then, NOW is after it.
    const dates = getNextOccurrences(
      series('2026-11-10T18:00:00Z', { frequency: 'monthly', interval: 30, monthly: 'nthWeekday' }),
      2,
      NOW
    );
    // May 2029: 2nd Tuesday is the 8th. Nov 2031: 2nd Tuesday is the 11th.
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual(['2029-05-08', '2031-11-11']);
  });
});

describe('R2 — far-future starts', () => {
  it('weekdays series starting on a Saturday five years out begins on the next chosen day', () => {
    // Sat 3 Jan 2032 → first weekday occurrence is Mon 5 Jan 2032.
    const dates = getNextOccurrences(
      series('2032-01-03T09:00:00Z', { frequency: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] }),
      2,
      NOW
    );
    expect(dates.map((d) => d.toISOString())).toEqual(['2032-01-05T09:00:00.000Z', '2032-01-06T09:00:00.000Z']);
  });
});

describe('R3 — "ends after N times"', () => {
  const cases: [string, RecurrencePattern, number, string][] = [
    ['25 monthly', { frequency: 'monthly', interval: 1 }, 25, '2028-11-20'],
    ['36 monthly', { frequency: 'monthly', interval: 1 }, 36, '2029-10-20'],
    ['60 every 2 weeks', { frequency: 'weekly', interval: 2 }, 60, '2029-02-23'],
    ['104 weekly', { frequency: 'weekly', interval: 1 }, 104, '2028-11-10'],
  ];
  it.each(cases)('%s', (_name, pattern, count, expected) => {
    expect(endDateAfterCount(series('2026-11-20T19:00:00Z', pattern), count)).toBe(expected);
  });
});

/**
 * Reference: the old day-by-day walk, uncapped. The new stepping generator
 * must produce exactly the same dates for every pattern shape, so the speed-up
 * cannot change which days match.
 */
function referenceWalk(event: ReturnType<typeof series>, count: number, now: Date): string[] {
  const start = new Date(event.start_datetime);
  const startMidnight = new Date(start);
  startMidnight.setHours(0, 0, 0, 0);
  const out: string[] = [];
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  for (let i = 0; out.length < count && i < 5000; i++, d.setDate(d.getDate() + 1)) {
    if (d < startMidnight) continue;
    if (isEventOnDate(event, d)) out.push(d.toDateString());
  }
  return out;
}

describe('stepping generator matches the day-by-day reference', () => {
  const patterns: [string, RecurrencePattern][] = [
    ['daily', { frequency: 'daily', interval: 1 }],
    ['every 3 days', { frequency: 'daily', interval: 3 }],
    ['every 10 days', { frequency: 'daily', interval: 10 }],
    ['weekly', { frequency: 'weekly', interval: 1 }],
    ['every 2 weeks', { frequency: 'weekly', interval: 2 }],
    ['every 3 weeks Tue+Thu', { frequency: 'weekly', interval: 3, byWeekday: [2, 4] }],
    ['weekdays', { frequency: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] }],
    ['weekends biweekly', { frequency: 'weekly', interval: 2, byWeekday: [0, 6] }],
    ['monthly', { frequency: 'monthly', interval: 1 }],
    ['every 2 months', { frequency: 'monthly', interval: 2 }],
    ['nth weekday', { frequency: 'monthly', interval: 1, monthly: 'nthWeekday' }],
    ['nth weekday every 4 months', { frequency: 'monthly', interval: 4, monthly: 'nthWeekday' }],
  ];
  // Local-naive starts (device zone) covering: month end (31st), last
  // weekday of a month, a Sunday, a leap day, and a start after NOW.
  const starts = [
    '2026-01-31T18:00:00',
    '2026-10-29T19:30:00',
    '2026-03-01T08:00:00',
    '2028-02-29T12:00:00',
    '2025-12-21T23:15:00',
  ];
  const nows = [new Date('2026-11-16T12:00:00'), new Date('2027-03-29T01:00:00'), new Date('2028-12-31T23:00:00')];

  for (const [name, pattern] of patterns) {
    it(name, () => {
      for (const start of starts) {
        for (const now of nows) {
          const event = series(start, pattern, null);
          const got = getNextOccurrences(event, 15, now).map((d) => d.toDateString());
          expect(got, `${name} from ${start} at ${now.toISOString()}`).toEqual(referenceWalk(event, 15, now));
        }
      }
    });
  }
});

describe('time zones are unaffected', () => {
  it('a 19:00 Lisbon weekly class stays 19:00 Lisbon across both DST changes', () => {
    const dates = getNextOccurrences(
      series('2026-03-04T19:00:00Z', { frequency: 'weekly', interval: 1 }, 'Europe/Lisbon'),
      40,
      new Date('2026-03-01T00:00:00Z')
    );
    expect(dates).toHaveLength(40);
    const lisbonHours = dates.map((d) =>
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', hour: '2-digit', hour12: false }).format(d)
    );
    expect(new Set(lisbonHours)).toEqual(new Set(['19']));
  });
});

describe('month-end series right after a clamped date (server drift S1)', () => {
  it('names 31 Mar, not 28 Mar, when asked on 28 Feb after its 19:00 occurrence', () => {
    // SQL event_next_occurrence (20261109130000:173-176) adds +1 month to the
    // clamped Feb 28 candidate and returns Mar 28 here. The client is the
    // correct side; see docs/HOST_DASHBOARD_AND_RECURRENCE_REVIEW_2026-11-16.md S1.
    // The client walk starts at midnight, so today's passed 19:00 slot comes
    // first (documented; the calendar relies on it). Compare like the parity
    // suite does: the first date at or after now.
    const now = new Date('2027-02-28T21:00:00Z');
    const next = getNextOccurrences(series('2027-01-31T19:00:00Z', { frequency: 'monthly', interval: 1 }), 2, now).find(
      (d) => d >= now
    );
    expect(next?.toISOString()).toBe('2027-03-31T19:00:00.000Z');
  });
});
