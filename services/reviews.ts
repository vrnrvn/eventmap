/**
 * Reviews service.
 * Handles business reviews (1-5 stars, text, business responses).
 */

import { supabase, getSessionUser } from './supabase';

export type Review = {
  id: string;
  user_id: string;
  business_id: string;
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

export const reviewsService = {
  async createOrUpdateReview(
    businessId: string,
    rating: number,
    text?: string | null
  ): Promise<void> {
    const user = await getSessionUser();
    if (!user) throw new Error('Not authenticated');

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
      .select(
        `
        id,
        user_id,
        business_id,
        rating,
        text,
        business_response,
        created_at,
        updated_at
      `
      )
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    const rows = (data || []) as any[];
    // Reviewer identities via RPC; the profiles table is owner-read-only.
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
      rating: row.rating,
      text: row.text,
      business_response: row.business_response,
      created_at: row.created_at,
      updated_at: row.updated_at,
      profile: profiles.get(row.user_id) || { name: 'User', avatar_url: null },
    }));
  },

  async getAverageRatingAndCount(businessId: string): Promise<AverageRatingResult> {
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

  async getUserReview(businessId: string): Promise<Review | null> {
    const user = await getSessionUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('reviews')
      .select('*')
      .eq('user_id', user.id)
      .eq('business_id', businessId)
      .maybeSingle();

    if (error) throw error;
    return data;
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

  async deleteReview(businessId: string): Promise<void> {
    const user = await getSessionUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase
      .from('reviews')
      .delete()
      .eq('user_id', user.id)
      .eq('business_id', businessId);

    if (error) throw error;
  },
};
