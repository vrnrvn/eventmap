import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * services/liveEvents on the applied `get_live_events` (20261120100000): the
 * typed call's argument shape, and the fallback kept for a backend that is
 * behind the migration set (display-only, so allowed by the client/schema
 * policy in docs/ISSUES.md).
 */

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };

const state = vi.hoisted(() => ({
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  rpcImpl: (() => ({ data: [], error: null })) as (fn: string, args: Record<string, unknown>) => RpcResult,
  rankedCalls: 0,
}));

vi.mock('@/services/supabase', () => ({
  supabase: {
    rpc(fn: string, args: Record<string, unknown>) {
      state.rpcCalls.push({ fn, args });
      return Promise.resolve(state.rpcImpl(fn, args));
    },
  },
}));
vi.mock('@/services/events', () => ({
  eventsService: {
    getRankedEventsPage: async () => {
      state.rankedCalls += 1;
      return { items: [] };
    },
  },
}));
vi.mock('@/services/occurrences', () => ({ occurrencesService: { listExceptionsForEvents: async () => [] } }));

// The "known missing" memo is module state: a fresh module per test.
async function load() {
  vi.resetModules();
  return (await import('@/services/liveEvents')).liveEventsService;
}

beforeEach(() => {
  state.rpcCalls = [];
  state.rpcImpl = () => ({ data: [], error: null });
  state.rankedCalls = 0;
});

describe('liveEventsService.getLiveEvents (typed get_live_events)', () => {
  it('sends the window, limit and seed; preferences when given', async () => {
    const svc = await load();
    await svc.getLiveEvents(40.7, -74, { radiusKm: 10, limit: 12, preferredCategories: ['c1', 'c2'], seed: 'visit-1' });
    expect(state.rpcCalls).toEqual([
      {
        fn: 'get_live_events',
        args: {
          user_lat: 40.7,
          user_lng: -74,
          radius_km: 10,
          p_limit: 12,
          p_soon_minutes: 60,
          p_preferred_category_ids: ['c1', 'c2'],
          p_seed: 'visit-1',
        },
      },
    ]);
  });

  it('no preferences / no seed: the keys are absent on the wire, so the SQL defaults (NULL) apply', async () => {
    const svc = await load();
    await svc.getLiveEvents(40.7, -74, { preferredCategories: [] });
    // What supabase-js puts in the request body: JSON drops undefined keys.
    const wire = JSON.parse(JSON.stringify(state.rpcCalls[0].args));
    expect(wire).toEqual({ user_lat: 40.7, user_lng: -74, radius_km: 25, p_limit: 30, p_soon_minutes: 60 });
  });

  it('the RPC answer is used as-is: one request, no fallback', async () => {
    state.rpcImpl = () => ({ data: [{ id: 'e1', live_status: 'live' }], error: null });
    const svc = await load();
    const r = await svc.getLiveEvents(40.7, -74);
    expect(r.source).toBe('rpc');
    expect(r.items).toHaveLength(1);
    expect(state.rankedCalls).toBe(0);
  });

  it('a missing function falls back once, then stops asking for the session', async () => {
    state.rpcImpl = () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    const svc = await load();
    expect((await svc.getLiveEvents(40.7, -74)).source).toBe('fallback');
    expect((await svc.getLiveEvents(40.7, -74)).source).toBe('fallback');
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rankedCalls).toBe(2);
  });

  it('any other error is thrown, not hidden behind the fallback', async () => {
    state.rpcImpl = () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
    const svc = await load();
    await expect(svc.getLiveEvents(40.7, -74)).rejects.toMatchObject({ code: '57014' });
    expect(state.rankedCalls).toBe(0);
  });
});
