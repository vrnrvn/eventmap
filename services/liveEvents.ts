/**
 * Live events (roadmap phase 3): what is running right now nearby, then what
 * starts soon.
 *
 * Preferred path: `get_live_events` (20261120100000, APPLIED locally
 * 2026-11-19 in c34139c; in the generated types). It ranks by proximity,
 * popularity, premium, interests (a boost, never a filter) and a seeded
 * sprinkle.
 *
 * Fallback, kept on purpose: where the function is missing (a backend behind
 * the migration set), one get_ranked_events page plus the recurring
 * candidates' exceptions, classified on the device with the same
 * occurrenceInProgress the event page uses (parity with the SQL is held by
 * tests/liveParity.test.ts). It only changes what is shown, never what is
 * written, which is the kind of degradation the client/schema policy allows
 * (docs/ISSUES.md ground rules). It ranks by distance only.
 */
import { supabase } from './supabase';
import { eventsService } from './events';
import { occurrencesService } from './occurrences';
import { isMissingDbFunction, isRpcKnownMissing, markRpcMissing } from '@/utils/rpcErrors';
import { type OccurrenceException } from '@/utils/occurrences';
import { classifyLive, SOON_WINDOW_MINUTES, type LiveStatus } from '@/utils/liveEvents';
import type { RankedEvent } from '@/types/database';

export type LiveEvent = RankedEvent & {
  occ_start: string;
  occ_end: string;
  live_status: LiveStatus;
};

export { SOON_WINDOW_MINUTES };
/** How the list was produced; 'fallback' lacks the interest/sprinkle ranking. */
export type LiveEventsResult = { items: LiveEvent[]; source: 'rpc' | 'fallback' };

export const liveEventsService = {
  async getLiveEvents(
    lat: number,
    lng: number,
    opts: { radiusKm?: number; limit?: number; preferredCategories?: string[]; seed?: string } = {}
  ): Promise<LiveEventsResult> {
    const radiusKm = opts.radiusKm ?? 25;
    const limit = opts.limit ?? 30;

    if (!isRpcKnownMissing('get_live_events')) {
      // Omitted keys take the SQL defaults (both NULL: no interest boost, an
      // unseeded sprinkle), which is what sending null used to mean.
      const { data, error } = await supabase.rpc('get_live_events', {
        user_lat: lat,
        user_lng: lng,
        radius_km: radiusKm,
        p_limit: limit,
        p_soon_minutes: SOON_WINDOW_MINUTES,
        p_preferred_category_ids: opts.preferredCategories?.length ? opts.preferredCategories : undefined,
        p_seed: opts.seed,
      });
      // The generated row types live_status as plain text; the SQL only ever
      // returns 'live' | 'soon' (20261120100000), which LiveEvent narrows to.
      if (!error) return { items: (data ?? []) as LiveEvent[], source: 'rpc' };
      if (!isMissingDbFunction(error)) throw error;
      markRpcMissing('get_live_events');
    }

    // Fallback: classify a ranked page on the device.
    const now = new Date();
    const { items: ranked } = await eventsService.getRankedEventsPage(lat, lng, { radiusKm }, { limit: 100, offset: 0 });
    const seriesIds = ranked.filter((e) => e.is_recurring && e.recurrence_pattern).map((e) => e.id);
    const exceptions = seriesIds.length
      ? await occurrencesService.listExceptionsForEvents(seriesIds).catch(() => [] as OccurrenceException[])
      : [];
    const items = ranked
      .flatMap((e) => {
        const c = classifyLive(e, exceptions, now);
        return c ? [{ ...e, ...c }] : [];
      })
      .sort((a, b) =>
        a.live_status === b.live_status
          ? a.live_status === 'live'
            ? a.distance_km - b.distance_km
            : a.occ_start.localeCompare(b.occ_start)
          : a.live_status === 'live'
            ? -1
            : 1
      )
      .slice(0, limit);
    return { items, source: 'fallback' };
  },
};
