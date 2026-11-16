/**
 * Shareable comparison links (docs/EVENT_COMPARISON_PLAN.md §3.2, decision D2).
 *
 * `/compare?ids=a,b,c` opens the comparison with those events. Two rules
 * protect hosts who chose "unlisted" (hidden from Discover and search, link
 * only):
 *  - a link never *includes* an unlisted event (`shareableCompareIds`), so a
 *    comparison cannot become a second way the event's link spreads;
 *  - an opened link *drops* an unlisted event unless the viewer could already
 *    see it — it was in their selection or details cache
 *    (`filterLinkedEvents`).
 * Events the server returns nothing for (cancelled, unpublished, gone) are
 * dropped the same way, and the screen says how many were.
 *
 * Pure module (no React Native imports) so it is unit-tested under node.
 */

import type { EventDetails, EventVisibility } from '@/types/database';
import { COMPARE_MAX } from '@/stores/compareStore';

/** Looks like an id we would have issued (uuid-ish); keeps junk out of requests. */
const ID_SHAPE = /^[0-9a-f-]{8,64}$/i;

/** Ids from the `ids` query param: split, trimmed, de-duplicated, capped. */
export function parseCompareIds(param: string | string[] | null | undefined): string[] {
  const raw = Array.isArray(param) ? param.join(',') : (param ?? '');
  const out: string[] = [];
  for (const piece of raw.split(',')) {
    const id = piece.trim();
    if (!id || !ID_SHAPE.test(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= COMPARE_MAX) break;
  }
  return out;
}

export function getCompareWebUrl(ids: readonly string[]): string {
  const base = (process.env.EXPO_PUBLIC_APP_WEB_ORIGIN ?? 'https://eventmap.pro').replace(/\/$/, '');
  return `${base}/compare?ids=${ids.join(',')}`;
}

/** The ids a link may carry, and how many unlisted events were left out. */
export function shareableCompareIds(
  events: readonly { id: string; visibility?: EventVisibility | null }[]
): { ids: string[]; excluded: number } {
  const ids = events.filter((e) => e.visibility !== 'unlisted').map((e) => e.id);
  return { ids, excluded: events.length - ids.length };
}

/**
 * What an opened link may show. `alreadyVisible` holds the ids the viewer
 * could see before the link: their current selection plus anything in the
 * details cache.
 */
export function filterLinkedEvents(
  results: readonly { id: string; details: EventDetails | null }[],
  alreadyVisible: ReadonlySet<string>
): { keep: EventDetails[]; dropped: number } {
  const keep: EventDetails[] = [];
  for (const r of results) {
    if (!r.details) continue;
    if (r.details.event.visibility === 'unlisted' && !alreadyVisible.has(r.id)) continue;
    keep.push(r.details);
  }
  return { keep, dropped: results.length - keep.length };
}

export function droppedFromLinkMessage(dropped: number): string {
  return dropped === 1 ? "1 event in this link isn't available." : `${dropped} events in this link aren't available.`;
}
