import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { ReviewCard } from '@/components/ReviewCard';
import { ReviewForm } from '@/components/ReviewForm';
import { StarRatingDisplay } from '@/components/StarRatingDisplay';
import { Colors, Spacing, Typography } from '@/constants/theme';
import { seriesReviewsKey, useSeriesReviews } from '@/hooks/useSeriesReviews';
import { reviewsService } from '@/services/reviews';
import { notify } from '@/utils/notify';
import { REHEARSAL_NOT_SAVED } from '@/utils/rehearsal';
import { blockedOffline } from '@/utils/requireOnline';

export const SERIES_REVIEW_NOT_YET_COPY = "Reviews of this series open once you've attended one of its sessions.";

type Props = {
  eventId: string;
  businessId: string;
  isRecurring: boolean;
  viewerId: string | null;
  isOwner: boolean;
  /** Host preview: nothing is saved, and eligibility is simulated. */
  rehearsing?: boolean;
  rehearsalEligible?: boolean;
  onReport?: (reviewId: string) => void;
};

/**
 * "Reviews of this series" (D2 step 4). Renders nothing for one-offs or on a
 * backend without series reviews (useSeriesReviews' probe), so it can ship
 * before `20261119110000_series_reviews` is applied. Series reviews also
 * count toward the venue average (owner decision 2026-11-18), so a save
 * refreshes the venue section too.
 */
export function SeriesReviewsSection({
  eventId,
  businessId,
  isRecurring,
  viewerId,
  isOwner,
  rehearsing,
  rehearsalEligible,
  onReport,
}: Props) {
  const queryClient = useQueryClient();
  const query = useSeriesReviews(eventId, isRecurring, viewerId);
  const [showForm, setShowForm] = useState(false);
  const data = query.data;
  if (!isRecurring || !data?.supported) return null;

  const eligible = rehearsing ? rehearsalEligible : data.canReview;
  const canWrite = !!viewerId && !isOwner;
  // Nothing to read and nothing this viewer can do yet: stay out of the way
  // (the venue section below already says when reviews open). Shown as soon
  // as there is a review, the viewer has one, or the viewer may write one.
  const canWriteNow = canWrite && eligible !== false;
  if (data.summary.count === 0 && !data.mine && !canWriteNow) return null;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: seriesReviewsKey(eventId) });
    void queryClient.invalidateQueries({ queryKey: ['business-reviews', businessId] });
  };

  const handleSubmit = async (rating: number, text: string) => {
    if (rehearsing) {
      notify.success(REHEARSAL_NOT_SAVED.review);
      setShowForm(false);
      return;
    }
    if (blockedOffline('post a review')) return;
    try {
      await reviewsService.submitSeriesReview(businessId, eventId, rating, text || null);
    } catch (err) {
      // RLS refused: eligibility changed since the screen loaded.
      if ((err as { code?: string })?.code === '42501') {
        notify.error(SERIES_REVIEW_NOT_YET_COPY);
        refresh();
        return;
      }
      throw err;
    }
    // Show the saved review at once (as the venue section does); the
    // refetch then brings the server's copy and the new average.
    queryClient.setQueryData([...seriesReviewsKey(eventId), viewerId ?? 'anon'], (old: typeof data | undefined) =>
      old && old.supported ? { ...old, mine: { rating, text } } : old
    );
    setShowForm(false);
    refresh();
  };

  const handleRespond = async (reviewId: string, response: string) => {
    await reviewsService.updateBusinessResponse(reviewId, response);
    refresh();
  };

  return (
    <View style={styles.section} testID="series-reviews">
      <Text style={styles.title} accessibilityRole="header">
        Reviews of this series
      </Text>
      <View style={{ marginBottom: Spacing.md }}>
        <StarRatingDisplay average={data.summary.average} count={data.summary.count} />
      </View>
      {canWrite && !data.mine && eligible === false ? (
        <Text style={styles.notYet}>{SERIES_REVIEW_NOT_YET_COPY}</Text>
      ) : canWrite ? (
        showForm ? (
          <>
            <Text style={styles.formTitle}>Review this series</Text>
            <ReviewForm
              initialRating={data.mine?.rating || 0}
              initialText={data.mine?.text || ''}
              onSubmit={handleSubmit}
              onCancel={() => setShowForm(false)}
              isEditing={!!data.mine}
            />
          </>
        ) : (
          <TouchableOpacity
            style={styles.writeBtn}
            onPress={() => setShowForm(true)}
            accessibilityRole="button"
            accessibilityLabel={data.mine ? 'Edit your review of this series' : 'Review this series'}
          >
            <Text style={styles.writeBtnText}>{data.mine ? 'Edit your series review' : 'Review this series'}</Text>
          </TouchableOpacity>
        )
      ) : null}
      {data.list.map((review) => (
        <ReviewCard
          key={review.id}
          review={review}
          isOwner={isOwner}
          onRespond={isOwner ? handleRespond : undefined}
          canReport={!!viewerId && review.user_id !== viewerId}
          onReport={onReport}
        />
      ))}
    </View>
  );
}

// Mirrors EventDetail's venue-review styles so the two sections read alike.
const styles = StyleSheet.create({
  section: { marginTop: Spacing.xl },
  title: {
    fontSize: Typography.sizes.xl,
    lineHeight: 28,
    color: Colors.text.primary,
    letterSpacing: -0.2,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
    marginBottom: 8,
  },
  formTitle: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  writeBtn: {
    alignSelf: 'flex-start',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
    borderRadius: 8,
    backgroundColor: Colors.primarySoft,
  },
  writeBtnText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.primary,
  },
  notYet: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.regular,
    color: Colors.text.secondary,
    marginBottom: Spacing.md,
  },
});
