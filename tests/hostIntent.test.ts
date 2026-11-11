import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  consumePendingHostIntent,
  isHostIntentParam,
  isMissingColumnError,
  markPendingHostIntent,
  parseUserIntent,
  readLocalIntent,
  saveUserIntent,
  wantsToHost,
} from '@/utils/hostIntent';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void store.set(k, v)),
    removeItem: vi.fn(async (k: string) => void store.delete(k)),
  },
}));

beforeEach(() => store.clear());

describe('hostIntent', () => {
  it('parses only known intents', () => {
    expect(parseUserIntent('host')).toBe('host');
    expect(parseUserIntent('both')).toBe('both');
    expect(parseUserIntent('HOST')).toBeNull();
    expect(parseUserIntent(null)).toBeNull();
    expect(parseUserIntent(3)).toBeNull();
  });

  it('wantsToHost covers host and both', () => {
    expect(wantsToHost('host')).toBe(true);
    expect(wantsToHost('both')).toBe(true);
    expect(wantsToHost('attend')).toBe(false);
    expect(wantsToHost(null)).toBe(false);
  });

  it('reads route params', () => {
    expect(isHostIntentParam('host')).toBe(true);
    expect(isHostIntentParam(['host', 'x'])).toBe(true);
    expect(isHostIntentParam('attend')).toBe(false);
    expect(isHostIntentParam(undefined)).toBe(false);
  });

  it('pending host flag is consumed once', async () => {
    expect(await consumePendingHostIntent()).toBe(false);
    await markPendingHostIntent();
    expect(await consumePendingHostIntent()).toBe(true);
    expect(await consumePendingHostIntent()).toBe(false);
  });

  it('saves locally even when the column is missing on the server', async () => {
    const result = await saveUserIntent('u1', 'both', async () => {
      throw { code: 'PGRST204', message: "Could not find the 'intent' column" };
    });
    expect(result).toBe('local-only');
    expect(await readLocalIntent('u1')).toBe('both');
  });

  it('reports saved and failed outcomes', async () => {
    expect(await saveUserIntent('u1', 'host', async () => {})).toBe('saved');
    expect(await saveUserIntent('u1', 'host', async () => { throw new Error('offline'); })).toBe('failed');
    expect(await readLocalIntent('u1')).toBe('host');
  });

  it('recognises missing-column codes only', () => {
    expect(isMissingColumnError({ code: '42703' })).toBe(true);
    expect(isMissingColumnError({ code: '23514' })).toBe(false);
    expect(isMissingColumnError(null)).toBe(false);
  });
});
