import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { socialService, type GoingEventsScope } from '@/services/social';
import { eventChatService } from '@/services/eventChat';
import { RankedEvent } from '@/types/database';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import { isEventInProgress } from '@/utils/eventStatus';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { EventListItem, formatEventDate } from '@/components/EventListItem';
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  MessageCircle,
  Repeat,
  History,
} from 'lucide-react-native';

const PAGE_SIZE = 20;

type TabState = {
  items: RankedEvent[];
  loaded: boolean;
  loadingMore: boolean;
  hasMore: boolean;
};

const emptyTab = (): TabState => ({ items: [], loaded: false, loadingMore: false, hasMore: true });

export default function JoinedEvents() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ tab?: string }>();
  const initialScope: GoingEventsScope =
    params.tab === 'past' || params.tab === 'interested' ? params.tab : 'upcoming';
  const [scope, setScope] = useState<GoingEventsScope>(initialScope);
  const [tabs, setTabs] = useState<Record<GoingEventsScope, TabState>>({
    upcoming: emptyTab(),
    interested: emptyTab(),
    past: emptyTab(),
  });
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatUnread, setChatUnread] = useState<Record<string, number>>({});
  // Guards against a slow response for one tab overwriting a newer one.
  const requestSeq = useRef<Record<GoingEventsScope, number>>({ upcoming: 0, interested: 0, past: 0 });

  const userId = user?.id;
  const current = tabs[scope];

  const patchTab = useCallback((key: GoingEventsScope, patch: Partial<TabState>) => {
    setTabs((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }, []);

  const loadUnread = useCallback(async (events: RankedEvent[]) => {
    const ids = events.map((event) => event.id);
    if (ids.length === 0) return;
    try {
      const counts = await eventChatService.getUnreadCounts(ids);
      setChatUnread((prev) => ({
        ...prev,
        ...Object.fromEntries(counts.map((row) => [row.event_id, row.unread_count])),
      }));
    } catch {
      // Badges are best-effort.
    }
  }, []);

  const loadPage = useCallback(
    async (key: GoingEventsScope, offset: number) => {
      if (!userId) return;
      const seq = ++requestSeq.current[key];
      if (offset > 0) patchTab(key, { loadingMore: true });
      try {
        const page = await socialService.getUserGoingEvents(userId, key, {
          limit: PAGE_SIZE,
          offset,
        });
        if (seq !== requestSeq.current[key]) return;
        setError(null);
        setTabs((prev) => {
          const existing = offset === 0 ? [] : prev[key].items;
          const seen = new Set(existing.map((event) => event.id));
          const merged = [...existing, ...page.filter((event) => !seen.has(event.id))];
          return {
            ...prev,
            [key]: { items: merged, loaded: true, loadingMore: false, hasMore: page.length >= PAGE_SIZE },
          };
        });
        if (key === 'upcoming') void loadUnread(page);
        // 'interested' and 'past' carry no chat badges.
      } catch {
        if (seq !== requestSeq.current[key]) return;
        setError('Could not load your events.');
        patchTab(key, { loaded: true, loadingMore: false, hasMore: false });
      }
    },
    [userId, patchTab, loadUnread]
  );

  // Fresh data every time the screen gains focus (RSVPs change elsewhere), and
  // again when the user switches tabs since the callback identity changes.
  useFocusEffect(
    useCallback(() => {
      void loadPage(scope, 0);
    }, [loadPage, scope])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadPage(scope, 0);
    setRefreshing(false);
  }, [loadPage, scope]);

  const onEndReached = useCallback(() => {
    if (!current.loaded || current.loadingMore || !current.hasMore) return;
    void loadPage(scope, current.items.length);
  }, [current, loadPage, scope]);

  const subtitle = useMemo(() => {
    if (!current.loaded) return 'Loading…';
    const n = `${current.items.length}${current.hasMore ? '+' : ''}`;
    const noun = current.items.length === 1 ? 'event' : 'events';
    if (scope === 'upcoming') return `${n} upcoming ${noun}`;
    if (scope === 'interested') return `${n} ${noun} you're interested in`;
    return `${n} attended ${noun}`;
  }, [current, scope]);

  const renderItem = useCallback(
    ({ item }: { item: RankedEvent }) => {
      const when = scope === 'past' ? item.start_datetime : item.next_start_datetime || item.start_datetime;
      const live = scope !== 'past' && isEventInProgress(item);
      const unread = chatUnread[item.id] ?? 0;
      const dateLine =
        (scope === 'past' ? formatEventDate(when) : `${formatDayLabel(when)} · ${formatTime(when)}`) +
        (item.is_recurring && scope !== 'past' ? ' · repeats' : '');
      return (
        <EventListItem
          title={item.title}
          subtitle={item.business_name}
          dateLine={dateLine}
          thumbnailUrl={item.cover_image_url}
          badge={live ? { label: 'LIVE', tone: 'success' } : null}
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
    if (!current.loaded) {
      // Static skeleton rows mirroring EventListItem's shape.
      return (
        <View
          style={styles.skeletonList}
          accessibilityLabel="Loading events"
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
      );
    }
    if (error) {
      return (
        <ErrorState
          title="Couldn't load your events"
          message={error}
          onRetry={() => {
            // Re-enter the skeleton state so the retry gives visible feedback.
            setError(null);
            patchTab(scope, { loaded: false });
            void loadPage(scope, 0);
          }}
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
              : 'No past events yet'}
        </Text>
        <Text style={styles.emptyText}>
          {scope === 'upcoming'
            ? 'Events you RSVP to as going will show up here.'
            : scope === 'interested'
              ? 'Mark events as interested to keep an eye on them here.'
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
          <Text style={styles.headerTitle}>Events Joined</Text>
          <Text style={styles.headerSubtitle}>{subtitle}</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.segment} accessibilityRole="tablist">
        {(['upcoming', 'interested', 'past'] as GoingEventsScope[]).map((key) => {
          const active = key === scope;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.segmentItem, active && styles.segmentItemActive]}
              onPress={() => setScope(key)}
              activeOpacity={0.85}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              hitSlop={{ top: 6, bottom: 6 }}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {key === 'upcoming' ? 'Going' : key === 'interested' ? 'Interested' : 'Attended'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={current.items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={[
          styles.listContent,
          current.items.length === 0 && styles.listContentEmpty,
          { paddingBottom: insets.bottom + 32 },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          current.loadingMore ? (
            <ActivityIndicator size="small" color={Colors.primary} style={styles.footerSpinner} />
          ) : null
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

function formatTime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatDayLabel(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
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
