/**
 * EJ-2 / EJ-13 (docs/EVENT_JOURNEY_REVIEW_2026-11-17.md): a recurring series
 * is "happening now" while one of its dates runs, a finished date can't be
 * RSVP'd from the event page, and the host keeps whole-series actions while
 * a date is live.
 */
import { describe, expect, it } from 'vitest';
import { isEventInProgress } from '@/utils/eventStatus';
import { moveIsPastSeriesEnd, occurrenceInProgress, upcomingDateRows, type OccurrenceException } from '@/utils/occurrences';
import { getHostActions, getHostEventPhase } from '@/utils/hostEvent';
import { playbookStage } from '@/utils/eventPlaybook';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Weekly, 18:00–20:00 UTC on Tuesdays, first date 2026-11-03.
const weekly = {
  start_datetime: '2026-11-03T18:00:00.000Z',
  end_datetime: '2026-11-03T20:00:00.000Z',
  is_recurring: true,
  recurrence_pattern: { frequency: 'weekly' as const, interval: 1 },
  timezone: 'UTC',
};
// 2026-11-17 is a Tuesday: the third date.
const at = (iso: string) => new Date(iso);

const exception = (over: Partial<OccurrenceException>): OccurrenceException => ({
  event_id: 'e1',
  occurrence_date: '2026-11-17',
  kind: 'cancelled',
  new_start: null,
  new_end: null,
  note: null,
  ...over,
});

describe('isEventInProgress for a series', () => {
  it('is true while a date runs and false before and after it', () => {
    expect(isEventInProgress(weekly, at('2026-11-17T17:59:00Z'))).toBe(false);
    expect(isEventInProgress(weekly, at('2026-11-17T18:00:00Z'))).toBe(true);
    expect(isEventInProgress(weekly, at('2026-11-17T19:30:00Z'))).toBe(true);
    expect(isEventInProgress(weekly, at('2026-11-17T20:00:00Z'))).toBe(false);
    expect(isEventInProgress(weekly, at('2026-11-18T19:00:00Z'))).toBe(false);
  });

  it('is never in progress after the series end date', () => {
    const ended = { ...weekly, recurrence_pattern: { ...weekly.recurrence_pattern, endDate: '2026-11-10' } };
    expect(isEventInProgress(ended, at('2026-11-17T19:00:00Z'))).toBe(false);
  });

  it('honours a skipped date and a moved date', () => {
    const skipped = [exception({ kind: 'cancelled' })];
    expect(isEventInProgress(weekly, at('2026-11-17T19:00:00Z'), skipped)).toBe(false);

    const moved = [
      exception({ kind: 'rescheduled', new_start: '2026-11-18T10:00:00Z', new_end: '2026-11-18T12:00:00Z' }),
    ];
    expect(isEventInProgress(weekly, at('2026-11-17T19:00:00Z'), moved)).toBe(false);
    expect(isEventInProgress(weekly, at('2026-11-18T11:00:00Z'), moved)).toBe(true);
  });

  it('finds a date that runs across midnight', () => {
    const late = {
      ...weekly,
      start_datetime: '2026-11-03T22:00:00.000Z',
      end_datetime: '2026-11-04T02:00:00.000Z',
    };
    expect(isEventInProgress(late, at('2026-11-18T01:00:00Z'))).toBe(true);
    expect(occurrenceInProgress(late, [], at('2026-11-18T01:00:00Z'))?.dateKey).toBe('2026-11-17');
  });

  it('leaves one-off events as they were', () => {
    const oneOff = { start_datetime: '2026-11-17T18:00:00Z', end_datetime: '2026-11-17T20:00:00Z' };
    expect(isEventInProgress(oneOff, at('2026-11-17T19:00:00Z'))).toBe(true);
    expect(isEventInProgress(oneOff, at('2026-11-17T21:00:00Z'))).toBe(false);
  });
});

describe('upcomingDateRows', () => {
  it('drops a date that already finished today', () => {
    const rows = upcomingDateRows(weekly, [], { count: 3, now: at('2026-11-17T21:00:00Z') });
    expect(rows.map((r) => r.dateKey)).toEqual(['2026-11-24', '2026-12-01', '2026-12-08']);
    expect(rows.some((r) => r.inProgress)).toBe(false);
  });

  it('keeps the running date, flagged, and still returns `count` dates', () => {
    const rows = upcomingDateRows(weekly, [], { count: 3, now: at('2026-11-17T19:00:00Z') });
    expect(rows.map((r) => r.dateKey)).toEqual(['2026-11-17', '2026-11-24', '2026-12-01']);
    expect(rows.map((r) => r.inProgress)).toEqual([true, false, false]);
  });

  it('keeps a cancelled date inside the span without counting it', () => {
    const rows = upcomingDateRows(weekly, [exception({ occurrence_date: '2026-11-24' })], {
      count: 2,
      now: at('2026-11-17T21:00:00Z'),
    });
    expect(rows.map((r) => `${r.dateKey}:${r.status}`)).toEqual([
      '2026-11-24:cancelled',
      '2026-12-01:scheduled',
      '2026-12-08:scheduled',
    ]);
  });
});

describe('host phase and actions while a series date runs', () => {
  const during = at('2026-11-17T19:00:00Z');

  it('reports the series as live, and the playbook as day-of', () => {
    expect(getHostEventPhase(weekly, during)).toBe('live');
    // Before EJ-2 the stage fell back to "lead-up" mid-session because the
    // next start had already moved to the following week.
    expect(
      playbookStage({ ...weekly, next_start_datetime: new Date(during.getTime() + 7 * DAY - HOUR).toISOString() }, during)
    ).toBe('dayof');
  });

  it('keeps whole-series actions for a live series but not for a live one-off', () => {
    const series = getHostActions('live', { isSeries: true });
    expect(series.canPostpone).toBe(true);
    expect(series.canReschedule).toBe(true);
    expect(series.canNotifyFollowers).toBe(true);

    const oneOff = getHostActions('live');
    expect(oneOff.canPostpone).toBe(false);
    expect(oneOff.canReschedule).toBe(false);
    expect(oneOff.canNotifyFollowers).toBe(false);
    expect(oneOff.canCancel).toBe(true);
  });
});

describe('moveIsPastSeriesEnd (EJ-14 advisory; the server extends or refuses)', () => {
  it('refuses a new date after the series end, in the event zone', () => {
    expect(moveIsPastSeriesEnd(at('2026-11-27T18:00:00Z'), 'UTC', '2026-11-24')).toBe(true);
    expect(moveIsPastSeriesEnd(at('2026-11-24T18:00:00Z'), 'UTC', '2026-11-24')).toBe(false);
    // 23:30 on the 24th in New York is already the 25th in UTC: judged in the event zone.
    expect(moveIsPastSeriesEnd(at('2026-11-25T04:30:00Z'), 'America/New_York', '2026-11-24')).toBe(false);
  });

  it('allows anything when the series has no end date', () => {
    expect(moveIsPastSeriesEnd(at('2027-06-01T18:00:00Z'), 'UTC', null)).toBe(false);
    expect(moveIsPastSeriesEnd(at('2027-06-01T18:00:00Z'), 'UTC', undefined)).toBe(false);
  });
});
