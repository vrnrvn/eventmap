import { useState, useEffect, useMemo, useRef } from 'react';
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
  Share,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { useApp } from '@/contexts/AppContext';
import { eventsService } from '@/services/events';
import { socialService } from '@/services/social';
import { reviewsService, type ReviewWithProfile } from '@/services/reviews';
import { EventDetails, type PublicAttendee } from '@/types/database';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import { ImageViewer } from '@/components/ImageViewer';
import { Avatar } from '@/components/Avatar';
import {
  AttendeesBottomSheet,
  type AttendeesBottomSheetHandle,
} from '@/components/AttendeesBottomSheet';
import { CategoryIcon } from '@/components/CategoryIcon';
import { StarRatingDisplay } from '@/components/StarRatingDisplay';
import { ReviewCard } from '@/components/ReviewCard';
import { ReviewForm } from '@/components/ReviewForm';
import {
  ArrowLeft,
  Building2,
  ExternalLink,
  Heart,
  Pencil,
  Trash2,
  CheckCircle2,
  Star,
  Flag,
  Repeat,
  Share2,
  Clock3,
  CalendarPlus,
  TrendingUp,
} from 'lucide-react-native';
import { EventmapMapPin, EventmapCalendar } from '@/components/icons/EventmapIcons';
import { GoogleMapView } from '@/components/GoogleMapView';
import { complaintsService } from '@/services/complaints';
import { getNextOccurrences, getRecurrenceLabel } from '@/utils/recurrence';
import { getEventWebUrl, getGoogleCalendarEventUrl } from '@/utils/eventShare';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function EventDetail() {
  const insets = useSafeAreaInsets();
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
  const attendeesSheetRef = useRef<AttendeesBottomSheetHandle>(null);
  const [previewAttendees, setPreviewAttendees] = useState<PublicAttendee[]>([]);

  const isOwner = !!(userBusiness && details?.event.business_id === userBusiness.id);

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
        if (data) {
          eventsService.trackEventView(id).catch(() => {});
        }
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

  useEffect(() => {
    if (!id || !details || details.rsvp_count < 1) {
      setPreviewAttendees([]);
      return;
    }
    let cancelled = false;
    socialService
      .getEventAttendees(id)
      .then((list) => {
        if (!cancelled) setPreviewAttendees(list);
      })
      .catch(() => {
        if (!cancelled) setPreviewAttendees([]);
      });
    return () => {
      cancelled = true;
    };
  }, [id, details?.rsvp_count]);

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

  const handleShareEvent = async () => {
    if (!id || !details) return;
    const url = getEventWebUrl(id);
    const title = details.event.title;
    try {
      await Share.share(
        Platform.OS === 'ios'
          ? { title, url }
          : { title, message: `${title}\n${url}` }
      );
    } catch {
      // dismissed
    }
  };

  const handleOpenCalendar = () => {
    if (!details) return;
    const url = getGoogleCalendarEventUrl({
      title: details.event.title,
      startIso: details.event.start_datetime,
      endIso: details.event.end_datetime,
      address: details.event.address,
      details: `${getEventWebUrl(details.event.id)}\n\nHosted by ${details.business.name}`,
    });
    Linking.openURL(url);
  };

  const submitEventReport = async (reason: string) => {
    if (!id) return;
    try {
      await complaintsService.createComplaint('event', id, reason);
      Alert.alert(
        'Report received',
        'Thanks for helping keep EventMaps safe. We typically review reports within about 48 hours and may remove content that violates our guidelines.'
      );
    } catch {
      Alert.alert('Error', 'Failed to submit report. Please try again.');
    }
  };

  const handleReportEvent = () => {
    Alert.alert('Report this event', 'What best describes the issue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Spam or misleading',
        onPress: () => void submitEventReport('Spam or misleading'),
      },
      {
        text: 'Safety concern',
        style: 'destructive',
        onPress: () => void submitEventReport('Safety concern'),
      },
      {
        text: 'Other',
        onPress: () => void submitEventReport('Other'),
      },
    ]);
  };

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  const formatDateTime = (dateString: string) =>
    new Date(dateString).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
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

  const venueLat = Number.isFinite(event.lat) ? event.lat : business.lat;
  const venueLng = Number.isFinite(event.lng) ? event.lng : business.lng;

  return (
    <View style={styles.container}>
      <View style={[styles.heroTopBarWrap, { top: insets.top + 10 }]}>
        <View style={styles.heroTopBar}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <ArrowLeft size={24} color={Colors.text.primary} />
          </TouchableOpacity>
          <Text style={styles.brandTitle}>EventMaps</Text>
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleShareEvent}
            accessibilityLabel="Share event"
          >
            <Share2 size={20} color={Colors.text.primary} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: 160 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroSection}>
          {allPhotoUrls.length > 0 ? (
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
          ) : (
            <View style={styles.coverPlaceholder}>
              <EventmapCalendar size={48} color={Colors.text.tertiary} />
            </View>
          )}
          <View style={styles.heroGradient} />
          <View style={styles.heroTitleWrap}>
            <View style={styles.heroCategoryPill}>
              <Text style={styles.heroCategoryText}>{category.label.toUpperCase()}</Text>
            </View>
            <Text style={styles.heroTitle}>{event.title}</Text>
          </View>
        </View>

        <ImageViewer
          visible={viewerVisible}
          images={allPhotoUrls}
          initialIndex={viewerIndex}
          onClose={() => setViewerVisible(false)}
        />

        <View style={styles.contentCard}>
          <View style={styles.quickInfoSection}>
            <View style={styles.metaRow}>
              <View style={styles.metaIconWrap}>
                <EventmapCalendar size={18} color={Colors.primary} />
              </View>
              <View>
                <Text style={styles.metaLabel}>Date</Text>
                <Text style={styles.metaValue}>{formatDate(event.start_datetime)}</Text>
              </View>
            </View>
            <View style={styles.metaRow}>
              <View style={styles.metaIconWrap}>
                <Clock3 size={18} color={Colors.primary} />
              </View>
              <View>
                <Text style={styles.metaLabel}>Time</Text>
                <Text style={styles.metaValue}>{formatDateTime(event.start_datetime)}</Text>
              </View>
            </View>
            {event.address && (
              <View style={styles.metaRow}>
                <View style={styles.metaIconWrap}>
                  <EventmapMapPin size={18} color={Colors.primary} />
                </View>
                <View>
                  <Text style={styles.metaLabel}>Location</Text>
                  <Text style={styles.metaValue}>{event.address}</Text>
                </View>
              </View>
            )}
          </View>

          <TouchableOpacity
            style={styles.calendarRow}
            onPress={handleOpenCalendar}
            activeOpacity={0.75}
          >
            <View style={styles.metaIconWrap}>
              <CalendarPlus size={18} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.metaLabel}>Add to calendar</Text>
              <Text style={styles.metaValue}>Google Calendar</Text>
            </View>
            <ExternalLink size={18} color={Colors.text.tertiary} />
          </TouchableOpacity>

          <Text style={styles.promoFootnote}>
            Listings may be ordered using distance, relevance, and paid promotion from hosts.
          </Text>

          <TouchableOpacity
            style={styles.attendeesSection}
            onPress={() => (details.rsvp_count > 0 ? attendeesSheetRef.current?.present() : null)}
            activeOpacity={details.rsvp_count > 0 ? 0.85 : 1}
            disabled={details.rsvp_count === 0}
          >
            <View style={styles.attendeeRow}>
              <View style={styles.attendeeGroup}>
                {(() => {
                  const faces = previewAttendees.slice(0, 4);
                  const moreCount = Math.max(0, details.rsvp_count - faces.length);
                  return (
                    <>
                      {faces.map((a) => (
                        <Avatar key={a.id} imageUrl={a.avatar_url} name={a.name} size={36} />
                      ))}
                      {moreCount > 0 ? (
                        <View style={styles.attendeePlaceholder}>
                          <Text style={styles.attendeePlus}>+{moreCount}</Text>
                        </View>
                      ) : null}
                    </>
                  );
                })()}
              </View>
              <Text style={styles.attendeeText}>
                {details.rsvp_count === 0
                  ? 'Be the first to RSVP'
                  : `${details.rsvp_count} going — tap to see who’s coming`}
              </Text>
            </View>
          </TouchableOpacity>

          <View style={styles.descriptionSection}>
            <Text style={styles.bigSectionTitle}>About Event</Text>
            <Text style={styles.descriptionText}>
              {event.description || 'Experience an immersive journey through sound and light.'}
            </Text>
          </View>

          {event.is_recurring && event.recurrence_pattern && (
            <View style={styles.recurrenceSection}>
              <View style={styles.recurrenceHeader}>
                <Repeat size={18} color={Colors.primary} />
                <Text style={styles.recurrenceSectionTitle}>
                  {getRecurrenceLabel(event.recurrence_pattern)} – Happens again
                </Text>
              </View>
              {getNextOccurrences(event, 5).map((d, i) => (
                <Text key={i} style={styles.recurrenceDate}>
                  {formatDateTime(d.toISOString())}
                </Text>
              ))}
            </View>
          )}

          <View style={styles.venueSection}>
            <View style={styles.venueHeader}>
              <Text style={styles.bigSectionTitle}>The Venue</Text>
              {event.address ? (
                <TouchableOpacity onPress={() => Linking.openURL(`https://www.google.com/maps?q=${encodeURIComponent(event.address || `${event.lat},${event.lng}`)}`)}>
                  <Text style={styles.directionsText}>Get Directions</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <View style={styles.venueMapCard}>
              <View style={styles.venueMapInner}>
                <GoogleMapView
                  style={{ flex: 1, minHeight: 0 }}
                  center={{ lat: venueLat, lng: venueLng }}
                  zoom={15}
                  markers={[
                    {
                      id: event.id,
                      lat: venueLat,
                      lng: venueLng,
                      title: event.title,
                      categorySlug: category.slug,
                      coverImageUrl: event.cover_image_url,
                      businessLogoUrl: business.logo_url,
                      businessName: business.name,
                    },
                  ]}
                />
              </View>
            </View>
          </View>

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
            <>
              <TouchableOpacity
                style={styles.insightsBanner}
                onPress={() => router.push(`/business/event-insights/${event.id}` as never)}
                activeOpacity={0.85}
              >
                <TrendingUp size={20} color={Colors.primary} />
                <Text style={styles.insightsBannerText}>Reach, saves & RSVPs</Text>
              </TouchableOpacity>
              <View style={styles.ownerActions}>
                <TouchableOpacity
                  style={styles.editButton}
                  onPress={() => router.push(`/business/edit-event/${event.id}` as any)}
                >
                  <Pencil size={18} color={Colors.primary} />
                  <Text style={styles.editButtonText}>Edit Event</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}>
                  <Trash2 size={18} color={Colors.error} />
                  <Text style={styles.deleteButtonText}>Delete Event</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {user && !isOwner ? (
            <TouchableOpacity style={styles.reportEventRow} onPress={handleReportEvent} activeOpacity={0.75}>
              <Flag size={18} color={Colors.text.secondary} />
              <Text style={styles.reportEventText}>Report this event</Text>
            </TouchableOpacity>
          ) : null}

          <Text style={styles.trustFootnote}>
            Reports are reviewed within about 48 hours. We may remove content that violates our guidelines.
          </Text>

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
                                  Alert.alert(
                                    'Thank you',
                                    'Your report has been submitted. We typically review within about 48 hours.'
                                  );
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
      <View style={[styles.bottomActionBar, { paddingBottom: Math.max(insets.bottom, 14) }]}>
        <TouchableOpacity
          style={styles.joinButton}
          onPress={() => {
            if (!user || saving) return;
            handleRsvp('going');
          }}
          activeOpacity={0.9}
        >
          <Text style={styles.joinButtonText}>Join Event</Text>
          <Text style={styles.joinArrow}>→</Text>
        </TouchableOpacity>
      </View>
      {id && (
        <AttendeesBottomSheet
          ref={attendeesSheetRef}
          eventId={id}
          rsvpCount={details.rsvp_count}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  heroTopBarWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 50,
  },
  heroTopBar: {
    height: 56,
    borderRadius: BorderRadius.round,
    backgroundColor: 'rgba(255,255,255,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
  },
  brandTitle: {
    color: Colors.primary,
    fontSize: Typography.sizes.xl,
    lineHeight: 28,
    letterSpacing: -0.3,
    fontFamily: Typography.displayFontFamilies.extrabold,
    fontWeight: '800',
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
  heroSection: {
    position: 'relative',
    height: 480,
    overflow: 'hidden',
  },
  scrollContent: {
    paddingBottom: Spacing.xxl,
  },
  coverImage: {
    width: SCREEN_WIDTH,
    height: 480,
    backgroundColor: Colors.background.secondary,
  },
  heroGradient: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  heroTitleWrap: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 28,
  },
  heroCategoryPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: BorderRadius.round,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.22)',
    marginBottom: 12,
  },
  heroCategoryText: {
    color: '#FFFFFF',
    fontSize: 10,
    letterSpacing: 2,
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: 32,
    lineHeight: 36,
    letterSpacing: -0.4,
    fontFamily: Typography.displayFontFamilies.extrabold,
    fontWeight: '800',
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
    height: 480,
    backgroundColor: Colors.background.secondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contentCard: {
    marginHorizontal: 16,
    marginTop: -32,
    backgroundColor: '#FFFFFF',
    borderRadius: 32,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 24,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 6,
  },
  quickInfoSection: {
    gap: 12,
    marginBottom: 18,
  },
  metaIconWrap: {
    width: 42,
    height: 42,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.background.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaLabel: {
    color: Colors.text.tertiary,
    fontSize: Typography.sizes.xs,
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  metaValue: {
    marginTop: 2,
    fontSize: Typography.sizes.md,
    lineHeight: 22,
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    maxWidth: SCREEN_WIDTH - 128,
  },
  calendarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    marginBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border.light,
  },
  promoFootnote: {
    fontSize: Typography.sizes.xs,
    lineHeight: 16,
    color: Colors.text.tertiary,
    fontFamily: Typography.fontFamilies.regular,
    marginBottom: 14,
  },
  attendeesSection: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: Colors.border.light,
    paddingVertical: 18,
    marginBottom: 18,
    gap: 14,
  },
  attendeeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  attendeeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  attendeePlaceholder: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.background.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attendeePlus: {
    fontSize: 11,
    color: Colors.text.secondary,
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  attendeeText: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  descriptionSection: {
    marginBottom: 18,
  },
  bigSectionTitle: {
    fontSize: Typography.sizes.xl,
    lineHeight: 28,
    color: Colors.text.primary,
    letterSpacing: -0.2,
    fontFamily: Typography.displayFontFamilies.extrabold,
    fontWeight: '800',
    marginBottom: 8,
  },
  descriptionText: {
    fontSize: Typography.sizes.md,
    lineHeight: 24,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
  },
  venueSection: {
    marginBottom: 20,
  },
  venueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  directionsText: {
    color: Colors.primary,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  venueMapCard: {
    height: 224,
    borderRadius: 30,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: Colors.background.secondary,
  },
  venueMapInner: {
    flex: 1,
    height: '100%',
    width: '100%',
  },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xxl,
  },
  title: {
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.displayFontFamilies.extrabold,
    fontWeight: '800',
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
    letterSpacing: 0,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.sm,
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
    fontSize: Typography.sizes.sm,
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
    fontSize: Typography.sizes.sm,
    color: Colors.text.primary,
  },
  recurrenceSection: {
    marginBottom: Spacing.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.background.secondary,
    borderRadius: BorderRadius.md,
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
  },
  recurrenceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  recurrenceSectionTitle: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  recurrenceDate: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
    marginTop: Spacing.xs,
    marginLeft: 26,
  },
  description: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.primary,
    lineHeight: 22,
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
  },
  linksSection: {
    marginBottom: Spacing.lg,
    backgroundColor: Colors.background.secondary,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    ...Shadows.md,
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
    fontSize: Typography.sizes.sm,
    color: Colors.primary,
  },
  actionsSection: {
    marginBottom: Spacing.lg,
    backgroundColor: Colors.background.secondary,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    ...Shadows.md,
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
    fontSize: Typography.sizes.sm,
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
    fontSize: Typography.sizes.xs,
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
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
  },
  saveButtonTextActive: {
    color: Colors.error,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  insightsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.primary + '44',
    backgroundColor: Colors.primary + '10',
  },
  insightsBannerText: {
    fontSize: Typography.sizes.sm,
    color: Colors.primary,
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
    fontSize: Typography.sizes.sm,
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
    fontSize: Typography.sizes.sm,
    color: Colors.error,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  reportEventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  reportEventText: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
  },
  trustFootnote: {
    fontSize: 11,
    lineHeight: 15,
    color: Colors.text.tertiary,
    fontFamily: Typography.fontFamilies.regular,
    marginBottom: Spacing.lg,
  },
  reviewsSection: {
    marginTop: Spacing.xl,
    backgroundColor: Colors.background.secondary,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    ...Shadows.md,
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
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.primary,
  },
  errorText: {
    fontSize: Typography.sizes.sm,
    color: Colors.error,
  },
  bottomActionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 16,
    paddingHorizontal: 24,
    backgroundColor: 'rgba(255,255,255,0.94)',
  },
  joinButton: {
    height: 58,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  joinButtonText: {
    color: '#FFFFFF',
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  joinArrow: {
    color: '#FFFFFF',
    fontSize: 26,
    lineHeight: 26,
  },
});
