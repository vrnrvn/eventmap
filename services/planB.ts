/**
 * Plan B, client half (docs/PLAN_B_PLAN.md §4.1, P1): fetch candidates
 * around the anchor and rank them with utils/planB. No migration needed:
 * everything here reads RPCs already applied.
 *
 *  - T1/T2/T3: ONE `get_ranked_events` page centred on the anchor's venue,
 *    10 km, its date filter opened early enough to include events already
 *    running at the anchor's start (the SQL filters one-offs on
 *    `next_start >= start_date`), then the exceptions of any series among
 *    them so a skipped date is never suggested. A sparse result retries once
 *    at 25 km (the MoreOfTypeRail pattern).
 *  - T5 ("late"): `get_live_events` (20261120100000, applied), which already
 *    returns each row's running/next session; the live service falls back on
 *    its own where the function is missing.
 */
import { eventsService } from './events';
import { occurrencesService } from './occurrences';
import { liveEventsService } from './liveEvents';
import { PLAN_B, rankPlanB, type PlanBAnchor, type PlanBPick } from '@/utils/planB';
import type { OccurrenceException } from '@/utils/occurrences';
import type { RankedEvent } from '@/types/database';

/** How far before the window the ranked query starts, to catch running events. */
const RUNNING_LOOKBACK_MS = 6 * 60 * 60 * 1000;
const FETCH_SIZE = 40;

export type PlanBResult = { picks: PlanBPick[]; widened: boolean };

async function seriesExceptions(rows: readonly RankedEvent[]): Promise<OccurrenceException[]> {
  const ids = rows.filter((r) => r.is_recurring && r.recurrence_pattern).map((r) => r.id);
  if (!ids.length) return [];
  // Best-effort: without them a skipped date could slip in, but failing the
  // whole section over it would be worse.
  return occurrencesService.listExceptionsForEvents(ids).catch(() => [] as OccurrenceException[]);
}

export const planBService = {
  async getPicks(
    anchor: PlanBAnchor,
    opts: { now?: Date; preferredCategoryIds?: string[] | null } = {}
  ): Promise<PlanBResult> {
    const now = opts.now ?? new Date();
    const prefs = opts.preferredCategoryIds?.length ? opts.preferredCategoryIds : undefined;

    const attempt = async (radiusKm: number): Promise<PlanBPick[]> => {
      if (anchor.reason === 'late') {
        const { items } = await liveEventsService.getLiveEvents(anchor.lat, anchor.lng, {
          radiusKm,
          limit: FETCH_SIZE,
          preferredCategories: prefs,
        });
        return rankPlanB(anchor, items, { now, preferredCategoryIds: prefs, radiusKm });
      }
      const { items } = await eventsService.getRankedEventsPage(
        anchor.lat,
        anchor.lng,
        {
          radiusKm,
          startDate: new Date(anchor.windowStart.getTime() - RUNNING_LOOKBACK_MS),
          endDate: anchor.windowEnd,
          preferredCategories: prefs,
        },
        { limit: FETCH_SIZE, offset: 0 }
      );
      const exceptions = await seriesExceptions(items);
      return rankPlanB(anchor, items, { now, exceptions, preferredCategoryIds: prefs, radiusKm });
    };

    const near = await attempt(PLAN_B.radiusKm);
    if (near.length >= PLAN_B.sparseBelow) return { picks: near, widened: false };
    const wide = await attempt(PLAN_B.wideRadiusKm);
    // The wider ranking is a superset; keep it only if it adds something.
    return wide.length > near.length ? { picks: wide, widened: true } : { picks: near, widened: false };
  },
};
