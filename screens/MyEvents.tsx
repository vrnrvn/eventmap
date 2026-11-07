import { useState, useCallback, useRef } from 'react';
import { useIsRestoring, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/hooks/queryKeys';
import { useConnectivity } from '@/services/connectivity';
import { freshnessNote } from '@/utils/screenState';
import { FreshnessNote, OfflineState } from '@/components/ui/QueryStates';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useApp } from '@/contexts/AppContext';
import { eventsService } from '@/services/events';
import { businessesService } from '@/services/businesses';
import { hostToolsService, type HostEventCounts } from '@/services/hostTools';
import { summarizeCapacity } from '@/utils/hostEvent';
import { confirmAction } from '@/utils/confirm';
import { notify } from '@/utils/notify';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { EventListItem, formatEventDate } from '@/components/EventListItem';
import { Event } from '@/types/database';
import { hasEventEnded, isEventInProgress } from '@/utils/eventStatus';
import { getNextOccurrences } from '@/utils/recurrence';
import { alpha, Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import {
  ArrowLeft,
  BarChart3,
  Megaphone,
  Pencil,
  CalendarX,
  PlusCircle,
  CalendarDays,
  Briefcase,
  ChevronRight,
  Clock,
  FileText,
} from '@/components/icons.generated';

const PAGE_SIZE = 30;

type Scope = 'upcoming' | 'drafts' | 'past';
const SCOPES: { value: Scope; label: string; a11y: string }[] = [
  { value: 'upcoming', label: 'Upcoming', a11y: 'Upcoming events' },
  { value: 'drafts', label: 'Drafts', a11y: 'Draft events' },
  { value: 'past', label: 'Past', a11y: 'Past and cancelled events' },
];

/**
 * A recurring series whose own end date has passed comes back from the
 * `upcoming` query (the server can't evaluate recurrence end dates in a
 * PostgREST filter); it belongs with the past ones.
 */
const partitionUpcoming = (rows: Event[]) => {
  const live: Event[] = [];
  const endedSeries: Event[] = [];
  for (const e of rows) (hasEventEnded(e) ? endedSeries : live).push(e);
  return { live, endedSeries };
};

/** One tab's first page as kept on the device. */
type CachedPage = { rows: Event[]; fetched: number };

export default function MyEvents() {
  const insets = useSafeAreaInsets();
  const { hasBusiness, userBusiness } = useApp();
  const [scope, setScope] = useState<Scope>('upcoming');
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [counts, setCounts] = useState<Map<string, HostEventCounts>>(new Map());
  const [updatedAt, setUpdatedAt] = useState(0);
  const [lastLoadFailed, setLastLoadFailed] = useState(false);
  const queryClient = useQueryClient();
  const connectivity = useConnectivity();
  const hasLoadedRef = useRef(false);
  // Ignore responses from a superseded load (tab switched mid-flight).
  const requestSeq = useRef(0);

  /** Going / waitlist per row; best-effort, the list renders without it. */
  const loadCounts = useCallback(async (rows: Event[]) => {
    const ids = rows.filter((e) => e.status !== 'cancelled').map((e) => e.id);
    if (ids.length === 0) return;
    try {
      const fetched = await hostToolsService.getEventsCounts(ids);
      setCounts((prev) => {
        const next = new Map(prev);
        fetched.forEach((v, k) => next.set(k, v));
        return next;
      });
    } catch {
      // Counts are decoration here; the hub shows them authoritatively.
    }
  }, []);

  const fetchPage = useCallback(
    async (businessId: string, which: Scope, pageOffset: number) => {
      const rows = await eventsService.getBusinessEvents(businessId, {
        limit: PAGE_SIZE,
        offset: pageOffset,
        scope: which,
      });
      void loadCounts(rows);
      if (which === 'upcoming') {
        // A recurring series whose own end date passed still matches the
        // upcoming query (the server can't evaluate it); it belongs in Past.
        return { rows: partitionUpcoming(rows).live, fetched: rows.length };
      }
      if (which === 'drafts') return { rows, fetched: rows.length };
      // Past: the query also returns ongoing recurring series (their first
      // occurrence has ended); keep only cancelled or genuinely finished ones.
      return {
        rows: rows.filter((e) => e.status === 'cancelled' || hasEventEnded(e)),
        fetched: rows.length,
      };
    },
    [loadCounts]
  );

  /** First page for the current tab. `silent` keeps the list visible. */
  const loadInitial = useCallback(
    async (silent = false) => {
      if (!userBusiness) {
        setEvents([]);
        setLoading(false);
        return;
      }
      const key = queryKeys.myEvents(userBusiness.id, scope);
      // First visit to this tab: show the page kept on the device (offline
      // included), then refresh quietly (docs/OFFLINE_PLAN.md §3.5).
      if (!hasLoadedRef.current) {
        const cached = queryClient.getQueryData<CachedPage>(key);
        if (cached && Array.isArray(cached.rows)) {
          setEvents(cached.rows);
          setOffset(cached.fetched);
          setHasMore(cached.fetched >= PAGE_SIZE);
          setUpdatedAt(queryClient.getQueryState(key)?.dataUpdatedAt ?? 0);
          setLoadError(false);
          setLoading(false);
          hasLoadedRef.current = true;
          silent = true;
        }
      }
      const seq = ++requestSeq.current;
      if (!silent) setLoading(true);
      try {
        const { rows, fetched } = await fetchPage(userBusiness.id, scope, 0);
        if (seq !== requestSeq.current) return;
        setEvents(rows);
        setOffset(fetched);
        setHasMore(fetched >= PAGE_SIZE);
        setLoadError(false);
        setLastLoadFailed(false);
        setUpdatedAt(Date.now());
        hasLoadedRef.current = true;
        queryClient.setQueryData<CachedPage>(key, { rows, fetched });
      } catch {
        if (seq !== requestSeq.current) return;
        setLastLoadFailed(true);
        if (silent && hasLoadedRef.current) {
          // Quiet refresh: keep the list that is already on screen (the
          // freshness note says it may be out of date).
          return;
        }
        setEvents([]);
        setLoadError(true);
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [userBusiness?.id, scope, fetchPage, queryClient]
  );

  const loadMore = useCallback(async () => {
    if (!userBusiness || loadingMore || !hasMore || loading) return;
    setLoadingMore(true);
    const seq = requestSeq.current;
    try {
      const { rows, fetched } = await fetchPage(userBusiness.id, scope, offset);
      if (seq !== requestSeq.current) return;
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...rows.filter((e) => !seen.has(e.id))];
      });
      setOffset((o) => o + fetched);
      setHasMore(fetched >= PAGE_SIZE);
    } catch {
      // Leave hasMore set so scrolling again retries the page.
      notify.error("Couldn't load more events.");
    } finally {
      setLoadingMore(false);
    }
  }, [userBusiness?.id, scope, offset, loadingMore, hasMore, loading, fetchPage]);

  const handleRefresh = useCallback(async () => {
    if (!userBusiness) return;
    setRefreshing(true);
    await loadInitial(true);
  }, [userBusiness?.id, loadInitial]);

  // Coming back from Edit / Insights / the event page refreshes quietly;
  // only the very first visit (and a tab switch) shows the skeleton.
  // Also re-runs once the device cache finishes restoring, so a cold start
  // straight into this screen picks up the cached page.
  const isRestoring = useIsRestoring();
  useFocusEffect(
    useCallback(() => {
      if (isRestoring) return;
      if (hasBusiness && userBusiness) {
        void loadInitial(hasLoadedRef.current);
      } else {
        setEvents([]);
        setLoading(false);
      }
    }, [hasBusiness, userBusiness?.id, loadInitial, isRestoring])
  );

  const switchScope = (next: Scope) => {
    if (next === scope) return;
    hasLoadedRef.current = false;
    setEvents([]);
    setOffset(0);
    setHasMore(true);
    setScope(next);
  };

  const handleCancelEvent = useCallback(
    async (event: Event) => {
      const ok = await confirmAction({
        title: 'Cancel Event',
        message: `Cancel "${event.title}"? Attendees will be notified and the event will no longer be visible to the public. This cannot be undone.`,
        confirmLabel: 'Cancel event',
        destructive: true,
      });
      if (!ok) return;
      try {
        // Pre-apply (20261030106000) this hard-deletes; post-apply it soft-
        // cancels and keeps the row, so reload instead of filtering locally.
        await eventsService.cancelEvent(event.id);
        notify.success('Event cancelled. Attendees have been notified.');
        await loadInitial(true);
      } catch {
        notify.error('Failed to cancel event');
      }
    },
    [loadInitial]
  );

  const handleNotifyFollowers = useCallback(async (event: Event) => {
    const ok = await confirmAction({
      title: 'Notify Followers',
      message: `Send your followers an in-app notification about "${event.title}"? Followers who were already notified about this event won't get a duplicate.`,
      confirmLabel: 'Notify',
    });
    if (!ok) return;
    try {
      await businessesService.notifyFollowersAboutEvent(event.id);
      notify.success('Followers notified.');
    } catch {
      notify.error('Failed to notify followers');
    }
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Event }) => {
      const cancelled = item.status === 'cancelled';
      const draft = item.publish_state === 'draft';
      const postponed = !cancelled && item.status === 'postponed';
      const ended = !cancelled && !draft && hasEventEnded(item);
      const live = !cancelled && !ended && !postponed && !draft && isEventInProgress(item);
      // Recurring series: show the next occurrence, not the first one.
      const nextStart =
        item.is_recurring && !ended && !cancelled
          ? (getNextOccurrences(item, 1)[0]?.toISOString() ?? item.start_datetime)
          : item.start_datetime;
      const badge = cancelled
        ? { label: 'Cancelled', tone: 'danger' as const }
        : draft
          ? { label: 'Draft', tone: 'neutral' as const }
          : postponed
            ? { label: 'Postponed', tone: 'danger' as const }
        : live
          ? { label: 'LIVE', tone: 'success' as const }
          : ended
            ? { label: 'Past', tone: 'neutral' as const }
            : item.is_recurring
              ? { label: 'Repeats', tone: 'primary' as const }
              : { label: 'Upcoming', tone: 'primary' as const };
      const c = counts.get(item.id);
      const metaLines: string[] = [];
      if (c && !cancelled) {
        const cap = summarizeCapacity(c.going, item.max_attendees);
        const parts = [cap.label];
        if (cap.isFull) parts.push('Full');
        if (c.waitlist) parts.push(`${c.waitlist} waiting`);
        if (c.interested) parts.push(`${c.interested} interested`);
        metaLines.push(parts.join(' · '));
      }

      return (
        <View style={styles.cardSpacing}>
          <EventListItem
            title={item.title}
            dateLine={formatEventDate(nextStart)}
            thumbnailUrl={item.cover_image_url}
            dimmed={cancelled || ended}
            badge={badge}
            dateIcon={<Clock size={12} color={Colors.text.tertiary} />}
            metaLines={metaLines}
            onPress={() => router.push(`/business/manage-event/${item.id}` as never)}
            accessibilityLabel={`Manage ${item.title}`}
            actions={
              <>
                {/* Cancelled events are read-only: no Edit, Notify or Cancel. */}
                {!cancelled && (
                  <TouchableOpacity
                    style={styles.editBtn}
                    onPress={() =>
                      router.push(`/business/edit-event/${item.id}` as never)
                    }
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${item.title}`}
                  >
                    <Pencil size={14} color={Colors.primary} />
                    <Text style={styles.editBtnText}>Edit</Text>
                  </TouchableOpacity>
                )}

                {!cancelled && !draft && (
                  <TouchableOpacity
                    style={styles.iconActionBtn}
                    onPress={() => handleNotifyFollowers(item)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Notify followers about ${item.title}`}
                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  >
                    <Megaphone size={14} color={Colors.primary} />
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={styles.iconActionBtn}
                  onPress={() =>
                    router.push(`/business/event-insights/${item.id}` as never)
                  }
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`View insights for ${item.title}`}
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                >
                  <BarChart3 size={14} color={Colors.primary} />
                </TouchableOpacity>

                {!cancelled && !draft && (
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => handleCancelEvent(item)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Cancel ${item.title}`}
                  >
                    <CalendarX size={14} color={Colors.error} />
                    <Text style={styles.deleteBtnText}>Cancel</Text>
                  </TouchableOpacity>
                )}
              </>
            }
          />
        </View>
      );
    },
    [handleCancelEvent, handleNotifyFollowers, counts]
  );

  const keyExtractor = useCallback((item: Event) => item.id, []);

  const freshness = freshnessNote({
    hasData: events.length > 0,
    dataUpdatedAt: updatedAt,
    isError: lastLoadFailed,
    connectivity,
  });

  const ListHeader = useCallback(
    () =>
      hasBusiness ? (
        <>
        <FreshnessNote text={freshness} />
        <TouchableOpacity
          style={styles.createCardWrap}
          onPress={() => router.push('/(tabs)/create' as never)}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={[Colors.primary, Colors.secondary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.createCardGradient}
          >
            <View style={styles.createCardIcon}>
              <PlusCircle size={20} color={Colors.primary} />
            </View>
            <View style={styles.createCardContent}>
              <Text style={styles.createCardTitle}>Create New Event</Text>
              <Text style={styles.createCardSubtitle}>
                Post an event for your community
              </Text>
            </View>
            <ChevronRight size={18} color="rgba(255,255,255,0.6)" />
          </LinearGradient>
        </TouchableOpacity>
        </>
      ) : null,
    [hasBusiness, freshness]
  );

  const ListEmpty = useCallback(
    () => {
      if (loading || refreshing) return null;
      if (loadError && connectivity === 'offline') {
        return <OfflineState onRetry={loadInitial} style={styles.errorState} />;
      }
      if (loadError) {
        return (
          <ErrorState
            title="Couldn't load your events"
            onRetry={loadInitial}
            style={styles.errorState}
          />
        );
      }
      return (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconWrap}>
            <FileText size={36} color={Colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>
            {scope === 'past' ? 'Nothing here yet' : scope === 'drafts' ? 'No drafts' : 'No Upcoming Events'}
          </Text>
          <Text style={styles.emptySubtitle}>
            {!hasBusiness
              ? 'You need a business profile to create and manage events.'
              : scope === 'past'
                ? 'Events that have ended or were cancelled will show up here.'
                : scope === 'drafts'
                  ? 'Save an event as a draft, or duplicate one from Manage event, and it will wait here until you publish it.'
                  : 'Create your next event to start reaching your local community.'}
          </Text>
          {hasBusiness && scope === 'upcoming' && (
            <Button
              label="Create Event"
              onPress={() => router.push('/(tabs)/create' as never)}
              variant="ghost"
              icon={<PlusCircle size={16} color={Colors.primary} />}
              style={styles.emptyCta}
            />
          )}
        </View>
      );
    },
    [loading, refreshing, hasBusiness, loadError, loadInitial, scope, connectivity]
  );

  const ListFooter = useCallback(
    () =>
      loadingMore ? (
        <View style={styles.footerLoader}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.footerLoaderText}>Loading more…</Text>
        </View>
      ) : null,
    [loadingMore]
  );

  /* ── No business state ── */
  if (!hasBusiness) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <ArrowLeft size={22} color={Colors.text.primary} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <View style={styles.headerIconWrap}>
              <CalendarDays size={18} color={Colors.primary} />
            </View>
            <Text style={styles.headerTitle}>My Events</Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.noBizContainer}>
          <View style={styles.noBizIconWrap}>
            <Briefcase size={36} color={Colors.primary} />
          </View>
          <Text style={styles.noBizTitle}>Business Required</Text>
          <Text style={styles.noBizSubtitle}>
            Create a business profile to start managing your events.
          </Text>
          <Button
            label="Create Business"
            onPress={() => router.push('/business/onboarding' as never)}
            size="lg"
            gradient
            icon={<ChevronRight size={18} color={Colors.white} />}
          />
        </View>
      </View>
    );
  }

  /* ── Main list ── */
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ArrowLeft size={22} color={Colors.text.primary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerIconWrap}>
            <CalendarDays size={18} color={Colors.primary} />
          </View>
          <View>
            <Text style={styles.headerTitle}>My Events</Text>
            <Text style={styles.headerSubtitle}>
              {loading
                ? 'Loading…'
                : `${events.length}${hasMore ? '+' : ''} ${
                    scope === 'upcoming' ? 'upcoming' : scope === 'drafts' ? 'drafts' : 'past or cancelled'
                  }`}
            </Text>
          </View>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.segmentRow} accessibilityRole="tablist">
        {SCOPES.map((tab) => {
          const active = scope === tab.value;
          return (
            <TouchableOpacity
              key={tab.value}
              style={[styles.segment, active && styles.segmentActive]}
              onPress={() => switchScope(tab.value)}
              activeOpacity={0.8}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={tab.a11y}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View
          style={styles.skeletonList}
          accessibilityLabel="Loading your events"
          accessibilityState={{ busy: true }}
        >
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.skeletonCard}>
              <View style={styles.skeletonThumb} />
              <View style={styles.skeletonLines}>
                <View style={styles.skeletonBar} />
                <View style={[styles.skeletonBar, styles.skeletonBarShort]} />
              </View>
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={events}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={[
            styles.listContent,
            events.length === 0 && styles.listContentEmpty,
            { paddingBottom: insets.bottom + 40 },
          ]}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={ListEmpty}
          ListFooterComponent={ListFooter}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[Colors.primary]}
              tintColor={Colors.primary}
            />
          }
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={10}
          removeClippedSubviews={Platform.OS === 'android'}
        />
      )}
    </View>
  );
}

/* ────────────────────────── STYLES ────────────────────────── */

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },

  /* ── Header ── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    backgroundColor: Colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border.light,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.background.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIconWrap: {
    width: 42,
    height: 42,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  headerSubtitle: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    marginTop: 1,
  },
  headerSpacer: {
    width: 40,
  },

  /* ── Scope tabs ── */
  segmentRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.md,
    padding: 4,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.background.secondary,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: BorderRadius.round,
  },
  segmentActive: {
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentText: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.semibold,
  },
  segmentTextActive: {
    color: Colors.primary,
  },

  /* ── Loading skeleton (mirrors EventListItem) ── */
  skeletonList: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md + Spacing.xs,
  },
  skeletonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border.light,
    padding: Spacing.md,
    marginBottom: 12,
  },
  skeletonThumb: {
    width: 58,
    height: 58,
    borderRadius: BorderRadius.md + 2,
    backgroundColor: Colors.background.tertiary,
  },
  skeletonLines: {
    flex: 1,
    gap: Spacing.sm,
  },
  skeletonBar: {
    height: 12,
    width: '70%',
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.background.tertiary,
  },
  skeletonBarShort: {
    width: '45%',
  },

  /* ── List ── */
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  listContentEmpty: {
    flexGrow: 1,
  },

  /* ── Create card ── */
  createCardWrap: {
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    marginBottom: 20,
    ...Platform.select({
      ios: {
        shadowColor: Colors.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 12,
      },
      android: { elevation: 6 },
    }),
  },
  createCardGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 18,
  },
  createCardIcon: {
    width: 42,
    height: 42,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  createCardContent: {
    flex: 1,
  },
  createCardTitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.inverse,
  },
  createCardSubtitle: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: alpha(Colors.surface, 0.75),
    marginTop: 2,
  },

  /* ── Event card ── */
  cardSpacing: {
    marginBottom: 12,
  },

  /* ── Action buttons ── */
  editBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    minHeight: 44,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primarySoft,
  },
  editBtnText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },
  iconActionBtn: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    minHeight: 44,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primarySoft,
  },
  deleteBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    minHeight: 44,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.errorSoft,
  },
  deleteBtnText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.error,
  },

  /* ── Error state ── */
  errorState: {
    flex: 1,
  },

  /* ── Empty state ── */
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: BorderRadius.xl,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  emptyCta: {
    backgroundColor: Colors.primarySoft,
  },

  /* ── Footer loader ── */
  footerLoader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: Spacing.lg,
  },
  footerLoaderText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.tertiary,
  },

  /* ── No business state ── */
  noBizContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  noBizIconWrap: {
    width: 80,
    height: 80,
    borderRadius: BorderRadius.xl,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  noBizTitle: {
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: 8,
  },
  noBizSubtitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
});
