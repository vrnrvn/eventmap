import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  OUTBOX_MAX_AGE_MS,
  buildOutbox,
  mergePending,
  messagesToAutoRetry,
  outboxKey,
  outboxPrefix,
  parseOutbox,
} from '../utils/chatOutbox';
import { overlayNotificationWrites } from '../utils/pendingWrites';

/** docs/OFFLINE_PLAN.md step 7: chat outbox, safe re-send, notification backfill overlay. */

const NOW = Date.parse('2026-11-05T12:00:00Z');
const msg = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  body: `body ${id}`,
  created_at: new Date(NOW - 60_000).toISOString(),
  ...over,
});

describe('chat outbox', () => {
  it('keeps unsent messages and the draft, nothing else', () => {
    const out = buildOutbox(
      [msg('a'), msg('b', { localStatus: 'failed', autoRetry: true }), msg('c', { localStatus: 'sending' })],
      'half written',
      [{ id: 'u2', name: 'Sam' }],
      NOW
    );
    expect(out?.pending.map((m) => m.id)).toEqual(['b', 'c']);
    expect(out?.draft).toBe('half written');
    expect(out?.draftMentions).toEqual([{ id: 'u2', name: 'Sam' }]);
  });

  it('is null when there is nothing to keep (so the stored copy is removed)', () => {
    expect(buildOutbox([msg('a')], '   ', [{ id: 'u2', name: 'Sam' }], NOW)).toBeNull();
  });

  it('restores mid-send messages as waiting for a connection and drops expired ones', () => {
    const raw = JSON.stringify({
      draft: '',
      draftMentions: [],
      pending: [
        msg('mid', { localStatus: 'sending' }),
        msg('refused', { localStatus: 'failed', autoRetry: false }),
        msg('old', { localStatus: 'failed', autoRetry: true, created_at: new Date(NOW - OUTBOX_MAX_AGE_MS - 1).toISOString() }),
        { id: 7 },
      ],
    });
    type M = ReturnType<typeof msg> & { localStatus?: 'sending' | 'failed'; autoRetry?: boolean };
    const out = parseOutbox<M>(raw, NOW)!;
    expect(out.pending.map((m) => [m.id, m.localStatus, m.autoRetry])).toEqual([
      ['mid', 'failed', true],
      ['refused', 'failed', false],
    ]);
    expect(parseOutbox('{', NOW)).toBeNull();
  });

  it('auto-retries only connection failures that are still fresh', () => {
    const list = [
      msg('a', { localStatus: 'failed', autoRetry: true }),
      msg('b', { localStatus: 'failed', autoRetry: false }),
      msg('c', { localStatus: 'sending', autoRetry: true }),
    ];
    expect(messagesToAutoRetry(list, NOW).map((m) => m.id)).toEqual(['a']);
  });

  it('merges restored messages the server does not have yet', () => {
    expect(mergePending([msg('a'), msg('b')], [msg('b'), msg('c')]).map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('keys are per user and room, with a per-user prefix for sign-out', () => {
    expect(outboxKey('u1', 'e1').startsWith(outboxPrefix('u1'))).toBe(true);
    expect(outboxKey('u1', 'e1').startsWith(outboxPrefix('u'))).toBe(false);
  });
});

describe('overlayNotificationWrites', () => {
  const rows = [
    { id: 'n1', read: false },
    { id: 'n2', read: false },
    { id: 'n3', read: true },
  ];

  it('hides queued dismissals and shows queued reads as read', () => {
    const out = overlayNotificationWrites(rows, [
      { kind: 'notificationDelete', targetId: 'n1' },
      { kind: 'notificationRead', targetId: 'n2' },
    ]);
    expect(out).toEqual([
      { id: 'n2', read: true },
      { id: 'n3', read: true },
    ]);
  });

  it('applies a queued mark-all and ignores unrelated writes', () => {
    expect(overlayNotificationWrites(rows, [{ kind: 'notificationRead', targetId: '*' }]).every((n) => n.read)).toBe(true);
    expect(overlayNotificationWrites(rows, [{ kind: 'save', targetId: 'n1', on: true }])).toEqual(rows);
  });
});

// ── sendMessage: a re-send of a message that already landed ───────────────

let insertError: { code: string; message: string } | null = null;
let stored: Record<string, unknown> | null = null;
vi.mock('@/services/supabase', () => {
  const chain = (result: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'insert']) c[m] = () => c;
    c.single = async () => result();
    c.maybeSingle = async () => result();
    return c;
  };
  return {
    supabase: {
      from: () => ({
        insert: () => chain(() => ({ data: null, error: insertError })),
        select: () => chain(() => ({ data: stored, error: null })),
      }),
      rpc: async () => ({ data: [], error: null }),
    },
    getSessionUser: async () => ({ id: 'u1' }),
  };
});

const { eventChatService } = await import('../services/eventChat');

describe('sendMessage re-send', () => {
  beforeEach(() => {
    insertError = null;
    stored = null;
  });
  const row = { id: 'm1', event_id: 'e1', sender_id: 'u1', body: 'hi', created_at: '2026-11-05T12:00:00Z', deleted_at: null, deleted_by: null, mentions: [] };

  it('treats a slow-mode refusal of an already stored message as success', async () => {
    insertError = { code: 'P0001', message: 'chat_slow_mode' };
    stored = row;
    await expect(eventChatService.sendMessage('e1', 'hi', 'm1')).resolves.toMatchObject({ id: 'm1' });
  });

  it('still reports slow mode when the message is not stored', async () => {
    insertError = { code: 'P0001', message: 'chat_slow_mode' };
    await expect(eventChatService.sendMessage('e1', 'hi', 'm1')).rejects.toMatchObject({ message: 'chat_slow_mode' });
  });

  it('rethrows connection failures without a lookup', async () => {
    insertError = { code: '', message: 'TypeError: Network request failed' };
    stored = row;
    await expect(eventChatService.sendMessage('e1', 'hi', 'm1')).rejects.toMatchObject({ code: '' });
  });
});
