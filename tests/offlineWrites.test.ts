import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MAX_ATTEMPTS,
  MAX_PENDING_AGE_MS,
  describeWrite,
  enqueueWrite,
  outcomeForFailure,
  parseQueue,
  queuedMessage,
  removeWrite,
  shouldFlushOnTransition,
  type PendingEntry,
} from '../utils/pendingWrites';
import { DRAFT_MAX_AGE_MS, parseDraft, serializeDraft } from '../utils/formDraft';

/** docs/OFFLINE_PLAN.md step 6: write queue and local drafts. */

const save = (targetId: string, on: boolean) => ({ kind: 'save' as const, targetId, on });

describe('enqueueWrite', () => {
  it('keeps only the latest intent per target', () => {
    let q: PendingEntry[] = [];
    q = enqueueWrite(q, save('e1', true), 1);
    q = enqueueWrite(q, save('e2', true), 2);
    q = enqueueWrite(q, save('e1', false), 3);
    expect(q.map((e) => [e.targetId, (e as { on: boolean }).on])).toEqual([
      ['e2', true],
      ['e1', false],
    ]);
  });

  it('dismiss supersedes a read-mark; mark-all supersedes every read-mark', () => {
    let q: PendingEntry[] = [];
    q = enqueueWrite(q, { kind: 'notificationRead', targetId: 'n1' }, 1);
    q = enqueueWrite(q, { kind: 'notificationRead', targetId: 'n2' }, 2);
    q = enqueueWrite(q, { kind: 'notificationDelete', targetId: 'n1' }, 3);
    expect(q.map((e) => `${e.kind}:${e.targetId}`)).toEqual(['notificationRead:n2', 'notificationDelete:n1']);
    q = enqueueWrite(q, { kind: 'notificationRead', targetId: '*' }, 4);
    expect(q.map((e) => `${e.kind}:${e.targetId}`)).toEqual(['notificationDelete:n1', 'notificationRead:*']);
  });

  it('removeWrite clears the entry for a target done directly', () => {
    const q = enqueueWrite([], save('e1', true), 1);
    expect(removeWrite(q, save('e1', false))).toEqual([]);
  });

  it('collection pins are keyed per (collection, event) pair', () => {
    let q: PendingEntry[] = [];
    q = enqueueWrite(q, { kind: 'collectionItem', targetId: 'c1:e1', on: true }, 1);
    q = enqueueWrite(q, { kind: 'collectionItem', targetId: 'c2:e1', on: true }, 2);
    q = enqueueWrite(q, { kind: 'collectionItem', targetId: 'c1:e1', on: false }, 3);
    expect(q.map((e) => [e.targetId, (e as { on: boolean }).on])).toEqual([
      ['c2:e1', true],
      ['c1:e1', false],
    ]);
    // A save for the same event is a different intent and is kept.
    q = enqueueWrite(q, save('e1', true), 4);
    expect(q).toHaveLength(3);
  });
});

describe('shouldFlushOnTransition', () => {
  it('replays on every step towards a working connection, and only then', () => {
    expect(shouldFlushOnTransition('offline', 'online')).toBe(true);
    expect(shouldFlushOnTransition('offline', 'degraded')).toBe(true);
    expect(shouldFlushOnTransition('degraded', 'online')).toBe(true); // was missed before
    expect(shouldFlushOnTransition('online', 'degraded')).toBe(false);
    expect(shouldFlushOnTransition('online', 'offline')).toBe(false);
    expect(shouldFlushOnTransition('degraded', 'offline')).toBe(false);
    expect(shouldFlushOnTransition('online', 'online')).toBe(false);
    expect(shouldFlushOnTransition('offline', 'offline')).toBe(false);
  });
});

describe('outcomeForFailure', () => {
  it('drops refusals, keeps connection failures, gives up on repeated unknowns', () => {
    expect(outcomeForFailure('client', 0)).toBe('drop');
    expect(outcomeForFailure('network', 99)).toBe('retry-later');
    expect(outcomeForFailure('timeout', 99)).toBe('retry-later');
    expect(outcomeForFailure('server', 0)).toBe('retry-later');
    expect(outcomeForFailure('unknown', MAX_ATTEMPTS - 1)).toBe('drop');
  });
});

describe('parseQueue', () => {
  it('keeps well-formed unexpired entries only', () => {
    const now = MAX_PENDING_AGE_MS * 2;
    const good = { ...save('e1', true), queuedAt: now - 1000, attempts: 0 };
    const raw = JSON.stringify([
      good,
      { ...save('e2', true), queuedAt: 0, attempts: 0 }, // expired
      { kind: 'save', targetId: 'e3', queuedAt: now, attempts: 0 }, // no `on`
      { kind: 'rsvp', targetId: 'e4', queuedAt: now, attempts: 0 }, // unknown kind
      { kind: 'collectionItem', targetId: 'c1:e5', queuedAt: now, attempts: 0 }, // no `on`
      null,
    ]);
    expect(parseQueue(raw, now)).toEqual([good]);
    const pin = { kind: 'collectionItem', targetId: 'c1:e5', on: true, collectionName: 'Plans', queuedAt: now, attempts: 0 };
    expect(parseQueue(JSON.stringify([pin]), now)).toEqual([pin]);
    expect(parseQueue('nope', now)).toEqual([]);
  });
});

describe('copy', () => {
  it('describes writes and announces only saves / follows', () => {
    expect(describeWrite({ ...save('e1', true), label: 'Jazz' })).toBe('save “Jazz”');
    expect(describeWrite({ kind: 'follow', targetId: 'b', on: false })).toBe('unfollow an organizer');
    expect(queuedMessage(save('e1', true))).toMatch(/back online/);
    expect(queuedMessage({ kind: 'notificationRead', targetId: 'n' })).toBeNull();
    expect(describeWrite({ kind: 'collectionItem', targetId: 'c1:e1', on: true, label: 'Jazz', collectionName: 'Plans' })).toBe('add “Jazz” to “Plans”');
    expect(describeWrite({ kind: 'collectionItem', targetId: 'c1:e1', on: false })).toBe('remove an event from a collection');
    expect(queuedMessage({ kind: 'collectionItem', targetId: 'c1:e1', on: true })).toMatch(/Added on this device/);
  });
});

describe('form drafts', () => {
  const form = {
    title: 'Jazz',
    startDatetime: new Date('2026-11-07T19:00:00Z'),
    extras: { priceLabel: '$10' },
    images: [
      { uri: 'file:///a.jpg' },
      { uri: 'blob:http://x/1' },
      { uri: 'data:image/png;base64,AAAA' },
      { uri: 'x', remoteUrl: 'https://cdn/x.jpg' },
    ],
  };

  it('round-trips dates and drops images that cannot survive a restart', () => {
    const out = parseDraft<typeof form>(serializeDraft(form, null, 1000), null, 2000)!;
    expect(out.startDatetime).toBeInstanceOf(Date);
    expect(out.startDatetime.toISOString()).toBe('2026-11-07T19:00:00.000Z');
    expect(out.extras.priceLabel).toBe('$10');
    expect(out.images.map((i) => i.uri)).toEqual(['file:///a.jpg', 'x']);
  });

  it('ignores drafts for another event version, expired or malformed', () => {
    const raw = serializeDraft(form, 'v1', 1000);
    expect(parseDraft(raw, 'v1', 2000)).not.toBeNull();
    expect(parseDraft(raw, 'v2', 2000)).toBeNull();
    expect(parseDraft(raw, 'v1', 1000 + DRAFT_MAX_AGE_MS + 1)).toBeNull();
    expect(parseDraft('{', null)).toBeNull();
  });
});

// ── runOrQueue / flush with a fake backend ────────────────────────────────

const calls: string[] = [];
let failWith: unknown = null;
const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => void store.set(k, v),
    removeItem: async (k: string) => void store.delete(k),
  },
}));
let slowOnce: Promise<void> | null = null;
const fake = (name: string) => async (id?: string) => {
  calls.push(`${name}:${id ?? ''}`);
  if (slowOnce) {
    const wait = slowOnce;
    slowOnce = null;
    await wait;
  }
  if (failWith) throw failWith;
};

vi.mock('@/services/social', () => ({
  socialService: {
    saveEvent: fake('save'),
    unsaveEvent: fake('unsave'),
    followBusiness: fake('follow'),
    unfollowBusiness: fake('unfollow'),
  },
}));
vi.mock('@/services/notifications', () => ({
  markNotificationAsRead: fake('read'),
  markAllNotificationsAsRead: fake('readAll'),
  deleteNotification: fake('delete'),
}));
vi.mock('@/services/collections', () => ({
  collectionsService: {
    addItem: async (c: string, e: string) => fake('pin')(`${c}:${e}`),
    removeItem: async (c: string, e: string) => fake('unpin')(`${c}:${e}`),
  },
}));

const pw = await import('../services/pendingWrites');
const conn = await import('../utils/connectivity');

describe('runOrQueue', () => {
  beforeEach(async () => {
    calls.length = 0;
    failWith = null;
    store.clear();
    conn.resetConnectivityForTests();
    pw.setPendingWritesUser(null);
    pw.setPendingWritesUser('u1');
    pw.setPendingWritesSessionVerified(true);
    await pw.flushPendingWrites();
  });

  it('a direct write waits for an in-flight replay of the same target (latest intent wins)', async () => {
    conn.setDeviceConnectivity('offline');
    await pw.runOrQueue(save('e1', true));
    await pw.runOrQueue(save('e2', true));
    conn.setDeviceConnectivity('online');
    // Make the replayed save slow so the user's tap lands while it is in flight.
    let release: () => void = () => {};
    slowOnce = new Promise<void>((r) => (release = r));
    const flush = pw.flushPendingWrites();
    await new Promise((r) => setTimeout(r, 5));
    const direct = pw.runOrQueue(save('e1', false));
    await new Promise((r) => setTimeout(r, 5));
    expect(calls).toEqual(['save:e1']); // the direct unsave has not been sent yet
    release();
    await flush;
    expect(await direct).toBe('done');
    expect(calls).toEqual(['save:e1', 'save:e2', 'unsave:e1']);
    expect(pw.getPendingWriteCount()).toBe(0);
  });

  it('a direct write for another target does not wait for the replay', async () => {
    conn.setDeviceConnectivity('offline');
    await pw.runOrQueue(save('e1', true));
    conn.setDeviceConnectivity('online');
    let release: () => void = () => {};
    slowOnce = new Promise<void>((r) => (release = r));
    const flush = pw.flushPendingWrites();
    await new Promise((r) => setTimeout(r, 5));
    expect(await pw.runOrQueue(save('e9', true))).toBe('done');
    expect(calls).toEqual(['save:e1', 'save:e9']);
    release();
    await flush;
  });

  it('sends directly when online', async () => {
    expect(await pw.runOrQueue(save('e1', true))).toBe('done');
    expect(calls).toEqual(['save:e1']);
    expect(pw.getPendingWriteCount()).toBe(0);
  });

  it('queues without sending while offline, and replays the latest intent on reconnect', async () => {
    conn.setDeviceConnectivity('offline');
    expect(await pw.runOrQueue(save('e1', true))).toBe('queued');
    expect(await pw.runOrQueue(save('e1', false))).toBe('queued');
    expect(calls).toEqual([]);
    expect(store.get('eventmap.pendingWrites.u1')).toContain('"on":false');
    conn.setDeviceConnectivity('online');
    const result = await pw.flushPendingWrites();
    expect(calls).toEqual(['unsave:e1']);
    expect(result.done).toHaveLength(1);
    expect(store.has('eventmap.pendingWrites.u1')).toBe(false);
  });

  it('queues when the request fails because of the connection', async () => {
    failWith = new TypeError('Network request failed');
    expect(await pw.runOrQueue({ kind: 'follow', targetId: 'b1', on: true })).toBe('queued');
    expect(pw.getPendingWriteCount()).toBe(1);
  });

  it('still rejects when the server refuses (caller rolls back)', async () => {
    failWith = { code: '42501', message: 'denied' };
    await expect(pw.runOrQueue(save('e1', true))).rejects.toMatchObject({ code: '42501' });
    expect(pw.getPendingWriteCount()).toBe(0);
  });

  it('flush drops refused entries and stops at a connection failure', async () => {
    conn.setDeviceConnectivity('offline');
    await pw.runOrQueue(save('e1', true));
    await pw.runOrQueue(save('e2', true));
    conn.setDeviceConnectivity('online');
    failWith = { code: '23503', message: 'event gone' };
    const r1 = await pw.flushPendingWrites();
    expect(r1.dropped).toHaveLength(2);
    conn.setDeviceConnectivity('offline');
    await pw.runOrQueue(save('e3', true));
    conn.setDeviceConnectivity('online');
    failWith = new TypeError('Failed to fetch');
    const r2 = await pw.flushPendingWrites();
    expect(r2.done).toHaveLength(0);
    expect(pw.getPendingWriteCount()).toBe(1);
  });

  it('queues without a request while the session is unverified', async () => {
    pw.setPendingWritesSessionVerified(false);
    try {
      expect(await pw.runOrQueue(save('e1', true))).toBe('queued');
      expect(calls).toEqual([]);
    } finally {
      pw.setPendingWritesSessionVerified(true);
    }
  });

  it('keeps queues per user', async () => {
    conn.setDeviceConnectivity('offline');
    await pw.runOrQueue(save('e1', true));
    pw.setPendingWritesUser('u2');
    expect(pw.getPendingWriteCount()).toBe(0);
    pw.setPendingWritesUser('u1');
    await pw.runOrQueue(save('e9', true)); // waits for u1's queue to load
    expect(pw.getPendingWriteCount()).toBe(2);
  });
});

describe('collection pins', () => {
  it('replay routes a queued pin to the collections service with the pair split', async () => {
    calls.length = 0;
    store.clear();
    conn.resetConnectivityForTests();
    pw.setPendingWritesUser(null);
    pw.setPendingWritesUser('u1');
    pw.setPendingWritesSessionVerified(true);
    await pw.flushPendingWrites();
    conn.setDeviceConnectivity('offline');
    expect(await pw.runOrQueue({ kind: 'collectionItem', targetId: 'c1:e1', on: true })).toBe('queued');
    expect(await pw.runOrQueue({ kind: 'collectionItem', targetId: 'c1:e2', on: false })).toBe('queued');
    expect(calls).toEqual([]);
    conn.setDeviceConnectivity('online');
    await pw.flushPendingWrites();
    expect(calls).toEqual(['pin:c1:e1', 'unpin:c1:e2']);
    expect(pw.getPendingWriteCount()).toBe(0);
  });
});

describe('RSVPs are never queued', () => {
  it('the queue has no RSVP / waitlist kind', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../utils/pendingWrites.ts', import.meta.url), 'utf8');
    const kinds = [...src.matchAll(/kind: '(\w+)'/g)].map((m) => m[1]);
    expect(new Set(kinds)).toEqual(new Set(['save', 'follow', 'collectionItem', 'notificationRead', 'notificationDelete']));
  });
});
