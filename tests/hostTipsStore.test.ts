import { beforeEach, describe, expect, it, vi } from 'vitest';
// vi.mock below is hoisted above every import by vitest.
import { hostTipsKey, markTipSeen, readSeenTips } from '@/utils/hostTipsStore';

const store = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => void store.set(k, v),
    removeItem: async (k: string) => void store.delete(k),
  },
}));

beforeEach(() => store.clear());

describe('hostTipsStore', () => {
  it('starts empty and records tips per host profile', async () => {
    expect(await readSeenTips('b1')).toEqual([]);
    await markTipSeen('b1', 'first_rsvp');
    expect(await readSeenTips('b1')).toEqual(['first_rsvp']);
    expect(await readSeenTips('b2')).toEqual([]);
    expect(hostTipsKey('b1')).toBe('eventmap.hostTips.b1');
  });

  it('does not duplicate and keeps earlier tips', async () => {
    await markTipSeen('b1', 'first_rsvp');
    await markTipSeen('b1', 'first_rsvp');
    await markTipSeen('b1', 'capacity_reached');
    expect(await readSeenTips('b1')).toEqual(['first_rsvp', 'capacity_reached']);
  });

  it('ignores corrupt or unexpected stored values', async () => {
    store.set(hostTipsKey('b3'), '{not json');
    expect(await readSeenTips('b3')).toEqual([]);
    store.set(hostTipsKey('b4'), '{"a":1}');
    expect(await readSeenTips('b4')).toEqual([]);
    store.set(hostTipsKey('b5'), '["first_rsvp", 7]');
    expect(await readSeenTips('b5')).toEqual(['first_rsvp']);
  });
});
