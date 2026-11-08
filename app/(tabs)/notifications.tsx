import { memo, useState, useCallback, useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import {
  Mail,
  Clock3,
  RefreshCcw,
  BellOff,
  BellRing,
  CalendarPlus,
  CheckCheck,
  MapPin,
  MessageCircle,
  AtSign,
  UserPlus,
  Users,
  X,
  Megaphone,
  ListOrdered,
  ShieldAlert,
} from '@/components/icons.generated';
import { alpha, Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import {
  getNotificationsPage,
  getUnreadNotificationCount,
  subscribeToNotifications,
  NOTIFICATIONS_PAGE_SIZE,
  type Notification as ApiNotification,
} from '@/services/notifications';
import { useIsRestoring, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { getPendingWrites, runOrQueue } from '@/services/pendingWrites';
import { overlayNotificationWrites } from '@/utils/pendingWrites';
import { queryKeys } from '@/hooks/queryKeys';
import { useConnectivity } from '@/services/connectivity';
import { getConnectivity, subscribeConnectivity } from '@/utils/connectivity';
import { freshnessNote } from '@/utils/screenState';
import { FreshnessNote, OfflineState } from '@/components/ui/QueryStates';
import { useAuth } from '@/contexts/AuthContext';
import { notify } from '@/utils/notify';
import { formatRelativeLabel } from '@/utils/relativeTime';
import { ErrorState } from '@/components/ui/ErrorState';

type Notification = ApiNotification;
type NotificationType = ApiNotification['type'];

const Palette = {
  surface: Colors.background.primary,
  card: Colors.surface,
  cardRead: Colors.background.secondary,
  text: Colors.text.primary,
  muted: Colors.text.secondary,
  subtle: Colors.text.tertiary,
  primary: Colors.primary,
  secondary: Colors.secondary,
  border: Colors.neutralSoft,
  readIconBg: Colors.background.tertiary,
};

const isUnreadStyle = (n: Notification) => !n.read;

const getIconMeta = (type: NotificationType) => {
  switch (type) {
    case 'new_follower':
      // The notification row carries no follower id, so a neutral icon is
      // shown rather than any placeholder photo.
      return { Icon: UserPlus, bg: alpha(Colors.primary, 0.08), color: Palette.primary };
    case 'event_reminder':
      return { Icon: Clock3, bg: alpha(Colors.secondary, 0.12), color: Palette.secondary };
    case 'event_update':
      return { Icon: RefreshCcw, bg: Palette.readIconBg, color: Palette.subtle };
    case 'rsvp':
      return { Icon: Users, bg: alpha(Colors.primary, 0.08), color: Palette.primary };
    case 'new_event_from_followed':
      return { Icon: CalendarPlus, bg: alpha(Colors.primary, 0.08), color: Palette.primary };
    case 'nearby_event':
      return { Icon: MapPin, bg: alpha(Colors.secondary, 0.12), color: Palette.secondary };
    case 'promotion':
      return { Icon: BellRing, bg: alpha(Colors.primary, 0.08), color: Palette.primary };
    case 'chat_message':
      return { Icon: MessageCircle, bg: alpha(Colors.primary, 0.08), color: Palette.primary };
    case 'chat_mention':
      return { Icon: AtSign, bg: alpha(Colors.primary, 0.08), color: Palette.primary };
    case 'host_announcement':
      return { Icon: Megaphone, bg: alpha(Colors.primary, 0.08), color: Palette.primary };
    case 'waitlist':
      return { Icon: ListOrdered, bg: alpha(Colors.secondary, 0.12), color: Palette.secondary };
    case 'moderation':
    case 'report_update':
      return { Icon: ShieldAlert, bg: Palette.readIconBg, color: Palette.subtle };
    default:
      return { Icon: Mail, bg: alpha(Colors.primary, 0.08), color: Palette.primary };
  }
};

type NotificationCardProps = {
  notification: Notification;
  /** Current time for relative labels; changes once a minute while focused. */
  now: number;
  onPress: (notification: Notification) => void;
  onDismiss: (id: string) => void;
};

/**
 * One notification row. Memoized so realtime inserts and read / dismiss
 * changes only re-render the rows whose data actually changed.
 */
const NotificationCard = memo(function NotificationCard({
  notification,
  now,
  onPress,
  onDismiss,
}: NotificationCardProps) {
  const unread = isUnreadStyle(notification);
  const iconMeta = getIconMeta(notification.type);

  return (
    <TouchableOpacity
      style={[styles.card, !unread && styles.cardRead]}
      activeOpacity={0.86}
      onPress={() => onPress(notification)}
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'Unread: ' : ''}${notification.title}. ${notification.body}`}
      // The dismiss button is nested in this card (one VoiceOver element).
      accessibilityActions={[{ name: 'dismiss', label: 'Dismiss notification' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'dismiss') onDismiss(notification.id);
      }}
    >
      <View style={styles.cardTopRow}>
        <View style={styles.cardLeft}>
          <View style={[styles.iconWrap, { backgroundColor: unread ? iconMeta.bg : Palette.readIconBg }]}>
            <iconMeta.Icon
              size={22}
              color={unread ? iconMeta.color : Palette.subtle}
            />
          </View>

          <View style={styles.contentWrap}>
            <View style={styles.titleRow}>
              <Text style={[styles.title, !unread && styles.titleRead]} numberOfLines={1}>
                {notification.title}
              </Text>
              <View style={styles.timeRow}>
                <Text style={[styles.timeLabel, !unread && styles.timeRead]}>
                  {formatRelativeLabel(notification.timestamp, new Date(now))}
                </Text>
                {unread ? <View style={styles.unreadDot} /> : null}
              </View>
            </View>
            <Text style={[styles.body, !unread && styles.bodyRead]}>
              {notification.body}
            </Text>
          </View>
        </View>
      </View>

      <TouchableOpacity
        style={styles.dismissButton}
        onPress={() => onDismiss(notification.id)}
        hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
        accessibilityRole="button"
        accessibilityLabel="Dismiss notification"
      >
        <X size={16} color={Palette.subtle} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
});

const ItemSeparator = () => <View style={styles.separator} />;

const keyExtractor = (n: Notification) => n.id;

type CachedNotifications = { items: Notification[]; hasMore: boolean; unreadCount: number };

/** The cached first page, with timestamps revived (they are stored as strings). */
function cachedNotifications(
  queryClient: QueryClient,
  userId: string | undefined
): (CachedNotifications & { updatedAt: number }) | null {
  if (!userId) return null;
  const key = queryKeys.notifications(userId);
  const cached = queryClient.getQueryData<CachedNotifications>(key);
  if (!cached || !Array.isArray(cached.items)) return null;
  return {
    items: cached.items.map((n) => ({ ...n, timestamp: new Date(n.timestamp) })),
    hasMore: !!cached.hasMore,
    unreadCount: typeof cached.unreadCount === 'number' ? cached.unreadCount : 0,
    updatedAt: queryClient.getQueryState(key)?.dataUpdatedAt ?? 0,
  };
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const connectivity = useConnectivity();
  // The first page last shown, kept on the device so the tab opens with it
  // offline (docs/OFFLINE_PLAN.md §3.5). The network load replaces it.
  const [initial] = useState(() => cachedNotifications(queryClient, user?.id));
  const [notifications, setNotifications] = useState<Notification[]>(initial?.items ?? []);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState(false);
  const [lastLoadFailed, setLastLoadFailed] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(initial?.updatedAt ?? 0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(initial?.hasMore ?? false);
  // Server-side count: the list is paged, so counting loaded rows would
  // under-report (and disagree with the tab badge).
  const [unreadCount, setUnreadCount] = useState(initial?.unreadCount ?? 0);
  // Whether rows are on screen: a failed refresh then keeps them (with the
  // freshness note) instead of swapping the list for the error state.
  const hasLoadedRef = useRef(!!initial);
  // A network load has succeeded this visit; until then the cached copy is
  // shown and not written back (that would stamp it as fresh).
  const fetchedRef = useRef(false);

  const loadNotifications = useCallback(async () => {
    try {
      const [{ items, hasMore: more }, unread] = await Promise.all([
        getNotificationsPage({ offset: 0 }),
        getUnreadNotificationCount().catch(() => null),
      ]);
      // Queued read / dismiss intents (made offline) win over the server
      // copy until they replay.
      const pending = getPendingWrites();
      const visible = overlayNotificationWrites(items, pending);
      setNotifications(visible);
      setHasMore(more);
      if (unread !== null) {
        const adjust = items.filter((n) => !n.read).length - visible.filter((n) => !n.read).length;
        setUnreadCount(Math.max(0, unread - adjust));
      }
      // A failed count keeps the last known value rather than reading 0.
      setError(false);
      setLastLoadFailed(false);
      setUpdatedAt(Date.now());
      hasLoadedRef.current = true;
      fetchedRef.current = true;
    } catch (err) {
      console.error('Failed to load notifications:', err);
      setLastLoadFailed(true);
      if (!hasLoadedRef.current) setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  // Mounted before the device cache finished restoring: adopt the restored
  // first page if nothing has loaded yet.
  const isRestoring = useIsRestoring();
  useEffect(() => {
    if (isRestoring || hasLoadedRef.current) return;
    const restored = cachedNotifications(queryClient, user?.id);
    if (!restored) return;
    hasLoadedRef.current = true;
    setNotifications(restored.items);
    setHasMore(restored.hasMore);
    setUnreadCount(restored.unreadCount);
    setUpdatedAt(restored.updatedAt);
    setError(false);
    setLoading(false);
    // Only the restore finishing should trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRestoring]);

  // Mirror the first page (with realtime and read / dismiss changes) into the
  // device cache once it has been fetched this visit.
  useEffect(() => {
    if (!user?.id || !fetchedRef.current) return;
    const snapshot: CachedNotifications = {
      items: notifications.slice(0, NOTIFICATIONS_PAGE_SIZE),
      hasMore: hasMore || notifications.length > NOTIFICATIONS_PAGE_SIZE,
      unreadCount,
    };
    queryClient.setQueryData(queryKeys.notifications(user.id), snapshot);
  }, [notifications, hasMore, unreadCount, user?.id, queryClient]);

  useEffect(() => {
    if (!user?.id) return;
    const unsubscribe = subscribeToNotifications(user.id, {
      onInsert: (incoming) => {
        setNotifications((prev) => {
          if (prev.some((n) => n.id === incoming.id)) return prev;
          return [incoming, ...prev];
        });
        if (!incoming.read) setUnreadCount((c) => c + 1);
      },
      onUpdate: (updated) => {
        setNotifications((prev) => {
          const before = prev.find((n) => n.id === updated.id);
          // A push tap marks the row read server-side; keep the chip honest.
          if (before && before.read !== updated.read) {
            setUnreadCount((c) => Math.max(0, c + (updated.read ? -1 : 1)));
          }
          return prev.map((n) => (n.id === updated.id ? updated : n));
        });
      },
      onDelete: (id) => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
      },
      // Rejoined after a drop: changes in between were never delivered.
      onResubscribed: () => void loadNotifications(),
    });
    // Back from offline: the realtime socket may not have noticed yet.
    let previous = getConnectivity();
    const unsubscribeConnectivity = subscribeConnectivity((status) => {
      const wasOffline = previous === 'offline';
      previous = status;
      if (wasOffline && status !== 'offline') void loadNotifications();
    });
    return () => {
      unsubscribe();
      unsubscribeConnectivity();
    };
  }, [user?.id, loadNotifications]);

  // Set when an older page failed: scroll-paging stops (no retry loop at
  // the list end) and the footer offers an explicit retry instead.
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const loadMore = useCallback(async () => {
    // onEndReached also fires while the list is empty (loading / error).
    if (loadingMore || !hasMore || loading || error) return;
    setLoadMoreFailed(false);
    setLoadingMore(true);
    try {
      const { items, hasMore: more } = await getNotificationsPage({
        offset: notifications.length,
      });
      setNotifications((prev) => {
        const seen = new Set(prev.map((n) => n.id));
        return [...prev, ...items.filter((n) => !seen.has(n.id))];
      });
      setHasMore(more);
    } catch {
      // The footer shows a retry control (see listFooter).
      setLoadMoreFailed(true);
      notify.error("Couldn't load older notifications.");
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, loading, error, notifications.length]);

  // Realtime pauses while backgrounded, so the list can drift from the badge.
  // Skips the first focus: the mount load above already fetched the count.
  const firstFocusRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocusRef.current) {
        firstFocusRef.current = false;
        return;
      }
      getUnreadNotificationCount()
        .then(setUnreadCount)
        .catch(() => {});
    }, [])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadNotifications();
  }, [loadNotifications]);

  const markAsRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    runOrQueue({ kind: 'notificationRead', targetId: id }).catch(() => {
      // Revert the optimistic change so the UI and badge stay in sync.
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: false } : n))
      );
      setUnreadCount((c) => c + 1);
      notify.error('Could not mark notification as read.');
    });
  }, []);

  const markAllRead = useCallback(() => {
    let previous: Notification[] = [];
    setNotifications((prev) => {
      previous = prev;
      return prev.map((n) => ({ ...n, read: true }));
    });
    const previousCount = unreadCount;
    setUnreadCount(0);
    runOrQueue({ kind: 'notificationRead', targetId: '*' }).catch(() => {
      setNotifications(previous);
      setUnreadCount(previousCount);
      notify.error('Could not mark all notifications as read.');
    });
  }, [unreadCount]);

  const dismissNotification = useCallback((id: string) => {
    let previous: Notification[] = [];
    setNotifications((prev) => {
      previous = prev;
      return prev.filter((n) => n.id !== id);
    });
    const wasUnread = previous.find((n) => n.id === id)?.read === false;
    if (wasUnread) setUnreadCount((c) => Math.max(0, c - 1));
    runOrQueue({ kind: 'notificationDelete', targetId: id }).catch(() => {
      setNotifications(previous);
      if (wasUnread) setUnreadCount((c) => c + 1);
      notify.error('Could not dismiss notification.');
    });
  }, []);

  const handlePress = useCallback(
    (notification: Notification) => {
      if (!notification.read) markAsRead(notification.id);
      if (notification.eventId) {
        const isChat = notification.type === 'chat_message' || notification.type === 'chat_mention';
        const path = isChat
          ? notification.messageId
            ? `/event-chat/${notification.eventId}?messageId=${notification.messageId}`
            : `/event-chat/${notification.eventId}`
          : `/event/${notification.eventId}`;
        router.push(path as never);
        return;
      }
      if (notification.businessId) {
        router.push(`/business/${notification.businessId}` as never);
        return;
      }
      router.push('/(tabs)/discover' as never);
    },
    [markAsRead]
  );

  // Rows are memoized, so "5m ago" labels need an explicit clock: refreshed
  // on focus and once a minute while this tab is focused.
  const [now, setNow] = useState(() => Date.now());
  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
      const timer = setInterval(() => setNow(Date.now()), 60_000);
      return () => clearInterval(timer);
    }, [])
  );
  const renderItem = useCallback(
    ({ item }: { item: Notification }) => (
      <NotificationCard notification={item} now={now} onPress={handlePress} onDismiss={dismissNotification} />
    ),
    [now, handlePress, dismissNotification]
  );

  const listHeader = (
    <View style={styles.editorialHeader}>
          <Text style={styles.editorialTitle}>Notifications</Text>
          <Text style={styles.editorialSubtitle}>
            Stay in the loop with your latest event activity.
          </Text>
          {!loading && !error && unreadCount > 0 ? (
            <TouchableOpacity
              style={styles.readAllChip}
              onPress={markAllRead}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`${unreadCount} unread, mark all as read`}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.readAllChipText}>
                {unreadCount} unread • Mark all read
              </Text>
            </TouchableOpacity>
          ) : null}
      {!loading && !error ? (
        <FreshnessNote
          style={styles.freshness}
          text={freshnessNote({
            hasData: notifications.length > 0,
            dataUpdatedAt: updatedAt,
            isError: lastLoadFailed,
            connectivity,
          })}
        />
      ) : null}
    </View>
  );

  const listEmpty = loading ? (
    <NotificationSkeleton />
  ) : error && connectivity === 'offline' ? (
    <OfflineState
      onRetry={() => {
        setLoading(true);
        loadNotifications();
      }}
    />
  ) : error ? (
    <ErrorState
      title="Couldn't load notifications"
      onRetry={() => {
        setLoading(true);
        loadNotifications();
      }}
    />
  ) : (
    <View style={styles.emptyCard}>
      <View style={styles.emptyIconWrap}>
        <BellOff size={28} color={Palette.primary} />
      </View>
      <Text style={styles.emptyTitle}>All caught up</Text>
      <Text style={styles.emptySub}>
        You have no notifications right now. We will let you know when something happens.
      </Text>
    </View>
  );

  const listFooter = (
    <>
      {!loading && !error && loadingMore ? (
        <View style={styles.loadMoreButton} accessibilityLabel="Loading older notifications">
          <ActivityIndicator color={Palette.primary} />
        </View>
      ) : null}
      {!loading && !error && !loadingMore && loadMoreFailed && hasMore ? (
        <TouchableOpacity
          style={styles.historyButton}
          activeOpacity={0.84}
          onPress={() => void loadMore()}
          accessibilityRole="button"
          accessibilityLabel="Retry loading older notifications"
        >
          <Text style={styles.historyText}>Couldn&apos;t load older notifications · Retry</Text>
        </TouchableOpacity>
      ) : null}
      {!loading && !error && unreadCount > 0 ? (
        <TouchableOpacity
          style={styles.historyButton}
          activeOpacity={0.84}
          onPress={markAllRead}
          accessibilityRole="button"
          accessibilityLabel="Mark all notifications as read"
        >
          <Text style={styles.historyText}>Mark all as read</Text>
          <CheckCheck size={17} color={Palette.text} />
        </TouchableOpacity>
      ) : null}
    </>
  );

  return (
    <View style={styles.root}>
      <FlatList
        data={loading || error ? [] : notifications}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ItemSeparatorComponent={ItemSeparator}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        ListFooterComponent={listFooter}
        onEndReached={() => {
          if (!loadMoreFailed) void loadMore();
        }}
        onEndReachedThreshold={0.4}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Palette.primary}
            colors={[Palette.primary]}
          />
        }
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 130,
          paddingHorizontal: 16,
        }}
      />
    </View>
  );
}

function NotificationSkeleton() {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    // Gentle pulse; skipped entirely when the user prefers reduced motion.
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduceMotion) => {
        if (cancelled || reduceMotion) return;
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(opacity, {
              toValue: 0.55,
              duration: 700,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(opacity, {
              toValue: 1,
              duration: 700,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ])
        );
        loop.start();
      })
      .catch(() => {
        // Reduced-motion lookup failed; leave the skeleton static.
      });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [opacity]);

  return (
    <View style={styles.skeletonWrap}>
      {[0, 1, 2].map((key) => (
        <Animated.View key={`skeleton-${key}`} style={[styles.skeletonCard, { opacity }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Palette.surface,
  },
  editorialHeader: {
    marginTop: Spacing.sm,
    marginBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  editorialTitle: {
    fontSize: 24,
    lineHeight: 28,
    letterSpacing: -0.2,
    color: Palette.text,
    fontFamily: Typography.displayFontFamilies.extrabold,
    fontWeight: '800',
  },
  editorialSubtitle: {
    fontSize: 14,
    lineHeight: 21,
    maxWidth: 320,
    color: Palette.muted,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
  },
  readAllChip: {
    marginTop: 14,
    alignSelf: 'flex-start',
    backgroundColor: alpha(Colors.primary, 0.08),
    borderRadius: BorderRadius.round,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  readAllChipText: {
    color: Palette.primary,
    fontSize: 12,
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  separator: {
    height: 12,
  },
  freshness: {
    marginTop: Spacing.xs,
    marginBottom: 0,
  },
  card: {
    backgroundColor: Palette.card,
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  cardRead: {
    backgroundColor: Palette.cardRead,
  },
  cardTopRow: {
    flexDirection: 'row',
  },
  cardLeft: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: BorderRadius.round,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentWrap: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 16,
    color: Palette.text,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  titleRead: {
    opacity: 0.85,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 2,
  },
  timeLabel: {
    color: Palette.subtle,
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  timeRead: {
    opacity: 0.65,
  },
  unreadDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: Palette.primary,
  },
  body: {
    marginTop: 6,
    color: Palette.muted,
    fontSize: Typography.sizes.md,
    lineHeight: 24,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
  },
  bodyRead: {
    opacity: 0.88,
  },
  dismissButton: {
    alignSelf: 'flex-end',
    marginTop: 8,
    marginRight: 4,
  },
  emptyCard: {
    backgroundColor: Palette.card,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    borderColor: Palette.border,
    padding: Spacing.lg,
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: BorderRadius.lg,
    backgroundColor: alpha(Colors.primary, 0.08),
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  emptyTitle: {
    fontSize: Typography.sizes.lg,
    color: Palette.text,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  emptySub: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 23,
    color: Palette.muted,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
  },
  loadMoreButton: {
    alignSelf: 'center',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
  },
  historyButton: {
    marginTop: 26,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 26,
    paddingVertical: Spacing.md,
    backgroundColor: Palette.card,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: BorderRadius.round,
  },
  historyText: {
    color: Palette.text,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  skeletonWrap: {
    gap: 12,
  },
  skeletonCard: {
    height: 138,
    borderRadius: 24,
    backgroundColor: Colors.background.tertiary,
  },
});
