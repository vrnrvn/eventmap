/**
 * Live events (roadmap phase 3): what is running right now nearby, then what
 * starts soon.
 *
 * Preferred path: `get_live_events` (PREPARED, supabase/prepared/
 * 2026-11-20_live_events — not applied anywhere yet). Until the owner applies
 * it, every backend takes the fallback: one get_ranked_events page plus the
 * recurring candidates' exceptions, classified on the device with the same
 * occurrenceInProgress the event page uses (parity with the SQL is held by
 * tests/liveParity.test.ts). The fallback ranks by distance only; the RPC
 * adds popularity, premium, interests and the seeded sprinkle.
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

const untypedRpc = (fn: string, args: Record<string, unknown>) =>
  (
    supabase as unknown as {
      rpc: (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;
    }
  ).rpc(fn, args);

export const liveEventsService = {
  async getLiveEvents(
    lat: number,
    lng: number,
    opts: { radiusKm?: number; limit?: number; preferredCategories?: string[]; seed?: string } = {}
  ): Promise<LiveEventsResult> {
    const radiusKm = opts.radiusKm ?? 25;
    const limit = opts.limit ?? 30;

    if (!isRpcKnownMissing('get_live_events')) {
      const { data, error } = await untypedRpc('get_live_events', {
        user_lat: lat,
        user_lng: lng,
        radius_km: radiusKm,
        p_limit: limit,
        p_soon_minutes: SOON_WINDOW_MINUTES,
        p_preferred_category_ids: opts.preferredCategories?.length ? opts.preferredCategories : null,
        p_seed: opts.seed ?? null,
      });
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
