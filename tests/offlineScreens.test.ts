import { describe, it, expect } from 'vitest';
import type { PersistedClient } from '@tanstack/query-persist-client-core';
import { findEventRow, previewDetailsFromRow } from '../utils/eventPreview';
import {
  DISCOVER_SNAPSHOT_MAX_ITEMS,
  isUnfiltered,
  makeDiscoverSnapshot,
  parseDiscoverSnapshot,
} from '../utils/discoverSnapshot';
import { serializeForStorage } from '../utils/queryPersistence';

/** docs/OFFLINE_PLAN.md step 4: event previews, Discover's last area, recent-events cap. */

const ranked = {
  id: 'e1',
  title: 'Rooftop Jazz',
  start_datetime: '2026-11-07T19:00:00Z',
  end_datetime: '2026-11-07T22:00:00Z',
  business_id: 'b1',
  business_name: 'Cached Venue',
  business_logo_url: null,
  category_id: 'c1',
  category_label: 'Music',
  category_slug: 'music',
  lat: 37.7,
  lng: -122.4,
  address: '1 Main St',
  cover_image_url: 'https://x.test/c.jpg',
  rsvp_count: 3,
  save_count: 1,
  user_rsvp: 'going',
  user_saved: true,
};

describe('findEventRow', () => {
  it('finds a row in plain lists, infinite pages and calendar wrappers', () => {
    expect(findEventRow([[ranked]], 'e1')?.title).toBe('Rooftop Jazz');
    expect(findEventRow([{ pages: [[], [ranked]], pageParams: [0, 20] }], 'e1')?.id).toBe('e1');
    expect(findEventRow([{ rows: [{ event: ranked, source: 'going' }] }], 'e1')?.id).toBe('e1');
    expect(findEventRow([{ center: {}, items: [ranked] }], 'e1')?.id).toBe('e1');
  });

  it('prefers a row that carries the business name', () => {
    const bare = { id: 'e1', title: 'Rooftop Jazz', start_datetime: ranked.start_datetime };
    expect(findEventRow([[bare], [ranked]], 'e1')?.business_name).toBe('Cached Venue');
  });

  it('returns null when nothing matches or data is odd', () => {
    expect(findEventRow([[ranked], null, 42, 'x', { pages: 'no' }], 'missing')).toBeNull();
    expect(findEventRow([[{ id: 'e1' }]], 'e1')).toBeNull(); // no title / start
  });
});

describe('previewDetailsFromRow', () => {
  it('builds the parts the event page reads', () => {
    const d = previewDetailsFromRow(ranked);
    expect(d.event.title).toBe('Rooftop Jazz');
    expect(d.business).toMatchObject({ id: 'b1', name: 'Cached Venue', lat: 37.7, lng: -122.4 });
    expect(d.category).toMatchObject({ label: 'Music', slug: 'music' });
    expect(d.links).toEqual([]);
    expect(d.photos).toEqual([]);
    expect(d.user_rsvp).toBe('going');
    expect(d.user_saved).toBe(true);
    expect(d.user_following_business).toBe(false);
  });

  it('tolerates sparse rows (calendar) without inventing values', () => {
    const d = previewDetailsFromRow({ id: 'e2', title: 'T', start_datetime: '2026-11-07T19:00:00Z' });
    expect(d.event.end_datetime).toBe('2026-11-07T19:00:00Z');
    expect(Number.isNaN(d.event.lat)).toBe(true);
    expect(d.business.name).toBe('');
    expect(d.category.label).toBe('');
    expect(d.user_rsvp).toBeNull();
  });
});

describe('discover last area', () => {
  it('only unfiltered results are saved', () => {
    expect(isUnfiltered({})).toBe(true);
    expect(isUnfiltered({ categories: [], searchQuery: '', startDate: null, endDate: null })).toBe(true);
    expect(isUnfiltered({ categories: ['c1'] })).toBe(false);
    expect(isUnfiltered({ searchQuery: 'jazz' })).toBe(false);
    expect(isUnfiltered({ startDate: '2026-11-07' })).toBe(false);
  });

  it('caps the stored page and keeps "more" truthful', () => {
    const items = Array.from({ length: DISCOVER_SNAPSHOT_MAX_ITEMS + 5 }, (_, i) => ({ id: `e${i}` }));
    const snap = makeDiscoverSnapshot(1, 2, items, false);
    expect(snap.items).toHaveLength(DISCOVER_SNAPSHOT_MAX_ITEMS);
    expect(snap.hasMore).toBe(true);
  });

  it('parses defensively', () => {
    expect(parseDiscoverSnapshot(makeDiscoverSnapshot(1, 2, [{ id: 'a' }], false))?.items).toEqual([{ id: 'a' }]);
    expect(parseDiscoverSnapshot({ center: { lat: 'x', lng: 2 }, items: [] })).toBeNull();
    expect(parseDiscoverSnapshot({ center: { lat: 1, lng: 2 }, items: 'no' })).toBeNull();
    expect(parseDiscoverSnapshot({ center: { lat: 1, lng: 2 }, items: [{ id: 1 }, { id: 'ok' }] })?.items).toEqual([
      { id: 'ok' },
    ]);
    expect(parseDiscoverSnapshot(null)).toBeNull();
  });
});

describe('per-item caps', () => {
  it('cover event details, visited profiles, business pages and chat rooms', async () => {
    const { PERSIST_LIMITS } = await import('../utils/queryPersistence');
    expect(PERSIST_LIMITS.map((l) => l.prefix[0])).toEqual(['event', 'user-profile', 'business-page', 'chat']);
  });
});

describe('recent events cap', () => {
  it('stores only the most recently shown event details', () => {
    type Q = PersistedClient['clientState']['queries'][number];
    const q = (key: unknown[], at: number) =>
      ({ queryKey: key, queryHash: JSON.stringify(key), state: { data: { x: 1 }, dataUpdatedAt: at } }) as unknown as Q;
    const queries = [
      ...Array.from({ length: 5 }, (_, i) => q(['event', 'details', `e${i}`], i)),
      q(['events', 'saved'], 0),
    ];
    const out = JSON.parse(
      serializeForStorage(
        { timestamp: 1, buster: 'b', clientState: { queries, mutations: [] } },
        { limits: [{ prefix: ['event', 'details'], max: 2 }] }
      )
    ) as PersistedClient;
    const keys = out.clientState.queries.map((x) => x.queryKey.join('/'));
    expect(keys).toContain('events/saved'); // other keys aren't limited
    expect(keys.filter((k) => k.startsWith('event/details'))).toEqual(['event/details/e4', 'event/details/e3']);
  });
});
