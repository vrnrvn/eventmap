import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Venue page "Upcoming" stat (Roadmap B5,
 * docs/HOST_DASHBOARD_AND_RECURRENCE_REVIEW_2026-11-16.md).
 *
 * The stat must count the same events the list under it shows:
 * published, active-or-postponed, and not ended — including recurring series
 * whose recurrence end date has passed, which the server filter cannot judge.
 */

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  /** Filters applied, per query, in call order. */
  queries: [] as { head: boolean; filters: [string, unknown][] }[],
  count: 0,
  countError: null as unknown,
  seriesRows: [] as Row[],
  seriesError: null as unknown,
}));

vi.mock('expo-file-system/legacy', () => ({}));
vi.mock('expo-image-manipulator', () => ({}));
vi.mock('base64-arraybuffer', () => ({ decode: () => new ArrayBuffer(0) }));
vi.mock('@/services/storageCleanup', () => ({
  imageCleanupMayRun: () => false,
  releaseEventImages: () => {},
}));
vi.mock('@/services/supabase', () => {
  const makeQuery = (head: boolean) => {
    const record = { head, filters: [] as [string, unknown][] };
    state.queries.push(record);
    const q: Record<string, unknown> = {};
    const chain = (name: string) => (col: string, val: unknown) => {
      record.filters.push([`${name}:${col}`, val]);
      return q;
    };
    q.eq = chain('eq');
    q.in = chain('in');
    q.or = (expr: string) => {
      record.filters.push(['or', expr]);
      return q;
    };
    q.limit = (n: number) => {
      record.filters.push(['limit', n]);
      return q;
    };
    // Head queries resolve to a count; row queries to the series rows.
    q.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(
        head
          ? { count: state.count, error: state.countError }
          : { data: state.seriesRows, error: state.seriesError }
      ).then(resolve);
    return q;
  };
  return {
    supabase: {
      from: () => ({
        select: (_cols: string, opts?: { head?: boolean }) => makeQuery(!!opts?.head),
      }),
    },
    getSessionUser: async () => null,
  };
});

const { eventsService } = await import('@/services/events');

const series = (endDate: string | null, timezone: string | null = 'UTC'): Row => ({
  start_datetime: '2026-01-05T19:00:00Z',
  end_datetime: '2026-01-05T21:00:00Z',
  is_recurring: true,
  recurrence_pattern: { frequency: 'weekly', interval: 1, ...(endDate ? { endDate } : {}) },
  timezone,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-16T12:00:00Z'));
  state.queries.length = 0;
  state.count = 0;
  state.countError = null;
  state.seriesRows = [];
  state.seriesError = null;
});

describe("getBusinessEventsCount scope 'upcoming'", () => {
  it('counts published active/postponed events and excludes drafts', async () => {
    state.count = 5;
    await eventsService.getBusinessEventsCount('biz-1', { scope: 'upcoming' });

    const filters = state.queries[0].filters;
    expect(filters).toContainEqual(['eq:publish_state', 'published']);
    expect(filters).toContainEqual(['in:status', ['active', 'postponed']]);
    expect(filters).toContainEqual(['eq:business_id', 'biz-1']);
  });

  it('subtracts recurring series whose end date has passed', async () => {
    state.count = 5;
    state.seriesRows = [series('2026-03-01'), series('2026-10-31'), series(null), series('2027-06-01')];

    // Two of the four series finished before 16 Nov 2026.
    await expect(eventsService.getBusinessEventsCount('biz-1', { scope: 'upcoming' })).resolves.toBe(3);
  });

  it('judges the end date on the event zone, not the device', async () => {
    state.count = 1;
    // At 12:00 UTC it is already 17 Nov in Kiritimati (UTC+14), so a series
    // ending 16 Nov is over there while the same date is still live in UTC.
    state.seriesRows = [series('2026-11-16', 'Pacific/Kiritimati')];
    await expect(eventsService.getBusinessEventsCount('biz-1', { scope: 'upcoming' })).resolves.toBe(0);

    state.queries.length = 0;
    state.count = 1;
    state.seriesRows = [series('2026-11-16', 'UTC')];
    await expect(eventsService.getBusinessEventsCount('biz-1', { scope: 'upcoming' })).resolves.toBe(1);
  });

  it('never returns a negative count', async () => {
    state.count = 1;
    state.seriesRows = [series('2026-01-01'), series('2026-02-01')];
    await expect(eventsService.getBusinessEventsCount('biz-1', { scope: 'upcoming' })).resolves.toBe(0);
  });

  it('skips the second query entirely when nothing is upcoming', async () => {
    state.count = 0;
    await expect(eventsService.getBusinessEventsCount('biz-1', { scope: 'upcoming' })).resolves.toBe(0);
    expect(state.queries).toHaveLength(1);
  });

  it('keeps the uncorrected count when a venue has more series than the scan limit', async () => {
    state.count = 500;
    state.seriesRows = Array.from({ length: 201 }, () => series('2026-01-01'));
    await expect(eventsService.getBusinessEventsCount('biz-1', { scope: 'upcoming' })).resolves.toBe(500);
  });

  it('keeps the count when the correction query fails', async () => {
    state.count = 7;
    state.seriesError = { message: 'boom' };
    await expect(eventsService.getBusinessEventsCount('biz-1', { scope: 'upcoming' })).resolves.toBe(7);
  });

  it('still throws when the count itself fails', async () => {
    state.countError = { message: 'nope' };
    await expect(eventsService.getBusinessEventsCount('biz-1', { scope: 'upcoming' })).rejects.toBeTruthy();
  });
});

describe("getBusinessEventsCount scope 'all'", () => {
  it('is unchanged: one head count, no publish or status filter', async () => {
    state.count = 42;
    await expect(eventsService.getBusinessEventsCount('biz-1')).resolves.toBe(42);
    expect(state.queries).toHaveLength(1);
    expect(state.queries[0].filters).toEqual([['eq:business_id', 'biz-1']]);
  });
});
