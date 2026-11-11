import { beforeEach, describe, expect, it, vi } from 'vitest';
// vi.mock below is hoisted above every import by vitest.
import {
  FIRST_EVENT_STEPS,
  dismissFirstEventGuide,
  firstEventGuideKey,
  initialEventLocation,
  readFirstEventGuideDismissed,
  shouldShowFirstEventGuide,
} from '@/utils/firstEventGuide';
import type { Business } from '@/types/database';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void store.set(k, v)),
    removeItem: vi.fn(async (k: string) => void store.delete(k)),
  },
}));

const biz = (over: Partial<Business>): Business => ({ id: 'b1', name: 'Host', ...over }) as Business;

beforeEach(() => store.clear());

describe('shouldShowFirstEventGuide', () => {
  it('shows only for a host with no events at all', () => {
    expect(shouldShowFirstEventGuide({ totalEvents: 0, dismissed: false })).toBe(true);
    expect(shouldShowFirstEventGuide({ totalEvents: 1, dismissed: false })).toBe(false);
    expect(shouldShowFirstEventGuide({ totalEvents: 40, dismissed: false })).toBe(false);
  });
  it('stays hidden once dismissed, and while the count is unknown', () => {
    expect(shouldShowFirstEventGuide({ totalEvents: 0, dismissed: true })).toBe(false);
    expect(shouldShowFirstEventGuide({ totalEvents: null, dismissed: false })).toBe(false);
  });
});

describe('dismissal storage', () => {
  it('is per host profile and sticks', async () => {
    expect(await readFirstEventGuideDismissed('b1')).toBe(false);
    await dismissFirstEventGuide('b1');
    expect(await readFirstEventGuideDismissed('b1')).toBe(true);
    expect(await readFirstEventGuideDismissed('b2')).toBe(false);
    expect(firstEventGuideKey('b1')).toBe('eventmap.firstEventGuide.b1');
  });
});

describe('FIRST_EVENT_STEPS', () => {
  it('covers the three form sections it points at', () => {
    expect(FIRST_EVENT_STEPS.map((s) => s.key)).toEqual(['basic', 'datetime', 'location']);
  });
  it('card copy stays short; the fuller hint goes inline', () => {
    for (const s of FIRST_EVENT_STEPS) {
      expect(s.short.length).toBeLessThanOrEqual(42);
      expect(s.hint.length).toBeGreaterThan(s.short.length);
    }
  });
});

describe('initialEventLocation', () => {
  it('prefills a venue street address and pin', () => {
    const r = initialEventLocation(biz({ location_kind: 'fixed', address: '1 Main St', lat: 1, lng: 2 }));
    expect(r).toEqual({ address: '1 Main St', lat: 1, lng: 2, needsPlace: false });
  });

  it('centres on a home area but never claims it as the event address', () => {
    const r = initialEventLocation(biz({ location_kind: 'area', address: 'Mission District', lat: 3, lng: 4 }));
    expect(r.address).toBe('');
    expect(r).toMatchObject({ lat: 3, lng: 4, needsPlace: true });
  });

  it('gives nothing for a host with no location', () => {
    expect(initialEventLocation(biz({ location_kind: 'none', address: null, lat: null, lng: null }))).toEqual({
      address: '',
      lat: null,
      lng: null,
      needsPlace: true,
    });
  });

  it('treats a legacy row (no location_kind) as a venue', () => {
    const r = initialEventLocation(biz({ address: '2 Main St', lat: 5, lng: 6 }));
    expect(r).toEqual({ address: '2 Main St', lat: 5, lng: 6, needsPlace: false });
  });

  it('handles a missing business and a fixed host with no pin yet', () => {
    expect(initialEventLocation(null).needsPlace).toBe(true);
    expect(initialEventLocation(biz({ location_kind: 'fixed', address: null, lat: null, lng: null }))).toEqual({
      address: '',
      lat: null,
      lng: null,
      needsPlace: true,
    });
  });
});
