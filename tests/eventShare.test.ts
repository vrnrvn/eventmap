import { describe, expect, it } from 'vitest';
import { buildEventIcs, buildRecurrenceRule } from '@/utils/eventIcs';

const unfold = (ics: string) => ics.split('\r\n').map((l) => l.replace(/^ /, '')).join('');

describe('buildRecurrenceRule', () => {
  it('returns null for non-recurring events', () => {
    expect(buildRecurrenceRule(null, false)).toBeNull();
    expect(buildRecurrenceRule({ frequency: 'weekly', interval: 1 }, false)).toBeNull();
    expect(buildRecurrenceRule(null, true)).toBeNull();
  });

  it('maps each frequency', () => {
    expect(buildRecurrenceRule({ frequency: 'daily', interval: 1 }, true)).toBe('RRULE:FREQ=DAILY');
    expect(buildRecurrenceRule({ frequency: 'weekly', interval: 1 }, true)).toBe('RRULE:FREQ=WEEKLY');
    expect(buildRecurrenceRule({ frequency: 'monthly', interval: 1 }, true)).toBe('RRULE:FREQ=MONTHLY');
  });

  it('emits INTERVAL only when greater than 1', () => {
    expect(buildRecurrenceRule({ frequency: 'weekly', interval: 1 }, true)).not.toContain('INTERVAL');
    expect(buildRecurrenceRule({ frequency: 'weekly', interval: 3 }, true)).toContain('INTERVAL=3');
  });

  it('turns endDate into an UNTIL at the end of that local day', () => {
    const rule = buildRecurrenceRule(
      { frequency: 'weekly', interval: 1, endDate: '2026-06-30' },
      true
    )!;
    expect(rule).toMatch(/UNTIL=\d{8}T\d{6}Z/);
    // The instant encoded must be the local end of 30 Jun 2026.
    const until = rule.split('UNTIL=')[1];
    const expected = new Date(2026, 5, 30, 23, 59, 59)
      .toISOString()
      .replace(/[-:]/g, '')
      .split('.')[0] + 'Z';
    expect(until).toBe(expected);
  });

  it('ignores a malformed endDate rather than emitting a broken UNTIL', () => {
    const rule = buildRecurrenceRule(
      { frequency: 'daily', interval: 1, endDate: 'someday' },
      true
    );
    expect(rule).toBe('RRULE:FREQ=DAILY');
  });
});

describe('buildEventIcs with recurrence', () => {
  const base = {
    id: 'abc',
    title: 'Weekly Trivia',
    startIso: new Date(2026, 0, 8, 19, 0).toISOString(),
    endIso: new Date(2026, 0, 8, 21, 0).toISOString(),
  };

  it('includes the RRULE line when given one', () => {
    const ics = buildEventIcs({
      ...base,
      recurrence: buildRecurrenceRule({ frequency: 'weekly', interval: 1 }, true),
    });
    expect(unfold(ics)).toContain('RRULE:FREQ=WEEKLY');
  });

  it('omits RRULE for a one-off event', () => {
    expect(buildEventIcs(base)).not.toContain('RRULE');
  });

  it('still produces a well-formed calendar', () => {
    const ics = buildEventIcs({ ...base, recurrence: 'RRULE:FREQ=DAILY' });
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(unfold(ics)).toContain('SUMMARY:Weekly Trivia');
  });
});
