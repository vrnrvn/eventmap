import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/hooks/queryKeys';
import { useScreenState } from '@/hooks/useScreenState';
import { PERSISTED_QUERY } from '@/utils/queryPersistence';
import { FreshnessNote, OfflineState } from '@/components/ui/QueryStates';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Platform,
  Dimensions,
  RefreshControl,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { useApp } from '@/contexts/AppContext';
import { businessesService } from '@/services/businesses';
import { eventsService } from '@/services/events';
import { socialService } from '@/services/social';
import { reviewsService, type ReviewWithProfile } from '@/services/reviews';
import { Business, Event } from '@/types/database';
import { hasEventEnded } from '@/utils/eventStatus';
import { getNextOccurrences } from '@/utils/recurrence';
import { formatEventDate } from '@/utils/formatEventWhen';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import { Avatar } from '@/components/Avatar';
import { CategoryIcon } from '@/components/CategoryIcon';
import { getCategorySlug } from '@/constants/categoryIcons';
import { StarRatingDisplay } from '@/components/StarRatingDisplay';
import { ReviewCard } from '@/components/ReviewCard';
import { GoogleMapView } from '@/components/GoogleMapView';
import { DeferredMount } from '@/components/DeferredMount';
import { EventCardCarousel } from '@/components/EventCardCarousel';
import {
  BadgeCheck,
  MapPin,
  Mail,
  ExternalLink,
  Heart,
  Calendar,
  Flag,
} from 'lucide-react-native';
import { FacebookIcon, InstagramIcon } from '@/components/icons/BrandIcons';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ErrorState } from '@/components/ui/ErrorState';
import { complaintsService } from '@/services/complaints';
import { notify, notifyConfirm } from '@/utils/notify';
import { connectionErrorMessage } from '@/utils/networkErrors';
import { runOrQueueWithNotice } from '@/services/pendingWrites';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

function buildGoogleSearchUrl(business: Business): string {
  const query = encodeURIComponent(`${business.name} ${business.address}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

function buildInstagramUrl(handle: string): string {
  const clean = handle.replace(/^@/, '').trim();
  return `https://instagram.com/${clean}`;
}

function buildFacebookUrl(handle: string): string {
  const clean = handle.trim();
  if (clean.startsWith('http')) return clean;
  if (clean.startsWith('facebook.com/') || clean.startsWith('fb.com/')) {
    return `https://${clean}`;
  }
  return `https://facebook.com/${clean}`;
}

type BusinessPage = {
  business: Business | null;
  photos: string[];
  links: { id: string; label: string | null; url: string }[];
  events: Event[];
  upcomingCount: number | null;
  averageRating: { average: number; count: number };
  followerCount: number;
  following: boolean;
  reviews: ReviewWithProfile[];
};

export default function BusinessDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { userBusiness } = useApp();
  const [business, setBusiness] = useState<Business | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [links, setLinks] = useState<Array<{ id: string; label: string | null; url: string }>>([]);
  const [events, setEvents] = useState<Event[]>([]);
  // Real count: the list is capped at 10, so events.length under-reported.
  const [upcomingCount, setUpcomingCount] = useState<number | null>(null);
  const [reviews, setReviews] = useState<ReviewWithProfile[]>([]);
  const [averageRating, setAverageRating] = useState({ average: 0, count: 0 });
  const [followerCount, setFollowerCount] = useState(0);
  const [following, setFollowing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const isOwner = userBusiness?.id === id;
  const queryClient = useQueryClient();

  // The whole page is one cached query, kept on the device so business pages
  // you've visited open offline (docs/OFFLINE_PLAN.md §3.5). Optional
  // sections that fail keep their last known value instead of blanking.
  const query = useQuery({
    queryKey: queryKeys.businessPage(id ?? ''),
    ...PERSISTED_QUERY,
    enabled: !!id,
    queryFn: async (): Promise<BusinessPage> => {
      const previous = queryClient.getQueryData<BusinessPage>(queryKeys.businessPage(id!));
      const [biz, photosData, linksData, eventsData, upcoming, avg, count, isFollowingResult, reviewsList] =
        await Promise.all([
          businessesService.getBusiness(id!),
          businessesService.getBusinessPhotos(id!).catch(() => null),
          businessesService.getBusinessLinks(id!).catch(() => null),
          eventsService.getBusinessEvents(id!, { limit: 10, scope: 'upcoming' }),
          eventsService.getBusinessEventsCount(id!, { scope: 'upcoming' }).catch(() => null),
          reviewsService.getAverageRatingAndCount(id!),
          businessesService.getFollowerCount(id!),
          user ? socialService.isFollowingBusiness(id!) : Promise.resolve(false),
          reviewsService.getReviewsForBusiness(id!),
        ]);
      return {
        business: biz || null,
        photos: photosData ? photosData.map((p) => p.image_url) : (previous?.photos ?? []),
        links: linksData ?? previous?.links ?? [],
        events: eventsData,
        upcomingCount: upcoming ?? previous?.upcomingCount ?? null,
        averageRating: avg,
        followerCount: count,
        following: isFollowingResult,
        reviews: biz ? reviewsList : [],
      };
    },
  });
  const { state: screenState, freshness } = useScreenState(query, {
    hasData: query.data !== undefined,
    isEmpty: false,
  });
  const loading = screenState === 'loading';
  const loadError = screenState === 'error' || screenState === 'offline';

  // Follow / review actions update these locally; each fetched page resets
  // them to the server's values.
  useEffect(() => {
    const page = query.data;
    if (!page) return;
    setBusiness(page.business);
    setPhotos(page.photos);
    setLinks(page.links);
    // Ended recurring series come back from the upcoming query, and cached
    // rows can be days old: drop ended events.
    setEvents(page.events.filter((e) => !hasEventEnded(e)));
    setUpcomingCount(page.upcomingCount);
    setAverageRating(page.averageRating);
    setFollowerCount(page.followerCount);
    setFollowing(page.following);
    setReviews(page.reviews);
  }, [query.data]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    query.refetch().finally(() => setRefreshing(false));
  }, [query]);

  const handleFollow = async () => {
    if (!user || !id) return;
    setSaving(true);
    try {
      // Queued when offline and replayed on reconnect; shown as done either way.
      await runOrQueueWithNotice({ kind: 'follow', targetId: id, on: !following, label: business?.name });
      setFollowing(!following);
      setFollowerCount((c) => Math.max(0, c + (following ? -1 : 1)));
      // Keep the cached page in step, so an offline reopen shows the change.
      queryClient.setQueryData<BusinessPage>(queryKeys.businessPage(id), (page) =>
        page
          ? {
              ...page,
              following: !following,
              followerCount: Math.max(0, page.followerCount + (following ? -1 : 1)),
            }
          : page
      );
    } catch (err) {
      notify.error(connectionErrorMessage(err) ?? (following ? 'Failed to unfollow' : 'Failed to follow'));
    } finally {
      setSaving(false);
    }
  };

  const retryLoad = () => void query.refetch();

  /** Recurring series display their next occurrence, not the first one. */
  const nextStartOf = (event: Event) =>
    event.is_recurring
      ? (getNextOccurrences(event, 1)[0]?.toISOString() ?? event.start_datetime)
      : event.start_datetime;

  const formatDate = (dateString: string) => formatEventDate(dateString);

  // Also while fetched data is being copied into state (one render).
  if ((loading && !business) || (!business && query.data?.business)) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <ScreenHeader title="Business" safeArea={false} />
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </View>
    );
  }

  if (!business) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <ScreenHeader title="Business" safeArea={false} />
        <View style={styles.centerContainer}>
          {screenState === 'offline' ? (
            <OfflineState onRetry={retryLoad} />
          ) : loadError ? (
            <ErrorState
              title="Couldn't load this business"
              onRetry={retryLoad}
            />
          ) : (
            <Text style={styles.errorText}>Business not found</Text>
          )}
        </View>
      </View>
    );
  }

  const allLinks: Array<{ id: string; label: string | null; url: string }> = [
    ...links,
    { id: 'google-maps', label: 'View on Google Maps', url: buildGoogleSearchUrl(business) },
    ...(business.google_reviews_url?.trim()
      ? [{ id: 'google-reviews', label: 'Google Reviews', url: business.google_reviews_url.trim() }]
      : []),
  ];

  const socialHandles = (business.social_handles as { instagram?: string; facebook?: string } | null) ?? {};

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScreenHeader
        title={business.name}
        safeArea={false}
        right={
          user && !isOwner ? (
            <TouchableOpacity
              style={styles.reportButton}
              accessibilityRole="button"
              accessibilityLabel="Report business"
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              onPress={() => {
                notifyConfirm({
                  title: 'Report Business',
                  message: 'Report this business for inappropriate content?',
                  confirmLabel: 'Report',
                  destructive: true,
                  onConfirm: async () => {
                    try {
                      await complaintsService.createComplaint('business', id);
                      notify.success('Your report has been submitted.');
                    } catch (err: unknown) {
                      if ((err as { code?: string })?.code === '23505') {
                        notify.success("You've already reported this. It's in the queue.");
                      } else {
                        notify.error('Failed to submit report.');
                      }
                    }
                  },
                });
              }}
            >
              <Flag size={20} color={Colors.text.tertiary} />
            </TouchableOpacity>
          ) : undefined
        }
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        <FreshnessNote text={freshness} style={styles.freshness} />
        {/* Hero: logo + name + category */}
        <View style={styles.hero}>
          <Avatar imageUrl={business.logo_url} name={business.name} size={100} />
          <Text style={styles.businessName}>{business.name}</Text>
          {business.verified ? (
            <View
              style={styles.verifiedBadge}
              accessibilityLabel="Verified business"
            >
              <BadgeCheck size={14} color={Colors.text.inverse} />
              <Text style={styles.verifiedBadgeText}>Verified</Text>
            </View>
          ) : null}
          <View style={styles.categoryBadge}>
            <CategoryIcon category={business.category} size="sm" variant="pill" />
            <Text style={styles.categoryText}>{business.category}</Text>
          </View>
          {!isOwner && user && (
            <TouchableOpacity
              style={[styles.followBtn, following && styles.followBtnActive]}
              onPress={handleFollow}
              disabled={saving}
              accessibilityRole="button"
              accessibilityState={{ selected: following, disabled: saving }}
              accessibilityLabel={
                following ? `Unfollow ${business.name}` : `Follow ${business.name}`
              }
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Heart
                size={18}
                color={following ? Colors.text.inverse : Colors.primary}
                fill={following ? Colors.text.inverse : 'transparent'}
              />
              <Text style={[styles.followBtnText, following && styles.followBtnTextActive]}>
                {following ? 'Following' : 'Follow'}
              </Text>
            </TouchableOpacity>
          )}
          {/* Compact stats row */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{followerCount}</Text>
              <Text style={styles.statLabel}>
                Follower{followerCount !== 1 ? 's' : ''}
              </Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>
                {averageRating.count > 0 ? averageRating.average.toFixed(1) : '—'}
              </Text>
              <Text style={styles.statLabel}>Rating</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{upcomingCount ?? events.length}</Text>
              <Text style={styles.statLabel}>Upcoming</Text>
            </View>
          </View>
        </View>

        {/* Upcoming events */}
        {events.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Upcoming Events</Text>
            {events.map((event) => (
              <TouchableOpacity
                key={event.id}
                style={styles.eventCard}
                onPress={() => router.push(`/event/${event.id}` as never)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`${event.title}, ${formatDate(nextStartOf(event))}`}
              >
                <Calendar size={20} color={Colors.primary} />
                <View style={styles.eventInfo}>
                  <Text style={styles.eventTitle} numberOfLines={2}>
                    {event.title}
                  </Text>
                  <Text style={styles.eventDate}>
                    {formatDate(nextStartOf(event))}
                    {event.is_recurring ? ' · repeats' : ''}
                  </Text>
                </View>
                <Text style={styles.viewEvent}>View</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {/* About */}
        {business.description ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.description}>{business.description}</Text>
          </View>
        ) : null}

        {/* Venue photos */}
        {photos.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Venue Photos</Text>
            <EventCardCarousel imageUrls={photos} imageHeight={280} />
          </View>
        )}

        {/* Location */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Location</Text>
          <View style={styles.addressRow}>
            <MapPin size={18} color={Colors.text.secondary} />
            <Text style={styles.addressText}>{business.address}</Text>
          </View>
          <View style={styles.mapContainer}>
            {/* Below the fold — don't build the map WebView mid-transition. */}
            <DeferredMount style={styles.mapFill}>
              <GoogleMapView
                center={{ lat: business.lat, lng: business.lng }}
                zoom={15}
                mapGesturesEnabled={false}
                webViewScrollEnabled={false}
                nestedScrollEnabled={false}
                markers={[
                  {
                    id: business.id,
                    lat: business.lat,
                    lng: business.lng,
                    title: business.name,
                    categorySlug: getCategorySlug(business.category) ?? undefined,
                  },
                ]}
              />
            </DeferredMount>
          </View>
        </View>

        {/* Contact */}
        {business.contact_email ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Contact</Text>
            <TouchableOpacity
              style={styles.linkRow}
              onPress={() => Linking.openURL(`mailto:${business.contact_email}`)}
              accessibilityRole="button"
              accessibilityLabel={`Email ${business.contact_email}`}
              hitSlop={{ top: 4, bottom: 4 }}
            >
              <Mail size={18} color={Colors.primary} />
              <Text style={styles.linkText}>{business.contact_email}</Text>
              <ExternalLink size={16} color={Colors.text.tertiary} />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Links */}
        {allLinks.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Links</Text>
            {allLinks.map((link) => (
              <TouchableOpacity
                key={link.id}
                style={styles.linkRow}
                onPress={() => Linking.openURL(link.url)}
                accessibilityRole="link"
                accessibilityLabel={link.label || link.url}
                hitSlop={{ top: 4, bottom: 4 }}
              >
                <Text style={styles.linkText} numberOfLines={1}>
                  {link.label || link.url}
                </Text>
                <ExternalLink size={16} color={Colors.text.tertiary} />
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {/* Connect - Instagram / Facebook */}
        {(socialHandles.instagram || socialHandles.facebook) ? (
          <View style={styles.socialsSection}>
            <Text style={styles.socialsLabel}>Connect</Text>
            <View style={styles.socials}>
              {socialHandles.instagram ? (
                <TouchableOpacity
                  style={styles.socialBtn}
                  onPress={() => Linking.openURL(buildInstagramUrl(socialHandles.instagram!))}
                  activeOpacity={0.7}
                  accessibilityRole="link"
                  accessibilityLabel="Open Instagram"
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                >
                  <InstagramIcon size={24} />
                </TouchableOpacity>
              ) : null}
              {socialHandles.facebook ? (
                <TouchableOpacity
                  style={styles.socialBtn}
                  onPress={() => Linking.openURL(buildFacebookUrl(socialHandles.facebook!))}
                  activeOpacity={0.7}
                  accessibilityRole="link"
                  accessibilityLabel="Open Facebook"
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                >
                  <FacebookIcon size={24} />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* Reviews */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Reviews</Text>
          {averageRating.count === 0 && reviews.length === 0 ? (
            <Text style={styles.noReviewsText}>
              No reviews yet — be the first to share your experience.
            </Text>
          ) : (
            <View style={styles.ratingRow}>
              <StarRatingDisplay average={averageRating.average} count={averageRating.count} />
            </View>
          )}
          {reviews.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              isOwner={isOwner}
              onRespond={
                isOwner
                  ? async (reviewId, response) => {
                      await reviewsService.updateBusinessResponse(reviewId, response);
                      // Show the saved response now; the reload is best-effort
                      // so a failure can't report the saved response as failed.
                      setReviews((prev) =>
                        prev.map((r) => (r.id === reviewId ? { ...r, business_response: response } : r))
                      );
                      reviewsService
                        .getReviewsForBusiness(id!)
                        .then(setReviews)
                        .catch(() => {});
                    }
                  : undefined
              }
              canReport={!!user && review.user_id !== user.id}
              onReport={
                user
                  ? (reviewId) => {
                      notifyConfirm({
                        title: 'Report Review',
                        message: 'Report this review for inappropriate content?',
                        confirmLabel: 'Report',
                        destructive: true,
                        onConfirm: async () => {
                          try {
                            await complaintsService.createComplaint('review', reviewId);
                            notify.success('Your report has been submitted.');
                          } catch (err: unknown) {
                            if ((err as { code?: string })?.code === '23505') {
                              notify.success("You've already reported this. It's in the queue.");
                            } else {
                              notify.error('Failed to submit report.');
                            }
                          }
                        },
                      });
                    }
                  : undefined
              }
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  freshness: {
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
  },
  root: {
    flex: 1,
    backgroundColor: Colors.background.secondary,
  },
  reportButton: {
    padding: Spacing.sm,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
  },
  scroll: {
    flex: 1,
  },
  hero: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    backgroundColor: Colors.background.primary,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.light,
  },
  businessName: {
    fontSize: 24,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginTop: Spacing.md,
    textAlign: 'center',
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.primary,
  },
  verifiedBadgeText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.inverse,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.background.secondary,
  },
  categoryText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.secondary,
  },
  followBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.round,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  followBtnActive: {
    backgroundColor: Colors.primary,
  },
  followBtnText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },
  followBtnTextActive: {
    color: Colors.text.inverse,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
    marginTop: Spacing.md,
  },
  statItem: {
    alignItems: 'center',
    minWidth: 64,
  },
  statValue: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  statLabel: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.labelFontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.tertiary,
    marginTop: 2,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: Spacing.lg,
    backgroundColor: Colors.border.light,
  },
  section: {
    padding: Spacing.lg,
    backgroundColor: Colors.surface,
    marginTop: Spacing.sm,
  },
  sectionTitle: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.secondary,
    textTransform: 'uppercase',
    marginBottom: Spacing.md,
  },
  description: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.primary,
    lineHeight: 24,
  },
  socialsSection: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.background.primary,
    marginTop: Spacing.sm,
    alignItems: 'center',
  },
  socialsLabel: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing.sm,
  },
  socials: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.lg,
  },
  socialBtn: {
    padding: Spacing.sm,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  addressText: {
    flex: 1,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.primary,
    lineHeight: 22,
  },
  mapContainer: {
    height: 180,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.background.secondary,
  },
  /** Keeps the deferred wrapper filling the map slot so there's no layout shift. */
  mapFill: {
    flex: 1,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border.light,
  },
  linkText: {
    flex: 1,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.primary,
  },
  ratingRow: {
    marginBottom: Spacing.md,
  },
  noReviewsText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
  },
  eventCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border.light,
  },
  eventInfo: {
    flex: 1,
    minWidth: 0,
  },
  eventTitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  eventDate: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    marginTop: 2,
  },
  viewEvent: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },
});
