import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { blockedOffline } from '@/utils/requireOnline';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Linking,
  FlatList,
  useWindowDimensions,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { useIsRestoring, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { findEventRow, previewDetailsFromRow } from '@/utils/eventPreview';
import { freshnessNote } from '@/utils/screenState';
import { FreshnessNote } from '@/components/ui/QueryStates';
import { useConnectivity } from '@/services/connectivity';
import { queryKeys } from '@/hooks/queryKeys';
import { useApp } from '@/contexts/AppContext';
import { eventsService } from '@/services/events';
import { eventChatService } from '@/services/eventChat';
import { socialService } from '@/services/social';
import { reviewsService, type ReviewWithProfile } from '@/services/reviews';
import {
  EventDetails,
  type EventChatMessageWithSender,
  type PublicAttendee,
} from '@/types/database';
import { alpha, Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import { notify, notifyConfirm } from '@/utils/notify';
import { ImageViewer } from '@/components/ImageViewer';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { connectionErrorMessage } from '@/utils/networkErrors';
import { runOrQueueWithNotice } from '@/services/pendingWrites';
import { getConnectivity } from '@/utils/connectivity';
import { Avatar } from '@/components/Avatar';
import {
  AttendeesBottomSheet,
  type AttendeesBottomSheetHandle,
} from '@/components/AttendeesBottomSheet';
import { StarRatingDisplay } from '@/components/StarRatingDisplay';
import { ReviewCard } from '@/components/ReviewCard';
import { ReviewForm } from '@/components/ReviewForm';
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Settings2,
  FileText,
  EyeOff,
  PauseCircle,
  Ticket,
  ShieldCheck,
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
  Ban,
} from 'lucide-react-native';
import {
  classifyRsvpError,
  rsvpErrorMessage,
  rsvpErrorNeedsRefresh,
} from '@/utils/rsvpErrors';
import { EventmapMapPin, EventmapCalendar } from '@/components/icons/EventmapIcons';
import { GoogleMapView } from '@/components/GoogleMapView';
import { DeferredMount } from '@/components/DeferredMount';
import { complaintsService } from '@/services/complaints';
import { getNextOccurrences, getRecurrenceLabel } from '@/utils/recurrence';
import { hasEventEnded, isEventInProgress } from '@/utils/eventStatus';
import { describeEventTime, formatInZone, getDeviceTimeZone, isValidTimeZone, zoneAbbreviation } from '@/utils/timezone';
import {
  buildRecurrenceRule,
  getEventWebUrl,
  getGoogleCalendarEventUrl,
  shareEventIcs,
  shareEventLink,
} from '@/utils/eventShare';
import * as Clipboard from 'expo-clipboard';
import { ReportReasonSheet } from '@/components/ReportReasonSheet';


type InitialDetails = { details: EventDetails | null; isPreview: boolean; updatedAt: number };

/**
 * What the page can show before the network answers: the details last
 * shown for this event (kept on the device), or a preview built from any
 * cached list row for it (utils/eventPreview.ts).
 */
function initialDetailsFromCache(queryClient: QueryClient, id: string | undefined): InitialDetails {
  if (!id) return { details: null, isPreview: false, updatedAt: 0 };
  const key = queryKeys.eventDetails(id);
  const cached = queryClient.getQueryData<EventDetails>(key);
  if (cached) {
    return { details: cached, isPreview: false, updatedAt: queryClient.getQueryState(key)?.dataUpdatedAt ?? 0 };
  }
  const row = findEventRow(
    queryClient.getQueryCache().getAll().map((q) => q.state.data),
    id
  );
  return row
    ? { details: previewDetailsFromRow(row), isPreview: true, updatedAt: 0 }
    : { details: null, isPreview: false, updatedAt: 0 };
}

export default function EventDetail() {
  const insets = useSafeAreaInsets();
  // Hero paging and the cover width must follow the live window: a
  // module-level Dimensions.get() broke the pager on rotation and on web
  // window resize.
  const { width: windowWidth } = useWindowDimensions();
  // Times render in the viewer's own zone; say which one.
  const viewerTz = useMemo(() => getDeviceTimeZone(), []);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, isBanned } = useAuth();
  const { userBusiness } = useApp();
  const queryClient = useQueryClient();
  // Joined / Saved lists are React Query caches; tell them this event changed
  // so they refetch instead of showing stale rows when the user goes back.
  const invalidateLists = () =>
    void queryClient.invalidateQueries({ queryKey: queryKeys.attendanceLists() });
  // Start from what this device already knows (docs/OFFLINE_PLAN.md §3.5):
  // the details last shown for this event, or else a preview built from a
  // cached list row, so the page opens instantly and works offline. The
  // network load below replaces it.
  const [initial] = useState(() => initialDetailsFromCache(queryClient, id));
  const [details, setDetails] = useState<EventDetails | null>(initial.details);
  // `details` is a list-row preview: actions wait for the real details.
  const [isPreview, setIsPreview] = useState(initial.isPreview);
  // When the details on screen were fetched; 0 for a preview.
  const [detailsUpdatedAt, setDetailsUpdatedAt] = useState(initial.updatedAt);
  const [lastLoadFailed, setLastLoadFailed] = useState(false);
  const connectivity = useConnectivity();
  const [loading, setLoading] = useState(!initial.details);
  // First load failed (network / server). Kept apart from `details === null`,
  // which means the event really doesn't exist.
  const [loadError, setLoadError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
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
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  const [togglingFollow, setTogglingFollow] = useState(false);

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
        // Keep the faces already shown; the next focus retries.
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
          setIsPreview(false);
          setDetailsUpdatedAt(Date.now());
          setLastLoadFailed(false);
          setLoadError(false);
          // A deleted event shouldn't keep opening from the device cache.
          if (!data) queryClient.removeQueries({ queryKey: queryKeys.eventDetails(id), exact: true });
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
          // A failed refetch keeps the event on screen; only a failed first
          // load shows the error state (never "Event not found").
          if (cancelled) return;
          setLastLoadFailed(true);
          if (!hasLoadedRef.current) setLoadError(true);
        } finally {
          if (!cancelled) setLoading(false);
        }
      };
      load();
      return () => {
        cancelled = true;
      };
      // reloadTick is a trigger: bumping it from Retry re-runs the load.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, loadAttendees, reloadTick])
  );

  // Mirror the details on screen (fetched or optimistically updated) into the
  // device cache, so the event opens offline next time. Previews and the
  // copy the screen started from aren't written back: that would stamp old
  // data as fresh.
  const mirroredRef = useRef<EventDetails | null>(initial.details);
  useEffect(() => {
    if (!id || !details || isPreview || details === mirroredRef.current) return;
    mirroredRef.current = details;
    queryClient.setQueryData(queryKeys.eventDetails(id), details);
  }, [id, details, isPreview, queryClient]);

  // Opened before the device cache finished restoring (cold start, deep
  // link): adopt what it restored if nothing has loaded yet.
  const isRestoring = useIsRestoring();
  useEffect(() => {
    if (isRestoring || details || hasLoadedRef.current) return;
    const restored = initialDetailsFromCache(queryClient, id);
    if (!restored.details) return;
    mirroredRef.current = restored.details;
    setDetails(restored.details);
    setIsPreview(restored.isPreview);
    setDetailsUpdatedAt(restored.updatedAt);
    setLoading(false);
    // Only the restore finishing should trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRestoring]);

  /** Actions need the real details; a list-row preview only has the basics. */
  const blockedByPreview = () => {
    if (!isPreview) return false;
    notify.error(
      getConnectivity() === 'offline'
        ? "You're offline. Connect to load this event first."
        : lastLoadFailed
          ? "Couldn't load this event yet. Check your connection and try again."
          : 'Still loading this event. Try again in a moment.'
    );
    return true;
  };

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
          // Keep the last known badge.
        });
      return () => {
        cancelled = true;
      };
    }, [id, chatIsOpen])
  );

  // Keep the attendee count (and the chat-unlock state derived from it) fresh
  // while the screen is open, via a 20s focus-scoped poll.
  //
  // A postgres_changes subscription on `rsvps` can't replace this: realtime
  // applies the subscriber's RLS and the only rsvps SELECT policy is
  // `auth.uid() = user_id`, so it would only ever report the viewer's own
  // RSVP. The prepared migration 20261102130000 adds a public
  // `event_rsvp_counts` table (maintained by trigger, in the publication);
  // once applied, subscribe to it here with filter `event_id=eq.<id>` and
  // call refetchCount on each change, keeping the poll as fallback.
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      const refetchCount = async () => {
        // Nothing to gain offline; the focus refetch catches up on return.
        if (getConnectivity() === 'offline') return;
        try {
          const data = await eventsService.getEventDetails(id);
          if (!data) return;
          setDetails((d) => {
            if (!d) return d;
            const nextStatus = data.event.status ?? 'active';
            const prevStatus = d.event.status ?? 'active';
            if (d.rsvp_count === data.rsvp_count && prevStatus === nextStatus) return d;
            // Merge only the count and lifecycle status: the user's own RSVP
            // state may have an optimistic local update in flight.
            return {
              ...d,
              rsvp_count: data.rsvp_count,
              event: { ...d.event, status: nextStatus },
            };
          });
        } catch {
          // Transient failure; the next tick retries.
        }
      };
      const timer = setInterval(refetchCount, 20000);
      return () => clearInterval(timer);
    }, [id])
  );

  const businessId = details?.business.id;

  // Business whose reviews are on screen; a failed reload for the same one
  // keeps them instead of resetting to "no reviews".
  const reviewsLoadedForRef = useRef<string | null>(null);

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
        reviewsLoadedForRef.current = businessId;
      } catch {
        if (reviewsLoadedForRef.current === businessId) return;
        setReviews([]);
        setAverageRating({ average: 0, count: 0 });
        setUserReview(null);
      }
    };
    loadReviews();
  }, [businessId, user]);

  const handleReviewSubmit = async (rating: number, text: string) => {
    if (blockedOffline('post a review')) return;
    if (!businessId) return;
    // Only the write can fail the form. The reload after it is best-effort,
    // so a saved review is never reported as "failed".
    await reviewsService.createOrUpdateReview(businessId, rating, text || null);
    setUserReview({ rating, text });
    setShowReviewForm(false);
    try {
      const [list, avg] = await Promise.all([
        reviewsService.getReviewsForBusiness(businessId),
        reviewsService.getAverageRatingAndCount(businessId),
      ]);
      setReviews(list);
      setAverageRating(avg);
    } catch {
      notify.success('Review saved. It will show here after the next refresh.');
    }
  };

  const handleReviewRespond = async (reviewId: string, response: string) => {
    await reviewsService.updateBusinessResponse(reviewId, response);
    // Show the saved response right away; the reload is best-effort.
    setReviews((prev) =>
      prev.map((r) => (r.id === reviewId ? { ...r, business_response: response } : r))
    );
    if (!businessId) return;
    reviewsService
      .getReviewsForBusiness(businessId)
      .then(setReviews)
      .catch(() => {});
  };

  const handleRsvp = async (status: 'going' | 'interested') => {
    if (blockedByPreview()) return;
    if (blockedOffline('RSVP')) return;
    if (!user || !id) return;
    if (isBanned) {
      notify.error('Your account has been suspended. Please contact support.');
      return;
    }
    if (details?.event.status === 'cancelled') {
      notify.error('This event was cancelled, so it can no longer be joined.');
      return;
    }
    if (details && hasEventEnded(details.event)) {
      notify.error('This event is over, so it can no longer be joined.');
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const result = await socialService.createOrUpdateRsvp(id, status);
      invalidateLists();
      if (result === 'requested') {
        notify.success('Request sent. The host will review it.');
      }
      setDetails((d) =>
        d
          ? {
              ...d,
              user_rsvp: result,
              rsvp_count: Math.max(
                0,
                d.rsvp_count +
                  (d.user_rsvp !== 'going' && result === 'going'
                    ? 1
                    : d.user_rsvp === 'going' && result !== 'going'
                      ? -1
                      : 0)
              ),
            }
          : null
      );
      void loadAttendees();
      setAttendeesRefresh((n) => n + 1);
    } catch (err: unknown) {
      const code = classifyRsvpError(err);
      notify.error(rsvpErrorMessage(code));
      if (rsvpErrorNeedsRefresh(code)) {
        // The event changed under the user (filled up, cancelled, ended or
        // deleted): reload so the screen reflects its real state instead of
        // keeping a stale Join button.
        try {
          const fresh = await eventsService.getEventDetails(id);
          setDetails(fresh);
          if (fresh) void loadAttendees();
        } catch {
          // Keep what we have; the focus refetch will retry.
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveRsvp = async () => {
    if (blockedByPreview()) return;
    if (blockedOffline('change your RSVP')) return;
    if (!user || !id) return;
    setSaving(true);
    try {
      await socialService.deleteRsvp(id);
      invalidateLists();
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
    } catch (err) {
      notify.error(connectionErrorMessage(err) ?? 'Failed to remove RSVP');
    } finally {
      setSaving(false);
    }
  };

  const handleJoinWaitlist = async () => {
    if (blockedByPreview()) return;
    if (blockedOffline('join the waitlist')) return;
    if (!user || !id || saving) return;
    setSaving(true);
    try {
      const position = await socialService.joinWaitlist(id);
      setDetails((d) =>
        d
          ? {
              ...d,
              waitlist: {
                count: (d.waitlist?.count ?? 0) + (d.waitlist?.position ? 0 : 1),
                position,
                notified_at: d.waitlist?.notified_at ?? null,
              },
            }
          : d
      );
      notify.success(`You're #${position} on the waitlist. We'll tell you when a spot opens.`);
    } catch (err: unknown) {
      // The service wraps RPC failures in RsvpError, so classify by code —
      // the raw SQL hint only survives in err.cause.
      const code = classifyRsvpError(err);
      if (code === 'SPOT_AVAILABLE') {
        // Someone left between render and tap: just join.
        notify.success('A spot is free — joining you now.');
        setSaving(false);
        await handleRsvp('going');
        return;
      }
      notify.error(rsvpErrorMessage(code));
      if (rsvpErrorNeedsRefresh(code)) {
        try {
          const fresh = await eventsService.getEventDetails(id);
          setDetails(fresh);
        } catch {
          // Focus refetch will retry.
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleLeaveWaitlist = async () => {
    if (blockedByPreview()) return;
    if (blockedOffline('leave the waitlist')) return;
    if (!user || !id || saving) return;
    setSaving(true);
    try {
      await socialService.leaveWaitlist(id);
      setDetails((d) =>
        d && d.waitlist
          ? {
              ...d,
              waitlist: {
                count: Math.max(0, d.waitlist.count - 1),
                position: null,
                notified_at: null,
              },
            }
          : d
      );
      notify.success('Removed from the waitlist.');
    } catch (err) {
      notify.error(connectionErrorMessage(err) ?? 'Could not leave the waitlist. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Leaving a "going" RSVP also locks the user out of the event chat, so ask
  // first. The interested-star toggle still removes silently via
  // handleRemoveRsvp — only the explicit "Leave" button confirms.
  const handleLeaveEvent = () => {
    if (blockedByPreview()) return;
    if (blockedOffline('leave this event')) return;
    const cancellingRequest = details?.user_rsvp === 'requested';
    notifyConfirm({
      title: cancellingRequest ? 'Cancel request?' : 'Leave event?',
      message: cancellingRequest
        ? 'The host will no longer see your request to join.'
        : "You'll lose access to the event chat for this event.",
      confirmLabel: cancellingRequest ? 'Cancel request' : 'Leave',
      cancelLabel: cancellingRequest ? 'Keep it' : 'Stay',
      destructive: true,
      onConfirm: () => void handleRemoveRsvp(),
    });
  };

  const handleToggleSave = async () => {
    if (blockedByPreview()) return;
    if (!user || !id || !details || togglingSave) return;
    const wasSaved = details.user_saved;
    setTogglingSave(true);
    // Optimistic flip; revert on failure.
    setDetails((d) =>
      d ? { ...d, user_saved: !wasSaved, save_count: Math.max(0, d.save_count + (wasSaved ? -1 : 1)) } : d
    );
    try {
      // Queued (kept as is) when offline; replayed on reconnect.
      const result = await runOrQueueWithNotice({ kind: 'save', targetId: id, on: !wasSaved, label: details.event.title });
      if (result === 'done') invalidateLists();
    } catch (err) {
      setDetails((d) =>
        d ? { ...d, user_saved: wasSaved, save_count: Math.max(0, d.save_count + (wasSaved ? 1 : -1)) } : d
      );
      notify.error(
        connectionErrorMessage(err) ?? (wasSaved ? 'Failed to remove from saved events' : 'Failed to save event')
      );
    } finally {
      setTogglingSave(false);
    }
  };

  const handleShareEvent = async () => {
    if (!id || !details) return;
    try {
      const outcome = await shareEventLink({
        title: details.event.title,
        url: getEventWebUrl(id),
        copyToClipboard: (text) => Clipboard.setStringAsync(text).then(() => {}),
      });
      // Desktop browsers mostly lack navigator.share, so the link is copied
      // instead — say so, otherwise the button looks broken.
      if (outcome === 'copied') notify.success('Event link copied to clipboard.');
      if (outcome !== 'dismissed') eventsService.trackEventInteraction(id, 'share');
    } catch {
      notify.error('Could not share this event.');
    }
  };

  const handleToggleFollow = async () => {
    if (blockedByPreview()) return;
    if (!user || !details || togglingFollow) return;
    const wasFollowing = details.user_following_business;
    setTogglingFollow(true);
    setDetails((d) => (d ? { ...d, user_following_business: !wasFollowing } : d));
    try {
      await runOrQueueWithNotice({
        kind: 'follow',
        targetId: details.business.id,
        on: !wasFollowing,
        label: details.business.name,
      });
    } catch (err) {
      setDetails((d) => (d ? { ...d, user_following_business: wasFollowing } : d));
      notify.error(
        connectionErrorMessage(err) ??
          (wasFollowing ? 'Could not unfollow this organizer.' : 'Could not follow this organizer.')
      );
    } finally {
      setTogglingFollow(false);
    }
  };

  /**
   * Calendar exports use the occurrence the header is showing (a weekly event
   * that started months ago would otherwise export a past date) and carry an
   * RRULE so repeating events import as a series.
   */
  const calendarTimes = () => {
    if (!details) return null;
    const start = displayStartIso;
    const durationMs =
      new Date(details.event.end_datetime).getTime() -
      new Date(details.event.start_datetime).getTime();
    const end = new Date(
      new Date(start).getTime() + (durationMs > 0 ? durationMs : 60 * 60 * 1000)
    ).toISOString();
    return {
      start,
      end,
      recurrence: buildRecurrenceRule(
        details.event.recurrence_pattern,
        details.event.is_recurring,
        details.event.timezone ?? null
      ),
      timezone: details.event.timezone ?? null,
    };
  };

  const handleOpenCalendar = () => {
    if (!details) return;
    const times = calendarTimes();
    if (!times) return;
    const url = getGoogleCalendarEventUrl({
      title: details.event.title,
      startIso: times.start,
      endIso: times.end,
      address: details.event.address,
      details: `${getEventWebUrl(details.event.id)}\n\nHosted by ${details.business.name}`,
      recurrence: times.recurrence,
      timezone: times.timezone,
    });
    eventsService.trackEventInteraction(details.event.id, 'calendar');
    void Linking.openURL(url).catch(() => notify.error('Could not open Google Calendar.'));
  };

  const handleShareIcs = async () => {
    if (!details) return;
    const times = calendarTimes();
    if (!times) return;
    try {
      await shareEventIcs({
        id: details.event.id,
        title: details.event.title,
        startIso: times.start,
        endIso: times.end,
        recurrence: times.recurrence,
        timezone: times.timezone,
        address: details.event.address,
        description: [
          details.event.description?.trim(),
          `${getEventWebUrl(details.event.id)}\n\nHosted by ${details.business.name}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
      });
      eventsService.trackEventInteraction(details.event.id, 'calendar');
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
    } catch (err: unknown) {
      // Unique violation = already reported (once the dedupe index exists).
      if ((err as { code?: string })?.code === '23505') {
        notify.success("You've already reported this event. It's in the queue.");
        return;
      }
      notify.error(connectionErrorMessage(err) ?? 'Failed to submit report. Please try again.');
    }
  };

  const handleReportEvent = () => {
    if (blockedByPreview()) return;
    if (blockedOffline('report this event')) return;
    setReportSheetOpen(true);
  };

  // Dates and times render in the event's zone when it has one (20261103140000);
  // legacy events fall back to the viewer's zone, exactly as before.
  const eventTz =
    details?.event.timezone && isValidTimeZone(details.event.timezone) ? details.event.timezone : null;
  const displayTz = eventTz ?? viewerTz;
  const formatDate = (dateString: string) =>
    formatInZone(new Date(dateString), displayTz, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  const formatDateTime = (dateString: string, tz: string = displayTz) =>
    formatInZone(new Date(dateString), tz, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  const formatClock = (d: Date, tz: string = displayTz) =>
    formatInZone(d, tz, { hour: 'numeric', minute: '2-digit' });
  const dayKey = (d: Date, tz: string) =>
    formatInZone(d, tz, { year: 'numeric', month: '2-digit', day: '2-digit' });
  // "1:00 PM – 3:00 PM"; for a recurring event the displayed start may be a later
  // occurrence, so the end is shifted by the original duration.
  const formatTimeRange = (startIso: string, endIso: string, originalStartIso: string, tz: string = displayTz) => {
    const start = new Date(startIso);
    const originalStart = new Date(originalStartIso);
    const end = new Date(endIso);
    if (Number.isNaN(start.getTime())) return '';
    if (Number.isNaN(end.getTime()) || Number.isNaN(originalStart.getTime())) return formatClock(start, tz);
    const shiftedEnd = new Date(start.getTime() + (end.getTime() - originalStart.getTime()));
    if (shiftedEnd.getTime() <= start.getTime()) return formatClock(start, tz);
    const multiDay = dayKey(shiftedEnd, tz) !== dayKey(start, tz);
    return `${formatClock(start, tz)} – ${multiDay ? formatDateTime(shiftedEnd.toISOString(), tz) : formatClock(shiftedEnd, tz)}`;
  };

  if (loading) {
    // Static skeleton mirroring the hero + content-card layout. The floating
    // back button stays live so users aren't stuck while details load.
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
            <Text style={styles.brandTitle}>EventMap</Text>
            <View style={styles.heroTopActions}>
              <View style={styles.backButton} />
            </View>
          </View>
        </View>
        <View
          accessibilityLabel="Loading event"
          accessibilityState={{ busy: true }}
        >
          <View style={styles.skeletonHero} />
          <View style={styles.skeletonCard}>
            <View style={styles.skeletonTitleBar} />
            <View style={styles.skeletonMetaRow}>
              <View style={styles.skeletonCircle} />
              <View style={styles.skeletonBar} />
            </View>
            <View style={styles.skeletonMetaRow}>
              <View style={styles.skeletonCircle} />
              <View style={[styles.skeletonBar, styles.skeletonBarShort]} />
            </View>
            <View style={styles.skeletonParagraph}>
              <View style={styles.skeletonLine} />
              <View style={styles.skeletonLine} />
              <View style={[styles.skeletonLine, styles.skeletonLineShort]} />
            </View>
          </View>
        </View>
      </View>
    );
  }

  if (!details) {
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
            <Text style={styles.brandTitle}>EventMap</Text>
            <View style={styles.heroTopActions}>
              <View style={styles.backButton} />
            </View>
          </View>
        </View>
        {loadError ? (
          <View style={styles.centerContainer}>
            <ErrorState
              title="Couldn't load this event"
              onRetry={() => {
                setLoading(true);
                setReloadTick((t) => t + 1);
              }}
            />
          </View>
        ) : (
          <View style={styles.centerContainer}>
            <Text style={styles.errorText}>Event not found</Text>
            <Button
              label="Back to Discover"
              onPress={() => router.replace('/(tabs)/discover' as never)}
              style={styles.notFoundButton}
            />
          </View>
        )}
      </View>
    );
  }

  const { event, business, category, links } = details;
  // Why what's shown may be incomplete or old (docs/OFFLINE_PLAN.md §3.4).
  const detailsNote = isPreview
    ? connectivity !== 'online' || lastLoadFailed
      ? 'Saved summary · Full details load when you reconnect'
      : null
    : freshnessNote({ hasData: true, dataUpdatedAt: detailsUpdatedAt, isError: lastLoadFailed, connectivity });

  const venueLat = Number.isFinite(event.lat) ? event.lat : business.lat;
  const venueLng = Number.isFinite(event.lng) ? event.lng : business.lng;
  const canOpenEventChat = details.user_rsvp === 'going' && details.rsvp_count >= 2;
  const hasJoinedEvent = details.user_rsvp === 'going';
  const hasRequested = details.user_rsvp === 'requested';
  const approvalMode = event.rsvp_mode === 'approval';
  const eventEnded = hasEventEnded(event);
  const eventCancelled = event.status === 'cancelled';
  const eventPostponed = event.status === 'postponed';
  const eventDraft = event.publish_state === 'draft';
  const eventUnlisted = event.visibility === 'unlisted';
  // Host switched "Accepting RSVPs" off (20261103130000). People already in
  // keep their seat and may still leave; nobody new can join.
  const rsvpsClosedByHost = !!event.rsvp_closed && !hasJoinedEvent;
  // "Closed" = no RSVP changes possible, for whichever reason.
  const eventClosed = eventEnded || eventCancelled || eventPostponed || eventDraft || rsvpsClosedByHost;
  const eventLive = !eventCancelled && isEventInProgress(event);
  const maxAttendees = event.max_attendees ?? null;
  const eventFull =
    maxAttendees != null && details.rsvp_count >= maxAttendees && !hasJoinedEvent;
  // Waitlist exists only once migration 20261102160000 is applied (the RPC
  // then returns a `waitlist` key); before that the full state stays a plain
  // disabled button.
  const waitlist = details.waitlist;
  const onWaitlist = !!waitlist && (waitlist.position ?? 0) > 0;
  // Joining the waitlist needs an open event; LEAVING it must survive the
  // host closing RSVPs or postponing (the row is the user's own). A pending
  // request takes precedence over the waitlist CTA.
  const canWaitlist =
    !!user &&
    !!waitlist &&
    !hasRequested &&
    ((eventFull && !eventClosed) || (onWaitlist && !eventCancelled && !eventEnded && !eventDraft));
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
          <Text style={styles.brandTitle}>EventMap</Text>
          <View style={styles.heroTopActions}>
            {user ? (
              <TouchableOpacity
                style={styles.backButton}
                onPress={handleToggleSave}
                disabled={togglingSave}
                accessibilityRole="button"
                accessibilityLabel={details.user_saved ? 'Remove from saved events' : 'Save event'}
                accessibilityState={{ selected: details.user_saved }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
                const page = Math.round(e.nativeEvent.contentOffset.x / windowWidth);
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
                    style={[styles.coverImage, { width: windowWidth }]}
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
          <LinearGradient
            colors={['transparent', alpha('#000000', 0.7)]}
            style={styles.heroGradient}
            pointerEvents="none"
          />
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
            {category.label ? (
              <View style={styles.heroCategoryPill}>
                <Text style={styles.heroCategoryText}>{category.label.toUpperCase()}</Text>
              </View>
            ) : null}
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
          <FreshnessNote text={detailsNote} />
          {eventDraft && isOwner ? (
            <View style={styles.infoNotice} accessibilityRole="alert">
              <FileText size={18} color={Colors.text.secondary} />
              <View style={styles.cancelledNoticeBody}>
                <Text style={styles.infoNoticeTitle}>Draft — only you can see this</Text>
                <Text style={styles.cancelledNoticeText}>
                  Publish it from Manage event when it is ready. Drafts do not count toward your monthly events.
                </Text>
              </View>
            </View>
          ) : null}
          {eventUnlisted && isOwner && !eventDraft ? (
            <View style={styles.infoNotice}>
              <EyeOff size={18} color={Colors.text.secondary} />
              <View style={styles.cancelledNoticeBody}>
                <Text style={styles.infoNoticeTitle}>Unlisted</Text>
                <Text style={styles.cancelledNoticeText}>Hidden from Discover and search. Anyone with the link can open it.</Text>
              </View>
            </View>
          ) : null}
          {eventPostponed ? (
            <View style={styles.cancelledNotice} accessibilityRole="alert">
              <PauseCircle size={18} color={Colors.error} />
              <View style={styles.cancelledNoticeBody}>
                <Text style={styles.cancelledNoticeTitle}>Postponed — new date coming</Text>
                <Text style={styles.cancelledNoticeText}>
                  {event.status_note?.trim()
                    ? event.status_note.trim()
                    : isOwner
                      ? 'Attendees have been told. Set the new date from Manage event to resume.'
                      : hasJoinedEvent || details.user_rsvp === 'interested'
                        ? 'Your RSVP is kept. You will be notified when the new date is set.'
                        : 'Joining reopens once the host sets a new date.'}
                </Text>
              </View>
            </View>
          ) : null}
          {eventCancelled ? (
            <View style={styles.cancelledNotice} accessibilityRole="alert">
              <Ban size={18} color={Colors.error} />
              <View style={styles.cancelledNoticeBody}>
                <Text style={styles.cancelledNoticeTitle}>This event was cancelled</Text>
                <Text style={styles.cancelledNoticeText}>
                  {isOwner
                    ? 'You cancelled this event. Everyone who was going or interested has been notified.'
                    : hasJoinedEvent || details.user_rsvp === 'interested'
                      ? 'The organizer cancelled it. Your RSVP no longer applies.'
                      : 'The organizer cancelled it, so it can no longer be joined.'}
                </Text>
              </View>
            </View>
          ) : null}
          <View style={styles.quickInfoSection}>
            <View style={styles.metaRow}>
              <View style={styles.metaIconWrap}>
                <EventmapCalendar size={18} color={Colors.primary} />
              </View>
              <View style={styles.metaBody}>
                <Text style={styles.metaLabel}>
                  {event.is_recurring && displayStartIso !== event.start_datetime ? 'Next date' : 'Date'}
                </Text>
                <Text style={styles.metaValue}>
                  {formatDate(displayStartIso)}
                  {eventCancelled
                    ? '  ·  Cancelled'
                    : eventLive
                      ? '  ·  Happening now'
                      : eventEnded
                        ? '  ·  Ended'
                        : ''}
                </Text>
              </View>
            </View>
            <View style={styles.metaRow}>
              <View style={styles.metaIconWrap}>
                <Clock3 size={18} color={Colors.primary} />
              </View>
              <View style={styles.metaBody}>
                <Text style={styles.metaLabel}>Time</Text>
                {(() => {
                  const when = describeEventTime(displayStartIso, eventTz, viewerTz);
                  const zoneSuffix =
                    when.differs && eventTz ? ` ${zoneAbbreviation(eventTz, new Date(displayStartIso))}` : '';
                  return (
                    <>
                      <Text style={styles.metaValue}>
                        {formatTimeRange(displayStartIso, event.end_datetime, event.start_datetime)}
                        {zoneSuffix}
                      </Text>
                      {when.differs ? (
                        <Text style={styles.metaSubValue}>
                          {formatTimeRange(displayStartIso, event.end_datetime, event.start_datetime, viewerTz)} your time
                          {dayKey(new Date(displayStartIso), viewerTz) !== dayKey(new Date(displayStartIso), displayTz)
                            ? ` (${formatInZone(new Date(displayStartIso), viewerTz, { month: 'short', day: 'numeric' })})`
                            : ''}
                        </Text>
                      ) : null}
                    </>
                  );
                })()}
              </View>
            </View>
            {event.address && (
              <View style={styles.metaRow}>
                <View style={styles.metaIconWrap}>
                  <EventmapMapPin size={18} color={Colors.primary} />
                </View>
                <View style={styles.metaBody}>
                  <Text style={styles.metaLabel}>Location</Text>
                  <Text style={styles.metaValue}>{event.address}</Text>
                </View>
              </View>
            )}
            {event.price_label || event.ticket_url ? (
              <View style={styles.metaRow}>
                <View style={styles.metaIconWrap}>
                  <Ticket size={18} color={Colors.primary} />
                </View>
                <View style={styles.metaBody}>
                  <Text style={styles.metaLabel}>Tickets</Text>
                  <Text style={styles.metaValue}>{event.price_label?.trim() || 'See ticket link'}</Text>
                  {event.ticket_url ? (
                    <TouchableOpacity
                      onPress={() => {
                        eventsService.trackEventInteraction(event.id, 'ticket');
                        void Linking.openURL(event.ticket_url!).catch(() => notify.error('Could not open the ticket link.'));
                      }}
                      accessibilityRole="link"
                      accessibilityLabel="Open ticket link"
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Text style={styles.metaLink}>Get tickets</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ) : null}
            {event.age_restriction && event.age_restriction !== 'none' ? (
              <View style={styles.metaRow}>
                <View style={styles.metaIconWrap}>
                  <ShieldCheck size={18} color={Colors.primary} />
                </View>
                <View style={styles.metaBody}>
                  <Text style={styles.metaLabel}>Age</Text>
                  <Text style={styles.metaValue}>{event.age_restriction} only</Text>
                </View>
              </View>
            ) : null}
          </View>

          {!eventCancelled ? (
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
          ) : null}

          <TouchableOpacity
            style={styles.attendeesSection}
            onPress={() => (details.rsvp_count > 0 ? attendeesSheetRef.current?.present() : null)}
            activeOpacity={details.rsvp_count > 0 ? 0.85 : 1}
            disabled={details.rsvp_count === 0}
            accessibilityRole="button"
            accessibilityLabel={
              details.rsvp_count === 0
                ? 'Be the first to RSVP'
                : `${details.rsvp_count} going, see who's coming`
            }
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

          {/* Shown to every signed-in attendee, not just those already going:
              the chat is a reason to join, so it shouldn't be invisible until
              after you RSVP. */}
          {user && !isOwner && !eventCancelled && !eventEnded && (
            <TouchableOpacity
              style={[styles.chatPromptRow, !canOpenEventChat && styles.chatPromptRowDisabled]}
              onPress={() => {
                if (canOpenEventChat) {
                  router.push(`/event-chat/${event.id}` as never);
                }
              }}
              activeOpacity={canOpenEventChat ? 0.85 : 1}
              disabled={!canOpenEventChat}
              accessibilityRole="button"
              accessibilityLabel={
                canOpenEventChat
                  ? 'Open event chat'
                  : hasJoinedEvent
                    ? 'Event chat, unlocks when 2 people are going'
                    : 'Event chat, join the event to unlock'
              }
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
                    : hasJoinedEvent
                      ? 'Unlocks when 2 people are going'
                      : 'Join the event to unlock the chat'}
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
            {/* get_event_details already returns user_following_business; this
                saves a trip to the venue page just to follow. */}
            {user && !isOwner ? (
              <TouchableOpacity
                style={[styles.followChip, details.user_following_business && styles.followChipActive]}
                onPress={handleToggleFollow}
                disabled={togglingFollow}
                activeOpacity={0.8}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityState={{ selected: details.user_following_business }}
                accessibilityLabel={
                  details.user_following_business
                    ? `Unfollow ${business.name}`
                    : `Follow ${business.name}`
                }
              >
                <Text
                  style={[
                    styles.followChipText,
                    details.user_following_business && styles.followChipTextActive,
                  ]}
                >
                  {details.user_following_business ? 'Following' : 'Follow'}
                </Text>
              </TouchableOpacity>
            ) : (
              <ChevronRight size={22} color={Colors.text.tertiary} />
            )}
          </TouchableOpacity>

          <View style={styles.descriptionSection}>
            <Text style={styles.bigSectionTitle}>About Event</Text>
            {event.description ? (
              <Text style={styles.descriptionText}>{event.description}</Text>
            ) : (
              <Text style={styles.noDescriptionText}>No description provided.</Text>
            )}
            {event.what_to_bring?.trim() ? (
              <View style={styles.extraBlock}>
                <Text style={styles.extraTitle}>What to bring</Text>
                <Text style={styles.descriptionText}>{event.what_to_bring.trim()}</Text>
              </View>
            ) : null}
            {event.accessibility_notes?.trim() ? (
              <View style={styles.extraBlock}>
                <Text style={styles.extraTitle}>Accessibility</Text>
                <Text style={styles.descriptionText}>{event.accessibility_notes.trim()}</Text>
              </View>
            ) : null}
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
                <TouchableOpacity
                  style={styles.directionsBtn}
                  onPress={() => {
                    eventsService.trackEventInteraction(event.id, 'directions');
                    void Linking.openURL(`https://www.google.com/maps?q=${encodeURIComponent(event.address || `${event.lat},${event.lng}`)}`);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Get directions"
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                >
                  <Text style={styles.directionsText}>Get Directions</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {Number.isFinite(venueLat) && Number.isFinite(venueLng) ? (
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
            ) : null}
          </View>

          {links.length > 0 && (
            <View style={styles.linksSection}>
              <Text style={styles.bigSectionTitle}>Links</Text>
              {links.map((link) => (
                <TouchableOpacity
                  key={link.id}
                  style={styles.linkRow}
                  onPress={() => Linking.openURL(link.url)}
                  accessibilityRole="link"
                  accessibilityLabel={link.label || link.url}
                  hitSlop={{ top: 6, bottom: 6 }}
                >
                  <ExternalLink size={18} color={Colors.primary} />
                  <Text style={styles.linkText} numberOfLines={1}>
                    {link.label || link.url}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {user && !isOwner && eventEnded && !eventCancelled && (
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
                accessibilityRole="button"
                accessibilityLabel="View reach, saves and RSVP insights"
              >
                <TrendingUp size={20} color={Colors.primary} />
                <Text style={styles.insightsBannerText}>Reach, saves & RSVPs</Text>
              </TouchableOpacity>
              {/* A cancelled event is read-only for the host too: no Edit or
                  second Cancel. Insights above stay available. */}
              {/* Edit / Cancel / attendees / chat controls live in the hub now. */}
              <Button
                label="Manage event"
                onPress={() => router.push(`/business/manage-event/${event.id}` as never)}
                icon={<Settings2 size={18} color={Colors.white} />}
                fullWidth
                style={styles.manageBtn}
                accessibilityLabel="Open the host tools for this event"
              />
            </>
          )}

          {user && !isOwner ? (
            <TouchableOpacity
              style={styles.reportEventRow}
              onPress={handleReportEvent}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Report this event"
              hitSlop={{ top: 6, bottom: 6 }}
            >
              <Flag size={18} color={Colors.text.secondary} />
              <Text style={styles.reportEventText}>Report this event</Text>
            </TouchableOpacity>
          ) : null}

          <View style={styles.reviewsSection}>
            {/* These are reviews of the hosting BUSINESS (venue), not of this
                single event — label them as such. */}
            <Text style={styles.bigSectionTitle}>
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

          {/* Legal footnotes live at the very bottom of the scroll content. */}
          <Text style={styles.promoFootnote}>
            Listings may be ordered using distance, relevance, and paid promotion from hosts.
          </Text>
          <Text style={styles.trustFootnote}>
            Reports are reviewed within about 48 hours. We may remove content that violates our guidelines.
          </Text>
        </View>
      </ScrollView>
      {!isOwner ? (
        <View style={[styles.bottomActionBar, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <View style={styles.bottomActionRow}>
            <TouchableOpacity
              style={[
                styles.joinButton,
                hasJoinedEvent && styles.joinButtonJoined,
                (eventClosed || (eventFull && !canWaitlist)) && styles.joinButtonEnded,
                canWaitlist && onWaitlist && styles.joinButtonWaitlisted,
              ]}
              onPress={() => {
                if (!user) {
                  if (eventClosed || eventFull) return;
                  // Send signed-out users to login with a return path to this event.
                  router.push({
                    pathname: '/(auth)/login',
                    params: { redirect: `/event/${id}` },
                  });
                  return;
                }
                if (canWaitlist) {
                  if (onWaitlist) handleLeaveWaitlist();
                  else handleJoinWaitlist();
                  return;
                }
                if (saving || hasJoinedEvent || hasRequested || eventClosed || eventFull) return;
                handleRsvp('going');
              }}
              disabled={
                user
                  ? saving || hasJoinedEvent || hasRequested || eventClosed || (eventFull && !canWaitlist)
                  : eventClosed || eventFull
              }
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityState={{
                disabled: user
                  ? saving || hasJoinedEvent || hasRequested || eventClosed || (eventFull && !canWaitlist)
                  : eventClosed || eventFull,
              }}
              accessibilityLabel={
                canWaitlist
                  ? onWaitlist
                    ? `You're number ${waitlist?.position} on the waitlist. Leave waitlist`
                    : 'Event full. Join the waitlist'
                  : undefined
              }
            >
              <Text style={styles.joinButtonText}>
                {eventCancelled
                  ? 'Event cancelled'
                  : eventEnded
                  ? hasJoinedEvent
                    ? 'You attended'
                    : 'Event ended'
                  : eventPostponed
                  ? hasJoinedEvent
                    ? 'Postponed · your spot is kept'
                    : 'Postponed · new date coming'
                  : hasRequested
                  ? 'Request pending · host will review'
                  : rsvpsClosedByHost
                  ? 'RSVPs closed'
                  : eventFull
                    ? canWaitlist
                      ? onWaitlist
                        ? `On waitlist · #${waitlist?.position} · tap to leave`
                        : 'Event full · Join waitlist'
                      : 'Event full'
                    : !user
                      ? 'Sign in to join'
                      : hasJoinedEvent
                        ? 'Event Joined'
                        : approvalMode
                            ? 'Request to join'
                            : maxAttendees != null
                              ? `Join Event (${details.rsvp_count} / ${maxAttendees})`
                              : 'Join Event'}
              </Text>
              {eventClosed || (eventFull && !canWaitlist) ? null : hasJoinedEvent ? (
                <Text style={styles.joinArrow}>✓</Text>
              ) : (
                <ArrowRight size={22} color={Colors.white} />
              )}
            </TouchableOpacity>

            {/* One secondary control replaces the old Going / Interested / Remove row:
                star = mark or unmark interest, "Leave" = drop a "going" RSVP. */}
            {/* Leaving (or cancelling a request / un-starring) must survive
                "RSVPs closed" and postponed states: the row is the user's own.
                Only cancelled/ended/draft events freeze it. */}
            {user && !eventCancelled && !eventEnded && !eventDraft ? (
              hasRequested ? (
                <TouchableOpacity
                  style={styles.secondaryActionButton}
                  onPress={handleLeaveEvent}
                  disabled={saving}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel your request to join"
                >
                  <Text style={styles.secondaryActionText}>Cancel request</Text>
                </TouchableOpacity>
              ) : hasJoinedEvent ? (
                <TouchableOpacity
                  style={styles.secondaryActionButton}
                  onPress={handleLeaveEvent}
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
          {user && !eventClosed && !hasJoinedEvent ? (
            <Text style={styles.bottomActionHint}>
              {canWaitlist
                ? onWaitlist
                  ? `We'll notify you the moment a spot opens. ${waitlist?.count ?? 0} waiting.`
                  : `${waitlist?.count ?? 0} ${waitlist?.count === 1 ? 'person is' : 'people are'} waiting. You'll be notified when a spot opens.`
                : details.user_rsvp === 'interested'
                  ? 'Marked as interested. Join to unlock the event chat.'
                  : 'Not sure yet? Tap the star to keep an eye on it.'}
            </Text>
          ) : null}
        </View>
      ) : null}
      {id && (
        <AttendeesBottomSheet ref={attendeesSheetRef} eventId={id} refreshToken={attendeesRefresh} />
      )}
      <ReportReasonSheet
        visible={reportSheetOpen}
        title="Report this event"
        onClose={() => setReportSheetOpen(false)}
        onSubmit={(reason) => void submitEventReport(reason)}
      />
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
  /* ── Loading skeleton (mirrors hero + content card) ── */
  skeletonHero: {
    height: 480,
    backgroundColor: Colors.background.tertiary,
  },
  skeletonCard: {
    marginHorizontal: Spacing.md,
    marginTop: -Spacing.xl,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xxl,
    paddingHorizontal: Spacing.md + Spacing.xs,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.lg,
    gap: Spacing.md,
  },
  skeletonTitleBar: {
    height: 28,
    width: '70%',
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.background.tertiary,
  },
  skeletonMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  skeletonCircle: {
    width: 42,
    height: 42,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.background.tertiary,
  },
  skeletonBar: {
    height: 14,
    width: '55%',
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.background.tertiary,
  },
  skeletonBarShort: {
    width: '40%',
  },
  skeletonParagraph: {
    marginTop: Spacing.sm,
    gap: Spacing.sm,
  },
  skeletonLine: {
    height: 12,
    width: '100%',
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.background.tertiary,
  },
  skeletonLineShort: {
    width: '62%',
  },
  backButton: {
    padding: Spacing.sm,
    marginRight: Spacing.sm,
  },
  scrollView: {
    flex: 1,
  },
  heroSection: {
    position: 'relative',
    height: 480,
    overflow: 'hidden',
  },
  coverImage: {
    height: 480,
    backgroundColor: Colors.background.secondary,
  },
  heroGradient: {
    // Bottom-up scrim so the white title/category stay legible on any photo.
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 240,
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
    color: Colors.white,
    fontSize: Typography.sizes.xxs,
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
  metaBody: {
    flex: 1,
    minWidth: 0,
  },
  metaValue: {
    marginTop: 2,
    fontSize: Typography.sizes.md,
    lineHeight: 22,
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  metaLink: {
    marginTop: 4,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.primary,
  },
  infoNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.neutralSoft,
  },
  infoNoticeTitle: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.primary,
    marginBottom: 2,
  },
  extraBlock: {
    marginTop: Spacing.md,
  },
  extraTitle: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.secondary,
    marginBottom: 4,
  },
  metaSubValue: {
    marginTop: 2,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
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
    marginTop: Spacing.xl,
    marginBottom: Spacing.sm,
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
  // Single section-heading style used by every content section on this screen.
  bigSectionTitle: {
    fontSize: Typography.sizes.xl,
    lineHeight: 28,
    color: Colors.text.primary,
    letterSpacing: -0.2,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
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
  directionsBtn: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xs,
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
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
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
  linksSection: {
    marginBottom: Spacing.lg,
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
  manageBtn: {
    marginBottom: Spacing.lg,
  },
  followChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: BorderRadius.round,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: Colors.primarySoft,
  },
  followChipActive: {
    backgroundColor: Colors.primary,
  },
  followChipText: {
    fontSize: Typography.sizes.sm,
    color: Colors.primary,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  followChipTextActive: {
    color: Colors.white,
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
  },
  reviewsSection: {
    marginTop: Spacing.xl,
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
    backgroundColor: Colors.primarySoft,
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
  notFoundButton: {
    marginTop: Spacing.lg,
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
    backgroundColor: Colors.successText,
  },
  joinButtonEnded: {
    backgroundColor: Colors.text.tertiary,
  },
  joinButtonWaitlisted: {
    backgroundColor: Colors.warningText,
  },
  cancelledNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: alpha(Colors.error, 0.25),
    backgroundColor: Colors.errorSoft,
  },
  cancelledNoticeBody: {
    flex: 1,
    gap: 2,
  },
  cancelledNoticeTitle: {
    fontSize: Typography.sizes.sm,
    color: Colors.error,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  cancelledNoticeText: {
    fontSize: Typography.sizes.sm,
    lineHeight: 20,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.medium,
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
    color: Colors.white,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  joinArrow: {
    color: Colors.white,
    fontSize: 26,
    lineHeight: 26,
  },
});
