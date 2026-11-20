/**
 * Reviews service.
 * Handles business reviews (1-5 stars, text, business responses).
 */

import { supabase, getSessionUser } from './supabase';
import { isMissingDbFunction, isRpcKnownMissing, markRpcMissing } from '@/utils/rpcErrors';

export type Review = {
  id: string;
  user_id: string;
  business_id: string;
  /**
   * Set when the review is about one recurring series rather than the venue
   * (D2, `20261119110000_series_reviews`). Absent on backends without that
   * column; treat absent and null alike — a venue review.
   */
  event_id?: string | null;
  rating: number;
  text: string | null;
  business_response: string | null;
  created_at: string;
  updated_at: string;
};

export type ReviewWithProfile = Review & {
  profile: { name: string; avatar_url: string | null };
};

export type AverageRatingResult = {
  average: number;
  count: number;
};


/** Attach reviewer identities via RPC; the profiles table is owner-read-only. */
async function withProfiles(rows: any[]): Promise<ReviewWithProfile[]> {
  const unique = Array.from(new Set(rows.map((row) => row.user_id)));
  let profiles = new Map<string, { name: string; avatar_url: string | null }>();
  if (unique.length > 0) {
    const { data: display, error: displayError } = await supabase.rpc('get_profiles_display', {
      user_ids: unique,
    });
    if (displayError) throw displayError;
    profiles = new Map(
      ((display as unknown as { id: string; name: string; avatar_url: string | null }[]) || []).map(
        (row) => [row.id, { name: row.name, avatar_url: row.avatar_url }]
      )
    );
  }

  return rows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    business_id: row.business_id,
    event_id: row.event_id ?? null,
    rating: row.rating,
    text: row.text,
    business_response: row.business_response,
    created_at: row.created_at,
    updated_at: row.updated_at,
    profile: profiles.get(row.user_id) || { name: 'User', avatar_url: null },
  }));
}

/**
 * Step-3 (D2) RPCs are not in the generated types until
 * `20261119110000_series_reviews` is applied and types regenerated.
 */
// Called as a method: supabase.rpc reads `this`, so it must not be detached.
const untypedRpc = (fn: string, args: Record<string, unknown>) =>
  (
    supabase as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
    }
  ).rpc(fn, args);

// Prepared RPC (20261106150000) found missing this session; skip retries.
let summaryRpcUnavailable = false;
export const reviewsService = {
  /**
   * Create or update the caller's review of a venue.
   *
   * Goes through `submit_review()` (20261119100000), which names no
   * ON CONFLICT arbiter, so the reviews unique constraint can become the
   * D2 partial indexes underneath it. The direct upsert below is kept ONLY
   * for backends that do not have the function yet; it stops working once
   * `20261119110000_series_reviews` lands, and that migration must never be
   * applied before this release is live (supabase/prepared/2026-11-19_series_reviews).
   */
  async createOrUpdateReview(
    businessId: string,
    rating: number,
    text?: string | null
  ): Promise<void> {
    const user = await getSessionUser();
    if (!user) throw new Error('Not authenticated');

    if (!isRpcKnownMissing('submit_review')) {
      const { error } = await supabase.rpc('submit_review', {
        p_business_id: businessId,
        p_rating: rating,
        p_text: text || undefined,
      });
      if (!error) return;
      // RLS refusals (42501) and validation errors surface to the caller
      // exactly as the upsert's did.
      if (!isMissingDbFunction(error)) throw error;
      markRpcMissing('submit_review');
    }

    const { error } = await supabase.from('reviews').upsert(
      {
        user_id: user.id,
        business_id: businessId,
        rating,
        text: text || null,
      },
      {
        onConflict: 'user_id,business_id',
      }
    );

    if (error) throw error;
  },

  async getReviewsForBusiness(
    businessId: string,
    limit = 20
  ): Promise<ReviewWithProfile[]> {
    const { data, error } = await supabase
      .from('reviews')
      // `*` rather than a column list: picks up `event_id` where D2 is
      // applied without failing where it is not.
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return withProfiles((data || []) as any[]);
  },

  async getAverageRatingAndCount(businessId: string): Promise<AverageRatingResult> {
    // Server-side aggregate (prepared RPC): one row instead of every rating
    // row — the device download was unbounded and silently wrong past
    // PostgREST's max_rows for well-reviewed businesses.
    if (!summaryRpcUnavailable) {
      const { data, error } = await supabase.rpc('get_business_review_summary', {
        p_business_id: businessId,
      });
      if (!error) {
        const row = (Array.isArray(data) ? data[0] : data) as
          | { average: number | string | null; review_count: number | string | null }
          | undefined;
        return { average: Number(row?.average ?? 0), count: Number(row?.review_count ?? 0) };
      }
      if (!isMissingDbFunction(error)) throw error;
      summaryRpcUnavailable = true;
    }

    const { data, error } = await supabase
      .from('reviews')
      .select('rating')
      .eq('business_id', businessId);

    if (error) throw error;

    const reviews = data || [];
    if (reviews.length === 0) {
      return { average: 0, count: 0 };
    }

    const sum = reviews.reduce((acc, r) => acc + (r.rating || 0), 0);
    const average = Math.round((sum / reviews.length) * 10) / 10;

    return {
      average,
      count: reviews.length,
    };
  },

  /**
   * Whether the signed-in user may review this business — the same rule the
   * insert policy enforces (`user_can_review_business`: a started "going"
   * RSVP to one of its events, and not the owner). `null` = unknown (no
   * session check possible, function missing, or a failed call): callers keep
   * offering the form and let the server decide, as before EJ-3.
   */
  async canReview(businessId: string): Promise<boolean | null> {
    const user = await getSessionUser();
    if (!user) return false;
    const { data, error } = await supabase.rpc('user_can_review_business', { p_business_id: businessId });
    if (error) return null;
    return data === true;
  },

  /**
   * The caller's VENUE review. After D2 a person can hold a venue review and
   * series reviews under the same business_id, so this must not assume one
   * row (`.maybeSingle()` would error). Filtering `event_id IS NULL` in the
   * query would fail on backends without the column, so it is done here.
   */
  async getUserReview(businessId: string): Promise<Review | null> {
    const user = await getSessionUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('reviews')
      .select('*')
      .eq('user_id', user.id)
      .eq('business_id', businessId);

    if (error) throw error;
    const rows = (data ?? []) as unknown as Review[];
    return rows.find((row) => !row.event_id) ?? null;
  },


  // ---- Series reviews (D2 step 4) ---------------------------------------
  // Everything below needs `20261119110000_series_reviews`. The summary call
  // doubles as the capability probe: callers ask it first and treat `null`
  // as "this backend has no series reviews", touching nothing else — so no
  // query here ever names `event_id` on a backend without the column.

  /** The series' own average, or `null` where series reviews do not exist. */
  async getSeriesReviewSummary(eventId: string): Promise<AverageRatingResult | null> {
    if (isRpcKnownMissing('get_event_review_summary')) return null;
    const { data, error } = await untypedRpc('get_event_review_summary', { p_event_id: eventId });
    if (error) {
      if (!isMissingDbFunction(error)) throw error;
      markRpcMissing('get_event_review_summary');
      return null;
    }
    const row = (Array.isArray(data) ? data[0] : data) as
      | { average: number | string | null; review_count: number | string | null }
      | undefined;
    return { average: Number(row?.average ?? 0), count: Number(row?.review_count ?? 0) };
  },

  async getReviewsForSeries(eventId: string, limit = 20): Promise<ReviewWithProfile[]> {
    const { data, error } = await supabase
      .from('reviews')
      .select('*')
      .eq('event_id' as never, eventId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return withProfiles((data || []) as any[]);
  },

  /** One per (user, series) by the D2 unique index, so a single row. */
  async getUserSeriesReview(eventId: string): Promise<Review | null> {
    const user = await getSessionUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from('reviews')
      .select('*')
      .eq('user_id', user.id)
      .eq('event_id' as never, eventId)
      .maybeSingle();
    if (error) throw error;
    return (data as unknown as Review) ?? null;
  },

  /**
   * `user_can_review_event`: attended at least one finished session, and not
   * the host. `null` = unknown (keep offering the form; the server decides).
   */
  async canReviewSeries(eventId: string): Promise<boolean | null> {
    const user = await getSessionUser();
    if (!user) return false;
    const { data, error } = await untypedRpc('user_can_review_event', { p_event_id: eventId });
    if (error) return null;
    return data === true;
  },

  /**
   * Create or update the caller's review of a series. The server files it
   * under the series' own venue whatever `businessId` says.
   */
  async submitSeriesReview(
    businessId: string,
    eventId: string,
    rating: number,
    text?: string | null
  ): Promise<void> {
    const user = await getSessionUser();
    if (!user) throw new Error('Not authenticated');
    const { error } = await untypedRpc('submit_review', {
      p_business_id: businessId,
      p_rating: rating,
      p_text: text || undefined,
      p_event_id: eventId,
    });
    if (error) throw error;
  },

  async updateBusinessResponse(reviewId: string, response: string): Promise<void> {
    const user = await getSessionUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase
      .from('reviews')
      .update({ business_response: response })
      .eq('id', reviewId);

    if (error) throw error;
  },

  /**
   * Delete the caller's VENUE review only — by id, so a series review under
   * the same venue (D2) is never swept up with it.
   */
  async deleteReview(businessId: string): Promise<void> {
    const user = await getSessionUser();
    if (!user) throw new Error('Not authenticated');

    const mine = await reviewsService.getUserReview(businessId);
    if (!mine) return;

    const { error } = await supabase
      .from('reviews')
      .delete()
      .eq('id', mine.id)
      .eq('user_id', user.id);

    if (error) throw error;
  },
};
