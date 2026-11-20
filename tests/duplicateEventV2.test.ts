import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Run it again" on duplicate_event v2 (20261118110000, applied): one call
 * carrying the date, title and an idempotency key; lineage read back through
 * `duplicated_from`.
 */

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };

const state = vi.hoisted(() => ({
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  rpcImpl: (() => ({ data: 'copy-1', error: null })) as (fn: string, args: Record<string, unknown>) => RpcResult,
  fromTable: [] as string[],
  selectArgs: [] as unknown[][],
  eqFilters: [] as [string, unknown][],
  countResult: { count: 2 as number | null, error: null as { message: string } | null },
}));

// hostTools imports these; they pull Expo native modules and aren't under test.
vi.mock('@/services/events', () => ({ eventsService: {} }));
vi.mock('@/services/social', () => ({ socialService: {} }));
vi.mock('@/services/supabase', () => {
  const supabase = {
    rpc(fn: string, args: Record<string, unknown>) {
      state.rpcCalls.push({ fn, args });
      return Promise.resolve(state.rpcImpl(fn, args));
    },
    from(table: string) {
      state.fromTable.push(table);
      const q = {
        select: (...args: unknown[]) => {
          state.selectArgs.push(args);
          return q;
        },
        eq: (col: string, val: unknown) => {
          state.eqFilters.push([col, val]);
          return Promise.resolve(state.countResult);
        },
      };
      return q;
    },
  };
  return { supabase, getSessionUser: async () => null };
});

const { hostToolsService, HostToolsUnavailableError } = await import('@/services/hostTools');
const { duplicateRefusalMessage } = await import('@/utils/duplicateDate');
const { playbookFactsFromHub } = await import('@/utils/eventPlaybook');

beforeEach(() => {
  state.rpcCalls = [];
  state.rpcImpl = () => ({ data: 'copy-1', error: null });
  state.fromTable = [];
  state.selectArgs = [];
  state.eqFilters = [];
  state.countResult = { count: 2, error: null };
});

const when = {
  start: new Date('2026-12-04T00:00:00.000Z'),
  end: new Date('2026-12-04T02:00:00.000Z'),
  title: 'Jazz night',
  requestKey: '7b0f3c1e-1111-4222-8333-444455556666',
};

describe('hostToolsService.duplicateEvent (v2: one call)', () => {
  it('sends the chosen start/end, the title and the request key in ONE rpc', async () => {
    const id = await hostToolsService.duplicateEvent('src-1', when);
    expect(id).toBe('copy-1');
    expect(state.rpcCalls).toEqual([
      {
        fn: 'duplicate_event',
        args: {
          p_event_id: 'src-1',
          p_start: '2026-12-04T00:00:00.000Z',
          p_end: '2026-12-04T02:00:00.000Z',
          p_title: 'Jazz night',
          p_client_request_id: '7b0f3c1e-1111-4222-8333-444455556666',
        },
      },
    ]);
  });

  it('a retry with the same key sends the same key (the server returns the existing draft)', async () => {
    await hostToolsService.duplicateEvent('src-1', when);
    await hostToolsService.duplicateEvent('src-1', when);
    expect(state.rpcCalls.map((c) => c.args.p_client_request_id)).toEqual([when.requestKey, when.requestKey]);
  });

  it('a missing function is "unavailable", not a crash', async () => {
    state.rpcImpl = () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    await expect(hostToolsService.duplicateEvent('src-1', when)).rejects.toBeInstanceOf(HostToolsUnavailableError);
  });

  it('a server refusal is rethrown as-is for the caller to word', async () => {
    state.rpcImpl = () => ({
      data: null,
      error: { code: 'P0001', message: 'invalid_duplicate: the new start must be in the future' },
    });
    await expect(hostToolsService.duplicateEvent('src-1', when)).rejects.toMatchObject({
      message: expect.stringContaining('new start must be in the future'),
    });
  });

  it('no id back is an error, never a navigation to /edit-event/undefined', async () => {
    state.rpcImpl = () => ({ data: [], error: null });
    await expect(hostToolsService.duplicateEvent('src-1', when)).rejects.toThrow('No copy was returned');
  });
});

describe('hostToolsService.countCopies (duplicated_from lineage)', () => {
  it('is a head count on events.duplicated_from', async () => {
    expect(await hostToolsService.countCopies('src-1')).toBe(2);
    expect(state.fromTable).toEqual(['events']);
    expect(state.selectArgs).toEqual([['id', { count: 'exact', head: true }]]);
    expect(state.eqFilters).toEqual([['duplicated_from', 'src-1']]);
  });

  it('a null count reads as zero; an error is thrown', async () => {
    state.countResult = { count: null, error: null };
    expect(await hostToolsService.countCopies('src-1')).toBe(0);
    state.countResult = { count: null, error: { message: 'boom' } };
    await expect(hostToolsService.countCopies('src-1')).rejects.toMatchObject({ message: 'boom' });
  });
});

describe('duplicateRefusalMessage (v2 refusals in the host’s words)', () => {
  it.each([
    ['invalid_duplicate: the new start must be in the future', 'Pick a start time in the future.'],
    ['invalid_duplicate: the new end must be after the new start', 'The end has to be after the start.'],
    ['not_allowed: account suspended', 'Your account is suspended, so you can’t create events.'],
    ['not_allowed: only the event host can duplicate', 'Only the host can run this event again.'],
    ['fetch failed', 'Could not duplicate. Please try again.'],
  ])('%s', (message, expected) => {
    expect(duplicateRefusalMessage({ message })).toBe(expected);
  });

  it('tolerates a non-error', () => {
    expect(duplicateRefusalMessage(null)).toBe('Could not duplicate. Please try again.');
  });
});

describe('playbookFactsFromHub — ranAgain from duplicated_from', () => {
  const event = {
    start_datetime: '2026-11-01T18:00:00.000Z',
    end_datetime: '2026-11-01T20:00:00.000Z',
  } as never;

  it('a copy on the server marks "run it again" done', () => {
    expect(playbookFactsFromHub({ event, copies: 1 }).ranAgain).toBe(true);
  });

  it('zero or unknown says nothing, so the device-local flag still applies', () => {
    expect('ranAgain' in playbookFactsFromHub({ event, copies: 0 })).toBe(false);
    expect('ranAgain' in playbookFactsFromHub({ event, copies: null })).toBe(false);
    expect('ranAgain' in playbookFactsFromHub({ event })).toBe(false);
  });
});
