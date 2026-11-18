/** The event page's same-day cue (utils/eventStatus.startsSoonLabel). */
import { describe, expect, it } from 'vitest';
import { startsSoonLabel } from '@/utils/eventStatus';

const now = new Date('2026-11-17T09:00:00Z');
const at = (h: number) => new Date(now.getTime() + h * 3600_000).toISOString();

describe('startsSoonLabel', () => {
  it('minutes within the hour, hours later the same day', () => {
    expect(startsSoonLabel(at(0.66), now, 'UTC')).toBe('Starts in 40 min');
    expect(startsSoonLabel(at(3), now, 'UTC')).toBe('Today · in 3 h');
  });

  it('"Tomorrow" for the next calendar day, nothing further out', () => {
    expect(startsSoonLabel(at(20), now, 'UTC')).toBe('Tomorrow'); // 05:00 next day
    expect(startsSoonLabel(at(48), now, 'UTC')).toBeNull();
  });

  it('judges the day in the event zone', () => {
    // 21:00 UTC is 16:00 in New York (same day) but 06:00 next day in Tokyo.
    expect(startsSoonLabel(at(12), now, 'America/New_York')).toBe('Today · in 12 h');
    expect(startsSoonLabel(at(12), now, 'Asia/Tokyo')).toBe('Tomorrow');
  });

  it('nothing once it has started, or for a bad date', () => {
    expect(startsSoonLabel(at(-1), now, 'UTC')).toBeNull();
    expect(startsSoonLabel('not a date', now, 'UTC')).toBeNull();
  });
});
