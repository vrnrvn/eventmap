/**
 * Date-range presets shared by Discover's Filters sheet, its header chip and
 * the search overlay, so all three agree on what "This weekend" means and a
 * range picked in one place highlights correctly in the others.
 *
 * Pure module — no React Native imports, unit-tested under node.
 */

export type DateRange = { start: Date; end: Date };

export type DatePresetKey = 'any' | 'today' | 'tomorrow' | 'weekend' | 'week' | 'month' | 'custom';

export function startOfDay(d: Date): Date {
  const next = new Date(d);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function endOfDay(d: Date): Date {
  const next = new Date(d);
  next.setHours(23, 59, 59, 999);
  return next;
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * Upcoming Saturday–Sunday. On Saturday or Sunday it means "the rest of this
 * weekend" rather than skipping to the next one.
 */
export function weekendRange(now: Date): DateRange {
  const day = now.getDay(); // 0 Sun … 6 Sat
  if (day === 6) return { start: startOfDay(now), end: endOfDay(addDays(now, 1)) };
  if (day === 0) return { start: startOfDay(now), end: endOfDay(now) };
  const saturday = addDays(now, 6 - day);
  return { start: startOfDay(saturday), end: endOfDay(addDays(saturday, 1)) };
}

export type DatePreset = {
  key: Exclude<DatePresetKey, 'custom'>;
  label: string;
  /** null = no date filter. `now` is injectable for tests. */
  build: (now?: Date) => DateRange | null;
};

export const DATE_PRESETS: DatePreset[] = [
  { key: 'any', label: 'Any time', build: () => null },
  {
    key: 'today',
    label: 'Today',
    build: (now = new Date()) => ({ start: startOfDay(now), end: endOfDay(now) }),
  },
  {
    key: 'tomorrow',
    label: 'Tomorrow',
    build: (now = new Date()) => {
      const tomorrow = addDays(now, 1);
      return { start: startOfDay(tomorrow), end: endOfDay(tomorrow) };
    },
  },
  {
    key: 'weekend',
    label: 'This weekend',
    build: (now = new Date()) => weekendRange(now),
  },
  {
    key: 'week',
    label: 'Next 7 days',
    build: (now = new Date()) => ({ start: startOfDay(now), end: endOfDay(addDays(now, 7)) }),
  },
  {
    key: 'month',
    label: 'Next 30 days',
    build: (now = new Date()) => ({ start: startOfDay(now), end: endOfDay(addDays(now, 30)) }),
  },
];

/** Tolerance when matching a stored range back to a preset (clock drift between renders). */
const MATCH_TOLERANCE_MS = 60_000;

/**
 * Which preset a range corresponds to. Ranges that match none (e.g. a custom
 * range from a future date picker) report 'custom' so the UI can show them
 * without highlighting the wrong chip.
 */
export function matchDatePreset(range: DateRange | null, now: Date = new Date()): DatePresetKey {
  if (!range) return 'any';
  const found = DATE_PRESETS.find((preset) => {
    const candidate = preset.build(now);
    return (
      candidate != null &&
      Math.abs(candidate.start.getTime() - range.start.getTime()) < MATCH_TOLERANCE_MS &&
      Math.abs(candidate.end.getTime() - range.end.getTime()) < MATCH_TOLERANCE_MS
    );
  });
  return found ? found.key : 'custom';
}
