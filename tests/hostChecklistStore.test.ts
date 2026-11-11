import { beforeEach, describe, expect, it, vi } from 'vitest';
// vi.mock below is hoisted above every import by vitest.
import { markChecklistSignal, readChecklistLocal, updateChecklistLocal } from '@/utils/hostChecklistStore';

const store = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => void store.set(k, v),
    removeItem: async (k: string) => void store.delete(k),
  },
}));

describe('hostChecklistStore', () => {
  beforeEach(() => store.clear());
  it('starts empty, persists per host, and ignores corrupt data', async () => {
    expect(await readChecklistLocal('b1')).toEqual({ sharedEvent: false, openedManage: false, dismissed: false, preexistingHost: null });
    await updateChecklistLocal('b1', { dismissed: true, preexistingHost: true });
    expect((await readChecklistLocal('b1')).dismissed).toBe(true);
    expect((await readChecklistLocal('b2')).dismissed).toBe(false);
    store.set('eventmap.hostChecklist.b3', '{not json');
    expect((await readChecklistLocal('b3')).dismissed).toBe(false);
  });
  it('signals are one-way', async () => {
    markChecklistSignal('b1', 'sharedEvent');
    await new Promise((r) => setTimeout(r, 0));
    expect((await readChecklistLocal('b1')).sharedEvent).toBe(true);
    markChecklistSignal(null, 'openedManage'); // no host → no-op, no throw
  });
});
