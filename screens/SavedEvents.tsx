import { memo, useCallback, useMemo, useState } from 'react';
import { cadenceLabel } from '@/utils/recurrence';
import { useEffectiveNextDates } from '@/hooks/useEffectiveNextDates';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { queryKeys } from '@/hooks/queryKeys';
import { useRefetchOnFocus } from '@/hooks/useRefetchOnFocus';
import { useScreenState } from '@/hooks/useScreenState';
import { PERSISTED_QUERY } from '@/utils/queryPersistence';
import {
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  SectionList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { socialService } from '@/services/social';
import { runOrQueue } from '@/services/pendingWrites';
import { notify } from '@/utils/notify';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { FreshnessNote, OfflineState } from '@/components/ui/QueryStates';
import { EventListItem } from '@/components/EventListItem';
import { formatDistance } from '@/utils/formatEventWhen';
import { describeEventDateTime } from '@/utils/timezone';
import { RankedEvent } from '@/types/database';
import { BorderRadius, Colors, Spacing, Typography } from '@/constants/theme';
import {
  ArrowLeft,
  Bookmark,
  BookmarkX,
  ChevronRight,
  Repeat,
} from '@/components/icons.generated';
import { a11yState } from '@/utils/accessibility';

const PAGE_SIZE = 30;

type SavedEventSection = { key: string; title: string | null; data: RankedEvent[] };

/**
 * One saved-event row. Memoized so paging in more rows (or toggling a save)
 * does not re-render every card in the list.
 */
const SavedEventRow = memo(function SavedEventRow({
  event,
  onUnsave,
  nextIso,
}: {
  event: RankedEvent;
  onUnsave: (event: RankedEvent) => void;
  /** Effective next date for series (useEffectiveNextDates). */
  nextIso?: string;
}) {
  const cancelled = event.status === 'cancelled';
  const ended = !!event.has_ended;
  const when = ended ? event.start_datetime : nextIso || event.next_start_datetime || event.start_datetime;
  // Event-zone time with a "your time" line when the viewer's clock differs
  // (rows carry `timezone` from 20261104130000; legacy rows render as before).
  const display = describeEventDateTime(when, event.timezone);
  const metaLines: string[] = [];
  if (display.secondary && !ended) metaLines.push(display.secondary);
  if (event.distance_km > 0) {
    metaLines.push(`${formatDistance(event.distance_km)} away`);
  }
  if (event.rsvp_count > 0 && !ended) {
    metaLines.push(
      `${event.rsvp_count} ${event.rsvp_count === 1 ? 'person' : 'people'} going`
    );
  }
  return (
    <View style={styles.cardSpacing}>
      <EventListItem
        title={event.title}
        subtitle={event.business_name}
        dateLine={`${display.primary}${event.is_recurring && !ended ? ` · ${cadenceLabel(event.recurrence_pattern).toLowerCase() || 'repeats'}` : ''}`}
        thumbnailUrl={event.cover_image_url}
        dimmed={ended || cancelled}
        badge={
          cancelled
            ? { label: 'Cancelled', tone: 'danger' }
            : ended
              ? { label: 'Ended', tone: 'neutral' }
              : null
        }
        dateIcon={
          event.is_recurring ? <Repeat size={12} color={Colors.text.tertiary} /> : undefined
        }
        metaLines={metaLines}
        rightAction={
          <TouchableOpacity
            style={styles.bookmarkBadge}
            onPress={() => onUnsave(event)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${event.title} from saved events`}
            {...a11yState({ selected: true }, 'button')}
          >
            <Bookmark size={14} color={Colors.primary} fill={Colors.primary} />
          </TouchableOpacity>
        }
        onPress={() => router.push(`/event/${event.id}` as never)}
        accessibilityLabel={`${event.title}, ${display.primary}${display.secondary ? `, ${display.secondary}` : ''}${ended ? ', ended' : ''}`}
      />
    </View>
  );
});

const keyExtractor = (event: RankedEvent) => event.id;

export default function SavedEvents() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  // Paged + cached. The old screen fetched a single page of 50 with no way
  // to reach older saves; this pages through all of them.
  const query = useInfiniteQuery({
    queryKey: queryKeys.savedEvents(),
    // Kept on the device so saved events open offline after a restart.
    ...PERSISTED_QUERY,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      socialService.getUserSavedEventsWithDetails({ limit: PAGE_SIZE, offset: pageParam }),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length >= PAGE_SIZE ? allPages.reduce((n, page) => n + page.length, 0) : undefined,
  });
  // Saves are toggled from event pages; refresh whenever we come back here.
  useRefetchOnFocus(query.refetch, true, queryKeys.savedEvents());

  const events = useMemo(() => {
    const seen = new Set<string>();
    return (query.data?.pages.flat() ?? []).filter((e) =>
      seen.has(e.id) ? false : (seen.add(e.id), true)
    );
  }, [query.data]);
  const { state: screenState, freshness } = useScreenState(query, {
    hasData: query.data !== undefined,
    isEmpty: events.length === 0,
  });
  const nextById = useEffectiveNextDates(events);
  const loading = screenState === 'loading';
  // Only the pull gesture drives the RefreshControl; background refetches
  // (focus, invalidation, foreground) must not animate the list.
  const [pulling, setPulling] = useState(false);

  const retryLoad = useCallback(() => {
    void query.refetch();
  }, [query]);

  const onRefresh = useCallback(() => {
    setPulling(true);
    void query
      .refetch()
      .then((result) => {
        if (result.isError && result.data) notify.backgroundError("Couldn't refresh saved events.", result.error);
      })
      .finally(() => setPulling(false));
  }, [query]);

  /**
   * Unsaving is one tap to undo, so it gets an undo toast rather than a
   * blocking confirm: no interruption, and a mistake costs one tap.
   */
  const handleUnsave = useCallback(
    async (event: RankedEvent) => {
      const key = queryKeys.savedEvents();
      // Stop an in-flight refetch (focus / invalidation) from writing the old
      // list back over the optimistic removal.
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      // Optimistic: drop the row from every cached page, restore on failure.
      queryClient.setQueryData<InfiniteData<RankedEvent[], number>>(key, (old) =>
        old
          ? { ...old, pages: old.pages.map((page) => page.filter((e) => e.id !== event.id)) }
          : old
      );
      try {
        // Offline the removal is queued and replayed on reconnect; a refetch
        // before then would bring the row back, so only re-read when sent.
        const result = await runOrQueue({ kind: 'save', targetId: event.id, on: false, label: event.title });
        if (result === 'done') void queryClient.invalidateQueries({ queryKey: key });
        const tail = result === 'queued' ? " It will sync when you're back online." : '';
        notify.undo(`Removed "${event.title}" from saved.${tail}`, () => {
          void (async () => {
            try {
              const undo = await runOrQueue({ kind: 'save', targetId: event.id, on: true, label: event.title });
              // Queued: put the row back as it was; sent: re-read rather than
              // splice it in, since position depends on the server's ordering.
              if (undo === 'queued') queryClient.setQueryData(key, previous);
              else void queryClient.invalidateQueries({ queryKey: key });
            } catch {
              notify.error('Could not restore the saved event.');
              void queryClient.invalidateQueries({ queryKey: key });
            }
          })();
        });
      } catch {
        queryClient.setQueryData(key, previous);
        notify.error('Failed to remove saved event');
      }
    },
    [queryClient]
  );

  // Split memoized on the flattened pages so paging / unrelated re-renders
  // do not rebuild the section arrays (which would re-render every row).
  const sections = useMemo<SavedEventSection[]>(() => {
    const upcoming = events.filter((e) => !e.has_ended);
    const past = events.filter((e) => e.has_ended);
    const result: SavedEventSection[] = [];
    if (upcoming.length > 0) result.push({ key: 'upcoming', title: null, data: upcoming });
    if (past.length > 0) {
      result.push({
        key: 'past',
        title: upcoming.length > 0 ? 'Already happened' : 'All of these have ended',
        data: past,
      });
    }
    return result;
  }, [events]);

  const renderItem = useCallback(
    ({ item }: { item: RankedEvent }) => (
      <SavedEventRow event={item} onUnsave={handleUnsave} nextIso={nextById.get(item.id)} />
    ),
    [handleUnsave, nextById]
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: SavedEventSection }) =>
      section.title ? <Text style={styles.groupLabel}>{section.title}</Text> : null,
    []
  );

  const onEndReached = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, [query]);

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
            <Bookmark size={18} color={Colors.primary} />
          </View>
          <View>
            <Text style={styles.headerTitle} accessibilityRole="header">Saved Events</Text>
            <Text style={styles.headerSubtitle}>
              {loading
                ? 'Loading…'
                : query.data === undefined
                  ? 'Not loaded yet'
                  : `${events.length} saved event${events.length !== 1 ? 's' : ''}`}
            </Text>
          </View>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View
          style={styles.skeletonList}
          accessibilityLabel="Loading your saved events"
          {...a11yState({ busy: true })}
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
        <SectionList
          sections={screenState === 'offline' || screenState === 'error' ? [] : sections}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          keyExtractor={keyExtractor}
          stickySectionHeadersEnabled={false}
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            events.length === 0 && styles.scrollContentEmpty,
            { paddingBottom: insets.bottom + 40 },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={pulling}
              onRefresh={onRefresh}
              tintColor={Colors.primary}
              colors={[Colors.primary]}
            />
          }
          ListHeaderComponent={
            screenState !== 'offline' && screenState !== 'error' && events.length > 0 ? (
              <FreshnessNote text={freshness} />
            ) : null
          }
          ListEmptyComponent={
            screenState === 'offline' ? (
              <OfflineState onRetry={retryLoad} />
            ) : screenState === 'error' ? (
              <ErrorState
                title="Couldn't load saved events"
                message="Could not load your saved events."
                onRetry={retryLoad}
              />
            ) : (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconWrap}>
                  <BookmarkX size={36} color={Colors.primary} />
                </View>
                <Text style={styles.emptyTitle}>No Saved Events</Text>
                <Text style={styles.emptySubtitle}>
                  Tap the bookmark on any event to keep it here for later.
                </Text>
                <Button
                  label="Explore Events"
                  onPress={() => router.push('/(tabs)/discover' as never)}
                  variant="ghost"
                  icon={<ChevronRight size={16} color={Colors.primary} />}
                  style={styles.exploreCta}
                />
              </View>
            )
          }
          onEndReached={onEndReached}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            query.isFetchingNextPage ? (
              <ActivityIndicator
                color={Colors.primary}
                style={styles.loadMore}
                accessibilityLabel="Loading more saved events"
              />
            ) : query.isFetchNextPageError && query.hasNextPage ? (
              // onEndReached won't fire again until the data changes, so a
              // failed page needs an explicit retry (the old button did this).
              <TouchableOpacity
                style={styles.loadMore}
                onPress={() => void query.fetchNextPage()}
                accessibilityRole="button"
                accessibilityLabel="Retry loading more saved events"
              >
                <Text style={styles.loadMoreRetryText}>Couldn&apos;t load more · Retry</Text>
              </TouchableOpacity>
            ) : null
          }
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

  loadMore: {
    alignSelf: 'center',
    marginTop: Spacing.sm,
  },
  loadMoreRetryText: {
    fontSize: Typography.sizes.sm,
    color: Colors.primary,
    fontFamily: Typography.fontFamilies.semibold,
    paddingVertical: Spacing.sm,
  },
  groupLabel: {
    marginTop: 8,
    marginBottom: 12,
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  /* ── Header ── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    borderRadius: 12,
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

  /* ── Scroll ── */
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  scrollContentEmpty: {
    flex: 1,
    justifyContent: 'center',
  },

  /* ── Empty state ── */
  emptyContainer: {
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
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
  exploreCta: {
    backgroundColor: Colors.primarySoft,
  },

  cardSpacing: {
    marginBottom: 12,
  },
  bookmarkBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

});