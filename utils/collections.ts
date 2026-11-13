/**
 * Pure helpers for private event collections (docs/EVENT_COLLECTIONS_PLAN.md).
 * Mirrors the limits and validation of migration 20261112100000 so the UI can
 * refuse bad input before a round trip; the server stays the authority.
 * No React Native imports: unit-tested under node.
 */
import type { CollectionFilter, CollectionSort, CollectionSource } from '@/types/database';

export const COLLECTION_LIMITS = Object.freeze({
  /** Collections per user. */
  collections: 50,
  /** Pinned events per collection (rule members do not count). */
  items: 500,
  nameLength: 40,
  noteLength: 140,
});

/** Trimmed name, or the reason it is not acceptable. */
export function validateCollectionName(
  raw: string,
  existing: readonly { name: string; kind: string; id?: string }[] = [],
  opts: { kind?: 'manual' | 'smart'; excludeId?: string } = {}
): { ok: true; name: string } | { ok: false; reason: string } {
  const name = raw.trim();
  if (!name) return { ok: false, reason: 'Give the collection a name.' };
  if (name.length > COLLECTION_LIMITS.nameLength) {
    return { ok: false, reason: `Keep the name under ${COLLECTION_LIMITS.nameLength} characters.` };
  }
  // Manual names are unique per user, case-insensitive (smart ones are
  // keyed by category instead and may repeat a manual name).
  if ((opts.kind ?? 'manual') === 'manual') {
    const lower = name.toLowerCase();
    const clash = existing.some(
      (c) => c.kind === 'manual' && c.id !== opts.excludeId && c.name.trim().toLowerCase() === lower
    );
    if (clash) return { ok: false, reason: 'You already have a collection with that name.' };
  }
  return { ok: true, name };
}

/** Trimmed note, null when blank, or the reason it is not acceptable. */
export function validateCollectionNote(
  raw: string | null | undefined
): { ok: true; note: string | null } | { ok: false; reason: string } {
  const note = (raw ?? '').trim();
  if (note.length > COLLECTION_LIMITS.noteLength) {
    return { ok: false, reason: `Keep the note under ${COLLECTION_LIMITS.noteLength} characters.` };
  }
  return { ok: true, note: note || null };
}

/** Server error (trigger / constraint names) → text the user can act on; null when unrelated. */
export function collectionErrorMessage(error: unknown): string | null {
  const msg = (error as { message?: unknown } | null)?.message;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof msg !== 'string') return null;
  if (msg.includes('collection_limit')) return `You can have up to ${COLLECTION_LIMITS.collections} collections.`;
  if (msg.includes('collection_items_limit')) return `A collection holds up to ${COLLECTION_LIMITS.items} events.`;
  if (msg.includes('collection_name_required')) return 'Give the collection a name.';
  if (msg.includes('collection_name_too_long')) return `Keep the name under ${COLLECTION_LIMITS.nameLength} characters.`;
  if (msg.includes('collections_manual_name_key')) return 'You already have a collection with that name.';
  if (msg.includes('collections_smart_rule_key')) return 'You already favourited that event type.';
  if (msg.includes('collection_categories_required') || msg.includes('collection_unknown_category')) {
    return 'Pick a valid event type.';
  }
  if (msg.includes('collection_items_note_check')) return `Keep the note under ${COLLECTION_LIMITS.noteLength} characters.`;
  if (code === '42P01' || code === 'PGRST205' || code === '42883' || code === 'PGRST202') {
    return "Collections aren't available on this server yet.";
  }
  return null;
}

export const COLLECTION_SORTS: readonly { value: CollectionSort; label: string }[] = [
  { value: 'next', label: 'Next up' },
  { value: 'rsvp', label: 'Most popular' },
  { value: 'added', label: 'Recently added' },
  { value: 'title', label: 'A to Z' },
];

export const COLLECTION_FILTERS: readonly { value: CollectionFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'repeating', label: 'Repeating' },
  { value: 'past', label: 'Past' },
  { value: 'pinned', label: 'Added by you' },
  { value: 'saved', label: 'Saved' },
  { value: 'going', label: 'Going' },
];

/** Short chip text for a membership source. */
export function collectionSourceLabel(source: CollectionSource): string {
  switch (source) {
    case 'pinned':
      return 'Added';
    case 'going':
      return 'Going';
    case 'requested':
      return 'Pending approval';
    case 'interested':
      return 'Interested';
    case 'saved':
      return 'Saved';
  }
}

/**
 * Which chips to show for a row: pinned is implied by being in a manual
 * collection, so it is only worth a chip in a smart one, where it marks an
 * event outside the rule.
 */
export function visibleSources(sources: readonly CollectionSource[], kind: 'manual' | 'smart'): CollectionSource[] {
  return sources.filter((s) => (kind === 'manual' ? s !== 'pinned' : true));
}

/** Key the offline queue and `usePendingWrite` use for one (collection, event) pair. */
export function collectionItemTarget(collectionId: string, eventId: string): string {
  return `${collectionId}:${eventId}`;
}

export function parseCollectionItemTarget(target: string): { collectionId: string; eventId: string } | null {
  const i = target.indexOf(':');
  if (i <= 0 || i === target.length - 1) return null;
  return { collectionId: target.slice(0, i), eventId: target.slice(i + 1) };
}

/**
 * Applies a pin / unpin to a membership list optimistically. Unpinning from a
 * smart collection the event also matches by rule keeps the row (by_rule
 * still true); otherwise the row goes.
 */
export function applyMembershipChange(
  memberships: readonly { collection_id: string; pinned: boolean; by_rule: boolean }[],
  collectionId: string,
  pinned: boolean
): { collection_id: string; pinned: boolean; by_rule: boolean }[] {
  const existing = memberships.find((m) => m.collection_id === collectionId);
  if (pinned) {
    return existing
      ? memberships.map((m) => (m.collection_id === collectionId ? { ...m, pinned: true } : m))
      : [...memberships, { collection_id: collectionId, pinned: true, by_rule: false }];
  }
  return memberships.flatMap((m) =>
    m.collection_id !== collectionId ? [m] : m.by_rule ? [{ ...m, pinned: false }] : []
  );
}

/**
 * Queued pin / unpin intents for one event, keyed by collection id, laid over
 * the server's membership so the sheet shows what the user asked for even
 * before the queue has replayed (or after a restart while still offline).
 * `pending` holds the intent (`on`) per collection id.
 */
export function overlayPendingMembership(
  memberships: readonly { collection_id: string; pinned: boolean; by_rule: boolean }[],
  pending: ReadonlyMap<string, boolean>
): { collection_id: string; pinned: boolean; by_rule: boolean; pending: boolean }[] {
  const out = memberships.map((m) => {
    const intent = pending.get(m.collection_id);
    return intent === undefined ? { ...m, pending: false } : { ...m, pinned: intent, pending: true };
  });
  for (const [collectionId, on] of pending) {
    if (on && !out.some((m) => m.collection_id === collectionId)) {
      out.push({ collection_id: collectionId, pinned: true, by_rule: false, pending: true });
    }
  }
  // A queued unpin on an event the rule does not cover means "not in it".
  return out.filter((m) => m.pinned || m.by_rule);
}

/** Plural-aware "3 events · 1 repeating" for a collection card. */
export function describeCollectionCounts(c: { item_count: number; recurring_count: number }): string {
  const events = `${c.item_count} ${c.item_count === 1 ? 'event' : 'events'}`;
  return c.recurring_count > 0 ? `${events} · ${c.recurring_count} repeating` : events;
}
