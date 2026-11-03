import { describe, expect, it } from 'vitest';
import {
  DATE_PRESETS,
  endOfDay,
  matchDatePreset,
  startOfDay,
  weekendRange,
} from '@/utils/datePresets';

const build = (key: string, now: Date) => {
  const preset = DATE_PRESETS.find((p) => p.key === key);
  if (!preset) throw new Error(`no preset ${key}`);
  return preset.build(now);
};

describe('startOfDay / endOfDay', () => {
  it('bracket the local calendar day', () => {
    const d = new Date(2026, 4, 17, 13, 45, 30, 500);
    expect(startOfDay(d).getHours()).toBe(0);
    expect(startOfDay(d).getMinutes()).toBe(0);
    expect(startOfDay(d).getDate()).toBe(17);
    expect(endOfDay(d).getHours()).toBe(23);
    expect(endOfDay(d).getMilliseconds()).toBe(999);
    expect(endOfDay(d).getDate()).toBe(17);
  });

  it('does not mutate the input', () => {
    const d = new Date(2026, 4, 17, 13, 45);
    const copy = new Date(d);
    startOfDay(d);
    endOfDay(d);
    expect(d.getTime()).toBe(copy.getTime());
  });
});

describe('weekendRange', () => {
  it('from a weekday, points at the coming Saturday and Sunday', () => {
    // Wed 13 May 2026
    const wed = new Date(2026, 4, 13, 10, 0);
    const range = weekendRange(wed);
    expect(range.start.getDay()).toBe(6);
    expect(range.start.getDate()).toBe(16);
    expect(range.end.getDay()).toBe(0);
    expect(range.end.getDate()).toBe(17);
  });

  it('on Saturday, covers the rest of that weekend', () => {
    const sat = new Date(2026, 4, 16, 18, 0);
    const range = weekendRange(sat);
    expect(range.start.getDate()).toBe(16);
    expect(range.start.getHours()).toBe(0);
    expect(range.end.getDate()).toBe(17);
  });

  it('on Sunday, covers only Sunday — it does not skip a week', () => {
    const sun = new Date(2026, 4, 17, 9, 0);
    const range = weekendRange(sun);
    expect(range.start.getDate()).toBe(17);
    expect(range.end.getDate()).toBe(17);
  });
});

describe('preset ranges', () => {
  const now = new Date(2026, 4, 13, 10, 0); // Wed

  it('any time means no filter', () => {
    expect(build('any', now)).toBeNull();
  });

  it('today and tomorrow are single days', () => {
    const today = build('today', now)!;
    expect(today.start.getDate()).toBe(13);
    expect(today.end.getDate()).toBe(13);
    const tomorrow = build('tomorrow', now)!;
    expect(tomorrow.start.getDate()).toBe(14);
    expect(tomorrow.end.getDate()).toBe(14);
  });

  it('next 7 / 30 days start today and run forward', () => {
    const week = build('week', now)!;
    expect(week.start.getDate()).toBe(13);
    expect(week.end.getDate()).toBe(20);
    const month = build('month', now)!;
    expect(month.end.getMonth()).toBe(5); // rolls into June
    expect(month.end.getDate()).toBe(12);
  });

  it('every preset range ends after it starts', () => {
    for (const preset of DATE_PRESETS) {
      const range = preset.build(now);
      if (range) expect(range.end.getTime()).toBeGreaterThan(range.start.getTime());
    }
  });
});

describe('matchDatePreset', () => {
  const now = new Date(2026, 4, 13, 10, 0);

  it('round-trips each preset back to its own key', () => {
    for (const preset of DATE_PRESETS) {
      expect(matchDatePreset(preset.build(now), now)).toBe(preset.key);
    }
  });

  it('reports any for a null range', () => {
    expect(matchDatePreset(null, now)).toBe('any');
  });

  it('reports custom for a range that matches no preset', () => {
    const range = { start: new Date(2026, 7, 1), end: new Date(2026, 7, 9) };
    expect(matchDatePreset(range, now)).toBe('custom');
  });

  it('tolerates small clock drift between building and matching', () => {
    const today = build('today', now)!;
    const drifted = {
      start: new Date(today.start.getTime() + 5_000),
      end: new Date(today.end.getTime() - 5_000),
    };
    expect(matchDatePreset(drifted, now)).toBe('today');
  });
});
