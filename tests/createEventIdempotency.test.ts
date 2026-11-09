import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Event create idempotency (docs/ISSUES.md "Publishing twice creates a
 * duplicate"): the request key is sent to the server when it knows it, and a
 * retry after a lost response looks for the event the first attempt created.
 */

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };

const state = vi.hoisted(() => ({
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  rpcImpl: (() => ({ data: 'evt-1', error: null })) as (
    fn: string,
    args: Record<string, unknown>
  ) => RpcResult | Promise<RpcResult>,
  lookupRows: [] as { id: string }[],
  lookupFilters: [] as [string, unknown][],
  lookupCalls: 0,
  insertError: null as { code?: string; message?: string } | null,
  released: [] as string[][],
}));

vi.mock('expo-file-system/legacy', () => ({}));
vi.mock('expo-image-manipulator', () => ({}));
vi.mock('base64-arraybuffer', () => ({ decode: () => new ArrayBuffer(0) }));
vi.mock('@/services/storageCleanup', () => ({
  imageCleanupMayRun: () => false,
  releaseEventImages: (urls: string[]) => {
    state.released.push(urls);
  },
}));
vi.mock('@/services/supabase', () => {
  const lookup = () => {
    const q = {
      select: () => q,
      eq: (col: string, val: unknown) => {
        state.lookupFilters.push([col, val]);
        return q;
      },
      gte: () => q,
      order: () => q,
      limit: async () => {
        state.lookupCalls += 1;
        return { data: state.lookupRows, error: null };
      },
      update: () => ({ eq: async () => ({ error: null }) }),
      insert: async () => ({ error: state.insertError }),
    };
    return q;
  };
  const supabase = {
    rpc(fn: string, args: Record<string, unknown>) {
      state.rpcCalls.push({ fn, args });
      return Promise.resolve(state.rpcImpl(fn, args));
    },
    from: () => lookup(),
  };
  return { supabase, getSessionUser: async () => null };
});

const { eventsService } = await import('@/services/events');

const input = (requestKey: string) => ({
  requestKey,
  businessId: 'biz-1',
  title: '  Jazz night ',
  description: '',
  categoryId: 'cat-1',
  startDatetime: '2026-12-01T20:00:00.000Z',
  endDatetime: '2026-12-01T23:00:00.000Z',
  lat: 1,
  lng: 2,
  address: 'Somewhere',
  timezone: 'Europe/Lisbon',
});

const networkError = () => Object.assign(new TypeError('Failed to fetch'), { code: '' });

beforeEach(() => {
  state.rpcCalls = [];
  state.lookupRows = [];
  state.lookupFilters = [];
  state.lookupCalls = 0;
  state.insertError = null;
  state.released = [];
  state.rpcImpl = () => ({ data: 'evt-1', error: null });
});

describe('createEvent idempotency', () => {
  it('sends the request key to the create RPC', async () => {
    const res = await eventsService.createEvent(input('key-a'));
    expect(res.id).toBe('evt-1');
    expect(state.rpcCalls[0].args.p_client_request_id).toBe('key-a');
  });

  it('a retry after a lost response returns the event the first attempt created', async () => {
    // postgrest-js reports a dropped connection as an error result, not a throw.
    state.rpcImpl = () => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' } });
    await expect(eventsService.createEvent(input('key-b'))).rejects.toMatchObject({ code: '' });
    expect(eventsService.hasUncertainCreate('key-b')).toBe(true);

    // The server did commit it; the retry finds it and does not create again.
    state.rpcImpl = () => ({ data: 'evt-dup', error: null });
    state.lookupRows = [{ id: 'evt-original' }];
    const callsBefore = state.rpcCalls.length;
    const res = await eventsService.createEvent(input('key-b'));
    expect(res).toMatchObject({ id: 'evt-original', recovered: true });
    expect(state.rpcCalls.length).toBe(callsBefore);
    expect(state.lookupFilters).toContainEqual(['title', 'Jazz night']);
    expect(state.lookupFilters).toContainEqual(['start_datetime', '2026-12-01T20:00:00.000Z']);
    expect(eventsService.hasUncertainCreate('key-b')).toBe(false);
  });

  it('the recovery lookup only matches the requested publish state', async () => {
    state.rpcImpl = () => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' } });
    await expect(eventsService.createEvent({ ...input('key-g'), publishState: 'draft' })).rejects.toBeTruthy();
    state.rpcImpl = () => ({ data: 'evt-draft', error: null });
    await eventsService.createEvent({ ...input('key-g'), publishState: 'draft' });
    expect(state.lookupFilters).toContainEqual(['publish_state', 'draft']);
    state.lookupFilters = [];
    await expect(eventsService.createEvent(input('key-h'))).resolves.toBeTruthy();
    expect(state.lookupFilters).toEqual([]); // nothing uncertain for this key
  });

  it('sends capacity, time zone and publish state in the single create call', async () => {
    await eventsService.createEvent({ ...input('key-i'), maxAttendees: 40, publishState: 'draft' });
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0].args).toMatchObject({
      p_max_attendees: 40,
      p_timezone: 'Europe/Lisbon',
      p_publish_state: 'draft',
    });
  });

  it('a retry creates the event when the first attempt never reached the server', async () => {
    state.rpcImpl = () => {
      throw networkError();
    };
    await expect(eventsService.createEvent(input('key-c'))).rejects.toThrow();
    state.rpcImpl = () => ({ data: 'evt-new', error: null });
    const res = await eventsService.createEvent(input('key-c'));
    expect(res.id).toBe('evt-new');
    expect(res.recovered).toBeUndefined();
    expect(state.lookupCalls).toBe(1);
  });

  it('a server refusal is not treated as uncertain (no lookup on retry)', async () => {
    state.rpcImpl = () => ({ data: null, error: { code: 'P0001', message: 'Event creation limit reached' } });
    await expect(eventsService.createEvent(input('key-d'))).rejects.toMatchObject({ code: 'P0001' });
    expect(eventsService.hasUncertainCreate('key-d')).toBe(false);
  });

  it('falls back to the pre-migration shape when the server does not know the key', async () => {
    state.rpcImpl = (_fn, args) =>
      'p_client_request_id' in args
        ? { data: null, error: { code: 'PGRST202', message: 'no function' } }
        : { data: 'evt-plain', error: null };
    const res = await eventsService.createEvent(input('key-e'));
    expect(res.id).toBe('evt-plain');
    // Remembered for the session: the next create skips the doomed call.
    state.rpcCalls = [];
    await eventsService.createEvent(input('key-f'));
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0].args).not.toHaveProperty('p_client_request_id');
  });
});

describe('addEventPhoto after a lost response', () => {
  const lost = { code: '', message: 'TypeError: Failed to fetch' };

  it('treats a committed insert as success (no duplicate on re-add)', async () => {
    state.insertError = lost;
    state.lookupRows = [{ id: 'photo-1' }];
    await expect(eventsService.addEventPhoto('evt-1', 'https://x/a.jpg', 0)).resolves.toBeUndefined();
    expect(state.lookupFilters).toContainEqual(['image_url', 'https://x/a.jpg']);
    expect(state.released).toEqual([]);
  });

  it('reports a real failure and frees the uploaded file', async () => {
    state.insertError = lost;
    state.lookupRows = [];
    await expect(eventsService.addEventPhoto('evt-1', 'https://x/b.jpg', 0)).rejects.toBe(lost);
    expect(state.released).toEqual([['https://x/b.jpg']]);
  });

  it('a server refusal skips the lookup', async () => {
    state.insertError = { code: '42501', message: 'permission denied' };
    await expect(eventsService.addEventPhoto('evt-1', 'https://x/c.jpg', 0)).rejects.toMatchObject({ code: '42501' });
    expect(state.lookupCalls).toBe(0);
    expect(state.released).toEqual([['https://x/c.jpg']]);
  });
});
