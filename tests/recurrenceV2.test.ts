import { describe, it, expect } from 'vitest';
import {
  describeRecurrence,
  endDateAfterCount,
  getNextOccurrences,
  isEventOnDate,
  validateRecurrencePattern,
  weekOfMonthFor,
  isLastWeekdayOfMonth,
  type RecurrencePattern,
} from '@/utils/recurrence';
import { buildRecurrenceRule } from '@/utils/eventIcs';

/** Local-naive ISO so results don't depend on the machine zone. */
const ev = (start: string, p: RecurrencePattern) => ({ start_datetime: start, is_recurring: true, recurrence_pattern: p });
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const next = (e: ReturnType<typeof ev>, n: number, from: string) => getNextOccurrences(e, n, new Date(from)).map(ymd);

describe('weekly byWeekday', () => {
  // Tue 3 Nov 2026, 19:00.
  const START = '2026-11-03T19:00:00';

  it('runs on each listed day', () => {
    const e = ev(START, { frequency: 'weekly', interval: 1, byWeekday: [2, 4] });
    expect(next(e, 4, '2026-11-03T00:00:00')).toEqual(['2026-11-03', '2026-11-05', '2026-11-10', '2026-11-12']);
  });

  it('every 2 weeks keeps both days in the same active (Monday-based) week', () => {
    const e = ev(START, { frequency: 'weekly', interval: 2, byWeekday: [2, 4] });
    expect(next(e, 4, '2026-11-03T00:00:00')).toEqual(['2026-11-03', '2026-11-05', '2026-11-17', '2026-11-19']);
  });

  it('Monday-based weeks: a Sunday belongs to the week before it', () => {
    // Start Sat 7 Nov (week of Mon 2 Nov). Every 2 weeks on Sat+Sun: Sun 8
    // Nov is the same week; next active week starts Mon 16 Nov.
    const e = ev('2026-11-07T10:00:00', { frequency: 'weekly', interval: 2, byWeekday: [0, 6] });
    expect(next(e, 4, '2026-11-07T00:00:00')).toEqual(['2026-11-07', '2026-11-08', '2026-11-21', '2026-11-22']);
  });

  it('weekdays only, starting on a Saturday, begins the next Monday', () => {
    const e = ev('2026-11-07T07:00:00', { frequency: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] });
    expect(next(e, 3, '2026-11-07T00:00:00')).toEqual(['2026-11-09', '2026-11-10', '2026-11-11']);
    expect(isEventOnDate(e, new Date('2026-11-07T00:00:00'))).toBe(false);
  });

  it('keeps the time of day and parity across a DST change', () => {
    const e = ev('2026-03-03T19:00:00', { frequency: 'weekly', interval: 2, byWeekday: [2] });
    const dates = getNextOccurrences(e, 4, new Date('2026-03-01T00:00:00'));
    expect(dates.map(ymd)).toEqual(['2026-03-03', '2026-03-17', '2026-03-31', '2026-04-14']);
    for (const d of dates) expect(d.getHours()).toBe(19);
  });

  it('ignores invalid weekday values and falls back to the start weekday', () => {
    const e = ev(START, { frequency: 'weekly', interval: 1, byWeekday: [9, -1] as number[] });
    expect(next(e, 2, '2026-11-03T00:00:00')).toEqual(['2026-11-03', '2026-11-10']);
  });

  it('respects endDate', () => {
    const e = ev(START, { frequency: 'weekly', interval: 1, byWeekday: [2, 4], endDate: '2026-11-10' });
    expect(next(e, 10, '2026-11-03T00:00:00')).toEqual(['2026-11-03', '2026-11-05', '2026-11-10']);
  });
});

describe('monthly nthWeekday', () => {
  it('second Tuesday of each month', () => {
    // Tue 10 Nov 2026 is the 2nd Tuesday.
    const e = ev('2026-11-10T19:00:00', { frequency: 'monthly', interval: 1, monthly: 'nthWeekday' });
    expect(next(e, 4, '2026-11-01T00:00:00')).toEqual(['2026-11-10', '2026-12-08', '2027-01-12', '2027-02-09']);
  });

  it('last Friday, including months with five Fridays', () => {
    // Fri 27 Nov 2026 is the last Friday; Jan 2027 has five (29th).
    const e = ev('2026-11-27T20:00:00', { frequency: 'monthly', interval: 1, monthly: 'nthWeekday' });
    expect(next(e, 3, '2026-11-01T00:00:00')).toEqual(['2026-11-27', '2026-12-25', '2027-01-29']);
  });

  it('honours the month interval', () => {
    const e = ev('2026-11-10T19:00:00', { frequency: 'monthly', interval: 2, monthly: 'nthWeekday' });
    expect(next(e, 3, '2026-11-01T00:00:00')).toEqual(['2026-11-10', '2027-01-12', '2027-03-09']);
  });

  it('derives the week from the start (3rd Tuesday)', () => {
    const e = ev('2026-11-17T19:00:00', { frequency: 'monthly', interval: 1, monthly: 'nthWeekday' });
    expect(next(e, 2, '2026-11-01T00:00:00')).toEqual(['2026-11-17', '2026-12-15']);
  });

  it('dayOfMonth mode is unchanged (clamps short months)', () => {
    const e = ev('2027-01-31T10:00:00', { frequency: 'monthly', interval: 1 });
    expect(next(e, 3, '2027-01-01T00:00:00')).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
  });

  it('helpers classify weeks of the month', () => {
    expect(weekOfMonthFor(new Date('2026-11-10T00:00:00'))).toBe(2);
    expect(weekOfMonthFor(new Date('2026-11-29T00:00:00'))).toBe(-1);
    // 4th Friday that is also the last one → "last" (server rule).
    expect(weekOfMonthFor(new Date('2026-11-27T00:00:00'))).toBe(-1);
    expect(weekOfMonthFor(new Date('2026-11-20T00:00:00'))).toBe(3);
    expect(isLastWeekdayOfMonth(new Date('2026-11-27T00:00:00'))).toBe(true);
    expect(isLastWeekdayOfMonth(new Date('2026-11-20T00:00:00'))).toBe(false);
  });
});

describe('describeRecurrence', () => {
  const tue = '2026-11-03T19:00:00';
  it.each([
    [{ frequency: 'daily', interval: 1 }, 'Every day'],
    [{ frequency: 'daily', interval: 3 }, 'Every 3 days'],
    [{ frequency: 'weekly', interval: 1 }, 'Every Tuesday'],
    [{ frequency: 'weekly', interval: 2 }, 'Every 2 weeks on Tuesday'],
    [{ frequency: 'weekly', interval: 1, byWeekday: [4, 2] }, 'Every Tuesday and Thursday'],
    [{ frequency: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] }, 'Every weekday'],
    [{ frequency: 'weekly', interval: 1, byWeekday: [0, 6] }, 'Every weekend day'],
    [{ frequency: 'weekly', interval: 1, byWeekday: [1, 3, 5, 6] }, 'Every Mon, Wed, Fri, Sat'],
    [{ frequency: 'monthly', interval: 1 }, 'Monthly on day 3'],
    [{ frequency: 'monthly', interval: 1, monthly: 'nthWeekday' }, 'Monthly on the first Tuesday'],
    [{ frequency: 'monthly', interval: 3, monthly: 'nthWeekday' }, 'Every 3 months on the first Tuesday'],
  ] as [RecurrencePattern, string][])('%j → %s', (p, text) => {
    expect(describeRecurrence(p, tue)).toBe(text);
  });

  it('appends the end date on request and copes without a start', () => {
    expect(describeRecurrence({ frequency: 'weekly', interval: 1, endDate: '2027-03-03' }, tue, { withEnd: true })).toMatch(/until/);
    expect(describeRecurrence({ frequency: 'weekly', interval: 1 })).toBe('Every week');
    expect(describeRecurrence(null)).toBe('');
  });
});

describe('validateRecurrencePattern', () => {
  it('accepts good patterns and rejects bad ones', () => {
    expect(validateRecurrencePattern({ frequency: 'weekly', interval: 1, byWeekday: [1] })).toBeNull();
    expect(validateRecurrencePattern({ frequency: 'weekly', interval: 0 })).toMatch(/1–99/);
    expect(validateRecurrencePattern({ frequency: 'weekly', interval: 1, byWeekday: [] })).toMatch(/at least one day/);
    expect(validateRecurrencePattern({ frequency: 'daily', interval: 1, byWeekday: [1] })).toMatch(/weekly/);
    expect(
      validateRecurrencePattern({ frequency: 'monthly', interval: 1, monthly: 'bogus' as 'nthWeekday' })
    ).toMatch(/day of the month/);
    expect(validateRecurrencePattern({ frequency: 'weekly', interval: 1, monthly: 'nthWeekday' })).toMatch(/monthly/);
  });
});

describe('endDateAfterCount', () => {
  it('converts "after N times" into the Nth date', () => {
    const p: RecurrencePattern = { frequency: 'weekly', interval: 1, byWeekday: [2, 4] };
    expect(endDateAfterCount({ start_datetime: '2026-11-03T19:00:00', recurrence_pattern: p }, 5)).toBe('2026-11-17');
    expect(endDateAfterCount({ start_datetime: '2026-11-03T19:00:00', recurrence_pattern: p }, 1)).toBe('2026-11-03');
  });
  it('ignores an existing endDate and rejects nonsense counts', () => {
    const p: RecurrencePattern = { frequency: 'daily', interval: 1, endDate: '2026-11-04' };
    expect(endDateAfterCount({ start_datetime: '2026-11-03T19:00:00', recurrence_pattern: p }, 10)).toBe('2026-11-12');
    expect(endDateAfterCount({ start_datetime: '2026-11-03T19:00:00', recurrence_pattern: p }, 0)).toBeNull();
  });
});

describe('buildRecurrenceRule (ICS) v2', () => {
  it('emits BYDAY for weekly days and WKST for intervals', () => {
    expect(buildRecurrenceRule({ frequency: 'weekly', interval: 1, byWeekday: [2, 4] }, true)).toBe('RRULE:FREQ=WEEKLY;BYDAY=TU,TH');
    expect(buildRecurrenceRule({ frequency: 'weekly', interval: 2, byWeekday: [6] }, true)).toBe(
      'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SA;WKST=MO'
    );
  });
  it('emits ordinal BYDAY for monthly nth weekday, from the series start', () => {
    const p: RecurrencePattern = { frequency: 'monthly', interval: 1, monthly: 'nthWeekday' };
    expect(buildRecurrenceRule(p, true, null, '2026-11-10T19:00:00')).toBe('RRULE:FREQ=MONTHLY;BYDAY=2TU');
    expect(buildRecurrenceRule(p, true, null, '2026-11-27T19:00:00')).toBe('RRULE:FREQ=MONTHLY;BYDAY=-1FR');
  });
  it('leaves old patterns exactly as before', () => {
    expect(buildRecurrenceRule({ frequency: 'weekly', interval: 1 }, true)).toBe('RRULE:FREQ=WEEKLY');
    expect(buildRecurrenceRule({ frequency: 'monthly', interval: 2 }, true)).toBe('RRULE:FREQ=MONTHLY;INTERVAL=2');
  });
});

describe('future start that is not itself an occurrence', () => {
  it('first occurrence is the next chosen day, matching the SQL walk', () => {
    // Tue 17 Nov 2026 start, series Mon & Wed → first date Wed 18 Nov
    // (SQL: event_next_occurrence returns 2026-11-18 on the scratch copy).
    const e = ev('2026-11-17T19:00:00', { frequency: 'weekly', interval: 1, byWeekday: [1, 3] });
    expect(next(e, 1, '2026-11-09T12:00:00')).toEqual(['2026-11-18']);
  });
});

import { cadenceLabel } from '@/utils/recurrence';

describe('cadenceLabel', () => {
  it('is short and specific', () => {
    expect(cadenceLabel({ frequency: 'daily', interval: 1 })).toBe('Daily');
    expect(cadenceLabel({ frequency: 'weekly', interval: 1 })).toBe('Weekly');
    expect(cadenceLabel({ frequency: 'weekly', interval: 2, byWeekday: [2, 4] })).toBe('Every 2 weeks');
    expect(cadenceLabel({ frequency: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] })).toBe('Weekdays');
    expect(cadenceLabel({ frequency: 'monthly', interval: 3 })).toBe('Every 3 months');
    expect(cadenceLabel(null)).toBe('');
  });
});
