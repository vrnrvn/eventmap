import { useQuery } from '@tanstack/react-query';
import { reviewsService, type AverageRatingResult, type ReviewWithProfile } from '@/services/reviews';

/**
 * Reviews of one recurring series (D2 step 4,
 * supabase/prepared/2026-11-19_series_reviews/README.md).
 *
 * `supported: false` where the backend has no series reviews yet: the
 * summary RPC is the probe, and nothing else is asked, so the section stays
 * hidden and costs one cached call per session (the miss is remembered).
 */
export type SeriesReviewsData =
  | { supported: false }
  | {
      supported: true;
      summary: AverageRatingResult;
      list: ReviewWithProfile[];
      mine: { rating: number; text: string } | null;
      /** null = unknown: offer the form and let the server decide. */
      canReview: boolean | null;
    };

export const seriesReviewsKey = (eventId: string | undefined) => ['series-reviews', eventId ?? 'none'] as const;

export function useSeriesReviews(eventId: string | undefined, isRecurring: boolean, viewerId: string | null) {
  return useQuery({
    queryKey: [...seriesReviewsKey(eventId), viewerId ?? 'anon'],
    enabled: !!eventId && isRecurring,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<SeriesReviewsData> => {
      const summary = await reviewsService.getSeriesReviewSummary(eventId!);
      if (!summary) return { supported: false };
      const [list, mine, canReview] = await Promise.all([
        reviewsService.getReviewsForSeries(eventId!),
        viewerId ? reviewsService.getUserSeriesReview(eventId!) : Promise.resolve(null),
        viewerId ? reviewsService.canReviewSeries(eventId!).catch(() => null) : Promise.resolve(false),
      ]);
      return {
        supported: true,
        summary,
        list,
        mine: mine ? { rating: mine.rating, text: mine.text || '' } : null,
        canReview,
      };
    },
  });
}
