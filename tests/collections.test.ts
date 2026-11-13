import { describe, it, expect } from 'vitest';
import { toIcsInputs } from '../utils/collectionIcs';
import {
  COLLECTION_LIMITS,
  applyMembershipChange,
  overlayPendingMembership,
  collectionErrorMessage,
  collectionItemTarget,
  describeCollectionCounts,
  parseCollectionItemTarget,
  validateCollectionName,
  validateCollectionNote,
  visibleSources,
} from '../utils/collections';

/** docs/EVENT_COLLECTIONS_PLAN.md Phase A: client mirrors of the 20261112100000 rules. */

describe('validateCollectionName', () => {
  const existing = [
    { id: 'c1', name: 'Weekend plans', kind: 'manual' },
    { id: 'c2', name: 'Live Music', kind: 'smart' },
  ];

  it('trims and accepts a normal name', () => {
    expect(validateCollectionName('  Date nights ', existing)).toEqual({ ok: true, name: 'Date nights' });
  });

  it('refuses blank and over-long names with the server limits', () => {
    expect(validateCollectionName('   ')).toEqual({ ok: false, reason: 'Give the collection a name.' });
    expect(validateCollectionName('x'.repeat(COLLECTION_LIMITS.nameLength))).toMatchObject({ ok: true });
    expect(validateCollectionName('x'.repeat(COLLECTION_LIMITS.nameLength + 1))).toMatchObject({ ok: false });
  });

  it('manual names clash case-insensitively, but not with smart names or itself', () => {
    expect(validateCollectionName('WEEKEND PLANS', existing)).toMatchObject({ ok: false });
    expect(validateCollectionName('Live Music', existing)).toEqual({ ok: true, name: 'Live Music' });
    expect(validateCollectionName('Weekend plans', existing, { excludeId: 'c1' })).toEqual({ ok: true, name: 'Weekend plans' });
    expect(validateCollectionName('Weekend plans', existing, { kind: 'smart' })).toEqual({ ok: true, name: 'Weekend plans' });
  });
});

describe('validateCollectionNote', () => {
  it('blank becomes null; the 140-char cap matches the CHECK constraint', () => {
    expect(validateCollectionNote('   ')).toEqual({ ok: true, note: null });
    expect(validateCollectionNote(undefined)).toEqual({ ok: true, note: null });
    expect(validateCollectionNote(' bring a scarf ')).toEqual({ ok: true, note: 'bring a scarf' });
    expect(validateCollectionNote('n'.repeat(141))).toMatchObject({ ok: false });
  });
});

describe('collectionErrorMessage', () => {
  it('maps the trigger and constraint names to user copy', () => {
    expect(collectionErrorMessage({ message: 'collection_limit: at most 50 collections' })).toMatch(/50 collections/);
    expect(collectionErrorMessage({ message: 'collection_items_limit: at most 500' })).toMatch(/500 events/);
    expect(collectionErrorMessage({ message: 'duplicate key value violates unique constraint "collections_manual_name_key"' })).toMatch(/already have/);
    expect(collectionErrorMessage({ message: 'duplicate key value violates unique constraint "collections_smart_rule_key"' })).toMatch(/already favourited/);
    expect(collectionErrorMessage({ message: 'collection_unknown_category: category does not exist' })).toMatch(/valid event type/);
    expect(collectionErrorMessage({ message: 'new row violates check constraint "collection_items_note_check"' })).toMatch(/140/);
  });

  it('recognises a server without the migration, and ignores unrelated errors', () => {
    expect(collectionErrorMessage({ code: '42P01', message: 'relation "collections" does not exist' })).toMatch(/aren't available/);
    expect(collectionErrorMessage({ code: 'PGRST202', message: 'Could not find the function' })).toMatch(/aren't available/);
    expect(collectionErrorMessage({ message: 'network request failed' })).toBeNull();
    expect(collectionErrorMessage(null)).toBeNull();
    expect(collectionErrorMessage('boom')).toBeNull();
  });
});

describe('visibleSources', () => {
  it('hides the implied pin in manual collections and keeps it in smart ones', () => {
    expect(visibleSources(['pinned', 'saved'], 'manual')).toEqual(['saved']);
    expect(visibleSources(['pinned'], 'manual')).toEqual([]);
    expect(visibleSources(['pinned', 'going', 'saved'], 'smart')).toEqual(['pinned', 'going', 'saved']);
  });
});

describe('collection item target', () => {
  it('round-trips the (collection, event) pair for the offline queue', () => {
    const t = collectionItemTarget('c1', 'e1');
    expect(t).toBe('c1:e1');
    expect(parseCollectionItemTarget(t)).toEqual({ collectionId: 'c1', eventId: 'e1' });
    expect(parseCollectionItemTarget('nope')).toBeNull();
    expect(parseCollectionItemTarget(':e1')).toBeNull();
    expect(parseCollectionItemTarget('c1:')).toBeNull();
  });
});

describe('applyMembershipChange', () => {
  const base = [
    { collection_id: 'manual', pinned: true, by_rule: false },
    { collection_id: 'smart', pinned: false, by_rule: true },
  ];

  it('pinning adds a row or flips pinned on an existing one', () => {
    expect(applyMembershipChange(base, 'other', true)).toEqual([
      ...base,
      { collection_id: 'other', pinned: true, by_rule: false },
    ]);
    expect(applyMembershipChange(base, 'smart', true)).toEqual([
      base[0],
      { collection_id: 'smart', pinned: true, by_rule: true },
    ]);
  });

  it('unpinning drops the row unless the smart rule still matches', () => {
    expect(applyMembershipChange(base, 'manual', false)).toEqual([base[1]]);
    const pinnedSmart = [{ collection_id: 'smart', pinned: true, by_rule: true }];
    expect(applyMembershipChange(pinnedSmart, 'smart', false)).toEqual([{ collection_id: 'smart', pinned: false, by_rule: true }]);
    expect(applyMembershipChange(base, 'missing', false)).toEqual(base);
  });
});

describe('overlayPendingMembership', () => {
  const server = [
    { collection_id: 'manual', pinned: true, by_rule: false },
    { collection_id: 'smart', pinned: false, by_rule: true },
  ];

  it('returns the server view, marked not pending, when nothing is queued', () => {
    expect(overlayPendingMembership(server, new Map())).toEqual(server.map((m) => ({ ...m, pending: false })));
  });

  it('a queued pin adds or flips a row; a queued unpin removes it unless the rule still holds', () => {
    const pending = new Map([['other', true], ['manual', false], ['smart', false]]);
    expect(overlayPendingMembership(server, pending)).toEqual([
      { collection_id: 'smart', pinned: false, by_rule: true, pending: true },
      { collection_id: 'other', pinned: true, by_rule: false, pending: true },
    ]);
  });

  it('a queued pin on a rule member marks it pinned and pending', () => {
    expect(overlayPendingMembership(server, new Map([['smart', true]]))).toEqual([
      { collection_id: 'manual', pinned: true, by_rule: false, pending: false },
      { collection_id: 'smart', pinned: true, by_rule: true, pending: true },
    ]);
  });
});

describe('describeCollectionCounts', () => {
  it('pluralises and mentions repeating series only when there are some', () => {
    expect(describeCollectionCounts({ item_count: 1, recurring_count: 0 })).toBe('1 event');
    expect(describeCollectionCounts({ item_count: 3, recurring_count: 1 })).toBe('3 events · 1 repeating');
    expect(describeCollectionCounts({ item_count: 0, recurring_count: 0 })).toBe('0 events');
  });
});

describe('toIcsInputs (collection calendar export)', () => {
  const base = {
    id: 'e1', title: 'Choir Weekly', description: 'Sing', start_datetime: '2026-11-20T19:00:00.000Z', end_datetime: '2026-11-20T21:00:00.000Z',
    address: 'Hall', timezone: 'UTC', business_name: 'Club', is_recurring: true,
    recurrence_pattern: { frequency: 'weekly' as const, interval: 1 },
  } as unknown as Parameters<typeof toIcsInputs>[0][number];

  it('maps a series with its rule and exceptions, and a one-off without', () => {
    const exceptions = new Map([[
      'e1',
      [{ event_id: 'e1', occurrence_date: '2026-11-27', kind: 'cancelled' as const, new_start: null, new_end: null, note: null }],
    ]]);
    const [series, single] = toIcsInputs([base, { ...base, id: 'e2', is_recurring: false, recurrence_pattern: null }], exceptions);
    expect(series.id).toBe('e1');
    expect(series.recurrence).toMatch(/^RRULE:FREQ=WEEKLY/);
    expect(series.exceptions).toHaveLength(1);
    expect(series.exceptions?.[0].kind).toBe('cancelled');
    expect(series.description).toContain('Hosted by Club');
    expect(single.recurrence).toBeNull();
    expect(single.exceptions).toBeUndefined();
  });
});
