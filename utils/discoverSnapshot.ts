/**
 * The last unfiltered Discover area: map centre plus the first page of
 * events there, kept on the device so Discover opens with pins and a list
 * offline (docs/OFFLINE_PLAN.md §3.5). Pure — unit-tested under node.
 */

export const DISCOVER_SNAPSHOT_MAX_ITEMS = 50;

export type DiscoverSnapshot<E> = {
  center: { lat: number; lng: number };
  items: E[];
  hasMore: boolean;
};

export type DiscoverFilters = {
  categories?: readonly string[] | undefined;
  searchQuery?: string | undefined;
  startDate?: unknown;
  endDate?: unknown;
};

/**
 * Only an unfiltered result is worth reopening: Discover always starts with
 * no filters, so a saved category / search / date result would be shown as
 * if it were everything nearby.
 */
export function isUnfiltered(filters: DiscoverFilters): boolean {
  return (
    (!filters.categories || filters.categories.length === 0) &&
    !filters.searchQuery &&
    filters.startDate == null &&
    filters.endDate == null
  );
}

export function makeDiscoverSnapshot<E>(lat: number, lng: number, items: readonly E[], hasMore: boolean): DiscoverSnapshot<E> {
  return {
    center: { lat, lng },
    items: items.slice(0, DISCOVER_SNAPSHOT_MAX_ITEMS),
    hasMore: hasMore || items.length > DISCOVER_SNAPSHOT_MAX_ITEMS,
  };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A usable snapshot, or null for anything malformed. */
export function parseDiscoverSnapshot<E extends { id: string }>(data: unknown): DiscoverSnapshot<E> | null {
  if (typeof data !== 'object' || data === null) return null;
  const { center, items, hasMore } = data as Partial<DiscoverSnapshot<unknown>>;
  if (!center || !finite(center.lat) || !finite(center.lng)) return null;
  if (!Array.isArray(items)) return null;
  const valid = items.filter(
    (e): e is E => typeof e === 'object' && e !== null && typeof (e as { id?: unknown }).id === 'string'
  );
  return { center: { lat: center.lat, lng: center.lng }, items: valid, hasMore: hasMore === true };
}
