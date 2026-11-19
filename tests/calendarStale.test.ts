import { describe, expect, it } from 'vitest';
import { calendarNeedsUpdate } from '@/utils/calendarStale';

const JOINED = '2026-11-10T12:00:00Z';

describe('calendarNeedsUpdate (EJ-23)', () => {
  it('flags a reschedule that happened after the viewer joined', () => {
    expect(calendarNeedsUpdate('2026-11-12T09:00:00Z', JOINED)).toBe(true);
  });

  it('ignores a reschedule from before they joined', () => {
    expect(calendarNeedsUpdate('2026-11-09T09:00:00Z', JOINED)).toBe(false);
  });

  it('says nothing when the event was never rescheduled', () => {
    expect(calendarNeedsUpdate(null, JOINED)).toBe(false);
    expect(calendarNeedsUpdate(undefined, JOINED)).toBe(false);
  });

  it('says nothing to someone who has not joined', () => {
    expect(calendarNeedsUpdate('2026-11-12T09:00:00Z', null)).toBe(false);
    expect(calendarNeedsUpdate('2026-11-12T09:00:00Z', undefined)).toBe(false);
  });

  it('treats the same instant as already up to date', () => {
    expect(calendarNeedsUpdate(JOINED, JOINED)).toBe(false);
  });

  it('compares instants, not strings, across time zones', () => {
    // 13:00+02:00 is 11:00Z — an hour BEFORE the 12:00Z RSVP.
    expect(calendarNeedsUpdate('2026-11-10T13:00:00+02:00', JOINED)).toBe(false);
    expect(calendarNeedsUpdate('2026-11-10T15:00:00+02:00', JOINED)).toBe(true);
  });

  it('ignores unparseable timestamps rather than guessing', () => {
    expect(calendarNeedsUpdate('not a date', JOINED)).toBe(false);
    expect(calendarNeedsUpdate('2026-11-12T09:00:00Z', 'not a date')).toBe(false);
  });
});
