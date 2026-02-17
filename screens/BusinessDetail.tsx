import { useState, useEffect, useCallback } from 'react';
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
  Alert,
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
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import { Avatar } from '@/components/Avatar';
import { CategoryIcon } from '@/components/CategoryIcon';
import { StarRatingDisplay } from '@/components/StarRatingDisplay';
import { ReviewCard } from '@/components/ReviewCard';
import { GoogleMapView } from '@/components/GoogleMapView';
import { EventCardCarousel } from '@/components/EventCardCarousel';
import {
  ArrowLeft,
  MapPin,
  Mail,
  ExternalLink,
  Heart,
  Calendar,
  Flag,
} from 'lucide-react-native';
import { complaintsService } from '@/services/complaints';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

function buildGoogleSearchUrl(business: Business): string {
  const query = encodeURIComponent(`${business.name} ${business.address}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

function buildGoogleReviewsUrl(business: Business): string {
  const query = encodeURIComponent(`${business.name} ${business.address} reviews`);
  return `https://www.google.com/search?q=${query}`;
}

export default function BusinessDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { userBusiness } = useApp();
  const [business, setBusiness] = useState<Business | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [links, setLinks] = useState<Array<{ id: string; label: string | null; url: string }>>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [reviews, setReviews] = useState<ReviewWithProfile[]>([]);
  const [averageRating, setAverageRating] = useState({ average: 0, count: 0 });
  const [followerCount, setFollowerCount] = useState(0);
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const isOwner = userBusiness?.id === id;

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [biz, photosData, linksData, eventsData, avg, count, isFollowingResult] = await Promise.all([
        businessesService.getBusiness(id),
        businessesService.getBusinessPhotos(id).catch(() => []),
        businessesService.getBusinessLinks(id).catch(() => []),
        eventsService.getBusinessEvents(id, { limit: 10 }),
        reviewsService.getAverageRatingAndCount(id),
        businessesService.getFollowerCount(id),
        user ? socialService.isFollowingBusiness(id) : Promise.resolve(false),
      ]);
      setBusiness(biz || null);
      setPhotos(photosData.map((p) => p.image_url));
      setLinks(linksData);
      setEvents(eventsData);
      setAverageRating(avg);
      setFollowerCount(count);
      setFollowing(isFollowingResult);

      if (biz) {
        const reviewsList = await reviewsService.getReviewsForBusiness(id);
        setReviews(reviewsList);
      }
    } catch (error) {
      console.error('Failed to load business:', error);
      setBusiness(null);
    } finally {
      setLoading(false);
    }
  }, [id, user]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  const handleFollow = async () => {
    if (!user || !id) return;
    setSaving(true);
    try {
      if (following) {
        await socialService.unfollowBusiness(id);
        setFollowing(false);
        setFollowerCount((c) => Math.max(0, c - 1));
      } else {
        await socialService.followBusiness(id);
        setFollowing(true);
        setFollowerCount((c) => c + 1);
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  if (loading && !business) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
            <ArrowLeft size={22} color={Colors.text.primary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Business</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </View>
    );
  }

  if (!business) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
            <ArrowLeft size={22} color={Colors.text.primary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Business</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.centerContainer}>
          <Text style={styles.errorText}>Business not found</Text>
        </View>
      </View>
    );
  }

  const allLinks = [
    ...links,
    { id: 'google-maps', label: 'View on Google Maps', url: buildGoogleSearchUrl(business) },
    { id: 'google-reviews', label: 'Google Reviews', url: buildGoogleReviewsUrl(business) },
  ];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <ArrowLeft size={22} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {business.name}
        </Text>
        <View style={styles.headerSpacer}>
          {user && !isOwner && (
            <TouchableOpacity
              style={styles.reportButton}
              onPress={() => {
                Alert.alert(
                  'Report Business',
                  'Report this business for inappropriate content?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Report',
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          await complaintsService.createComplaint('business', id);
                          Alert.alert('Thank you', 'Your report has been submitted.');
                        } catch {
                          Alert.alert('Error', 'Failed to submit report.');
                        }
                      },
                    },
                  ]
                );
              }}
            >
              <Flag size={20} color={Colors.text.tertiary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        {/* Hero: logo + name + category */}
        <View style={styles.hero}>
          <Avatar imageUrl={business.logo_url} name={business.name} size={100} />
          <Text style={styles.businessName}>{business.name}</Text>
          <View style={styles.categoryBadge}>
            <CategoryIcon category={business.category} size="sm" variant="pill" />
            <Text style={styles.categoryText}>{business.category}</Text>
          </View>
          {!isOwner && user && (
            <TouchableOpacity
              style={[styles.followBtn, following && styles.followBtnActive]}
              onPress={handleFollow}
              disabled={saving}
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
          <Text style={styles.followerCount}>{followerCount} follower{followerCount !== 1 ? 's' : ''}</Text>
        </View>

        {/* About */}
        {business.description ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.description}>{business.description}</Text>
          </View>
        ) : null}

        {/* Location */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Location</Text>
          <View style={styles.addressRow}>
            <MapPin size={18} color={Colors.text.secondary} />
            <Text style={styles.addressText}>{business.address}</Text>
          </View>
          <View style={styles.mapContainer}>
            <GoogleMapView
              center={{ lat: business.lat, lng: business.lng }}
              zoom={15}
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
          </View>

          {photos.length > 0 && (
            <View style={styles.venueCarouselWrap}>
              <Text style={styles.venuePhotosLabel}>Venue Photos</Text>
              <EventCardCarousel imageUrls={photos} imageHeight={280} />
            </View>
          )}
        </View>

        {/* Contact */}
        {business.contact_email ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Contact</Text>
            <TouchableOpacity
              style={styles.linkRow}
              onPress={() => Linking.openURL(`mailto:${business.contact_email}`)}
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
              >
                <ExternalLink size={18} color={Colors.primary} />
                <Text style={styles.linkText} numberOfLines={1}>
                  {link.label || link.url}
                </Text>
                <ExternalLink size={16} color={Colors.text.tertiary} />
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {/* Reviews */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Reviews</Text>
          <View style={styles.ratingRow}>
            <StarRatingDisplay average={averageRating.average} count={averageRating.count} />
          </View>
          {reviews.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              isOwner={isOwner}
              onRespond={
                isOwner
                  ? async (reviewId, response) => {
                      await reviewsService.updateBusinessResponse(reviewId, response);
                      const list = await reviewsService.getReviewsForBusiness(id!);
                      setReviews(list);
                    }
                  : undefined
              }
              canReport={!!user && review.user_id !== user.id}
              onReport={
                user
                  ? (reviewId) => {
                      Alert.alert(
                        'Report Review',
                        'Report this review for inappropriate content?',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Report',
                            style: 'destructive',
                            onPress: async () => {
                              try {
                                await complaintsService.createComplaint('review', reviewId);
                                Alert.alert('Thank you', 'Your report has been submitted.');
                              } catch {
                                Alert.alert('Error', 'Failed to submit report.');
                              }
                            },
                          },
                        ]
                      );
                    }
                  : undefined
              }
            />
          ))}
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
              >
                <Calendar size={20} color={Colors.primary} />
                <View style={styles.eventInfo}>
                  <Text style={styles.eventTitle} numberOfLines={2}>
                    {event.title}
                  </Text>
                  <Text style={styles.eventDate}>{formatDate(event.start_datetime)}</Text>
                </View>
                <Text style={styles.viewEvent}>View</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background.secondary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: Colors.background.primary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border.light,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.background.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerTitle: {
    flex: 1,
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  headerSpacer: {
    width: 40,
    alignItems: 'flex-end',
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
    color: Colors.text.tertiary,
  },
  scroll: {
    flex: 1,
  },
  venueCarouselWrap: {
    marginTop: Spacing.lg,
  },
  venuePhotosLabel: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.secondary,
    marginBottom: Spacing.sm,
    textTransform: 'uppercase',
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
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginTop: Spacing.md,
    textAlign: 'center',
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
  followerCount: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    marginTop: Spacing.xs,
  },
  section: {
    padding: Spacing.lg,
    backgroundColor: Colors.background.primary,
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
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
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
