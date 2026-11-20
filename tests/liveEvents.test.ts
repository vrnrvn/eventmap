import { describe, expect, it } from 'vitest';
import { classifyLive, minutesLabel, rebucket, SOON_WINDOW_MINUTES } from '@/utils/liveEvents';
import type { RankedEvent } from '@/types/database';

const NOW = new Date('2026-12-01T12:00:00Z');
const at = (h: number) => new Date(NOW.getTime() + h * 3600_000).toISOString();
const ev = (over: Partial<RankedEvent>): RankedEvent =>
  ({ id: 'e1', start_datetime: at(-1), end_datetime: at(1), is_recurring: false, recurrence_pattern: null, timezone: 'UTC', ...over }) as RankedEvent;

describe('classifyLive', () => {
  it('a running one-off is live with its own window', () => {
    expect(classifyLive(ev({}), [], NOW)).toEqual({ occ_start: at(-1), occ_end: at(1), live_status: 'live' });
  });

  it('soon only within the window; at the boundary counts, past it does not', () => {
    expect(classifyLive(ev({ start_datetime: at(0.5), end_datetime: at(2) }), [], NOW)?.live_status).toBe('soon');
    const edge = new Date(NOW.getTime() + SOON_WINDOW_MINUTES * 60_000).toISOString();
    expect(classifyLive(ev({ start_datetime: edge, end_datetime: at(3) }), [], NOW)?.live_status).toBe('soon');
    expect(classifyLive(ev({ start_datetime: at(1.5), end_datetime: at(3) }), [], NOW)).toBeNull();
  });

  it('ended and far-future one-offs are neither', () => {
    expect(classifyLive(ev({ start_datetime: at(-3), end_datetime: at(-1) }), [], NOW)).toBeNull();
    expect(classifyLive(ev({ start_datetime: at(30), end_datetime: at(32) }), [], NOW)).toBeNull();
  });

  it('a series session running now is live with THAT session window', () => {
    const e = ev({ start_datetime: at(-169), end_datetime: at(-167), is_recurring: true,
      recurrence_pattern: { frequency: 'weekly', interval: 1 } as never });
    expect(classifyLive(e, [], NOW)).toEqual({ occ_start: at(-1), occ_end: at(1), live_status: 'live' });
  });

  it("a series whose today is cancelled falls back to 'soon' only if the NEXT date is near", () => {
    const e = ev({ start_datetime: at(-169), end_datetime: at(-167), is_recurring: true,
      recurrence_pattern: { frequency: 'weekly', interval: 1 } as never });
    const skipped = [{ event_id: 'e1', occurrence_date: at(0).slice(0, 10), kind: 'cancelled' as const, new_start: null, new_end: null, note: null }];
    expect(classifyLive(e, skipped, NOW)).toBeNull();
  });

  it('a date moved over now is live at its new time', () => {
    const e = ev({ start_datetime: at(-169), end_datetime: at(-167), is_recurring: true,
      recurrence_pattern: { frequency: 'weekly', interval: 1 } as never });
    const moved = [{ event_id: 'e1', occurrence_date: at(0).slice(0, 10), kind: 'rescheduled' as const,
      new_start: at(-0.5), new_end: at(1.5), note: null }];
    expect(classifyLive(e, moved, NOW)).toEqual({ occ_start: at(-0.5), occ_end: at(1.5), live_status: 'live' });
  });

  it('garbage dates are not live', () => {
    expect(classifyLive(ev({ start_datetime: 'nope', end_datetime: 'nope' }), [], NOW)).toBeNull();
  });
});

describe('minutesLabel', () => {
  it('reads naturally across the scale', () => {
    expect(minutesLabel('Ends', at(0.01), NOW)).toBe('Ends now');
    expect(minutesLabel('Ends', at(0.67), NOW)).toBe('Ends in 40 min');
    expect(minutesLabel('Starts', at(2), NOW)).toBe('Starts in 2 h');
    // Multi-day sessions read in days.
    expect(minutesLabel('Ends', at(30), NOW)).toBe('Ends in 30 h');
    expect(minutesLabel('Ends', at(50), NOW)).toBe('Ends in 2 days');
    expect(minutesLabel('Ends', at(-1), NOW)).toBeNull();
    expect(minutesLabel('Ends', 'nope', NOW)).toBeNull();
  });
});

describe('rebucket (between refreshes)', () => {
  const row = (status: 'live' | 'soon', start: number, end: number) => ({
    id: `${status}${start}`, live_status: status, occ_start: at(start), occ_end: at(end),
  });

  it('keeps fresh buckets as they are', () => {
    const r = rebucket([row('live', -1, 1), row('soon', 0.5, 2)], NOW);
    expect(r.live.map((x) => x.id)).toEqual(['live-1']);
    expect(r.soon.map((x) => x.id)).toEqual(['soon0.5']);
  });

  it('drops a session that ended since the last fetch', () => {
    expect(rebucket([row('live', -2, -0.1)], NOW).live).toEqual([]);
  });

  it('moves a "soon" row whose start has passed up to live', () => {
    const r = rebucket([row('soon', -0.1, 1)], NOW);
    expect(r.live.map((x) => x.id)).toEqual(['soon-0.1']);
    expect(r.soon).toEqual([]);
  });

  it('keeps the server order inside each bucket', () => {
    const r = rebucket([row('live', -1, 3), row('live', -2, 2), row('soon', 0.2, 1), row('soon', 0.1, 1)], NOW);
    expect(r.live.map((x) => x.id)).toEqual(['live-1', 'live-2']);
    expect(r.soon.map((x) => x.id)).toEqual(['soon0.2', 'soon0.1']);
  });
});
