import { beforeEach, describe, expect, it, vi } from 'vitest';
// vi.mock below is hoisted above every import by vitest.
import {
  EMPTY_PLAYBOOK_LOCAL,
  dismissPlaybookStage,
  eventPlaybookKey,
  markPlaybookSignal,
  parsePlaybookLocal,
  prunePlaybookLocal,
  readPlaybookLocal,
  readPlaybookLocalMany,
  setPlaybookItemTicked,
  updatePlaybookLocal,
} from '@/utils/eventPlaybookStore';

const store = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => void store.set(k, v),
    removeItem: async (k: string) => void store.delete(k),
    getAllKeys: async () => [...store.keys()],
    multiRemove: async (keys: string[]) => keys.forEach((k) => store.delete(k)),
    multiGet: async (keys: string[]) => keys.map((k) => [k, store.get(k) ?? null]),
  },
}));

describe('eventPlaybookStore', () => {
  beforeEach(() => store.clear());

  it('starts empty and keeps events apart', async () => {
    expect(await readPlaybookLocal('e1')).toEqual(EMPTY_PLAYBOOK_LOCAL);
    await updatePlaybookLocal('e1', { shared: true });
    expect((await readPlaybookLocal('e1')).shared).toBe(true);
    expect((await readPlaybookLocal('e2')).shared).toBe(false);
  });

  it('ticks and un-ticks a manual item without duplicating it', async () => {
    await setPlaybookItemTicked('e1', 'venue_confirmed', true);
    await setPlaybookItemTicked('e1', 'venue_confirmed', true);
    expect((await readPlaybookLocal('e1')).ticked).toEqual(['venue_confirmed']);
    await setPlaybookItemTicked('e1', 'lessons', true);
    await setPlaybookItemTicked('e1', 'venue_confirmed', false);
    expect((await readPlaybookLocal('e1')).ticked).toEqual(['lessons']);
  });

  it('dismisses one stage at a time', async () => {
    await dismissPlaybookStage('e1', 'leadup');
    await dismissPlaybookStage('e1', 'leadup');
    expect((await readPlaybookLocal('e1')).dismissedStages).toEqual(['leadup']);
    await dismissPlaybookStage('e1', 'after');
    expect((await readPlaybookLocal('e1')).dismissedStages).toEqual(['leadup', 'after']);
  });

  it('signals are one-way and tolerate a missing event id', async () => {
    markPlaybookSignal('e1', 'openedInsights');
    await new Promise((r) => setTimeout(r, 0));
    expect((await readPlaybookLocal('e1')).openedInsights).toBe(true);
    markPlaybookSignal(null, 'shared'); // no event → no-op, no throw
    markPlaybookSignal(undefined, 'shared');
    await new Promise((r) => setTimeout(r, 0));
    expect(store.size).toBe(1);
  });

  it('reads corrupt or foreign data as empty rather than throwing', () => {
    expect(parsePlaybookLocal(null)).toEqual(EMPTY_PLAYBOOK_LOCAL);
    expect(parsePlaybookLocal('{not json')).toEqual(EMPTY_PLAYBOOK_LOCAL);
    expect(parsePlaybookLocal('"a string"')).toEqual(EMPTY_PLAYBOOK_LOCAL);
    expect(parsePlaybookLocal('{"ticked":[1,"lessons",null],"shared":"yes"}')).toEqual({
      ...EMPTY_PLAYBOOK_LOCAL,
      ticked: ['lessons'],
    });
  });

  it('prunes keys for events no longer worth keeping, and nothing else', async () => {
    await updatePlaybookLocal('keep', { shared: true });
    await updatePlaybookLocal('drop', { shared: true });
    store.set('eventmap.hostChecklist.b1', '{}');
    const removed = await prunePlaybookLocal(['keep']);
    expect(removed).toBe(1);
    expect([...store.keys()].sort()).toEqual([eventPlaybookKey('keep'), 'eventmap.hostChecklist.b1']);
  });
});

describe('readPlaybookLocalMany', () => {
  beforeEach(() => store.clear());

  it('reads several events in one go, filling in the ones with nothing stored', async () => {
    await setPlaybookItemTicked('e1', 'lessons', true);
    await updatePlaybookLocal('e2', { shared: true });
    const many = await readPlaybookLocalMany(['e1', 'e2', 'e3', 'e1']);
    expect(many.size).toBe(3);
    expect(many.get('e1')?.ticked).toEqual(['lessons']);
    expect(many.get('e2')?.shared).toBe(true);
    expect(many.get('e3')).toEqual(EMPTY_PLAYBOOK_LOCAL);
  });

  it('is a no-op for an empty list', async () => {
    expect((await readPlaybookLocalMany([])).size).toBe(0);
  });
});
