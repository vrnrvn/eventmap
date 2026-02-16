import { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  FlatList,
  Dimensions,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useApp } from '@/contexts/AppContext';
import { eventsService } from '@/services/events';
import { socialService } from '@/services/social';
import { reviewsService, type ReviewWithProfile } from '@/services/reviews';
import { EventDetails } from '@/types/database';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import { ImageViewer } from '@/components/ImageViewer';
import { Avatar } from '@/components/Avatar';
import { StarRatingDisplay } from '@/components/StarRatingDisplay';
import { ReviewCard } from '@/components/ReviewCard';
import { ReviewForm } from '@/components/ReviewForm';
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Building2,
  ExternalLink,
  Heart,
  Users,
  Pencil,
  Trash2,
  CheckCircle2,
  Star,
  Flag,
} from 'lucide-react-native';
import { complaintsService } from '@/services/complaints';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, isBanned } = useAuth();
  const { userBusiness } = useApp();
  const [details, setDetails] = useState<EventDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [reviews, setReviews] = useState<ReviewWithProfile[]>([]);
  const [averageRating, setAverageRating] = useState({ average: 0, count: 0 });
  const [userReview, setUserReview] = useState<{ rating: number; text: string } | null>(null);
  const [showReviewForm, setShowReviewForm] = useState(false);

  const isOwner = userBusiness && details?.event.business_id === userBusiness.id;

  const allPhotoUrls = useMemo(() => {
    if (!details) return [];
    const urls: string[] = [];
    if (details.photos?.length) {
      details.photos
        .sort((a, b) => a.sort_order - b.sort_order)
        .forEach((p) => urls.push(p.image_url));
    } else if (details.event.cover_image_url) {
      urls.push(details.event.cover_image_url);
    }
    return urls;
  }, [details]);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      try {
        const data = await eventsService.getEventDetails(id);
        setDetails(data);
      } catch {
        setDetails(null);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const businessId = details?.business.id;

  useEffect(() => {
    if (!businessId) return;
    const loadReviews = async () => {
      try {
        const [list, avg, mine] = await Promise.all([
          reviewsService.getReviewsForBusiness(businessId),
          reviewsService.getAverageRatingAndCount(businessId),
          user ? reviewsService.getUserReview(businessId) : Promise.resolve(null),
        ]);
        setReviews(list);
        setAverageRating(avg);
        setUserReview(mine ? { rating: mine.rating, text: mine.text || '' } : null);
      } catch {
        setReviews([]);
        setAverageRating({ average: 0, count: 0 });
        setUserReview(null);
      }
    };
    loadReviews();
  }, [businessId, user]);

  const handleReviewSubmit = async (rating: number, text: string) => {
    if (!businessId) return;
    await reviewsService.createOrUpdateReview(businessId, rating, text || null);
    const [list, avg] = await Promise.all([
      reviewsService.getReviewsForBusiness(businessId),
      reviewsService.getAverageRatingAndCount(businessId),
    ]);
    setReviews(list);
    setAverageRating(avg);
    setUserReview({ rating, text });
    setShowReviewForm(false);
  };

  const handleReviewRespond = async (reviewId: string, response: string) => {
    await reviewsService.updateBusinessResponse(reviewId, response);
    if (!businessId) return;
    const list = await reviewsService.getReviewsForBusiness(businessId);
    setReviews(list);
  };

  const handleRsvp = async (status: 'going' | 'interested') => {
    if (!user || !id) return;
    if (isBanned) {
      Alert.alert('Account Suspended', 'Your account has been suspended. Please contact support.');
      return;
    }
    setSaving(true);
    try {
      await socialService.createOrUpdateRsvp(id, status);
      setDetails((d) =>
        d
          ? {
              ...d,
              user_rsvp: status,
              rsvp_count:
                d.user_rsvp === status
                  ? d.rsvp_count
                  : d.user_rsvp
                    ? d.rsvp_count
                    : d.rsvp_count + 1,
            }
          : null
      );
    } catch {
      Alert.alert('Error', 'Failed to update RSVP');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveRsvp = async () => {
    if (!user || !id) return;
    setSaving(true);
    try {
      await socialService.deleteRsvp(id);
      setDetails((d) =>
        d ? { ...d, user_rsvp: null, rsvp_count: Math.max(0, d.rsvp_count - 1) } : null
      );
    } catch {
      Alert.alert('Error', 'Failed to remove RSVP');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!user || !id) return;
    setSaving(true);
    try {
      if (details?.user_saved) {
        await socialService.unsaveEvent(id);
        setDetails((d) =>
          d ? { ...d, user_saved: false, save_count: Math.max(0, d.save_count - 1) } : null
        );
      } else {
        await socialService.saveEvent(id);
        setDetails((d) =>
          d ? { ...d, user_saved: true, save_count: d.save_count + 1 } : null
        );
      }
    } catch {
      Alert.alert('Error', 'Failed to update save');
    } finally {
      setSaving(false);
    }
  };

  const handleFollow = async () => {
    if (!user || !details) return;
    setSaving(true);
    try {
      if (details.user_following_business) {
        await socialService.unfollowBusiness(details.business.id);
        setDetails((d) => (d ? { ...d, user_following_business: false } : null));
      } else {
        await socialService.followBusiness(details.business.id);
        setDetails((d) => (d ? { ...d, user_following_business: true } : null));
      }
    } catch {
      Alert.alert('Error', 'Failed to update follow');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!id) return;
    Alert.alert('Delete Event', 'Are you sure? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await eventsService.deleteEvent(id);
            router.back();
          } catch {
            Alert.alert('Error', 'Failed to delete event');
          }
        },
      },
    ]);
  };

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!details) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <ArrowLeft size={24} color={Colors.text.primary} />
          </TouchableOpacity>
        </View>
        <View style={styles.centerContainer}>
          <Text style={styles.errorText}>Event not found</Text>
        </View>
      </View>
    );
  }

  const { event, business, category, links } = details;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ArrowLeft size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {event.title}
        </Text>
        <View style={styles.headerRight}>
          {user && !isOwner && (
            <TouchableOpacity
              style={styles.reportButton}
              onPress={async () => {
                Alert.alert(
                  'Report Event',
                  'Report this event for inappropriate content?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Report',
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          await complaintsService.createComplaint('event', event.id);
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
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {allPhotoUrls.length > 0 ? (
          <View>
            <FlatList
              data={allPhotoUrls}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              keyExtractor={(_, i) => `photo-${i}`}
              renderItem={({ item, index }) => (
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => {
                    setViewerIndex(index);
                    setViewerVisible(true);
                  }}
                >
                  <Image
                    source={{ uri: item }}
                    style={styles.coverImage}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
              )}
            />
            {allPhotoUrls.length > 1 && (
              <View style={styles.photoDots}>
                {allPhotoUrls.map((_, i) => (
                  <View key={i} style={[styles.photoDot, i === 0 && styles.photoDotActive]} />
                ))}
              </View>
            )}
          </View>
        ) : (
          <View style={styles.coverPlaceholder}>
            <Calendar size={48} color={Colors.text.tertiary} />
          </View>
        )}

        <ImageViewer
          visible={viewerVisible}
          images={allPhotoUrls}
          initialIndex={viewerIndex}
          onClose={() => setViewerVisible(false)}
        />

        <View style={styles.content}>
          <Text style={styles.title}>{event.title}</Text>
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryText}>{category.label}</Text>
          </View>

          <TouchableOpacity
            style={styles.businessRow}
            onPress={() => router.push(`/business/${business.id}` as any)}
            activeOpacity={0.7}
          >
            <Avatar
              imageUrl={business.logo_url}
              name={business.name}
              size={28}
            />
            <Text style={styles.businessName}>{business.name}</Text>
            {user && !isOwner && (
              <TouchableOpacity
                style={[
                  styles.followButton,
                  details.user_following_business && styles.followButtonActive,
                ]}
                onPress={handleFollow}
                disabled={saving}
              >
                <Text
                  style={[
                    styles.followButtonText,
                    details.user_following_business && styles.followButtonTextActive,
                  ]}
                >
                  {details.user_following_business ? 'Following' : 'Follow'}
                </Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>

          <View style={styles.metaRow}>
            <Calendar size={18} color={Colors.text.secondary} />
            <Text style={styles.metaText}>
              {formatDate(event.start_datetime)}
              {event.end_datetime && ` – ${formatDate(event.end_datetime)}`}
            </Text>
          </View>

          {event.address && (
            <View style={styles.metaRow}>
              <MapPin size={18} color={Colors.text.secondary} />
              <Text style={styles.metaText}>{event.address}</Text>
            </View>
          )}

          {event.description && (
            <Text style={styles.description}>{event.description}</Text>
          )}

          {links.length > 0 && (
            <View style={styles.linksSection}>
              <Text style={styles.sectionTitle}>Links</Text>
              {links.map((link) => (
                <TouchableOpacity
                  key={link.id}
                  style={styles.linkRow}
                  onPress={() => Linking.openURL(link.url)}
                >
                  <ExternalLink size={18} color={Colors.primary} />
                  <Text style={styles.linkText} numberOfLines={1}>
                    {link.label || link.url}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {user && !isOwner && (
            <View style={styles.actionsSection}>
              <View style={styles.actionRow}>
                {details.user_rsvp ? (
                  <>
                    <TouchableOpacity
                      style={[
                        styles.actionButton,
                        details.user_rsvp === 'going' && styles.actionButtonActive,
                      ]}
                      onPress={() => handleRsvp('going')}
                      disabled={saving}
                      activeOpacity={0.8}
                    >
                      <CheckCircle2
                        size={22}
                        color={details.user_rsvp === 'going' ? Colors.text.inverse : Colors.primary}
                      />
                      <Text
                        style={[
                          styles.actionButtonText,
                          details.user_rsvp === 'going' && styles.actionButtonTextActive,
                        ]}
                      >
                        Going
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.actionButton,
                        details.user_rsvp === 'interested' && styles.actionButtonActive,
                      ]}
                      onPress={() => handleRsvp('interested')}
                      disabled={saving}
                      activeOpacity={0.8}
                    >
                      <Star
                        size={22}
                        color={details.user_rsvp === 'interested' ? Colors.text.inverse : Colors.primary}
                      />
                      <Text
                        style={[
                          styles.actionButtonText,
                          details.user_rsvp === 'interested' && styles.actionButtonTextActive,
                        ]}
                      >
                        Interested
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionButtonRemove}
                      onPress={handleRemoveRsvp}
                      disabled={saving}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.actionButtonRemoveText}>Remove</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => handleRsvp('going')}
                      disabled={saving}
                      activeOpacity={0.8}
                    >
                      <CheckCircle2 size={22} color={Colors.primary} />
                      <Text style={styles.actionButtonText}>Going</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => handleRsvp('interested')}
                      disabled={saving}
                      activeOpacity={0.8}
                    >
                      <Star size={22} color={Colors.primary} />
                      <Text style={styles.actionButtonText}>Interested</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
              <TouchableOpacity
                style={styles.saveButton}
                onPress={handleSave}
                disabled={saving}
              >
                <Heart
                  size={20}
                  color={details.user_saved ? Colors.error : Colors.text.secondary}
                  fill={details.user_saved ? Colors.error : 'transparent'}
                />
                <Text
                  style={[
                    styles.saveButtonText,
                    details.user_saved && styles.saveButtonTextActive,
                  ]}
                >
                  {details.user_saved ? 'Saved' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {isOwner && (
            <View style={styles.ownerActions}>
              <TouchableOpacity
                style={styles.editButton}
                onPress={() => router.push(`/business/edit-event/${event.id}` as any)}
              >
                <Pencil size={18} color={Colors.primary} />
                <Text style={styles.editButtonText}>Edit Event</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={handleDelete}
              >
                <Trash2 size={18} color={Colors.error} />
                <Text style={styles.deleteButtonText}>Delete Event</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Users size={16} color={Colors.text.tertiary} />
              <Text style={styles.statText}>{details.rsvp_count} going</Text>
            </View>
            <View style={styles.stat}>
              <Heart size={16} color={Colors.text.tertiary} />
              <Text style={styles.statText}>{details.save_count} saved</Text>
            </View>
          </View>

          <View style={styles.reviewsSection}>
            <Text style={styles.sectionTitle}>Reviews</Text>
            <View style={{ marginBottom: Spacing.md }}>
              <StarRatingDisplay
                average={averageRating.average}
                count={averageRating.count}
              />
            </View>
            {user && !isOwner && (
              showReviewForm ? (
                <ReviewForm
                  initialRating={userReview?.rating || 0}
                  initialText={userReview?.text || ''}
                  onSubmit={handleReviewSubmit}
                  onCancel={() => setShowReviewForm(false)}
                  isEditing={!!userReview}
                />
              ) : (
                <TouchableOpacity
                  style={styles.writeReviewBtn}
                  onPress={() => setShowReviewForm(true)}
                >
                  <Text style={styles.writeReviewBtnText}>
                    {userReview ? 'Edit your review' : 'Write a review'}
                  </Text>
                </TouchableOpacity>
              )
            )}
            {reviews.map((review) => (
              <ReviewCard
                key={review.id}
                review={review}
                isOwner={isOwner}
                onRespond={isOwner ? handleReviewRespond : undefined}
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
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingTop: Platform.OS === 'ios' ? Spacing.xxl + 24 : Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.light,
  },
  backButton: {
    padding: Spacing.sm,
    marginRight: Spacing.sm,
  },
  headerTitle: {
    flex: 1,
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  headerRight: {
    width: 40,
    alignItems: 'flex-end',
  },
  reportButton: {
    padding: Spacing.sm,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: Spacing.xxl,
  },
  coverImage: {
    width: SCREEN_WIDTH,
    height: 200,
    backgroundColor: Colors.background.secondary,
  },
  photoDots: {
    position: 'absolute',
    bottom: 10,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  photoDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  photoDotActive: {
    backgroundColor: '#FFFFFF',
  },
  coverPlaceholder: {
    width: '100%',
    height: 160,
    backgroundColor: Colors.background.secondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: Spacing.xl,
  },
  title: {
    fontSize: Typography.sizes.xxl,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: Spacing.sm,
  },
  categoryBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.background.secondary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.round,
    marginBottom: Spacing.md,
  },
  categoryText: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
  },
  businessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  businessName: {
    flex: 1,
    fontSize: Typography.sizes.md,
    color: Colors.text.secondary,
  },
  followButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.round,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  followButtonActive: {
    backgroundColor: Colors.primary,
  },
  followButtonText: {
    fontSize: Typography.sizes.sm,
    color: Colors.primary,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  followButtonTextActive: {
    color: Colors.text.inverse,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  metaText: {
    flex: 1,
    fontSize: Typography.sizes.md,
    color: Colors.text.primary,
  },
  description: {
    fontSize: Typography.sizes.md,
    color: Colors.text.primary,
    lineHeight: 24,
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
  },
  linksSection: {
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.secondary,
    textTransform: 'uppercase',
    marginBottom: Spacing.sm,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.light,
  },
  linkText: {
    flex: 1,
    fontSize: Typography.sizes.md,
    color: Colors.primary,
  },
  actionsSection: {
    marginBottom: Spacing.lg,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  actionButton: {
    flex: 1,
    minWidth: 140,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.lg,
    borderWidth: 2,
    borderColor: Colors.primary,
    backgroundColor: Colors.background.primary,
    ...Shadows.md,
  },
  actionButtonActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  actionButtonText: {
    fontSize: Typography.sizes.md,
    color: Colors.primary,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  actionButtonTextActive: {
    color: Colors.text.inverse,
  },
  actionButtonRemove: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border.medium,
    alignSelf: 'center',
  },
  actionButtonRemoveText: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  saveButtonText: {
    fontSize: Typography.sizes.md,
    color: Colors.text.secondary,
  },
  saveButtonTextActive: {
    color: Colors.error,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  ownerActions: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  editButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  editButtonText: {
    fontSize: Typography.sizes.md,
    color: Colors.primary,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  deleteButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.error,
  },
  deleteButtonText: {
    fontSize: Typography.sizes.md,
    color: Colors.error,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.lg,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  statText: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.tertiary,
  },
  reviewsSection: {
    marginTop: Spacing.xl,
    paddingTop: Spacing.xl,
    borderTopWidth: 1,
    borderTopColor: Colors.border.light,
  },
  writeReviewBtn: {
    alignSelf: 'flex-start',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
    borderRadius: 8,
    backgroundColor: Colors.background.secondary,
  },
  writeReviewBtnText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.primary,
  },
  errorText: {
    fontSize: Typography.sizes.md,
    color: Colors.error,
  },
});
