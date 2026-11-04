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

describe('time zones in calendar exports', () => {
  it('writes local wall clock with TZID when the event has a zone', () => {
    const ics = unfold(
      buildEventIcs({
        id: 'tz1',
        title: 'Lisbon show',
        startIso: '2026-07-15T18:00:00Z', // 19:00 WEST
        endIso: '2026-07-15T20:00:00Z',
        timezone: 'Europe/Lisbon',
      })
    );
    expect(ics).toContain('DTSTART;TZID=Europe/Lisbon:20260715T190000');
    expect(ics).toContain('DTEND;TZID=Europe/Lisbon:20260715T210000');
    expect(ics).not.toContain('DTSTART:2026');
  });

  it('keeps UTC instants for legacy events without a zone', () => {
    const ics = unfold(
      buildEventIcs({ id: 'tz2', title: 'x', startIso: '2026-07-15T18:00:00Z', endIso: '2026-07-15T20:00:00Z' })
    );
    expect(ics).toContain('DTSTART:20260715T180000Z');
  });

  it('ignores an invalid zone rather than emitting a broken TZID', () => {
    const ics = unfold(
      buildEventIcs({
        id: 'tz3',
        title: 'x',
        startIso: '2026-07-15T18:00:00Z',
        endIso: '2026-07-15T20:00:00Z',
        timezone: 'Mars/Olympus',
      })
    );
    expect(ics).toContain('DTSTART:20260715T180000Z');
  });

  it('computes UNTIL at the end of the final day in the event zone', () => {
    // New York, 2026-07-31 23:59:59 EDT = 2026-08-01T03:59:59Z
    expect(
      buildRecurrenceRule({ frequency: 'weekly', interval: 1, endDate: '2026-07-31' }, true, 'America/New_York')
    ).toBe('RRULE:FREQ=WEEKLY;UNTIL=20260801T035959Z');
  });
});
