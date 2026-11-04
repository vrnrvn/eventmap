import { useState, useCallback, useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
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
} from 'lucide-react-native';
import { alpha, Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import {
  getNotificationsPage,
  getUnreadNotificationCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  subscribeToNotifications,
  type Notification as ApiNotification,
} from '@/services/notifications';
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

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  // Server-side count: the list is paged, so counting loaded rows would
  // under-report (and disagree with the tab badge).
  const [unreadCount, setUnreadCount] = useState(0);

  const loadNotifications = useCallback(async () => {
    try {
      const [{ items, hasMore: more }, unread] = await Promise.all([
        getNotificationsPage({ offset: 0 }),
        getUnreadNotificationCount().catch(() => 0),
      ]);
      setNotifications(items);
      setHasMore(more);
      setUnreadCount(unread);
      setError(false);
    } catch (err) {
      console.error('Failed to load notifications:', err);
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

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
    });
    return unsubscribe;
  }, [user?.id]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
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
      // Keep the button so a transient failure can be retried.
      notify.error("Couldn't load older notifications.");
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, notifications.length]);

  // Realtime pauses while backgrounded, so the list can drift from the badge.
  useFocusEffect(
    useCallback(() => {
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
    markNotificationAsRead(id).catch(() => {
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
    markAllNotificationsAsRead().catch(() => {
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
    deleteNotification(id).catch(() => {
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

  return (
    <View style={styles.root}>
      <ScrollView
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
      >
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
        </View>

        <View style={styles.listWrap}>
          {loading ? (
            <NotificationSkeleton />
          ) : error ? (
            <ErrorState
              title="Couldn't load notifications"
              onRetry={() => {
                setLoading(true);
                loadNotifications();
              }}
            />
          ) : notifications.length === 0 ? (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIconWrap}>
                <BellOff size={28} color={Palette.primary} />
              </View>
              <Text style={styles.emptyTitle}>All caught up</Text>
              <Text style={styles.emptySub}>
                You have no notifications right now. We will let you know when something happens.
              </Text>
            </View>
          ) : (
            notifications.map((notification) => {
              const unread = isUnreadStyle(notification);
              const iconMeta = getIconMeta(notification.type);

              return (
                <TouchableOpacity
                  key={notification.id}
                  style={[styles.card, !unread && styles.cardRead]}
                  activeOpacity={0.86}
                  onPress={() => handlePress(notification)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    unread ? `Unread: ${notification.title}` : notification.title
                  }
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
                              {formatRelativeLabel(notification.timestamp)}
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
                    onPress={() => dismissNotification(notification.id)}
                    hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                    accessibilityRole="button"
                    accessibilityLabel="Dismiss notification"
                  >
                    <X size={16} color={Palette.subtle} />
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })
          )}
          {!loading && !error && hasMore ? (
            <TouchableOpacity
              style={styles.loadMoreButton}
              onPress={() => void loadMore()}
              disabled={loadingMore}
              activeOpacity={0.84}
              accessibilityRole="button"
              accessibilityLabel="Load older notifications"
            >
              <Text style={styles.loadMoreText}>
                {loadingMore ? 'Loading…' : 'Load older notifications'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

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
      </ScrollView>
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
  listWrap: {
    gap: 12,
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
  loadMoreText: {
    fontSize: Typography.sizes.sm,
    color: Palette.primary,
    fontFamily: Typography.fontFamilies.semibold,
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
