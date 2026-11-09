import { useCallback, useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/hooks/queryKeys';
import { useRefetchOnFocus } from '@/hooks/useRefetchOnFocus';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { socialService, type GoingEventsScope } from '@/services/social';
import { eventChatService } from '@/services/eventChat';
import { RankedEvent } from '@/types/database';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import { isEventInProgress } from '@/utils/eventStatus';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { FreshnessNote, OfflineState } from '@/components/ui/QueryStates';
import { useScreenState } from '@/hooks/useScreenState';
import { PERSISTED_QUERY } from '@/utils/queryPersistence';
import { EventListItem } from '@/components/EventListItem';
import { formatEventDate, formatEventWhen } from '@/utils/formatEventWhen';
import { describeEventDateTime } from '@/utils/timezone';
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  MessageCircle,
  Repeat,
  History,
} from '@/components/icons.generated';
import { a11yState } from '@/utils/accessibility';

const PAGE_SIZE = 20;

const dedupeById = (events: RankedEvent[]) => {
  const seen = new Set<string>();
  return events.filter((event) => (seen.has(event.id) ? false : (seen.add(event.id), true)));
};

export default function JoinedEvents() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ tab?: string }>();
  const initialScope: GoingEventsScope =
    params.tab === 'past' || params.tab === 'interested' || params.tab === 'requested' ? params.tab : 'upcoming';
  const [scope, setScope] = useState<GoingEventsScope>(initialScope);
  const [chatUnread, setChatUnread] = useState<Record<string, number>>({});
  const userId = user?.id;

  // The Requests tab only appears when the backend supports the scope
  // (requested_count present, 20261104120000) and there is something in it,
  // or when deep-linked straight to it.
  const countsQuery = useQuery({
    queryKey: queryKeys.attendanceCounts(userId),
    ...PERSISTED_QUERY,
    enabled: !!userId,
    queryFn: () => socialService.getUserAttendanceCounts(userId!),
    staleTime: 30_000,
  });
  const requestedCount = countsQuery.data?.requested ?? null;
  const showRequests = (requestedCount !== null && requestedCount > 0) || scope === 'requested';
  const tabs: GoingEventsScope[] = showRequests
    ? ['upcoming', 'requested', 'interested', 'past']
    : ['upcoming', 'interested', 'past'];

  // One cached, paged query per tab. React Query gives us request de-duping,
  // stale-while-revalidate on focus and tab switches, and page merging — the
  // hand-rolled per-tab state with request sequencing is gone.
  const query = useInfiniteQuery({
    queryKey: queryKeys.joinedEvents(userId, scope),
    // Kept on the device so your plans open offline after a restart.
    ...PERSISTED_QUERY,
    enabled: !!userId,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      socialService.getUserGoingEvents(userId!, scope, { limit: PAGE_SIZE, offset: pageParam }),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length >= PAGE_SIZE ? allPages.reduce((n, page) => n + page.length, 0) : undefined,
  });
  useRefetchOnFocus(query.refetch, !!userId, queryKeys.joinedEvents(userId, scope));
  // The tab counts are marked stale by RSVP writes too; catch up on focus.
  useRefetchOnFocus(countsQuery.refetch, !!userId, queryKeys.attendanceCounts(userId));

  const items = useMemo(() => dedupeById(query.data?.pages.flat() ?? []), [query.data]);
  const hasData = query.data !== undefined;
  const { state: screenState, freshness } = useScreenState(query, { hasData, isEmpty: items.length === 0 });
  const loaded = hasData;
  // Only the pull gesture drives the RefreshControl; background refetches
  // (focus, invalidation, foreground) must not animate the list.
  const [pulling, setPulling] = useState(false);

  // Chat unread badges only matter on the Going tab.
  useEffect(() => {
    if (scope !== 'upcoming' || items.length === 0) return;
    let cancelled = false;
    eventChatService
      .getUnreadCounts(items.map((event) => event.id))
      .then((counts) => {
        if (cancelled) return;
        setChatUnread((prev) => ({
          ...prev,
          ...Object.fromEntries(counts.map((row) => [row.event_id, row.unread_count])),
        }));
      })
      .catch(() => {
        // Badges are best-effort.
      });
    return () => {
      cancelled = true;
    };
  }, [scope, items]);

  const onRefresh = useCallback(() => {
    setPulling(true);
    void query.refetch().finally(() => setPulling(false));
  }, [query]);

  const onEndReached = useCallback(() => {
    if (!loaded || query.isFetchingNextPage || !query.hasNextPage) return;
    void query.fetchNextPage();
  }, [loaded, query]);

  const subtitle = useMemo(() => {
    if (!loaded) return screenState === 'loading' ? 'Loading…' : 'Not loaded yet';
    const n = `${items.length}${query.hasNextPage ? '+' : ''}`;
    const noun = items.length === 1 ? 'event' : 'events';
    if (scope === 'upcoming') return `${n} upcoming ${noun}`;
    if (scope === 'interested') return `${n} ${noun} you're interested in`;
    if (scope === 'requested') return `${n} ${items.length === 1 ? 'request' : 'requests'} waiting for approval`;
    return `${n} attended ${noun}`;
  }, [loaded, screenState, items.length, query.hasNextPage, scope]);

  const renderItem = useCallback(
    ({ item }: { item: RankedEvent }) => {
      const when = scope === 'past' ? item.start_datetime : item.next_start_datetime || item.start_datetime;
      const live = scope !== 'past' && isEventInProgress(item);
      const unread = chatUnread[item.id] ?? 0;
      // Upcoming rows: event-zone time plus "your time" when the viewer's
      // clock differs (rows carry `timezone` from 20261104120000).
      const zoned = item.timezone ? describeEventDateTime(when, item.timezone) : null;
      const dateLine =
        (scope === 'past' ? formatEventDate(when) : zoned && zoned.secondary ? zoned.primary : formatEventWhen(when)) +
        // The repeat icon already marks series; skip the suffix on the longer zoned line.
        (item.is_recurring && scope !== 'past' && !zoned?.secondary ? ' · repeats' : '');
      const zoneLine = scope !== 'past' && zoned?.secondary ? [zoned.secondary] : undefined;
      return (
        <EventListItem
          title={item.title}
          subtitle={item.business_name}
          dateLine={dateLine}
          metaLines={zoneLine}
          thumbnailUrl={item.cover_image_url}
          badge={
            scope === 'requested'
              ? { label: 'Pending', tone: 'primary' }
              : live
                ? { label: 'LIVE', tone: 'success' }
                : null
          }
          dateIcon={
            item.is_recurring ? (
              <Repeat size={12} color={Colors.text.tertiary} />
            ) : undefined
          }
          titleAccessory={
            unread > 0 ? (
              <View style={styles.unreadBadge} accessibilityLabel={`${unread} unread chat messages`}>
                <MessageCircle size={10} color="#FFFFFF" />
                <Text style={styles.unreadText}>{unread > 99 ? '99+' : unread}</Text>
              </View>
            ) : null
          }
          rightAccessory={<ChevronRight size={18} color={Colors.border.medium} />}
          onPress={() => router.push(`/event/${item.id}`)}
          accessibilityLabel={`${item.title}, ${formatEventDate(when)}`}
        />
      );
    },
    [scope, chatUnread]
  );

  const renderEmpty = () => {
    if (screenState === 'loading') {
      // Static skeleton rows mirroring EventListItem's shape.
      return (
        <View
          style={styles.skeletonList}
          accessibilityLabel="Loading events"
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
      );
    }
    if (screenState === 'offline') {
      return <OfflineState onRetry={() => void query.refetch()} style={styles.center} />;
    }
    if (screenState === 'error') {
      return (
        <ErrorState
          title="Couldn't load your events"
          message="Could not load your events."
          onRetry={() => void query.refetch()}
          style={styles.center}
        />
      );
    }
    return (
      <View style={styles.center}>
        <View style={styles.emptyIcon}>
          {scope === 'upcoming' ? (
            <CalendarDays size={28} color={Colors.primary} />
          ) : (
            <History size={28} color={Colors.primary} />
          )}
        </View>
        <Text style={styles.emptyTitle}>
          {scope === 'upcoming'
            ? 'Nothing coming up'
            : scope === 'interested'
              ? 'No interested events'
              : scope === 'requested'
                ? 'No pending requests'
              : 'No past events yet'}
        </Text>
        <Text style={styles.emptyText}>
          {scope === 'upcoming'
            ? 'Events you RSVP to as going will show up here.'
            : scope === 'interested'
              ? 'Mark events as interested to keep an eye on them here.'
              : scope === 'requested'
                ? 'When a host approves or declines your request, it leaves this list.'
              : 'Once an event you joined is over, it moves here.'}
        </Text>
        {scope !== 'past' ? (
          <Button
            label="Discover events"
            onPress={() => router.push('/(tabs)/discover')}
            style={styles.emptyButton}
          />
        ) : null}
      </View>
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={22} color={Colors.text.primary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} accessibilityRole="header">Events Joined</Text>
          <Text style={styles.headerSubtitle}>{subtitle}</Text>
        </View>
        <TouchableOpacity
          style={styles.headerSpacer}
          onPress={() => router.push('/calendar' as never)}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Open calendar"
        >
          <CalendarDays size={22} color={Colors.text.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.segment} accessibilityRole="tablist">
        {tabs.map((key) => {
          const active = key === scope;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.segmentItem, active && styles.segmentItemActive]}
              onPress={() => setScope(key)}
              activeOpacity={0.85}
              accessibilityRole="tab"
              {...a11yState({ selected: active })}
              hitSlop={{ top: 6, bottom: 6 }}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {key === 'upcoming'
                  ? 'Going'
                  : key === 'interested'
                    ? 'Interested'
                    : key === 'requested'
                      ? `Requests${requestedCount ? ` ${requestedCount}` : ''}`
                      : 'Attended'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={items.length > 0 ? <FreshnessNote text={freshness} /> : null}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={[
          styles.listContent,
          items.length === 0 && styles.listContentEmpty,
          { paddingBottom: insets.bottom + 32 },
        ]}
        refreshControl={
          <RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <ActivityIndicator size="small" color={Colors.primary} style={styles.footerSpinner} />
          ) : null
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.background.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  headerSubtitle: {
    fontSize: Typography.sizes.xs,
    color: Colors.text.tertiary,
    marginTop: 1,
  },
  headerSpacer: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segment: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 12,
    padding: 4,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.background.secondary,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: BorderRadius.round,
    alignItems: 'center',
  },
  segmentItemActive: {
    backgroundColor: '#FFFFFF',
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
    fontWeight: Typography.weights.semibold,
  },
  segmentTextActive: {
    color: Colors.text.primary,
  },
  listContent: {
    paddingHorizontal: 16,
    gap: 10,
  },
  listContentEmpty: {
    flexGrow: 1,
  },
  unreadBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 18,
    paddingHorizontal: 6,
    borderRadius: 9999,
    backgroundColor: Colors.primary,
  },
  unreadText: {
    fontSize: 10,
    lineHeight: 12,
    color: '#FFFFFF',
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xxl,
  },
  /* ── Loading skeleton (mirrors EventListItem) ── */
  skeletonList: {
    gap: 10,
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
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: Colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  emptyText: {
    marginTop: 6,
    textAlign: 'center',
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
    lineHeight: 20,
  },
  emptyButton: {
    marginTop: 18,
  },
  footerSpinner: {
    paddingVertical: Spacing.md,
  },
});
