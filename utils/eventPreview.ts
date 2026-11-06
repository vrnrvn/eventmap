import type { Business, Category, Event, EventDetails } from '@/types/database';

/**
 * Opening an event with no connection (docs/OFFLINE_PLAN.md §3.5): if its
 * full details were never loaded, a row for it is often already cached in a
 * list (discover, saved, joined, calendar, profile). This finds such a row
 * and turns it into a partial EventDetails, so the page can show the title,
 * time, place and cover instead of an error. Pure — unit-tested under node.
 *
 * A preview doesn't know the viewer's real RSVP / save / follow state, links,
 * photos or waitlist; the screen marks it as a preview and blocks actions
 * until the real details load.
 */

type Row = Record<string, unknown>;

const isObject = (v: unknown): v is Row => typeof v === 'object' && v !== null;

/** A list row for event `id`: needs at least a title and a start time. */
function asEventRow(v: unknown, id: string): Row | null {
  if (!isObject(v)) return null;
  if (v.id === id && typeof v.title === 'string' && typeof v.start_datetime === 'string') return v;
  // Calendar rows wrap the event: { event, source }.
  if (isObject(v.event)) return asEventRow(v.event, id);
  return null;
}

/**
 * Searches cached query data (arrays, infinite-query `pages`, `rows` /
 * `items` containers) for a row describing event `id`. Prefers rows that
 * carry the business name. Bounded depth; never throws.
 */
export function findEventRow(datas: readonly unknown[], id: string): Row | null {
  let best: Row | null = null;
  const visit = (v: unknown, depth: number) => {
    if (depth > 4 || (best && typeof best.business_name === 'string')) return;
    const row = asEventRow(v, id);
    if (row) {
      if (!best || (typeof row.business_name === 'string' && typeof best.business_name !== 'string')) best = row;
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1);
    } else if (isObject(v)) {
      for (const key of ['pages', 'rows', 'items', 'events']) {
        if (key in v) visit(v[key], depth + 1);
      }
    }
  };
  for (const data of datas) visit(data, 0);
  return best;
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Partial details from a list row (see the module note for what's missing). */
export function previewDetailsFromRow(row: Row): EventDetails {
  const lat = num(row.lat, NaN);
  const lng = num(row.lng, NaN);
  const event = {
    ...row,
    id: str(row.id),
    business_id: str(row.business_id),
    title: str(row.title),
    description: str(row.description),
    category_id: str(row.category_id),
    start_datetime: str(row.start_datetime),
    end_datetime: str(row.end_datetime, str(row.start_datetime)),
    lat,
    lng,
    address: str(row.address),
    cover_image_url: typeof row.cover_image_url === 'string' ? row.cover_image_url : null,
    created_at: str(row.created_at),
    updated_at: str(row.updated_at, str(row.created_at)),
  } as Event;
  const business = {
    id: str(row.business_id),
    name: str(row.business_name),
    logo_url: typeof row.business_logo_url === 'string' ? row.business_logo_url : null,
    lat,
    lng,
  } as Business;
  const category = {
    id: str(row.category_id),
    label: str(row.category_label),
    slug: str(row.category_slug),
  } as Category;
  const rsvp = row.user_rsvp;
  return {
    event,
    business,
    category,
    links: [],
    photos: [],
    rsvp_count: num(row.rsvp_count),
    save_count: num(row.save_count),
    user_rsvp: rsvp === 'going' || rsvp === 'interested' || rsvp === 'requested' ? rsvp : null,
    user_saved: row.user_saved === true,
    user_following_business: false,
  } as EventDetails;
}
