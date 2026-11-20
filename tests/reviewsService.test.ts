import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * D2 step 2 (supabase/prepared/2026-11-19_series_reviews/README.md):
 * reviews are written through submit_review(), and venue-review reads and
 * deletes must stay correct once a person can also hold series reviews under
 * the same business_id — without referencing `event_id` in a query, because
 * the column does not exist until step 3.
 */

type Call = { kind: string; table?: string; fn?: string; args?: unknown; filters: [string, unknown][]; op?: string };

const state = vi.hoisted(() => ({
  calls: [] as Call[],
  rpcError: null as unknown,
  rows: [] as Record<string, unknown>[],
  user: { id: 'u1' } as { id: string } | null,
  rpcData: {} as Record<string, unknown>,
}));

vi.mock('@/services/supabase', () => {
  const from = (table: string) => {
    const call: Call = { kind: 'from', table, filters: [] };
    state.calls.push(call);
    const q: Record<string, unknown> = {};
    const result = () => Promise.resolve({ data: state.rows, error: null });
    q.select = (cols: string) => ((call.filters.push(['select', cols]), q));
    q.eq = (c: string, v: unknown) => ((call.filters.push([`eq:${c}`, v]), q));
    q.is = (c: string, v: unknown) => ((call.filters.push([`is:${c}`, v]), q));
    q.order = () => q;
    q.limit = () => q;
    q.delete = () => ((call.op = 'delete'), q);
    q.upsert = (row: unknown, opts: unknown) => {
      call.op = 'upsert';
      call.args = { row, opts };
      return Promise.resolve({ error: null });
    };
    q.maybeSingle = () => Promise.reject(new Error('maybeSingle must not be used'));
    q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => result().then(res, rej);
    return q;
  };
  const client = {
    from,
    // Like supabase-js, needs its receiver: a detached call (the D2 step-4
    // bug caught in the browser suite) throws here too.
    rpc(this: unknown, fn: string, args: unknown) {
      if (this !== client) throw new TypeError('rpc called without its client');
      state.calls.push({ kind: 'rpc', fn, args, filters: [] });
      const data = state.rpcData[fn] ?? (state.rpcError ? null : 'rid');
      return Promise.resolve({ data: state.rpcError ? null : data, error: state.rpcError });
    },
  };
  return {
    supabase: client,
    getSessionUser: async () => state.user,
  };
});

import { reviewsService } from '@/services/reviews';

beforeEach(() => {
  state.calls = [];
  state.rpcError = null;
  state.rows = [];
  state.user = { id: 'u1' };
  state.rpcData = {};
});

describe('createOrUpdateReview', () => {
  it('submits through submit_review and never upserts', async () => {
    await reviewsService.createOrUpdateReview('b1', 4, 'Great');
    expect(state.calls).toEqual([
      { kind: 'rpc', fn: 'submit_review', args: { p_business_id: 'b1', p_rating: 4, p_text: 'Great' }, filters: [] },
    ]);
  });

  it('sends no text for an empty review', async () => {
    await reviewsService.createOrUpdateReview('b1', 5, '');
    expect((state.calls[0].args as Record<string, unknown>).p_text).toBeUndefined();
  });

  it('surfaces an RLS refusal unchanged, without falling back', async () => {
    state.rpcError = { code: '42501', message: 'new row violates row-level security policy' };
    await expect(reviewsService.createOrUpdateReview('b1', 3)).rejects.toMatchObject({ code: '42501' });
    expect(state.calls.some((c) => c.op === 'upsert')).toBe(false);
  });

  // Last in this block: the missing-function registry is session-scoped.
  it('falls back to the upsert where the function is missing, then stops probing', async () => {
    state.rpcError = { code: 'PGRST202', message: 'not found' };
    await reviewsService.createOrUpdateReview('b1', 2);
    expect(state.calls.map((c) => c.fn ?? c.op)).toEqual(['submit_review', 'upsert']);
    state.calls = [];
    await reviewsService.createOrUpdateReview('b1', 2);
    expect(state.calls.map((c) => c.fn ?? c.op)).toEqual(['upsert']);
  });
});

describe('venue review reads and deletes (D2-safe)', () => {
  const venue = { id: 'r-venue', user_id: 'u1', business_id: 'b1', event_id: null, rating: 4 };
  const series = { id: 'r-series', user_id: 'u1', business_id: 'b1', event_id: 'e1', rating: 5 };

  it('getUserReview returns the venue review when a series review shares the venue', async () => {
    state.rows = [series, venue];
    expect((await reviewsService.getUserReview('b1'))?.id).toBe('r-venue');
  });

  it('getUserReview treats a missing event_id column as a venue review', async () => {
    const { event_id: _omit, ...preD2 } = venue;
    state.rows = [preD2];
    expect((await reviewsService.getUserReview('b1'))?.id).toBe('r-venue');
  });

  it('getUserReview is null when only a series review exists', async () => {
    state.rows = [series];
    expect(await reviewsService.getUserReview('b1')).toBeNull();
  });

  it('never filters on event_id in a query (the column may not exist)', async () => {
    state.rows = [venue];
    await reviewsService.getUserReview('b1');
    await reviewsService.deleteReview('b1');
    const cols = state.calls.flatMap((c) => c.filters.map(([k]) => k));
    expect(cols.some((k) => k.includes('event_id'))).toBe(false);
  });

  it('deleteReview deletes the venue review by id only', async () => {
    state.rows = [series, venue];
    await reviewsService.deleteReview('b1');
    const del = state.calls.find((c) => c.op === 'delete');
    expect(del?.filters).toEqual([
      ['eq:id', 'r-venue'],
      ['eq:user_id', 'u1'],
    ]);
  });

  it('deleteReview does nothing when there is no venue review', async () => {
    state.rows = [series];
    await reviewsService.deleteReview('b1');
    expect(state.calls.some((c) => c.op === 'delete')).toBe(false);
  });
});

describe('series reviews (D2 step 4)', () => {
  it('reads the series summary as the capability probe', async () => {
    state.rpcData = { get_event_review_summary: [{ average: '4.5', review_count: '2' }] };
    await expect(reviewsService.getSeriesReviewSummary('e1')).resolves.toEqual({ average: 4.5, count: 2 });
    expect(state.calls[0]).toMatchObject({ fn: 'get_event_review_summary', args: { p_event_id: 'e1' } });
  });

  it('submits a series review with p_event_id', async () => {
    await reviewsService.submitSeriesReview('b1', 'e1', 4, 'Good');
    expect(state.calls).toEqual([
      { kind: 'rpc', fn: 'submit_review', args: { p_business_id: 'b1', p_rating: 4, p_text: 'Good', p_event_id: 'e1' }, filters: [] },
    ]);
  });

  it('asks user_can_review_event for eligibility; unknown on error', async () => {
    state.rpcData = { user_can_review_event: true };
    await expect(reviewsService.canReviewSeries('e1')).resolves.toBe(true);
    state.rpcError = { code: '500' };
    await expect(reviewsService.canReviewSeries('e1')).resolves.toBeNull();
  });

  it('lists a series by event_id', async () => {
    state.rows = [];
    await reviewsService.getReviewsForSeries('e1');
    expect(state.calls[0].filters).toContainEqual(['eq:event_id', 'e1']);
  });

  // Last: the missing-function registry is session-scoped.
  it('reports "unsupported" (null) where the migration is absent, then stops probing', async () => {
    state.rpcError = { code: 'PGRST202' };
    await expect(reviewsService.getSeriesReviewSummary('e1')).resolves.toBeNull();
    state.calls = [];
    await expect(reviewsService.getSeriesReviewSummary('e2')).resolves.toBeNull();
    expect(state.calls).toEqual([]);
  });
});
