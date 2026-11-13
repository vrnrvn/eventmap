/**
 * Private event collections (migration 20261112100000,
 * docs/EVENT_COLLECTIONS_PLAN.md §3.2–3.3).
 *
 * Reads go through the RPCs; writes are direct table writes under RLS, like
 * saves, and are idempotent on retry (a duplicate pin is success, a missing
 * row on removal is success) so the offline queue can replay them. Until the
 * migration is applied the tables and RPCs don't exist: reads then return
 * empty lists and remember the outage, writes throw
 * CollectionsUnavailableError, which the UI turns into "not available yet".
 */
import { supabase, getSessionUser } from './supabase';
import { signalEventWrites } from '@/utils/eventDataVersion';
import type {
  Collection,
  CollectionEvent,
  CollectionFilter,
  CollectionMembership,
  CollectionSort,
  RankedEvent,
} from '@/types/database';

export class CollectionsUnavailableError extends Error {
  readonly code = 'NOT_AVAILABLE' as const;

  constructor() {
    super("Collections aren't available on this server yet.");
    this.name = 'CollectionsUnavailableError';
  }
}

/** undefined_table, PostgREST unknown table, undefined_function, PostgREST unknown function. */
const MISSING = new Set(['42P01', 'PGRST205', '42883', 'PGRST202']);
let unavailable = false;

export function isCollectionsUnavailable(): boolean {
  return unavailable;
}

function checkMissing(error: { code?: string } | null): void {
  if (error?.code && MISSING.has(error.code)) {
    unavailable = true;
    throw new CollectionsUnavailableError();
  }
}

/** RPC row → list row. Collection rows never carry distance / premium. */
function toCollectionEvent(raw: Record<string, unknown>): CollectionEvent {
  return {
    ...(raw as unknown as RankedEvent),
    distance_km: 0,
    is_premium: false,
    has_ended: !!raw.has_ended,
    sources: (raw.sources as CollectionEvent['sources'] | null) ?? [],
    added_at: (raw.added_at as string | null) ?? (raw.created_at as string),
    note: (raw.note as string | null) ?? null,
  };
}

export type CreateCollectionInput =
  | { kind: 'manual'; name: string; color?: string | null; icon_key?: string | null }
  /** A favourited event type. Blank name = the category's label. */
  | { kind: 'smart'; categoryIds: string[]; name?: string; color?: string | null; icon_key?: string | null };

export type UpdateCollectionInput = {
  name?: string;
  color?: string | null;
  icon_key?: string | null;
  /** Smart collections only. */
  categoryIds?: string[];
};

export const collectionsService = {
  /** The caller's collections with counts and covers, in the user's order. */
  async list(): Promise<Collection[]> {
    if (unavailable) return [];
    const { data, error } = await supabase.rpc('get_user_collections');
    if (error) {
      checkMissing(error);
      throw error;
    }
    return ((data as unknown as Collection[] | null) ?? []).map((c) => ({
      ...c,
      category_ids: c.category_ids ?? [],
      cover_urls: c.cover_urls ?? [],
      item_count: c.item_count ?? 0,
      upcoming_count: c.upcoming_count ?? 0,
      recurring_count: c.recurring_count ?? 0,
      next_start_datetime: c.next_start_datetime ?? null,
    }));
  },

  /** One collection's events (upcoming first by default); [] for a collection the caller does not own. */
  async events(
    collectionId: string,
    opts: { limit?: number; offset?: number; sort?: CollectionSort; filter?: CollectionFilter; categoryIds?: string[] } = {}
  ): Promise<CollectionEvent[]> {
    if (unavailable) return [];
    const { data, error } = await supabase.rpc('get_collection_events', {
      p_collection_id: collectionId,
      p_limit: opts.limit ?? 50,
      p_offset: opts.offset ?? 0,
      p_sort: opts.sort ?? 'next',
      p_filter: opts.filter ?? 'all',
      p_category_ids: opts.categoryIds && opts.categoryIds.length > 0 ? opts.categoryIds : undefined,
    });
    if (error) {
      checkMissing(error);
      throw error;
    }
    return ((data as unknown as Record<string, unknown>[] | null) ?? []).map(toCollectionEvent);
  },

  /** Which of the caller's collections hold this event (pinned and/or by rule). */
  async membership(eventId: string): Promise<CollectionMembership[]> {
    if (unavailable) return [];
    const { data, error } = await supabase.rpc('get_event_collection_membership', { p_event_id: eventId });
    if (error) {
      checkMissing(error);
      throw error;
    }
    return (data as unknown as CollectionMembership[] | null) ?? [];
  },

  /**
   * Which of the caller's collections hold each of these events (pinned or
   * by rule), for list screens. Events in none are absent from the map.
   */
  async membershipMany(eventIds: readonly string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (unavailable || eventIds.length === 0) return out;
    const { data, error } = await supabase.rpc('get_events_collection_membership', {
      p_event_ids: [...new Set(eventIds)].slice(0, 200),
    });
    if (error) {
      checkMissing(error);
      throw error;
    }
    for (const row of (data as unknown as { event_id: string; collection_ids: string[] }[] | null) ?? []) {
      out.set(row.event_id, row.collection_ids ?? []);
    }
    return out;
  },

  async create(input: CreateCollectionInput): Promise<Collection> {
    if (unavailable) throw new CollectionsUnavailableError();
    const user = await getSessionUser();
    if (!user) throw new Error('Not authenticated');
    const row =
      input.kind === 'smart'
        ? {
            user_id: user.id,
            kind: 'smart',
            // The server fills a blank name from the category label.
            name: input.name ?? '',
            category_ids: input.categoryIds,
            color: input.color ?? null,
            icon_key: input.icon_key ?? null,
          }
        : {
            user_id: user.id,
            kind: 'manual',
            name: input.name,
            color: input.color ?? null,
            icon_key: input.icon_key ?? null,
          };
    const { data, error } = await supabase.from('collections').insert(row).select('*').single();
    if (error) {
      checkMissing(error);
      throw error;
    }
    return {
      ...(data as unknown as Collection),
      kind: data.kind as Collection['kind'],
      item_count: 0,
      upcoming_count: 0,
      recurring_count: 0,
      next_start_datetime: null,
      cover_urls: [],
    };
  },

  /**
   * Favourite an event type: the smart collection for exactly this category,
   * created if the caller has none yet. Returns the collection id.
   */
  async favouriteCategory(categoryId: string): Promise<string> {
    const existing = await this.findSmartForCategory(categoryId);
    if (existing) return existing;
    try {
      const created = await this.create({ kind: 'smart', categoryIds: [categoryId] });
      return created.id;
    } catch (err) {
      // Unique violation: a retry after an earlier insert landed but its
      // response was lost. Read the row that exists.
      if ((err as { code?: string } | null)?.code === '23505') {
        const again = await this.findSmartForCategory(categoryId);
        if (again) return again;
      }
      throw err;
    }
  },

  /** Id of the smart collection keyed on exactly this one category, or null. */
  async findSmartForCategory(categoryId: string): Promise<string | null> {
    if (unavailable) return null;
    const user = await getSessionUser();
    if (!user) return null;
    // `contains` is the array operator PostgREST handles reliably; the
    // exact-match check (one category only) is done on the few rows back.
    const { data, error } = await supabase
      .from('collections')
      .select('id, category_ids')
      .eq('user_id', user.id)
      .eq('kind', 'smart')
      .contains('category_ids', [categoryId]);
    if (error) {
      checkMissing(error);
      throw error;
    }
    return (data ?? []).find((c) => (c.category_ids ?? []).length === 1)?.id ?? null;
  },

  /** Unfavourite an event type: deletes the smart collection for exactly this category (pins included). */
  async unfavouriteCategory(categoryId: string): Promise<void> {
    const id = await this.findSmartForCategory(categoryId);
    if (id) await this.remove(id);
  },

  async update(collectionId: string, input: UpdateCollectionInput): Promise<void> {
    if (unavailable) throw new CollectionsUnavailableError();
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.color !== undefined) patch.color = input.color;
    if (input.icon_key !== undefined) patch.icon_key = input.icon_key;
    if (input.categoryIds !== undefined) patch.category_ids = input.categoryIds;
    if (Object.keys(patch).length === 0) return;
    const { error } = await supabase.from('collections').update(patch).eq('id', collectionId);
    if (error) {
      checkMissing(error);
      throw error;
    }
  },

  async remove(collectionId: string): Promise<void> {
    if (unavailable) throw new CollectionsUnavailableError();
    const { error } = await supabase.from('collections').delete().eq('id', collectionId);
    if (error) {
      checkMissing(error);
      throw error;
    }
  },

  /** Persists the order of the caller's collections (ids in display order). */
  async reorder(ids: string[]): Promise<void> {
    if (unavailable) throw new CollectionsUnavailableError();
    if (ids.length === 0) return;
    const { error } = await supabase.rpc('reorder_collections', { p_ids: ids });
    if (error) {
      checkMissing(error);
      throw error;
    }
  },

  /** Pin an event. Idempotent: an existing pin is success. */
  async addItem(collectionId: string, eventId: string, note?: string | null): Promise<void> {
    if (unavailable) throw new CollectionsUnavailableError();
    const { error } = await supabase
      .from('collection_items')
      .insert({ collection_id: collectionId, event_id: eventId, note: note ?? null });
    if (error && error.code !== '23505') {
      checkMissing(error);
      throw error;
    }
  },

  /** Unpin an event. A smart collection keeps it if a save / RSVP still matches the rule. */
  async removeItem(collectionId: string, eventId: string): Promise<void> {
    if (unavailable) throw new CollectionsUnavailableError();
    const { error } = await supabase
      .from('collection_items')
      .delete()
      .eq('collection_id', collectionId)
      .eq('event_id', eventId);
    if (error) {
      checkMissing(error);
      throw error;
    }
  },

  async setItemNote(collectionId: string, eventId: string, note: string | null): Promise<void> {
    if (unavailable) throw new CollectionsUnavailableError();
    const { error } = await supabase
      .from('collection_items')
      .update({ note })
      .eq('collection_id', collectionId)
      .eq('event_id', eventId);
    if (error) {
      checkMissing(error);
      throw error;
    }
  },
};

// Pins change what a collection screen shows; bump the shared version so
// list screens refetch on focus (utils/eventDataVersion).
signalEventWrites(collectionsService, ['create', 'update', 'remove', 'reorder', 'addItem', 'removeItem', 'setItemNote']);
