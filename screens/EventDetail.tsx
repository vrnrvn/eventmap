import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { useApp } from '@/contexts/AppContext';
import { eventsService } from '@/services/events';
import { supabase } from '@/services/supabase';
import { eventChatService } from '@/services/eventChat';
import { socialService } from '@/services/social';
import { reviewsService, type ReviewWithProfile } from '@/services/reviews';
import {
  EventDetails,
  type EventChatMessageWithSender,
  type PublicAttendee,
} from '@/types/database';
import { alpha, Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import { notify, notifyConfirm } from '@/utils/notify';
import { ImageViewer } from '@/components/ImageViewer';
import { Button } from '@/components/ui/Button';
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
  ExternalLink,
  Pencil,
  Trash2,
  Star,
  Flag,
  Repeat,
  Share2,
  Clock3,
  CalendarPlus,
  Download,
  TrendingUp,
  ChevronRight,
  MessageCircle,
  Bookmark,
  BookmarkCheck,
} from 'lucide-react-native';
import { EventmapMapPin, EventmapCalendar } from '@/components/icons/EventmapIcons';
import { GoogleMapView } from '@/components/GoogleMapView';
import { DeferredMount } from '@/components/DeferredMount';
import { complaintsService } from '@/services/complaints';
import { getNextOccurrences, getRecurrenceLabel } from '@/utils/recurrence';
import { hasEventEnded, isEventInProgress } from '@/utils/eventStatus';
import { getEventWebUrl, getGoogleCalendarEventUrl, shareEventIcs } from '@/utils/eventShare';

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
  // Active page of the hero photo carousel (drives the page dots).
  const [photoIndex, setPhotoIndex] = useState(0);
  const [reviews, setReviews] = useState<ReviewWithProfile[]>([]);
  const [averageRating, setAverageRating] = useState({ average: 0, count: 0 });
  const [userReview, setUserReview] = useState<{ rating: number; text: string } | null>(null);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const attendeesSheetRef = useRef<AttendeesBottomSheetHandle>(null);
  const [previewAttendees, setPreviewAttendees] = useState<PublicAttendee[]>([]);
  const [attendeesRefresh, setAttendeesRefresh] = useState(0);
  const [togglingSave, setTogglingSave] = useState(false);
  const hasLoadedRef = useRef(false);
  const [chatPreview, setChatPreview] = useState<EventChatMessageWithSender | null>(null);
  const [chatUnread, setChatUnread] = useState(0);

  const isOwner = !!(userBusiness && details?.event.business_id === userBusiness.id);
  const chatIsOpen = details?.user_rsvp === 'going' && (details?.rsvp_count ?? 0) >= 2;

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

  // Attendee list is owned here and shared by the preview faces and the sheet,
  // so the event page makes one attendee request per refresh instead of two.
  // Four faces for the preview row. The sheet fetches its own pages, so the
  // event page never downloads the whole list; the parent only bumps
  // attendeesRefresh when the viewer's own RSVP changes.
  const loadAttendees = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      if (!id) return;
      try {
        const page = await socialService.getEventAttendeesPage(id, { limit: 4 });
        if (isCancelled()) return;
        setPreviewAttendees(page.items);
      } catch {
        if (isCancelled()) return;
        setPreviewAttendees([]);
      }
    },
    [id]
  );

  // Details (RSVP state, counts) are re-fetched every time the screen gains
  // focus, so returning from chat, attendee profiles, or the host's edit
  // screen shows current data. Only the very first load shows the spinner.
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let cancelled = false;
      const load = async () => {
        try {
          const data = await eventsService.getEventDetails(id);
          if (cancelled) return;
          setDetails(data);
          if (data && !hasLoadedRef.current) {
            eventsService.trackEventView(id).catch(() => {});
          }
          hasLoadedRef.current = true;
          if (data && data.rsvp_count > 0) {
            void loadAttendees(() => cancelled);
          } else if (data) {
            setPreviewAttendees([]);
          }
        } catch {
          if (!cancelled && !hasLoadedRef.current) setDetails(null);
        } finally {
          if (!cancelled) setLoading(false);
        }
      };
      load();
      return () => {
        cancelled = true;
      };
    }, [id, loadAttendees])
  );

  // A one-line preview of the latest chat message for the chat-entry row.
  // Focus-driven so it also refreshes when the user comes back from the chat.
  useFocusEffect(
    useCallback(() => {
      if (!id || !chatIsOpen) {
        setChatPreview(null);
        setChatUnread(0);
        return;
      }
      let cancelled = false;
      eventChatService
        .getLatestMessage(id)
        .then((message) => {
          if (!cancelled) setChatPreview(message);
        })
        .catch(() => {
          // Keep the generic subtitle when the preview can't load.
        });
      eventChatService
        .getUnreadCounts([id])
        .then((counts) => {
          if (!cancelled) setChatUnread(counts.find((row) => row.event_id === id)?.unread_count ?? 0);
        })
        .catch(() => {
          if (!cancelled) setChatUnread(0);
        });
      return () => {
        cancelled = true;
      };
    }, [id, chatIsOpen])
  );

  // Keep the attendee count (and the chat-unlock state derived from it) fresh
  // while the screen is open. The 20s focus-scoped poll is the PRIMARY
  // mechanism today: `rsvps` is NOT in the supabase_realtime publication
  // (only event_chat_messages is — 20260301000000), so the postgres_changes
  // subscription below subscribes fine but never receives events pre-publication.
  //
  // Upgrade path (zero client work needed): once a migration runs
  // `ALTER PUBLICATION supabase_realtime ADD TABLE rsvps`, the subscription
  // starts firing and attendance updates become near-instant (1s debounce);
  // the poll then only serves as a fallback. Tracked in docs/ISSUES.md.
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      const refetchCount = async () => {
        try {
          const data = await eventsService.getEventDetails(id);
          if (!data) return;
          setDetails((d) => {
            if (!d || d.rsvp_count === data.rsvp_count) return d;
            // Merge only the count: the user's own RSVP state may have an
            // optimistic local update in flight.
            return { ...d, rsvp_count: data.rsvp_count };
          });
        } catch {
          // Transient failure; next tick / next realtime event retries.
        }
      };
      const timer = setInterval(refetchCount, 20000);
      // Realtime-ready subscription: coalesce bursts of RSVP changes into one
      // refetch at most every second.
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      const channel = supabase
        .channel(`event-rsvps:${id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'rsvps', filter: `event_id=eq.${id}` },
          () => {
            if (debounceTimer) return;
            debounceTimer = setTimeout(() => {
              debounceTimer = null;
              void refetchCount();
            }, 1000);
          }
        )
        .subscribe();
      return () => {
        clearInterval(timer);
        if (debounceTimer) clearTimeout(debounceTimer);
        supabase.removeChannel(channel);
      };
    }, [id])
  );

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
      notify.error('Your account has been suspended. Please contact support.');
      return;
    }
    if (details && hasEventEnded(details.event)) {
      notify.error('This event is over, so it can no longer be joined.');
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
              rsvp_count: Math.max(
                0,
                d.rsvp_count +
                  (d.user_rsvp !== 'going' && status === 'going'
                    ? 1
                    : d.user_rsvp === 'going' && status !== 'going'
                      ? -1
                      : 0)
              ),
            }
          : null
      );
      void loadAttendees();
      setAttendeesRefresh((n) => n + 1);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'EVENT_FULL') {
        notify.error('This event has reached its maximum number of attendees.');
      } else {
        notify.error('Failed to update RSVP');
      }
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
        d
          ? {
              ...d,
              user_rsvp: null,
              rsvp_count:
                d.user_rsvp === 'going' ? Math.max(0, d.rsvp_count - 1) : d.rsvp_count,
            }
          : null
      );
      void loadAttendees();
      setAttendeesRefresh((n) => n + 1);
    } catch {
      notify.error('Failed to remove RSVP');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleSave = async () => {
    if (!user || !id || !details || togglingSave) return;
    const wasSaved = details.user_saved;
    setTogglingSave(true);
    // Optimistic flip; revert on failure.
    setDetails((d) =>
      d ? { ...d, user_saved: !wasSaved, save_count: Math.max(0, d.save_count + (wasSaved ? -1 : 1)) } : d
    );
    try {
      if (wasSaved) await socialService.unsaveEvent(id);
      else await socialService.saveEvent(id);
    } catch {
      setDetails((d) =>
        d ? { ...d, user_saved: wasSaved, save_count: Math.max(0, d.save_count + (wasSaved ? 1 : -1)) } : d
      );
      notify.error(wasSaved ? 'Failed to remove from saved events' : 'Failed to save event');
    } finally {
      setTogglingSave(false);
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
      notify.error('Failed to update follow');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEvent = () => {
    if (!id) return;
    notifyConfirm({
      title: 'Cancel Event',
      message:
        'Cancel this event? Attendees will be notified and the event will no longer be visible to the public. This cannot be undone.',
      cancelLabel: 'Keep event',
      confirmLabel: 'Cancel event',
      destructive: true,
      onConfirm: async () => {
        try {
          // Pre-apply (20261030106000) this falls back to a hard delete.
          await eventsService.cancelEvent(id);
          router.back();
        } catch {
          notify.error('Failed to cancel event');
        }
      },
    });
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

  const handleShareIcs = async () => {
    if (!details) return;
    try {
      await shareEventIcs({
        id: details.event.id,
        title: details.event.title,
        startIso: details.event.start_datetime,
        endIso: details.event.end_datetime,
        address: details.event.address,
        description: [
          details.event.description?.trim(),
          `${getEventWebUrl(details.event.id)}\n\nHosted by ${details.business.name}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
      });
    } catch {
      notify.error('Could not create the calendar file.');
    }
  };

  const submitEventReport = async (reason: string) => {
    if (!id) return;
    try {
      await complaintsService.createComplaint('event', id, reason);
      notify.success(
        'Report received. We typically review reports within about 48 hours.'
      );
    } catch {
      notify.error('Failed to submit report. Please try again.');
    }
  };

  const handleReportEvent = () => {
    if (Platform.OS === 'web') {
      // Alert.alert with buttons is a no-op in browsers. notifyConfirm only
      // supports two buttons, so chain the two most important reasons:
      // confirm picks the reason, cancel moves to the next question.
      notifyConfirm({
        title: 'Report this event',
        message: 'Is this event spam or misleading?',
        confirmLabel: 'Report as spam',
        onConfirm: () => void submitEventReport('Spam or misleading'),
        onCancel: () => {
          notifyConfirm({
            title: 'Report this event',
            message: 'Is this a safety concern?',
            confirmLabel: 'Report safety concern',
            cancelLabel: 'Never mind',
            destructive: true,
            onConfirm: () => void submitEventReport('Safety concern'),
          });
        },
      });
      return;
    }
    // Native: Alert.alert supports the full 4-option picker that notifyConfirm
    // (2 buttons) cannot express.
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
  const formatClock = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  // "1:00 PM – 3:00 PM"; for a recurring event the displayed start may be a later
  // occurrence, so the end is shifted by the original duration.
  const formatTimeRange = (startIso: string, endIso: string, originalStartIso: string) => {
    const start = new Date(startIso);
    const originalStart = new Date(originalStartIso);
    const end = new Date(endIso);
    if (Number.isNaN(start.getTime())) return '';
    if (Number.isNaN(end.getTime()) || Number.isNaN(originalStart.getTime())) return formatClock(start);
    const shiftedEnd = new Date(start.getTime() + (end.getTime() - originalStart.getTime()));
    if (shiftedEnd.getTime() <= start.getTime()) return formatClock(start);
    const multiDay = shiftedEnd.toDateString() !== start.toDateString();
    return `${formatClock(start)} – ${multiDay ? formatDateTime(shiftedEnd.toISOString()) : formatClock(shiftedEnd)}`;
  };

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
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
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
  const canOpenEventChat = details.user_rsvp === 'going' && details.rsvp_count >= 2;
  const shouldShowEventChatPrompt = details.user_rsvp === 'going';
  const hasJoinedEvent = details.user_rsvp === 'going';
  const eventEnded = hasEventEnded(event);
  const eventLive = isEventInProgress(event);
  // Tolerant capacity check: events.max_attendees only exists once
  // 20261030108000 is applied. Pre-apply the field is absent (null here), so
  // the UI is identical to today.
  const maxAttendees =
    (event as { max_attendees?: number | null }).max_attendees ?? null;
  const eventFull =
    maxAttendees != null && details.rsvp_count >= maxAttendees && !hasJoinedEvent;
  // Recurring events that already started show their next occurrence in the
  // header; everything else shows the scheduled start.
  const displayStartIso = (() => {
    if (!event.is_recurring || eventEnded) return event.start_datetime;
    if (new Date(event.start_datetime).getTime() > Date.now()) return event.start_datetime;
    const next = getNextOccurrences(event, 1)[0];
    return next ? next.toISOString() : event.start_datetime;
  })();

  return (
    <View style={styles.container}>
      <View style={[styles.heroTopBarWrap, { top: insets.top + 10 }]}>
        <View style={styles.heroTopBar}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <ArrowLeft size={24} color={Colors.text.primary} />
          </TouchableOpacity>
          <Text style={styles.brandTitle}>EventMaps</Text>
          <View style={styles.heroTopActions}>
            {user ? (
              <TouchableOpacity
                style={styles.backButton}
                onPress={handleToggleSave}
                disabled={togglingSave}
                accessibilityRole="button"
                accessibilityLabel={details.user_saved ? 'Remove from saved events' : 'Save event'}
                accessibilityState={{ selected: details.user_saved }}
              >
                {details.user_saved ? (
                  <BookmarkCheck size={20} color={Colors.primary} />
                ) : (
                  <Bookmark size={20} color={Colors.text.primary} />
                )}
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={styles.backButton}
              onPress={handleShareEvent}
              accessibilityRole="button"
              accessibilityLabel="Share event"
            >
              <Share2 size={20} color={Colors.text.primary} />
            </TouchableOpacity>
          </View>
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
              onMomentumScrollEnd={(e) => {
                const page = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
                setPhotoIndex(Math.max(0, Math.min(page, allPhotoUrls.length - 1)));
              }}
              keyExtractor={(_, i) => `photo-${i}`}
              renderItem={({ item, index }) => (
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => {
                    setViewerIndex(index);
                    setViewerVisible(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`View photo ${index + 1} of ${allPhotoUrls.length}`}
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
            {allPhotoUrls.length > 1 ? (
              <View style={styles.photoDots} pointerEvents="none">
                {allPhotoUrls.map((_, i) => (
                  <View
                    key={`photo-dot-${i}`}
                    style={[styles.photoDot, i === photoIndex && styles.photoDotActive]}
                  />
                ))}
              </View>
            ) : null}
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
                <Text style={styles.metaLabel}>
                  {event.is_recurring && displayStartIso !== event.start_datetime ? 'Next date' : 'Date'}
                </Text>
                <Text style={styles.metaValue}>
                  {formatDate(displayStartIso)}
                  {eventLive ? '  ·  Happening now' : eventEnded ? '  ·  Ended' : ''}
                </Text>
              </View>
            </View>
            <View style={styles.metaRow}>
              <View style={styles.metaIconWrap}>
                <Clock3 size={18} color={Colors.primary} />
              </View>
              <View>
                <Text style={styles.metaLabel}>Time</Text>
                <Text style={styles.metaValue}>{formatTimeRange(displayStartIso, event.end_datetime, event.start_datetime)}</Text>
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

          <View style={styles.calendarRow}>
            <View style={styles.metaIconWrap}>
              <CalendarPlus size={18} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.metaLabel}>Add to calendar</Text>
              <View style={styles.calendarChoiceRow}>
                <TouchableOpacity
                  style={styles.calendarChoiceBtn}
                  onPress={handleOpenCalendar}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel="Add to Google Calendar"
                >
                  <Text style={styles.calendarChoiceText}>Google Calendar</Text>
                  <ExternalLink size={14} color={Colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.calendarChoiceBtn}
                  onPress={handleShareIcs}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel="Add to calendar as an ics file"
                >
                  <Text style={styles.calendarChoiceText}>.ics file</Text>
                  <Download size={14} color={Colors.primary} />
                </TouchableOpacity>
              </View>
            </View>
          </View>

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
                  : maxAttendees != null
                    ? `${details.rsvp_count} / ${maxAttendees} going — tap to see who’s coming`
                    : `${details.rsvp_count} going — tap to see who’s coming`}
              </Text>
            </View>
          </TouchableOpacity>

          {shouldShowEventChatPrompt && (
            <TouchableOpacity
              style={[styles.chatPromptRow, !canOpenEventChat && styles.chatPromptRowDisabled]}
              onPress={() => {
                if (canOpenEventChat) {
                  router.push(`/event-chat/${event.id}` as never);
                }
              }}
              activeOpacity={canOpenEventChat ? 0.85 : 1}
              disabled={!canOpenEventChat}
            >
              <View style={styles.chatIconWrap}>
                <MessageCircle
                  size={20}
                  color={canOpenEventChat ? Colors.primary : Colors.text.tertiary}
                />
              </View>
              <View style={styles.chatPromptMeta}>
                <View style={styles.chatPromptTitleRow}>
                  <Text style={styles.chatPromptTitle}>Event chat</Text>
                  {chatUnread > 0 ? (
                    <View style={styles.chatUnreadBadge} accessibilityLabel={`${chatUnread} unread messages`}>
                      <Text style={styles.chatUnreadBadgeText}>
                        {chatUnread > 99 ? '99+' : chatUnread}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text
                  style={[styles.chatPromptSubtitle, chatUnread > 0 && styles.chatPromptSubtitleUnread]}
                  numberOfLines={1}
                >
                  {canOpenEventChat
                    ? chatPreview
                      ? `${chatPreview.sender?.name ?? 'Someone'}: ${chatPreview.body}`
                      : 'Chat with everyone going'
                    : 'Unlocks when 2 people are going'}
                </Text>
              </View>
              <ChevronRight
                size={22}
                color={canOpenEventChat ? Colors.text.tertiary : Colors.border.medium}
              />
            </TouchableOpacity>
          )}

          {/* Hosts rarely RSVP to their own event, so the attendee chat row
              above never shows for them — but the DB (20261028130000/180000)
              grants hosts chat read + moderation. Give them an entry point. */}
          {isOwner && details.user_rsvp !== 'going' && (
            <TouchableOpacity
              style={styles.chatPromptRow}
              onPress={() => router.push(`/event-chat/${event.id}` as never)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Manage event chat"
            >
              <View style={styles.chatIconWrap}>
                <MessageCircle size={20} color={Colors.primary} />
              </View>
              <View style={styles.chatPromptMeta}>
                <Text style={styles.chatPromptTitle}>Manage chat</Text>
                <Text style={styles.chatPromptSubtitle} numberOfLines={1}>
                  Read and moderate your event&apos;s chat
                </Text>
              </View>
              <ChevronRight size={22} color={Colors.text.tertiary} />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.hostBusinessRow}
            onPress={() => router.push(`/business/${business.id}` as never)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`View business ${business.name}`}
          >
            <Avatar imageUrl={business.logo_url} name={business.name} size={48} />
            <View style={styles.hostBusinessMeta}>
              <Text style={styles.hostBusinessLabel}>Organizer</Text>
              <Text style={styles.hostBusinessName} numberOfLines={2}>
                {business.name}
              </Text>
              <Text style={styles.hostBusinessHint}>View business profile</Text>
            </View>
            <ChevronRight size={22} color={Colors.text.tertiary} />
          </TouchableOpacity>

          <View style={styles.descriptionSection}>
            <Text style={styles.bigSectionTitle}>About Event</Text>
            {event.description ? (
              <Text style={styles.descriptionText}>{event.description}</Text>
            ) : (
              <Text style={styles.noDescriptionText}>No description provided.</Text>
            )}
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
              {/* Below the fold — don't build the map WebView mid-transition.
                  DeferredMount renders the venueMapInner View itself. */}
              <DeferredMount style={styles.venueMapInner}>
                <GoogleMapView
                  style={{ flex: 1, minHeight: 0 }}
                  center={{ lat: venueLat, lng: venueLng }}
                  zoom={15}
                  mapGesturesEnabled={false}
                  webViewScrollEnabled={false}
                  nestedScrollEnabled={false}
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
              </DeferredMount>
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

          {user && !isOwner && eventEnded && (
            <View style={styles.endedNotice}>
              <Clock3 size={16} color={Colors.text.secondary} />
              <Text style={styles.endedNoticeText}>
                {hasJoinedEvent
                  ? 'This event has ended. It now lives in your attendance history.'
                  : 'This event has ended and can no longer be joined.'}
              </Text>
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
                <Button
                  label="Edit Event"
                  variant="secondary"
                  onPress={() => router.push(`/business/edit-event/${event.id}` as any)}
                  icon={<Pencil size={18} color={Colors.primary} />}
                  style={styles.ownerActionBtn}
                />
                <Button
                  label="Cancel Event"
                  variant="destructive"
                  onPress={handleCancelEvent}
                  icon={<Trash2 size={18} color="#FFFFFF" />}
                  style={styles.ownerActionBtn}
                />
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
            {/* These are reviews of the hosting BUSINESS (venue), not of this
                single event — label them as such. */}
            <Text style={styles.sectionTitle}>
              {business.name ? `Reviews of ${business.name}` : 'Venue reviews'}
            </Text>
            <View style={{ marginBottom: Spacing.md }}>
              <StarRatingDisplay
                average={averageRating.average}
                count={averageRating.count}
              />
            </View>
            {user && !isOwner && (
              showReviewForm ? (
                <>
                <Text style={styles.reviewFormTitle}>
                  {business.name ? `Review ${business.name}` : 'Review this venue'}
                </Text>
                <ReviewForm
                  initialRating={userReview?.rating || 0}
                  initialText={userReview?.text || ''}
                  onSubmit={handleReviewSubmit}
                  onCancel={() => setShowReviewForm(false)}
                  isEditing={!!userReview}
                />
                </>
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
                        notifyConfirm({
                          title: 'Report Review',
                          message: 'Report this review for inappropriate content?',
                          confirmLabel: 'Report',
                          destructive: true,
                          onConfirm: async () => {
                            try {
                              await complaintsService.createComplaint('review', reviewId);
                              notify.success(
                                'Your report has been submitted. We typically review within about 48 hours.'
                              );
                            } catch {
                              notify.error('Failed to submit report.');
                            }
                          },
                        });
                      }
                    : undefined
                }
              />
            ))}
          </View>
        </View>
      </ScrollView>
      {!isOwner ? (
        <View style={[styles.bottomActionBar, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <View style={styles.bottomActionRow}>
            <TouchableOpacity
              style={[
                styles.joinButton,
                hasJoinedEvent && styles.joinButtonJoined,
                (eventEnded || eventFull) && styles.joinButtonEnded,
              ]}
              onPress={() => {
                if (!user) {
                  if (eventEnded || eventFull) return;
                  // Send signed-out users to login with a return path to this event.
                  router.push({
                    pathname: '/(auth)/login',
                    params: { redirect: `/event/${id}` },
                  });
                  return;
                }
                if (saving || hasJoinedEvent || eventEnded || eventFull) return;
                handleRsvp('going');
              }}
              disabled={
                user
                  ? saving || hasJoinedEvent || eventEnded || eventFull
                  : eventEnded || eventFull
              }
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityState={{
                disabled: user
                  ? saving || hasJoinedEvent || eventEnded || eventFull
                  : eventEnded || eventFull,
              }}
            >
              <Text style={styles.joinButtonText}>
                {eventEnded
                  ? hasJoinedEvent
                    ? 'You attended'
                    : 'Event ended'
                  : eventFull
                    ? 'Event full'
                    : !user
                      ? 'Sign in to join'
                      : hasJoinedEvent
                        ? 'Event Joined'
                        : maxAttendees != null
                          ? `Join Event (${details.rsvp_count} / ${maxAttendees})`
                          : 'Join Event'}
              </Text>
              <Text style={styles.joinArrow}>
                {eventEnded || eventFull ? '' : hasJoinedEvent ? '✓' : '→'}
              </Text>
            </TouchableOpacity>

            {/* One secondary control replaces the old Going / Interested / Remove row:
                star = mark or unmark interest, "Leave" = drop a "going" RSVP. */}
            {user && !eventEnded ? (
              hasJoinedEvent ? (
                <TouchableOpacity
                  style={styles.secondaryActionButton}
                  onPress={handleRemoveRsvp}
                  disabled={saving}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Leave event"
                >
                  <Text style={styles.secondaryActionText}>Leave</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[
                    styles.secondaryActionButton,
                    styles.secondaryActionIcon,
                    details.user_rsvp === 'interested' && styles.secondaryActionActive,
                  ]}
                  onPress={() =>
                    details.user_rsvp === 'interested' ? handleRemoveRsvp() : handleRsvp('interested')
                  }
                  disabled={saving}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={details.user_rsvp === 'interested' ? 'Remove interest' : 'Mark as interested'}
                  accessibilityState={{ selected: details.user_rsvp === 'interested' }}
                >
                  <Star
                    size={22}
                    color={details.user_rsvp === 'interested' ? Colors.text.inverse : Colors.primary}
                    fill={details.user_rsvp === 'interested' ? Colors.text.inverse : 'transparent'}
                  />
                </TouchableOpacity>
              )
            ) : null}
          </View>
          {user && !eventEnded && !hasJoinedEvent ? (
            <Text style={styles.bottomActionHint}>
              {details.user_rsvp === 'interested'
                ? 'Marked as interested. Join to unlock the event chat.'
                : 'Not sure yet? Tap the star to keep an eye on it.'}
            </Text>
          ) : null}
        </View>
      ) : null}
      {id && (
        <AttendeesBottomSheet ref={attendeesSheetRef} eventId={id} refreshToken={attendeesRefresh} />
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
  heroTopActions: {
    flexDirection: 'row',
    alignItems: 'center',
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
    // In-flow above the category pill/title: the contentCard's -32 overlap and
    // the title text make an absolute bottom placement collide, so the dots
    // ride on top of the hero title block instead.
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 5,
    marginBottom: 10,
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
  calendarChoiceRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: 6,
  },
  calendarChoiceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.round,
    borderWidth: 1,
    borderColor: alpha(Colors.primary, 0.27),
    backgroundColor: Colors.primarySoft,
  },
  calendarChoiceText: {
    fontSize: Typography.sizes.sm,
    color: Colors.primary,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
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
    fontSize: Typography.sizes.xs,
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
  chatPromptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    marginBottom: Spacing.lg,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.accentLight,
    borderWidth: 1,
    borderColor: 'rgba(180,25,36,0.12)',
  },
  chatPromptRowDisabled: {
    backgroundColor: Colors.background.secondary,
    borderColor: Colors.border.light,
  },
  chatIconWrap: {
    width: 42,
    height: 42,
    borderRadius: BorderRadius.round,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatPromptMeta: {
    flex: 1,
    minWidth: 0,
  },
  chatPromptTitle: {
    fontSize: Typography.sizes.md,
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  chatPromptTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  chatUnreadBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatUnreadBadgeText: {
    fontSize: Typography.sizes.xs,
    lineHeight: 14,
    color: '#FFFFFF',
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  chatPromptSubtitle: {
    marginTop: 3,
    fontSize: Typography.sizes.xs,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.medium,
  },
  chatPromptSubtitleUnread: {
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.semibold,
  },
  hostBusinessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    marginBottom: Spacing.lg,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.background.secondary,
    borderWidth: 1,
    borderColor: Colors.border.light,
  },
  hostBusinessMeta: {
    flex: 1,
    minWidth: 0,
  },
  hostBusinessLabel: {
    fontSize: Typography.sizes.xs,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.text.tertiary,
    fontFamily: Typography.labelFontFamilies.semibold,
    marginBottom: 2,
  },
  hostBusinessName: {
    fontSize: Typography.sizes.md,
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  hostBusinessHint: {
    marginTop: 4,
    fontSize: Typography.sizes.xs,
    color: Colors.primary,
    fontFamily: Typography.fontFamilies.medium,
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
  noDescriptionText: {
    fontSize: Typography.sizes.md,
    lineHeight: 24,
    color: Colors.text.tertiary,
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
  insightsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: alpha(Colors.primary, 0.27),
    backgroundColor: Colors.primarySoft,
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
  ownerActionBtn: {
    flex: 1,
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
    fontSize: Typography.sizes.xs,
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
  reviewFormTitle: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
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
    paddingTop: 12,
    paddingHorizontal: 24,
    backgroundColor: Colors.background.primary,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border.light,
  },
  bottomActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  secondaryActionButton: {
    height: 58,
    minWidth: 58,
    paddingHorizontal: 18,
    borderRadius: BorderRadius.round,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.background.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionIcon: {
    paddingHorizontal: 0,
    width: 58,
  },
  secondaryActionActive: {
    backgroundColor: Colors.primary,
  },
  secondaryActionText: {
    color: Colors.primary,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  bottomActionHint: {
    marginTop: 8,
    textAlign: 'center',
    fontSize: Typography.sizes.xs,
    color: Colors.text.secondary,
  },
  joinButton: {
    flex: 1,
    height: 58,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  joinButtonJoined: {
    backgroundColor: Colors.success,
  },
  joinButtonEnded: {
    backgroundColor: Colors.text.tertiary,
  },
  endedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.background.secondary,
  },
  endedNoticeText: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.medium,
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
