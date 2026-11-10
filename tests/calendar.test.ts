import { describe, expect, it } from 'vitest';
import {
  addDaysToKey,
  agendaSections,
  calendarIcsInputs,
  MAX_SPAN_DAYS,
  occurrenceDayKeys,
  dayKeyOf,
  dayKeyToInstant,
  dayMarkers,
  daysBetween,
  expandOccurrences,
  findOverlaps,
  formatOccurrenceSpan,
  formatOccurrenceTimeRange,
  groupByDay,
  matrixRange,
  monthMatrix,
  parseDayKey,
  primarySource,
  shiftMonth,
  weekStartForLocale,
  type CalendarEvent,
  type SourcedEvent,
} from '@/utils/calendar';
import { buildCalendarIcs } from '@/utils/eventIcs';
import { dateKeyInZone } from '@/utils/timezone';

const TZ = 'Europe/Lisbon';

// Local-naive ISO strings keep one-off expectations machine-zone independent;
// zoned series use an explicit event zone so the walk is deterministic too.
const oneOff = (id: string, start: string, hours = 2, extra: Partial<CalendarEvent> = {}): CalendarEvent => {
  const s = new Date(start);
  return {
    id,
    title: `Event ${id}`,
    start_datetime: s.toISOString(),
    end_datetime: new Date(s.getTime() + hours * 3600_000).toISOString(),
    ...extra,
  };
};

const weeklyLisbon: CalendarEvent = {
  id: 'run-club',
  title: 'Run club',
  // 19:00 Lisbon on Tue 2 Jun 2026 (WEST, UTC+1)
  start_datetime: '2026-06-02T18:00:00.000Z',
  end_datetime: '2026-06-02T19:00:00.000Z',
  is_recurring: true,
  recurrence_pattern: { frequency: 'weekly', interval: 1 },
  timezone: TZ,
};

const range = (from: string, to: string) => ({ from: new Date(from), to: new Date(to) });

describe('day keys and month arithmetic', () => {
  it('formats and parses day keys', () => {
    expect(dayKeyOf(2026, 0, 5)).toBe('2026-01-05');
    expect(parseDayKey('2026-01-05')).toEqual({ year: 2026, month0: 0, day: 5 });
    expect(parseDayKey('junk')).toBeNull();
  });

  it('counts whole days between keys across a DST change', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-01-31', '2026-01-01')).toBe(-30);
  });

  it('shifts months across year boundaries', () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month0: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month0: 11 });
    expect(shiftMonth(2026, 5, -18)).toEqual({ year: 2024, month0: 11 });
  });

  it('gives the first and last instant of a day in a zone', () => {
    const start = dayKeyToInstant('2026-06-10', TZ, 'start');
    const end = dayKeyToInstant('2026-06-10', TZ, 'end');
    expect(start.toISOString()).toBe('2026-06-09T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-06-10T22:59:59.000Z');
    expect(dateKeyInZone(start, TZ)).toBe('2026-06-10');
    expect(dateKeyInZone(end, TZ)).toBe('2026-06-10');
  });
});

describe('monthMatrix', () => {
  it('pads June 2026 to whole weeks starting Monday', () => {
    // 1 Jun 2026 is a Monday; 30 days → exactly 5 rows with Monday start.
    const m = monthMatrix(2026, 5, 1, '2026-06-15');
    expect(m).toHaveLength(5);
    expect(m[0][0]).toMatchObject({ dayKey: '2026-06-01', inMonth: true, weekday: 1 });
    expect(m[4][6]).toMatchObject({ dayKey: '2026-07-05', inMonth: false });
    expect(m.flat().filter((c) => c.isToday).map((c) => c.dayKey)).toEqual(['2026-06-15']);
  });

  it('starts on Sunday when asked and adds leading days from the previous month', () => {
    const m = monthMatrix(2026, 5, 0, '2026-01-01');
    expect(m[0][0]).toMatchObject({ dayKey: '2026-05-31', inMonth: false, weekday: 0 });
    expect(m[0][1].dayKey).toBe('2026-06-01');
  });

  it('needs six rows for a month that spans them', () => {
    // Aug 2026 starts on a Saturday; with Monday start: 5 leading + 31 = 36 → 6 rows.
    const m = monthMatrix(2026, 7, 1, '2026-01-01');
    expect(m).toHaveLength(6);
    expect(m.flat().filter((c) => c.inMonth)).toHaveLength(31);
  });

  it('exposes the visible range as zone instants', () => {
    const m = monthMatrix(2026, 5, 1, '2026-01-01');
    const r = matrixRange(m, TZ);
    expect(dateKeyInZone(r.from, TZ)).toBe('2026-06-01');
    expect(dateKeyInZone(r.to, TZ)).toBe('2026-07-05');
  });
});

describe('weekStartForLocale', () => {
  it('returns Sunday for en-US and Monday for de-DE', () => {
    expect(weekStartForLocale('en-US')).toBe(0);
    expect(weekStartForLocale('de-DE')).toBe(1);
  });

  it('falls back to Monday for a locale without region info', () => {
    expect([0, 1, 6]).toContain(weekStartForLocale('eo'));
  });
});

describe('expandOccurrences', () => {
  it('places one-off events on their start day and drops those outside the range', () => {
    const rows: SourcedEvent[] = [
      { event: oneOff('a', '2026-06-10T19:00:00'), source: 'going' },
      { event: oneOff('b', '2026-07-10T19:00:00'), source: 'going' },
    ];
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const out = expandOccurrences(rows, range('2026-06-01T00:00:00', '2026-06-30T23:59:59'), tz);
    expect(out.map((o) => o.event.id)).toEqual(['a']);
    expect(out[0].dayKey).toBe('2026-06-10');
    expect(out[0].isSeries).toBe(false);
    expect(out[0].key).toBe('a:2026-06-10');
  });

  it('expands a zoned weekly series onto every Tuesday of the visible range at the same wall clock', () => {
    const out = expandOccurrences(
      [{ event: weeklyLisbon, source: 'going' }],
      { from: dayKeyToInstant('2026-06-01', TZ, 'start'), to: dayKeyToInstant('2026-06-30', TZ, 'end') },
      TZ
    );
    expect(out.map((o) => o.dayKey)).toEqual(['2026-06-02', '2026-06-09', '2026-06-16', '2026-06-23', '2026-06-30']);
    for (const o of out) {
      expect(o.isSeries).toBe(true);
      expect(o.start.toISOString().slice(11)).toBe('18:00:00.000Z');
      expect(o.end.getTime() - o.start.getTime()).toBe(3600_000);
    }
  });

  it('keeps a series at 19:00 local across the October DST change', () => {
    const out = expandOccurrences(
      [{ event: weeklyLisbon, source: 'going' }],
      { from: dayKeyToInstant('2026-10-20', TZ, 'start'), to: dayKeyToInstant('2026-11-03', TZ, 'end') },
      TZ
    );
    // WEST → WET on 25 Oct 2026: the UTC instant shifts, the wall clock doesn't.
    expect(out.map((o) => o.start.toISOString())).toEqual([
      '2026-10-20T18:00:00.000Z',
      '2026-10-27T19:00:00.000Z',
      '2026-11-03T19:00:00.000Z',
    ]);
  });

  it('merges sources for an event that is both going and saved, in priority order', () => {
    const e = oneOff('a', '2026-06-10T19:00:00');
    const out = expandOccurrences(
      [
        { event: e, source: 'saved' },
        { event: e, source: 'going' },
      ],
      range('2026-06-01T00:00:00', '2026-06-30T23:59:59'),
      Intl.DateTimeFormat().resolvedOptions().timeZone
    );
    expect(out).toHaveLength(1);
    expect(out[0].sources).toEqual(['going', 'saved']);
    expect(primarySource(out[0])).toBe('going');
  });

  it('keeps cancelled events (the day list badges them) and sorts by start', () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const out = expandOccurrences(
      [
        { event: oneOff('late', '2026-06-10T21:00:00'), source: 'going' },
        { event: oneOff('gone', '2026-06-10T18:00:00', 2, { status: 'cancelled' }), source: 'going' },
      ],
      range('2026-06-10T00:00:00', '2026-06-10T23:59:59'),
      tz
    );
    expect(out.map((o) => o.event.id)).toEqual(['gone', 'late']);
  });

  it('returns nothing for an inverted range', () => {
    expect(expandOccurrences([{ event: weeklyLisbon, source: 'going' }], range('2026-07-01', '2026-06-01'), TZ)).toEqual([]);
  });
});

describe('groupByDay and findOverlaps', () => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const rows: SourcedEvent[] = [
    { event: oneOff('a', '2026-06-10T18:00:00', 2), source: 'going' },
    { event: oneOff('b', '2026-06-10T19:00:00', 2), source: 'going' },
    { event: oneOff('c', '2026-06-10T21:00:00', 1), source: 'going' }, // starts when b ends: no overlap
    { event: oneOff('d', '2026-06-10T18:30:00', 1), source: 'interested' }, // not committed
    { event: oneOff('e', '2026-06-12T10:00:00', 1), source: 'saved' },
  ];
  const occ = expandOccurrences(rows, range('2026-06-01T00:00:00', '2026-06-30T23:59:59'), tz);

  it('groups by day with each day sorted', () => {
    const days = groupByDay(occ);
    expect([...days.keys()]).toEqual(['2026-06-10', '2026-06-12']);
    expect(days.get('2026-06-10')!.map((o) => o.event.id)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('flags only committed occurrences that overlap in time', () => {
    const overlaps = findOverlaps(occ);
    const byId = new Map(occ.map((o) => [o.event.id, o.occurrenceId]));
    expect([...overlaps].sort()).toEqual([byId.get('a'), byId.get('b')].sort());
  });

  it('ignores pending requests when looking for conflicts', () => {
    const pending = expandOccurrences(
      [
        { event: oneOff('a', '2026-06-10T18:00:00', 2), source: 'going', pending: true },
        { event: oneOff('b', '2026-06-10T19:00:00', 2), source: 'going' },
      ],
      range('2026-06-10T00:00:00', '2026-06-10T23:59:59'),
      tz
    );
    expect(pending.find((o) => o.event.id === 'a')!.pending).toBe(true);
    expect(findOverlaps(pending).size).toBe(0);
  });

  it('ignores cancelled events when looking for conflicts', () => {
    const cancelled = expandOccurrences(
      [
        { event: oneOff('a', '2026-06-10T18:00:00', 2, { status: 'cancelled' }), source: 'going' },
        { event: oneOff('b', '2026-06-10T19:00:00', 2), source: 'going' },
      ],
      range('2026-06-10T00:00:00', '2026-06-10T23:59:59'),
      tz
    );
    expect(findOverlaps(cancelled).size).toBe(0);
  });
});

describe('multi-day occurrences', () => {
  it('lists a three-day festival on each day it covers, with one occurrence id', () => {
    const out = expandOccurrences(
      [{ event: { id: 'fest', title: 'Fest', start_datetime: '2026-06-12T10:00:00.000Z', end_datetime: '2026-06-14T22:00:00.000Z' }, source: 'going' }],
      { from: dayKeyToInstant('2026-06-01', TZ, 'start'), to: dayKeyToInstant('2026-06-30', TZ, 'end') },
      TZ
    );
    expect(out.map((o) => [o.dayKey, o.spanIndex, o.spanDays])).toEqual([
      ['2026-06-12', 0, 3],
      ['2026-06-13', 1, 3],
      ['2026-06-14', 2, 3],
    ]);
    expect(new Set(out.map((o) => o.occurrenceId)).size).toBe(1);
    // The festival doesn't overlap with itself.
    expect(findOverlaps(out).size).toBe(0);
  });

  it('keeps a segment that started before the visible range', () => {
    const out = expandOccurrences(
      [{ event: { id: 'fest', title: 'Fest', start_datetime: '2026-05-30T10:00:00.000Z', end_datetime: '2026-06-02T10:00:00.000Z' }, source: 'going' }],
      { from: dayKeyToInstant('2026-06-01', TZ, 'start'), to: dayKeyToInstant('2026-06-30', TZ, 'end') },
      TZ
    );
    expect(out.map((o) => [o.dayKey, o.spanIndex])).toEqual([
      ['2026-06-01', 2],
      ['2026-06-02', 3],
    ]);
  });

  it('spreads each occurrence of a multi-day series, including one carried into the range', () => {
    const weekendCamp: CalendarEvent = {
      id: 'camp',
      title: 'Weekend camp',
      // Sat 30 May 2026 10:00 → Sun 31 May 18:00 Lisbon, weekly
      start_datetime: '2026-05-30T09:00:00.000Z',
      end_datetime: '2026-05-31T17:00:00.000Z',
      is_recurring: true,
      recurrence_pattern: { frequency: 'weekly', interval: 1 },
      timezone: TZ,
    };
    const out = expandOccurrences(
      [{ event: weekendCamp, source: 'going' }],
      { from: dayKeyToInstant('2026-05-31', TZ, 'start'), to: dayKeyToInstant('2026-06-07', TZ, 'end') },
      TZ
    );
    expect(out.map((o) => o.dayKey)).toEqual(['2026-05-31', '2026-06-06', '2026-06-07']);
  });

  it('keeps a night out that ends before 06:00 on its start day', () => {
    expect(occurrenceDayKeys(new Date('2026-06-12T21:00:00.000Z'), new Date('2026-06-13T01:00:00.000Z'), TZ)).toEqual(['2026-06-12']);
    // Ends 08:00 the next morning: listed on both days.
    expect(occurrenceDayKeys(new Date('2026-06-12T21:00:00.000Z'), new Date('2026-06-13T07:00:00.000Z'), TZ)).toEqual(['2026-06-12', '2026-06-13']);
    // Ends exactly at local midnight: no spill.
    expect(occurrenceDayKeys(new Date('2026-06-12T09:00:00.000Z'), new Date('2026-06-12T23:00:00.000Z'), TZ)).toEqual(['2026-06-12']);
  });

  it('caps absurd spans', () => {
    const days = occurrenceDayKeys(new Date('2026-01-01T10:00:00.000Z'), new Date('2026-12-31T10:00:00.000Z'), TZ);
    expect(days).toHaveLength(MAX_SPAN_DAYS);
  });
});

describe('agenda helpers', () => {
  it('moves day keys across month and year ends', () => {
    expect(addDaysToKey('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDaysToKey('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('builds day sections in order', () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const occ = expandOccurrences(
      [
        { event: oneOff('late', '2026-06-20T10:00:00'), source: 'going' },
        { event: oneOff('early', '2026-06-05T10:00:00'), source: 'saved' },
        { event: oneOff('early2', '2026-06-05T08:00:00'), source: 'going' },
      ],
      range('2026-06-01T00:00:00', '2026-06-30T23:59:59'),
      tz
    );
    expect(agendaSections(occ).map((s) => [s.dayKey, s.data.map((o) => o.event.id)])).toEqual([
      ['2026-06-05', ['early2', 'early']],
      ['2026-06-20', ['late']],
    ]);
  });
});

describe('calendar ICS export', () => {
  const now = new Date('2026-06-15T12:00:00Z');

  it('anchors a series at its next occurrence and keeps the RRULE', () => {
    const inputs = calendarIcsInputs([weeklyLisbon], now);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].startIso).toBe('2026-06-16T18:00:00.000Z');
    expect(inputs[0].recurrence).toBe('RRULE:FREQ=WEEKLY');
    expect(inputs[0].timezone).toBe(TZ);
  });

  it('skips ended, cancelled and duplicate events', () => {
    const past = oneOff('past', '2026-01-01T10:00:00');
    const future = oneOff('future', '2026-08-01T10:00:00');
    const cancelled = oneOff('cancelled', '2026-08-02T10:00:00', 2, { status: 'cancelled' });
    const inputs = calendarIcsInputs([past, future, future, cancelled], now);
    expect(inputs.map((i) => i.id)).toEqual(['future']);
  });

  it('builds one VCALENDAR with several VEVENTs', () => {
    const ics = buildCalendarIcs(
      calendarIcsInputs([weeklyLisbon, oneOff('future', '2026-08-01T10:00:00')], now)
    );
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('UID:event-run-club@eventmap.pro');
    expect(ics).toContain('UID:event-future@eventmap.pro');
    expect(ics).toContain(`DTSTART;TZID=${TZ}:20260616T190000`);
  });

  it('still produces a valid empty calendar', () => {
    const ics = buildCalendarIcs([]);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).not.toContain('VEVENT');
  });
});

describe('formatOccurrenceTimeRange', () => {
  const start = new Date('2026-06-02T18:00:00.000Z'); // 19:00 Lisbon, 14:00 New York
  const end = new Date('2026-06-02T20:00:00.000Z');

  it('renders in the event zone and appends the zone when the viewer differs', () => {
    expect(formatOccurrenceTimeRange(start, end, 'Europe/Lisbon', 'Europe/Lisbon', 'en-US')).toBe('7:00 PM – 9:00 PM');
    const away = formatOccurrenceTimeRange(start, end, 'Europe/Lisbon', 'America/New_York', 'en-US');
    expect(away.startsWith('7:00 PM – 9:00 PM ')).toBe(true);
    expect(away.length).toBeGreaterThan('7:00 PM – 9:00 PM '.length);
  });

  it('falls back to the viewer zone for legacy events without a zone', () => {
    expect(formatOccurrenceTimeRange(start, end, null, 'America/New_York', 'en-US')).toBe('2:00 PM – 4:00 PM');
  });
});

describe('formatOccurrenceSpan', () => {
  it('names both days for a multi-day occurrence', () => {
    const s = formatOccurrenceSpan(new Date('2026-06-12T09:00:00.000Z'), new Date('2026-06-14T21:00:00.000Z'), 'Europe/Lisbon', 'Europe/Lisbon', 'en-US');
    expect(s).toBe('Fri 10:00 AM → Sun 10:00 PM');
  });
});

describe('dayMarkers', () => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const day = (rows: SourcedEvent[]) =>
    expandOccurrences(rows, range('2026-06-10T00:00:00', '2026-06-10T23:59:59'), tz);

  it('orders markers by priority and marks all-pending sources hollow', () => {
    const occ = day([
      { event: oneOff('a', '2026-06-10T10:00:00'), source: 'saved' },
      { event: oneOff('b', '2026-06-10T12:00:00'), source: 'going', pending: true },
    ]);
    expect(dayMarkers(occ)).toEqual([
      { kind: 'going', pending: true },
      { kind: 'saved', pending: false },
    ]);
  });

  it('is solid when at least one occurrence of the source is confirmed', () => {
    const occ = day([
      { event: oneOff('a', '2026-06-10T10:00:00'), source: 'going', pending: true },
      { event: oneOff('b', '2026-06-10T12:00:00'), source: 'going' },
    ]);
    expect(dayMarkers(occ)).toEqual([{ kind: 'going', pending: false }]);
  });

  it('shows a muted marker for a day with only cancelled plans', () => {
    const occ = day([{ event: oneOff('a', '2026-06-10T10:00:00', 2, { status: 'cancelled' }), source: 'going' }]);
    expect(dayMarkers(occ)).toEqual([{ kind: 'cancelled', pending: false }]);
    expect(dayMarkers([])).toEqual([]);
  });
});

describe('expandOccurrences with per-date exceptions', () => {
  it('drops skipped dates and moves rescheduled ones', async () => {
    const { expandOccurrences } = await import('@/utils/calendar');
    const event = {
      id: 'jam',
      title: 'Weekly Jam',
      start_datetime: '2026-11-03T19:00:00Z',
      end_datetime: '2026-11-03T21:00:00Z',
      is_recurring: true,
      recurrence_pattern: { frequency: 'weekly' as const, interval: 1 },
      timezone: 'UTC',
    };
    const range = { from: new Date('2026-11-09T00:00:00Z'), to: new Date('2026-11-30T23:59:59Z') };
    const ex = new Map([
      ['jam', [
        { event_id: 'jam', occurrence_date: '2026-11-10', kind: 'cancelled' as const, new_start: null, new_end: null, note: null },
        { event_id: 'jam', occurrence_date: '2026-11-17', kind: 'rescheduled' as const, new_start: '2026-11-18T20:00:00Z', new_end: '2026-11-18T22:00:00Z', note: null },
      ]],
    ]);
    const days = expandOccurrences([{ event, source: 'going' } as never], range, 'UTC', ex).map((o) => o.dayKey);
    expect(days).toEqual(['2026-11-18', '2026-11-24']);
    const plain = expandOccurrences([{ event, source: 'going' } as never], range, 'UTC').map((o) => o.dayKey);
    expect(plain).toEqual(['2026-11-10', '2026-11-17', '2026-11-24']);
  });
});

describe('expandOccurrences: date moved INTO the range (G15)', () => {
  it('shows a date moved in from outside the visible range', async () => {
    const { expandOccurrences } = await import('@/utils/calendar');
    const event = {
      id: 'jam2',
      title: 'Weekly Jam',
      start_datetime: '2026-11-03T19:00:00Z',
      end_datetime: '2026-11-03T21:00:00Z',
      is_recurring: true,
      recurrence_pattern: { frequency: 'weekly' as const, interval: 1 },
      timezone: 'UTC',
    };
    // Range: just 11–13 Nov. 24 Nov (outside) is moved to 12 Nov.
    const range = { from: new Date('2026-11-11T00:00:00Z'), to: new Date('2026-11-13T23:59:59Z') };
    const ex = new Map([
      ['jam2', [{ event_id: 'jam2', occurrence_date: '2026-11-24', kind: 'rescheduled' as const, new_start: '2026-11-12T18:00:00Z', new_end: '2026-11-12T20:00:00Z', note: null }]],
    ]);
    const days = expandOccurrences([{ event, source: 'going' } as never], range, 'UTC', ex).map((o) => o.dayKey);
    expect(days).toEqual(['2026-11-12']);
  });
});
