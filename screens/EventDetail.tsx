import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { blockedOffline } from '@/utils/requireOnline';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  FlatList,
  useWindowDimensions,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { useIsRestoring, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { findEventRow, previewDetailsFromRow } from '@/utils/eventPreview';
import { freshnessNote } from '@/utils/screenState';
import { FreshnessNote } from '@/components/ui/QueryStates';
import { useConnectivity } from '@/services/connectivity';
import { queryKeys } from '@/hooks/queryKeys';
import { useApp } from '@/contexts/AppContext';
import { Image as ExpoImage } from 'expo-image';
import { eventsService } from '@/services/events';
import { getEventDataVersion } from '@/utils/eventDataVersion';
import { eventChatService } from '@/services/eventChat';
import { eventChatAccess, type ChatAccessSettings } from '@/utils/eventChatAccess';
import { goBackOr } from '@/utils/navigation';
import { socialService } from '@/services/social';
import { isCollectionsUnavailable } from '@/services/collections';
import { reviewsService, type ReviewWithProfile } from '@/services/reviews';
import {
  EventDetails,
  type EventChatMessageWithSender,
  type PublicAttendee,
  EventStatus,
} from '@/types/database';
import { alpha, Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import { notify, notifyConfirm } from '@/utils/notify';
import { ImageViewer } from '@/components/ImageViewer';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { connectionErrorMessage } from '@/utils/networkErrors';
import { runOrQueueWithNotice } from '@/services/pendingWrites';
import { usePendingWrite } from '@/hooks/usePendingWrite';
import { getConnectivity } from '@/utils/connectivity';
import { Avatar } from '@/components/Avatar';
import {
  AttendeesBottomSheet,
  type AttendeesBottomSheetHandle,
} from '@/components/AttendeesBottomSheet';
import { AddToCollectionSheet } from '@/components/AddToCollectionSheet';
import { StarRatingDisplay } from '@/components/StarRatingDisplay';
import { ReviewCard } from '@/components/ReviewCard';
import { ReviewForm } from '@/components/ReviewForm';
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Ban,
  Bookmark,
  BookmarkCheck,
  CalendarPlus,
  ChevronRight,
  Clock3,
  CloudOff,
  Download,
  ExternalLink,
  EyeOff,
  FileText,
  Flag,
  FolderHeart,
  FolderPlus,
  MessageCircle,
  PauseCircle,
  Repeat,
  Settings2,
  Share2,
  ShieldCheck,
  Star,
  Ticket,
  TrendingUp,
} from '@/components/icons.generated';
import {
  classifyRsvpError,
  rsvpErrorMessage,
  rsvpErrorNeedsRefresh,
} from '@/utils/rsvpErrors';
import { EventmapMapPin, EventmapCalendar } from '@/components/icons/EventmapIcons';
import { GoogleMapView } from '@/components/GoogleMapView';
import { DeferredMount } from '@/components/DeferredMount';
import { complaintsService } from '@/services/complaints';
import { describeRecurrence, getNextOccurrences } from '@/utils/recurrence';
import {
  dateAttendance,
  exceptionsForIcs,
  listOccurrences,
  nextDateOverride,
  nextEffectiveOccurrence,
  type DateAttendance,
} from '@/utils/occurrences';
import { occurrenceErrorMessage, occurrencesService } from '@/services/occurrences';
import { useOccurrenceExceptions } from '@/hooks/useOccurrenceExceptions';
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
import { categoryRoute } from '@/utils/categoryBrowse';
import { presentCategory } from '@/utils/categoryPresentation';
import { ReportReasonSheet } from '@/components/ReportReasonSheet';
import { a11yState } from '@/utils/accessibility';


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

/** A focus within this long of the last fetch, with no writes since, reuses it. */
const FOCUS_FRESH_MS = 15_000;

export default function EventDetail() {
  const insets = useSafeAreaInsets();
  // Hero paging and the cover width must follow the live window: a
  // module-level Dimensions.get() broke the pager on rotation and on web
  // window resize.
  const { width: windowWidth } = useWindowDimensions();
  // Times render in the viewer's own zone; say which one.
  const viewerTz = useMemo(() => getDeviceTimeZone(), []);
  // `date` (YYYY-MM-DD in the event zone) comes from a series date row in a
  // collection: that date is highlighted in the dates list below.
  const { id, date: focusDateKey } = useLocalSearchParams<{ id: string; date?: string }>();
  const { user, isBanned, sessionLoading } = useAuth();
  // A save / unsave queued offline for this event: shown on the bookmark.
  const pendingSave = usePendingWrite('save', id);
  const { userBusiness } = useApp();
  const queryClient = useQueryClient();
  // Joined / Saved lists are React Query caches; tell them this event changed
  // so they refetch instead of showing stale rows when the user goes back.
  const invalidateLists = () => queryKeys.markAttendanceListsStale(queryClient);
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
  // Skipped / moved dates of a series (empty for one-offs or pre-migration).
  const { exceptions: occurrenceExceptions } = useOccurrenceExceptions(id, !!details?.event?.is_recurring);
  // Per-date "Going" (Phase F): the viewer's overrides on top of the series RSVP.
  const isSeries = !!details?.event?.is_recurring;
  const dateRsvpsQuery = useQuery({
    queryKey: queryKeys.dateRsvps(id ?? 'none', user?.id ?? 'anon'),
    enabled: !!id && !!user?.id && isSeries,
    queryFn: () => occurrencesService.listMyDateRsvps(id!, user!.id),
    staleTime: 30 * 1000,
  });
  const [dateRsvpBusy, setDateRsvpBusy] = useState<string | null>(null);
  const toggleDateRsvp = useCallback(
    async (dateKey: string, current: DateAttendance) => {
      if (!id || !user) return;
      const next = nextDateOverride(details?.user_rsvp, current);
      setDateRsvpBusy(dateKey);
      try {
        const result = await occurrencesService.setDateRsvp(id, dateKey, next);
        await queryClient.invalidateQueries({ queryKey: queryKeys.dateRsvps(id, user.id) });
        notify.success(
          result?.status === 'waitlist'
            ? "That date is full — you're on its waitlist."
            : current === 'waitlist'
              ? 'You left the waitlist for that date.'
              : current === 'going'
                ? "Got it — you're not going that date."
                : "You're going that date."
        );
      } catch (e) {
        notify.error(occurrenceErrorMessage(e) ?? "Couldn't update that date. Try again.");
      } finally {
        setDateRsvpBusy(null);
      }
    },
    [id, user, details?.user_rsvp, queryClient]
  );
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
  // Phase C: the add-to-collection sheet (long-press on the bookmark, the
  // Collections row, or the toast action after saving).
  const [collectionsSheetOpen, setCollectionsSheetOpen] = useState(false);
  const hasLoadedRef = useRef(false);
  const [chatPreview, setChatPreview] = useState<EventChatMessageWithSender | null>(null);
  const [chatUnread, setChatUnread] = useState(0);
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  const [togglingFollow, setTogglingFollow] = useState(false);

  const isOwner = !!(userBusiness && details?.event.business_id === userBusiness.id);
  // The host's chat settings (mode + who unlocks it); null until loaded, which
  // falls back to the server defaults (open, unlocks at two going).
  const [chatSettings, setChatSettings] = useState<ChatAccessSettings>(null);
  const chatAccess = eventChatAccess(details?.user_rsvp, details?.rsvp_count ?? 0, chatSettings);
  const chatIsOpen = chatAccess.state === 'open';

  const allPhotoUrls = useMemo(() => {
    if (!details) return [];
    const urls: string[] = [];
    if (details.photos?.length) {
      // Copy first: `details` can be the shared React Query cache object.
      [...details.photos]
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
  // When the details on screen were last fetched, and the write version at
  // that moment (utils/eventDataVersion). Returning within FOCUS_FRESH_MS
  // with no write anywhere since (RSVP, follow, edit, host action…) skips
  // the refetch: back from a photo, profile or business page costs nothing
  // instead of details + attendees requests.
  const lastFetchRef = useRef<{ at: number; version: number; tick: number } | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      const last = lastFetchRef.current;
      if (
        last &&
        hasLoadedRef.current &&
        last.tick === reloadTick &&
        Date.now() - last.at < FOCUS_FRESH_MS &&
        last.version === getEventDataVersion()
      ) {
        return;
      }
      let cancelled = false;
      const load = async () => {
        const startedVersion = getEventDataVersion();
        try {
          const data = await eventsService.getEventDetails(id);
          if (cancelled) return;
          // Only a result that was applied counts as fresh.
          lastFetchRef.current = { at: Date.now(), version: startedVersion, tick: reloadTick };
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

  // Chat mode / open policy, refreshed on focus (the host may change them).
  // A failure keeps the last known settings (or the defaults).
  useFocusEffect(
    useCallback(() => {
      if (!id || !user) return;
      let cancelled = false;
      eventChatService
        .getPostStatus(id)
        .then((status) => {
          if (!cancelled) setChatSettings({ chat_mode: status.chat_mode, open_policy: status.open_policy });
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [id, user])
  );

  // A one-line preview of the latest chat message for the chat-entry row.
  // Focus-driven so it also refreshes when the user comes back from the chat.
  // Same freshness rule as the details load: a return within FOCUS_FRESH_MS
  // with no write since (sending or reading in the chat counts) reuses it.
  const lastChatPreviewRef = useRef<{ at: number; version: number; id: string } | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!id || !chatIsOpen) {
        lastChatPreviewRef.current = null;
        setChatPreview(null);
        setChatUnread(0);
        return;
      }
      const last = lastChatPreviewRef.current;
      if (
        last &&
        last.id === id &&
        Date.now() - last.at < FOCUS_FRESH_MS &&
        last.version === getEventDataVersion()
      ) {
        return;
      }
      const startedVersion = getEventDataVersion();
      let cancelled = false;
      // Fresh only once both parts applied; a failure or a discarded result
      // (screen left first) must not suppress the next focus's reload.
      Promise.all([
        eventChatService.getLatestMessage(id).then((message) => {
          if (!cancelled) setChatPreview(message);
        }),
        eventChatService.getUnreadCounts([id]).then((counts) => {
          if (!cancelled) setChatUnread(counts.find((row) => row.event_id === id)?.unread_count ?? 0);
        }),
      ])
        .then(() => {
          if (!cancelled) lastChatPreviewRef.current = { at: Date.now(), version: startedVersion, id };
        })
        .catch(() => {
          // Keep the generic subtitle / last known badge; retried next focus.
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
  // RSVP. The public `event_rsvp_counts` table (20261102130000, maintained
  // by trigger) is subscribed to below for instant updates.
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      const applyCountAndStatus = (rsvpCount: number, nextStatus: EventStatus) => {
        setDetails((d) => {
          if (!d) return d;
          const prevStatus = d.event.status ?? 'active';
          if (d.rsvp_count === rsvpCount && prevStatus === nextStatus) return d;
          // Merge only the count and lifecycle status: the user's own RSVP
          // state may have an optimistic local update in flight.
          return { ...d, rsvp_count: rsvpCount, event: { ...d.event, status: nextStatus } };
        });
      };
      const refetchCount = async () => {
        // Nothing to gain offline; the focus refetch catches up on return.
        if (getConnectivity() === 'offline') return;
        try {
          // Two tiny selects instead of the full details payload (event +
          // business + photos + links + waitlist re-fetched every tick).
          const live = await eventsService.getEventLiveStatus(id);
          if (live && live.status !== null) {
            applyCountAndStatus(live.goingCount ?? 0, live.status as EventStatus);
            return;
          }
          // live === null: counts table not on this backend — full fetch.
          // status === null: the row vanished for this viewer (cancelled or
          // unpublished mid-view); the RPC still reveals which.
          const data = await eventsService.getEventDetails(id);
          if (!data) return;
          applyCountAndStatus(data.rsvp_count, data.event.status ?? 'active');
        } catch {
          // Transient failure; the next tick retries.
        }
      };
      const timer = setInterval(refetchCount, 20000);
      // Live: a join/leave anywhere updates the count within a second; the
      // poll stays as the fallback (missed changes across reconnects).
      const unsubscribe = eventsService.subscribeEventLiveStatus(id, () => void refetchCount());
      return () => {
        clearInterval(timer);
        unsubscribe();
      };
    }, [id])
  );

  const businessId = details?.business.id;

  // Reviews for the business, cached per business + viewer: opening several
  // events from the same business (or coming back) no longer re-runs the
  // three review requests each time. A failed refetch keeps the cached data
  // (React Query semantics), matching the old "keep what's shown" rule.
  const viewerId = user?.id ?? null;
  const reviewsKey = useMemo(() => ['business-reviews', businessId ?? 'none', viewerId ?? 'anon'] as const, [businessId, viewerId]);
  const reviewsQuery = useQuery({
    queryKey: reviewsKey,
    enabled: !!businessId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [list, avg, mine] = await Promise.all([
        reviewsService.getReviewsForBusiness(businessId!),
        reviewsService.getAverageRatingAndCount(businessId!),
        viewerId ? reviewsService.getUserReview(businessId!) : Promise.resolve(null),
      ]);
      return {
        list,
        avg,
        mine: mine ? { rating: mine.rating, text: mine.text || '' } : null,
      };
    },
  });
  useEffect(() => {
    const data = reviewsQuery.data;
    if (!data) {
      if (reviewsQuery.isError) {
        setReviews([]);
        setAverageRating({ average: 0, count: 0 });
        setUserReview(null);
      }
      return;
    }
    setReviews(data.list);
    setAverageRating(data.avg);
    setUserReview(data.mine);
  }, [reviewsQuery.data, reviewsQuery.isError]);

  const handleReviewSubmit = async (rating: number, text: string) => {
    if (blockedOffline('post a review')) return;
    if (!businessId) return;
    // Only the write can fail the form. The reload after it is best-effort,
    // so a saved review is never reported as "failed".
    await reviewsService.createOrUpdateReview(businessId, rating, text || null);
    void queryClient.invalidateQueries({ queryKey: ['business-reviews', businessId], refetchType: 'none' });
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
    if (businessId) {
      void queryClient.invalidateQueries({ queryKey: ['business-reviews', businessId], refetchType: 'none' });
    }
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
      if (result === 'done') {
        invalidateLists();
        // Saved just now: offer to also file it into a collection.
        if (!wasSaved && !isCollectionsUnavailable()) {
          notify.withAction('Saved.', { label: 'Add to collection', onPress: () => setCollectionsSheetOpen(true) });
        }
      }
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
        details.event.timezone ?? null,
        details.event.start_datetime
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
        exceptions: exceptionsForIcs(details.event, occurrenceExceptions),
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
              onPress={() => goBackOr(router)}
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
          {...a11yState({ busy: true })}
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
              onPress={() => goBackOr(router)}
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

  const venueLat = Number.isFinite(event.lat) ? event.lat : (business.lat ?? NaN);
  const venueLng = Number.isFinite(event.lng) ? event.lng : (business.lng ?? NaN);
  const canOpenEventChat = chatIsOpen;
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
    if (occurrenceExceptions.length === 0 && new Date(event.start_datetime).getTime() > Date.now()) {
      return event.start_datetime;
    }
    // Honour skipped dates and moved times; fall back to the plain walk.
    const next = nextEffectiveOccurrence(event, occurrenceExceptions)?.start ?? getNextOccurrences(event, 1)[0];
    return next ? next.toISOString() : event.start_datetime;
  })();

  return (
    <View style={styles.container}>
      <View style={[styles.heroTopBarWrap, { top: insets.top + 10 }]}>
        <View style={styles.heroTopBar}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => goBackOr(router)}
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
                onLongPress={() => (blockedByPreview() ? undefined : setCollectionsSheetOpen(true))}
                disabled={togglingSave}
                accessibilityRole="button"
                accessibilityLabel={details.user_saved ? 'Remove from saved events' : 'Save event'}
                accessibilityHint={pendingSave ? "Waiting for a connection; it will sync when you're back online." : undefined}
                {...a11yState({ selected: details.user_saved, busy: !!pendingSave }, 'button')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                {details.user_saved ? (
                  <BookmarkCheck size={20} color={pendingSave ? Colors.text.secondary : Colors.primary} />
                ) : (
                  <Bookmark size={20} color={pendingSave ? Colors.text.secondary : Colors.text.primary} />
                )}
                {pendingSave ? (
                  <View style={styles.pendingDot} importantForAccessibility="no" accessibilityElementsHidden>
                    <CloudOff size={9} color={Colors.white} />
                  </View>
                ) : null}
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
                  <ExpoImage
                    source={{ uri: item }}
                    style={[styles.coverImage, { width: windowWidth }]}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    recyclingKey={item}
                    transition={150}
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
              <TouchableOpacity
                style={styles.heroCategoryPill}
                onPress={() => category.slug && router.push(categoryRoute(category.slug) as never)}
                disabled={!category.slug}
                activeOpacity={0.8}
                accessibilityRole="link"
                accessibilityLabel={`See more ${presentCategory(category).label} events`}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              >
                <Text style={styles.heroCategoryText}>{presentCategory(category).label.toUpperCase()}</Text>
              </TouchableOpacity>
            ) : null}
            <Text style={styles.heroTitle} accessibilityRole="header">{event.title}</Text>
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

          {user && !eventCancelled && !isCollectionsUnavailable() ? (
            <View style={styles.calendarRow}>
              <View style={styles.metaIconWrap}>
                <FolderHeart size={18} color={Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.metaLabel}>Collections</Text>
                <View style={styles.calendarChoiceRow}>
                  <TouchableOpacity
                    style={styles.calendarChoiceBtn}
                    onPress={() => (blockedByPreview() ? undefined : setCollectionsSheetOpen(true))}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel="Add to collection"
                  >
                    <Text style={styles.calendarChoiceText}>Add to collection</Text>
                    <FolderPlus size={14} color={Colors.primary} />
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
                  : chatAccess.state === 'off'
                    ? 'Event chat, turned off by the host'
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
                      : chatAccess.state === 'open' && chatAccess.announcementsOnly
                        ? 'Announcements from the host'
                        : 'Chat with everyone going'
                    : chatAccess.state === 'off'
                      ? 'The host turned the chat off'
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
            accessibilityLabel={`View business ${business.name}${business.verified ? ', verified' : ''}${
              user && !isOwner && details.user_following_business ? ', following' : ''
            }`}
            // The Follow chip is nested in this row (one VoiceOver element).
            accessibilityActions={
              user && !isOwner
                ? [
                    {
                      name: 'toggleFollow',
                      label: details.user_following_business
                        ? `Unfollow ${business.name}`
                        : `Follow ${business.name}`,
                    },
                  ]
                : undefined
            }
            onAccessibilityAction={(e) => {
              if (e.nativeEvent.actionName === 'toggleFollow' && !togglingFollow) void handleToggleFollow();
            }}
          >
            <Avatar imageUrl={business.logo_url} name={business.name} size={48} />
            <View style={styles.hostBusinessMeta}>
              <Text style={styles.hostBusinessLabel}>Organizer</Text>
              <View style={styles.hostNameRow}>
                <Text style={styles.hostBusinessName} numberOfLines={2}>
                  {business.name}
                </Text>
                {/* Same badge as the host page, so "verified" looks the same
                    wherever the host appears. */}
                {business.verified ? (
                  <View style={styles.hostVerified} accessible={false} importantForAccessibility="no-hide-descendants">
                    <BadgeCheck size={14} color={Colors.primary} />
                    <Text style={styles.hostVerifiedText}>Verified</Text>
                  </View>
                ) : null}
              </View>
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
                {...a11yState({ selected: details.user_following_business }, 'button')}
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
                  {describeRecurrence(event.recurrence_pattern, event.start_datetime, { withEnd: true })}
                </Text>
              </View>
              {listOccurrences(event, occurrenceExceptions, { count: 5 }).map((o) => {
                const attendance = dateAttendance(details.user_rsvp, dateRsvpsQuery.data ?? [], o.dateKey);
                const canToggle = !!user && !isOwner && o.status !== 'cancelled' && !eventEnded;
                const focused = !!focusDateKey && o.dateKey === focusDateKey;
                return (
                <View key={o.dateKey} style={[styles.recurrenceRow, focused && styles.recurrenceRowFocused]}>
                <Text
                  style={[styles.recurrenceDate, styles.recurrenceDateFlex, o.status === 'cancelled' && styles.recurrenceDateCancelled, focused && styles.recurrenceDateFocused]}
                  accessibilityLabel={
                    o.status === 'cancelled'
                      ? `${formatDateTime(o.start.toISOString())}, cancelled`
                      : o.status === 'moved'
                        ? `${formatDateTime(o.start.toISOString())}, moved from ${formatDateTime(o.originalStart.toISOString())}`
                        : undefined
                  }
                >
                  {formatDateTime(o.start.toISOString())}
                  {o.status === 'cancelled' ? ' · cancelled' : o.status === 'moved' ? ' · moved' : ''}
                  {o.note ? ` — ${o.note}` : ''}
                </Text>
                {canToggle ? (
                  <TouchableOpacity
                    onPress={() => void toggleDateRsvp(o.dateKey, attendance)}
                    disabled={dateRsvpBusy === o.dateKey}
                    style={[styles.dateRsvpChip, attendance === 'going' && styles.dateRsvpChipOn]}
                    accessibilityRole="switch"
                    accessibilityLabel={`Going on ${formatDateTime(o.start.toISOString())}`}
                    {...a11yState({ checked: attendance === 'going', busy: dateRsvpBusy === o.dateKey })}
                    hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                  >
                    <Text style={[styles.dateRsvpText, attendance === 'going' && styles.dateRsvpTextOn]}>
                      {attendance === 'going'
                        ? 'Going'
                        : attendance === 'waitlist'
                          ? 'Waitlisted'
                          : attendance === 'not_going'
                            ? "Can't go"
                            : 'Go'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
                </View>
                );
              })}
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
                  // A slow start (degraded connection): the stored session
                  // is applied within a few seconds; don't bounce to login.
                  if (sessionLoading) {
                    notify.success('Still signing you in — try again in a moment.');
                    return;
                  }
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
              {...a11yState({
                disabled: user
                  ? saving || hasJoinedEvent || hasRequested || eventClosed || (eventFull && !canWaitlist)
                  : eventClosed || eventFull,
              })}
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
                  {...a11yState({ selected: details.user_rsvp === 'interested' }, 'button')}
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
        <>
          <AddToCollectionSheet
            event={collectionsSheetOpen && details ? { id, title: details.event.title } : null}
            onClose={() => setCollectionsSheetOpen(false)}
          />
          <AttendeesBottomSheet ref={attendeesSheetRef} eventId={id} refreshToken={attendeesRefresh} />
        </>
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
  hostNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  hostVerified: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  hostVerifiedText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.primary,
  },
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
  pendingDot: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.text.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.surface,
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
  recurrenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  recurrenceRowFocused: {
    backgroundColor: Colors.primarySoft,
    borderRadius: BorderRadius.sm,
    marginHorizontal: -Spacing.xs,
    paddingHorizontal: Spacing.xs,
  },
  recurrenceDateFocused: { color: Colors.text.primary, fontFamily: Typography.fontFamilies.semibold },
  recurrenceDateFlex: { flex: 1 },
  dateRsvpChip: {
    marginTop: Spacing.xs,
    paddingHorizontal: 12,
    paddingVertical: 5,
    minWidth: 72,
    alignItems: 'center',
    borderRadius: BorderRadius.round,
    borderWidth: 1,
    borderColor: Colors.border.medium,
  },
  dateRsvpChipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  dateRsvpText: { fontSize: Typography.sizes.xs, fontFamily: Typography.fontFamilies.semibold, color: Colors.text.primary },
  dateRsvpTextOn: { color: '#FFFFFF' },
  recurrenceDateCancelled: {
    textDecorationLine: 'line-through',
    color: Colors.text.tertiary,
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
