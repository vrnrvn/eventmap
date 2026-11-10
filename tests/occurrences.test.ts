import { describe, it, expect } from 'vitest';
import { listOccurrences, nextEffectiveOccurrence, occurrenceDateKey, type OccurrenceException } from '@/utils/occurrences';

// Weekly on Tuesdays 19:00–21:00 UTC from 3 Nov 2026.
const event = {
  start_datetime: '2026-11-03T19:00:00Z',
  end_datetime: '2026-11-03T21:00:00Z',
  is_recurring: true,
  recurrence_pattern: { frequency: 'weekly' as const, interval: 1 },
  timezone: 'UTC',
};
const NOW = new Date('2026-11-09T12:00:00Z'); // Monday
const ex = (date: string, kind: OccurrenceException['kind'], s?: string, e?: string): OccurrenceException => ({
  event_id: 'e', occurrence_date: date, kind, new_start: s ?? null, new_end: e ?? null, note: kind === 'cancelled' ? 'Closed' : null,
});
const keys = (list: { dateKey: string; status: string }[]) => list.map((o) => `${o.dateKey}:${o.status}`);

describe('listOccurrences', () => {
  it('lists plain upcoming dates', () => {
    expect(keys(listOccurrences(event, [], { count: 3, now: NOW }))).toEqual([
      '2026-11-10:scheduled', '2026-11-17:scheduled', '2026-11-24:scheduled',
    ]);
  });

  it('marks cancelled dates and still returns `count` live ones', () => {
    const list = listOccurrences(event, [ex('2026-11-17', 'cancelled')], { count: 3, now: NOW });
    expect(keys(list)).toEqual(['2026-11-10:scheduled', '2026-11-17:cancelled', '2026-11-24:scheduled', '2026-12-01:scheduled']);
    expect(list[1].note).toBe('Closed');
  });

  it('drops cancelled dates when asked', () => {
    expect(keys(listOccurrences(event, [ex('2026-11-10', 'cancelled')], { count: 2, now: NOW, includeCancelled: false }))).toEqual([
      '2026-11-17:scheduled', '2026-11-24:scheduled',
    ]);
  });

  it('uses the moved time, keeps the original, and re-sorts', () => {
    // 17 Nov moved earlier, to Mon 9 Nov 20:00 — now first in the list.
    const list = listOccurrences(event, [ex('2026-11-17', 'rescheduled', '2026-11-09T20:00:00Z', '2026-11-09T22:00:00Z')], { count: 3, now: NOW });
    expect(keys(list)).toEqual(['2026-11-17:moved', '2026-11-10:scheduled', '2026-11-24:scheduled']);
    expect(list[0].start.toISOString()).toBe('2026-11-09T20:00:00.000Z');
    expect(list[0].originalStart.toISOString()).toBe('2026-11-17T19:00:00.000Z');
    expect(list[0].end.toISOString()).toBe('2026-11-09T22:00:00.000Z');
  });

  it('carries the series duration onto scheduled dates', () => {
    const [first] = listOccurrences(event, [], { count: 1, now: NOW });
    expect(first.end.getTime() - first.start.getTime()).toBe(2 * 3600 * 1000);
  });

  it('returns nothing for one-off events', () => {
    expect(listOccurrences({ ...event, is_recurring: false }, [], { now: NOW })).toEqual([]);
  });
});

describe('nextEffectiveOccurrence (mirrors SQL event_next_effective_occurrence)', () => {
  it('skips a cancelled next date', () => {
    expect(nextEffectiveOccurrence(event, [ex('2026-11-10', 'cancelled')], NOW)?.dateKey).toBe('2026-11-17');
  });
  it('returns a moved date at its new time', () => {
    const next = nextEffectiveOccurrence(event, [ex('2026-11-10', 'rescheduled', '2026-11-11T18:00:00Z', '2026-11-11T20:00:00Z')], NOW);
    expect(next?.start.toISOString()).toBe('2026-11-11T18:00:00.000Z');
  });
  it('ignores a date moved into the past', () => {
    const next = nextEffectiveOccurrence(event, [ex('2026-11-10', 'rescheduled', '2026-11-08T18:00:00Z', '2026-11-08T20:00:00Z')], NOW);
    expect(next?.dateKey).toBe('2026-11-17');
  });
});

describe('occurrenceDateKey', () => {
  it('keys by the event zone, not UTC', () => {
    // 01:30 UTC on the 11th is still the 10th in New York.
    expect(occurrenceDateKey(new Date('2026-11-11T01:30:00Z'), 'America/New_York')).toBe('2026-11-10');
    expect(occurrenceDateKey(new Date('2026-11-11T01:30:00Z'), 'UTC')).toBe('2026-11-11');
  });
});

import { buildEventIcs } from '@/utils/eventIcs';

describe('ICS with exceptions', () => {
  const base = {
    id: 'abc',
    title: 'Weekly Jam',
    startIso: '2026-11-03T19:00:00Z',
    endIso: '2026-11-03T21:00:00Z',
    recurrence: 'RRULE:FREQ=WEEKLY',
  };
  it('writes EXDATE for a cancelled date (UTC and zoned)', () => {
    const ics = buildEventIcs({ ...base, exceptions: [{ originalStartIso: '2026-11-17T19:00:00Z', kind: 'cancelled' }] });
    expect(ics).toContain('EXDATE:20261117T190000Z');
    const zoned = buildEventIcs({
      ...base,
      timezone: 'Europe/Lisbon',
      exceptions: [{ originalStartIso: '2026-11-17T19:00:00Z', kind: 'cancelled' }],
    });
    expect(zoned).toContain('EXDATE;TZID=Europe/Lisbon:20261117T190000');
  });
  it('writes an override VEVENT with RECURRENCE-ID for a moved date', () => {
    const ics = buildEventIcs({
      ...base,
      exceptions: [
        { originalStartIso: '2026-11-17T19:00:00Z', kind: 'rescheduled', newStartIso: '2026-11-18T20:00:00Z', newEndIso: '2026-11-18T22:00:00Z' },
      ],
    });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('RECURRENCE-ID:20261117T190000Z');
    expect(ics).toContain('DTSTART:20261118T200000Z');
    expect(ics).not.toContain('EXDATE');
  });
  it('ignores exceptions on one-off events and malformed entries', () => {
    const ics = buildEventIcs({ ...base, recurrence: null, exceptions: [{ originalStartIso: '2026-11-17T19:00:00Z', kind: 'cancelled' }] });
    expect(ics).not.toContain('EXDATE');
    const bad = buildEventIcs({ ...base, exceptions: [{ originalStartIso: 'nope', kind: 'cancelled' }] });
    expect(bad).not.toContain('EXDATE');
  });
});

import { dateAttendance, nextDateOverride } from '@/utils/occurrences';

describe('per-date attendance (Phase F)', () => {
  const o = [{ occurrence_date: '2026-11-17', status: 'not_going' as const }, { occurrence_date: '2026-11-24', status: 'going' as const }];
  it('override wins, else the series RSVP decides', () => {
    expect(dateAttendance('going', o, '2026-11-10')).toBe('going');
    expect(dateAttendance('going', o, '2026-11-17')).toBe('not_going');
    expect(dateAttendance(null, o, '2026-11-24')).toBe('going');
    expect(dateAttendance('interested', [], '2026-11-10')).toBe('none');
  });
  it('toggling stores the minimal override', () => {
    expect(nextDateOverride('going', 'going')).toBe('not_going'); // series goer skips a date
    expect(nextDateOverride('going', 'not_going')).toBeNull(); // back to default
    expect(nextDateOverride(null, 'none')).toBe('going'); // just this date
    expect(nextDateOverride(null, 'going')).toBeNull(); // undo
    expect(nextDateOverride('interested', 'none')).toBe('going');
  });
});

import { effectiveNextStartIso } from '@/utils/occurrences';

describe('strict "next" (G2) and effectiveNextStartIso (E-R1)', () => {
  const LATE = new Date('2026-11-10T21:00:00Z'); // Tuesday 21:00, after tonight's 19:00
  it('strict listing skips a date whose time has passed today', () => {
    expect(listOccurrences(event, [], { count: 1, now: LATE })[0].dateKey).toBe('2026-11-10'); // calendar semantics
    expect(listOccurrences(event, [], { count: 1, now: LATE, strict: true })[0].dateKey).toBe('2026-11-17');
    expect(nextEffectiveOccurrence(event, [], LATE)?.dateKey).toBe('2026-11-17');
  });
  it('uses the server value when there are no exceptions and it is still ahead', () => {
    const row = { ...event, next_start_datetime: '2026-11-17T19:00:00Z' };
    expect(effectiveNextStartIso(row, [], NOW)).toBe('2026-11-17T19:00:00.000Z');
    expect(effectiveNextStartIso({ ...event, next_start_datetime: '2026-11-10T19:00:00Z' }, [], LATE)).toBe('2026-11-17T19:00:00.000Z');
  });
  it('overrides the server value when the next date is skipped or moved', () => {
    const row = { ...event, next_start_datetime: '2026-11-10T19:00:00Z' };
    expect(effectiveNextStartIso(row, [ex('2026-11-10', 'cancelled')], NOW)).toBe('2026-11-17T19:00:00.000Z');
    expect(effectiveNextStartIso(row, [ex('2026-11-10', 'rescheduled', '2026-11-11T18:00:00Z', '2026-11-11T20:00:00Z')], NOW)).toBe('2026-11-11T18:00:00.000Z');
    expect(effectiveNextStartIso({ ...event, is_recurring: false }, [], NOW)).toBe(event.start_datetime);
  });
});

describe('per-date waitlist (F-R2)', () => {
  it('reports waitlisted dates and leaves the waitlist on tap', () => {
    const o = [{ occurrence_date: '2026-11-17', status: 'waitlist' as const }];
    expect(dateAttendance(null, o, '2026-11-17')).toBe('waitlist');
    expect(nextDateOverride(null, 'waitlist')).toBeNull();
    expect(nextDateOverride('going', 'waitlist')).toBeNull();
  });
});
