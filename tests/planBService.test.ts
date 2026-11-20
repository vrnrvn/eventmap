import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RankedEvent } from '@/types/database';

/**
 * services/planB: one ranked request around the anchor (the date window
 * opened early for running events), exceptions only when a series is among
 * the rows, widen once when sparse, and the live endpoint for "late".
 */

const H = 60 * 60 * 1000;
const NOW = new Date('2026-12-05T15:00:00.000Z');
const iso = (h: number) => new Date(NOW.getTime() + h * H).toISOString();

const state = vi.hoisted(() => ({
  rankedCalls: [] as { lat: number; lng: number; filters: Record<string, unknown> }[],
  rankedRows: [] as unknown[],
  rankedByRadius: null as null | ((r: number) => unknown[]),
  exceptionCalls: [] as string[][],
  liveCalls: [] as { lat: number; lng: number; opts: Record<string, unknown> }[],
  liveRows: [] as unknown[],
}));

vi.mock('@/services/events', () => ({
  eventsService: {
    getRankedEventsPage: async (lat: number, lng: number, filters: Record<string, unknown>) => {
      state.rankedCalls.push({ lat, lng, filters });
      const rows = state.rankedByRadius ? state.rankedByRadius(filters.radiusKm as number) : state.rankedRows;
      return { items: rows, hasMore: false };
    },
  },
}));
vi.mock('@/services/occurrences', () => ({
  occurrencesService: {
    listExceptionsForEvents: async (ids: string[]) => {
      state.exceptionCalls.push(ids);
      return [];
    },
  },
}));
vi.mock('@/services/liveEvents', () => ({
  liveEventsService: {
    getLiveEvents: async (lat: number, lng: number, opts: Record<string, unknown>) => {
      state.liveCalls.push({ lat, lng, opts });
      return { items: state.liveRows, source: 'rpc' };
    },
  },
}));

const { planBService } = await import('@/services/planB');
const { planBAnchor } = await import('@/utils/planB');

const original = { id: 'orig', business_id: 'b0', category_id: 'cat-music', lat: 40.7, lng: -74 };
const cancelled = () =>
  planBAnchor({ reason: 'cancelled', event: original, session: { start: new Date(iso(5)), end: new Date(iso(8)) }, now: NOW })!;

let n = 0;
const row = (over: Partial<RankedEvent> = {}) =>
  ({
    id: `r${++n}`,
    business_id: 'b1',
    category_id: 'cat-food',
    start_datetime: iso(5),
    end_datetime: iso(7),
    is_recurring: false,
    recurrence_pattern: null,
    max_attendees: null,
    distance_km: 1,
    rsvp_count: 0,
    user_rsvp: null,
    title: 't',
    ...over,
  }) as RankedEvent;

beforeEach(() => {
  state.rankedCalls = [];
  state.rankedRows = [];
  state.rankedByRadius = null;
  state.exceptionCalls = [];
  state.liveCalls = [];
  state.liveRows = [];
});

describe('planBService.getPicks', () => {
  it('one ranked request around the venue, 10 km, window opened 6 h early for running events', async () => {
    state.rankedRows = [row(), row(), row()];
    const r = await planBService.getPicks(cancelled(), { now: NOW, preferredCategoryIds: ['cat-food'] });
    expect(state.rankedCalls).toHaveLength(1);
    const c = state.rankedCalls[0];
    expect([c.lat, c.lng]).toEqual([40.7, -74]);
    expect(c.filters.radiusKm).toBe(10);
    expect((c.filters.startDate as Date).toISOString()).toBe(iso(5 - 2 - 6));
    expect((c.filters.endDate as Date).toISOString()).toBe(iso(8 + 1));
    expect(c.filters.preferredCategories).toEqual(['cat-food']);
    expect(r).toMatchObject({ widened: false });
    expect(r.picks).toHaveLength(3);
  });

  it('exceptions are asked only for the series among the rows', async () => {
    state.rankedRows = [row(), row(), row()];
    await planBService.getPicks(cancelled(), { now: NOW });
    expect(state.exceptionCalls).toEqual([]);
    const s = row({ is_recurring: true, recurrence_pattern: { frequency: 'weekly', interval: 1 } as never });
    state.rankedRows = [s, row(), row(), row()];
    await planBService.getPicks(cancelled(), { now: NOW });
    expect(state.exceptionCalls).toEqual([[s.id]]);
  });

  it('sparse at 10 km: one retry at 25 km, kept only if it adds picks', async () => {
    const near = row({ distance_km: 2 });
    const farther = row({ distance_km: 18 });
    state.rankedByRadius = (r) => (r === 10 ? [near] : [near, farther]);
    const r = await planBService.getPicks(cancelled(), { now: NOW });
    expect(state.rankedCalls.map((c) => c.filters.radiusKm)).toEqual([10, 25]);
    expect(r.widened).toBe(true);
    expect(r.picks.map((p) => p.event.id).sort()).toEqual([near.id, farther.id].sort());

    state.rankedCalls = [];
    state.rankedByRadius = () => [near];
    const same = await planBService.getPicks(cancelled(), { now: NOW });
    expect(state.rankedCalls).toHaveLength(2);
    expect(same.widened).toBe(false);
  });

  it('late: the live endpoint, no ranked call, sessions from the live rows', async () => {
    const late = planBAnchor({ reason: 'late', event: original, session: { start: new Date(iso(0.25)), end: new Date(iso(3)) }, now: NOW })!;
    state.liveRows = [
      { ...row(), occ_start: iso(-1), occ_end: iso(1), live_status: 'live' },
      { ...row(), occ_start: iso(0.5), occ_end: iso(2), live_status: 'soon' },
      { ...row(), occ_start: iso(-1), occ_end: iso(0.2), live_status: 'live' }, // 12 min left: out
    ];
    const r = await planBService.getPicks(late, { now: NOW });
    expect(state.rankedCalls).toEqual([]);
    expect(state.liveCalls[0]).toMatchObject({ lat: 40.7, lng: -74, opts: { radiusKm: 10 } });
    expect(r.picks).toHaveLength(2);
  });
});
