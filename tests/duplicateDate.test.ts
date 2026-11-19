import { describe, expect, it } from 'vitest';
import { addDaysToKey, dayOfWeekForKey, defaultRunAgainDay, runAgainWhen } from '@/utils/duplicateDate';
import { dateKeyInZone, utcToWallClock } from '@/utils/timezone';

const at = (iso: string) => new Date(iso);

describe('addDaysToKey', () => {
  it('crosses months and years', () => {
    expect(addDaysToKey('2026-11-28', 7)).toBe('2026-12-05');
    expect(addDaysToKey('2026-12-29', 7)).toBe('2027-01-05');
    expect(addDaysToKey('2026-02-26', 3)).toBe('2026-03-01');
  });

  it('handles a leap day', () => {
    expect(addDaysToKey('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysToKey('2028-02-29', 1)).toBe('2028-03-01');
  });

  // Adding whole days across a DST change must not slip a date.
  it('is unaffected by daylight saving', () => {
    expect(addDaysToKey('2027-03-13', 1)).toBe('2027-03-14');
    expect(addDaysToKey('2026-10-31', 1)).toBe('2026-11-01');
  });
});

describe('dayOfWeekForKey', () => {
  it('reads the weekday', () => {
    expect(dayOfWeekForKey('2026-11-18')).toBe(3); // a Wednesday
    expect(dayOfWeekForKey('2026-11-21')).toBe(6); // a Saturday
  });
});

describe('defaultRunAgainDay', () => {
  const now = at('2026-11-18T10:00:00Z'); // Wednesday

  it('offers a week later for an event still ahead', () => {
    expect(defaultRunAgainDay(at('2026-11-20T19:00:00Z'), 'UTC', now)).toBe('2026-11-27');
  });

  it('offers the next matching weekday for an event that has happened', () => {
    // A Saturday event last month → the next Saturday.
    expect(defaultRunAgainDay(at('2026-10-17T19:00:00Z'), 'UTC', now)).toBe('2026-11-21');
  });

  it("skips today even when today is the source's weekday", () => {
    // Source was a Wednesday; today is Wednesday → next Wednesday, not today.
    expect(defaultRunAgainDay(at('2026-11-11T19:00:00Z'), 'UTC', now)).toBe('2026-11-25');
  });

  it('treats an event earlier today as past', () => {
    expect(defaultRunAgainDay(at('2026-11-18T08:00:00Z'), 'UTC', now)).toBe('2026-11-25');
  });

  it('always lands strictly in the future', () => {
    const todayKey = dateKeyInZone(now, 'UTC');
    for (const iso of ['2024-01-01T12:00:00Z', '2026-11-17T23:00:00Z', '2026-11-19T06:00:00Z']) {
      expect(defaultRunAgainDay(at(iso), 'UTC', now) > todayKey).toBe(true);
    }
  });

  it("uses the event's zone, not UTC, to decide what 'today' is", () => {
    // 2026-11-19T02:00Z is already the 19th in UTC but still the 18th in NY.
    const nowNy = at('2026-11-19T02:00:00Z');
    // A Thursday source (the 19th in UTC) that NY still calls Wednesday the 18th.
    expect(defaultRunAgainDay(at('2026-11-19T02:00:00Z'), 'America/New_York', nowNy)).toBe('2026-11-25');
  });
});

describe('runAgainWhen', () => {
  it('keeps the time of day and the duration', () => {
    const out = runAgainWhen(
      { start: at('2026-10-17T19:00:00Z'), end: at('2026-10-17T21:30:00Z') },
      '2026-11-21',
      'UTC'
    );
    expect(out.start.toISOString()).toBe('2026-11-21T19:00:00.000Z');
    expect(out.end.toISOString()).toBe('2026-11-21T21:30:00.000Z');
    expect(out.end.getTime() - out.start.getTime()).toBe(2.5 * 60 * 60 * 1000);
  });

  // The bug this exists for: the server's shift lands the copy at the current
  // clock time instead of the event's own.
  it('does not inherit the current clock time', () => {
    const out = runAgainWhen(
      { start: at('2026-10-17T19:00:00Z'), end: at('2026-10-17T21:00:00Z') },
      '2026-11-21',
      'UTC'
    );
    expect(utcToWallClock(out.start, 'UTC')).toMatchObject({ hour: 19, minute: 0, second: 0 });
  });

  // The other bug: +7 days of UTC arithmetic across a DST change moves the
  // local start by an hour.
  it('holds the local time of day across a daylight-saving change', () => {
    // 1 Nov 2026 02:00 ends DST in New York; a 19:00 event before it...
    const source = { start: at('2026-10-24T23:00:00Z'), end: at('2026-10-25T01:00:00Z') }; // 19:00–21:00 EDT
    expect(utcToWallClock(source.start, 'America/New_York')).toMatchObject({ hour: 19 });

    const out = runAgainWhen(source, '2026-11-07', 'America/New_York');
    // ...is still 19:00 after the change, which is a different UTC instant.
    expect(utcToWallClock(out.start, 'America/New_York')).toMatchObject({ hour: 19, minute: 0 });
    expect(out.start.toISOString()).toBe('2026-11-08T00:00:00.000Z');
    expect(out.end.getTime() - out.start.getTime()).toBe(2 * 60 * 60 * 1000);
  });

  it('keeps an event that runs past midnight intact', () => {
    const out = runAgainWhen(
      { start: at('2026-10-17T22:00:00Z'), end: at('2026-10-18T02:00:00Z') },
      '2026-11-21',
      'UTC'
    );
    expect(out.start.toISOString()).toBe('2026-11-21T22:00:00.000Z');
    expect(out.end.toISOString()).toBe('2026-11-22T02:00:00.000Z');
  });

  it('survives a zero-length or reversed source without going backwards', () => {
    const out = runAgainWhen(
      { start: at('2026-10-17T19:00:00Z'), end: at('2026-10-17T18:00:00Z') },
      '2026-11-21',
      'UTC'
    );
    expect(out.end.getTime()).toBeGreaterThanOrEqual(out.start.getTime());
  });
});
