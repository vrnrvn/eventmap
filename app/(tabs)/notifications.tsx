import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  Animated,
  Platform,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Swipeable } from 'react-native-gesture-handler';
import { router } from 'expo-router';
import {
  Bell,
  BellOff,
  Calendar,
  Users,
  Heart,
  MapPin,
  Sparkles,
  Check,
  CheckCheck,
  Trash2,
  Clock,
  Star,
  ChevronRight,
} from 'lucide-react-native';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  type Notification as ApiNotification,
} from '@/services/notifications';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const Palette = {
  gradientStart: Colors.primary,
  gradientEnd: Colors.accent,
  cardBg: Colors.background.primary,
  surfaceMuted: Colors.background.primary,
  accentSoft: 'rgba(196, 92, 62, 0.12)',
  separator: Colors.border.light,
  badge: Colors.primary,
  unreadDot: Colors.primary,
  successSoft: 'rgba(45, 138, 110, 0.12)',
  successDot: Colors.success,
  warnSoft: 'rgba(212, 160, 23, 0.12)',
  warnDot: Colors.warning,
  errorSoft: 'rgba(196, 92, 62, 0.12)',
  errorDot: Colors.error,
};

/* ── Notification types (re-export from service for UI) ── */
type NotificationType = ApiNotification['type'];
type Notification = ApiNotification;

/* ── Helpers ── */
const getNotificationIcon = (type: NotificationType) => {
  switch (type) {
    case 'event_reminder':
      return { Icon: Clock, bg: Palette.warnSoft, color: Palette.warnDot };
    case 'new_follower':
      return { Icon: Heart, bg: Palette.errorSoft, color: Palette.errorDot };
    case 'rsvp':
      return { Icon: Users, bg: Palette.successSoft, color: Palette.successDot };
    case 'nearby_event':
      return { Icon: MapPin, bg: Palette.accentSoft, color: Palette.badge };
    case 'event_update':
      return { Icon: Calendar, bg: Palette.accentSoft, color: Palette.badge };
    case 'promotion':
      return { Icon: Star, bg: Palette.warnSoft, color: Palette.warnDot };
    default:
      return { Icon: Bell, bg: Palette.accentSoft, color: Palette.badge };
  }
};

const formatTimeAgo = (date: Date): string => {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const groupNotifications = (notifications: Notification[]) => {
  const now = new Date();
  const today: Notification[] = [];
  const thisWeek: Notification[] = [];
  const earlier: Notification[] = [];

  notifications.forEach((n) => {
    const diffMs = now.getTime() - n.timestamp.getTime();
    const diffDays = diffMs / 86400000;
    if (diffDays < 1) today.push(n);
    else if (diffDays < 7) thisWeek.push(n);
    else earlier.push(n);
  });

  type Section = { title: string; data: Notification[] };
  const sections: Section[] = [];
  if (today.length) sections.push({ title: 'Today', data: today });
  if (thisWeek.length) sections.push({ title: 'This Week', data: thisWeek });
  if (earlier.length) sections.push({ title: 'Earlier', data: earlier });
  return sections;
};

/* ── Component ── */
export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());

  const loadNotifications = useCallback(async () => {
    try {
      const list = await getNotifications();
      setNotifications(list);
    } catch (err) {
      console.error('Failed to load notifications:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const sections = groupNotifications(notifications);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadNotifications();
  }, [loadNotifications]);

  const markAsRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
    markNotificationAsRead(id).catch(() => {});
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    markAllNotificationsAsRead().catch(() => {});
  }, []);

  const dismissNotification = useCallback((id: string) => {
    swipeableRefs.current.get(id)?.close();
    deleteNotification(id).catch(() => {});
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 200);
  }, []);

  const handlePress = useCallback(
    (notification: Notification) => {
      markAsRead(notification.id);
      if (notification.eventId) {
        router.push(`/event/${notification.eventId}` as never);
      } else {
        router.push('/(tabs)/discover' as never);
      }
    },
    [markAsRead]
  );

  /* ── Swipe right action (delete) ── */
  const renderRightActions = (
    _progress: Animated.AnimatedInterpolation<number>,
    _dragX: Animated.AnimatedInterpolation<number>,
    id: string
  ) => (
    <TouchableOpacity
      style={styles.swipeAction}
      onPress={() => dismissNotification(id)}
      activeOpacity={0.8}
    >
      <Trash2 size={20} color="#FFFFFF" />
      <Text style={styles.swipeActionText}>Remove</Text>
    </TouchableOpacity>
  );

  /* ── Notification row ── */
  const renderNotification = (notification: Notification) => {
    const { Icon, bg, color } = getNotificationIcon(notification.type);

    return (
      <Swipeable
        ref={(ref) => {
          if (ref) swipeableRefs.current.set(notification.id, ref);
        }}
        renderRightActions={(progress, dragX) =>
          renderRightActions(progress, dragX, notification.id)
        }
        overshootRight={false}
        friction={2}
      >
        <TouchableOpacity
          style={[
            styles.notifCard,
            !notification.read && styles.notifCardUnread,
          ]}
          onPress={() => handlePress(notification)}
          activeOpacity={0.7}
        >
          {/* Unread dot */}
          {!notification.read && <View style={styles.unreadDot} />}

          {/* Icon */}
          <View style={[styles.notifIcon, { backgroundColor: bg }]}>
            <Icon size={18} color={color} />
          </View>

          {/* Content */}
          <View style={styles.notifContent}>
            <Text
              style={[
                styles.notifTitle,
                !notification.read && styles.notifTitleUnread,
              ]}
              numberOfLines={1}
            >
              {notification.title}
            </Text>
            <Text style={styles.notifBody} numberOfLines={2}>
              {notification.body}
            </Text>
            <Text style={styles.notifTime}>
              {formatTimeAgo(notification.timestamp)}
            </Text>
          </View>

          {/* Chevron */}
          {notification.eventId && (
            <ChevronRight
              size={16}
              color={Colors.text.tertiary}
              style={styles.notifChevron}
            />
          )}
        </TouchableOpacity>
      </Swipeable>
    );
  };

  /* ── Section header ── */
  const renderSectionHeader = (title: string) => (
    <View style={styles.sectionHeaderRow}>
      <Text style={styles.sectionHeaderText}>{title}</Text>
    </View>
  );

  /* ── Build flat data with section headers ── */
  type ListItem =
    | { type: 'header'; title: string; key: string }
    | { type: 'notification'; data: Notification; key: string };

  const flatData: ListItem[] = [];
  sections.forEach((section) => {
    flatData.push({
      type: 'header',
      title: section.title,
      key: `header-${section.title}`,
    });
    section.data.forEach((n) => {
      flatData.push({ type: 'notification', data: n, key: n.id });
    });
  });

  /* ── Empty state ── */
  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconWrap}>
        <BellOff size={36} color={Colors.primary} />
      </View>
      <Text style={styles.emptyTitle}>All Caught Up</Text>
      <Text style={styles.emptySubtitle}>
        You have no notifications right now.{'\n'}We'll let you know when
        something happens!
      </Text>
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerIconWrap}>
            <Bell size={20} color={Palette.gradientStart} />
          </View>
          <View>
            <Text style={styles.headerTitle}>Notifications</Text>
            <Text style={styles.headerSubtitle}>
              {unreadCount > 0
                ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}`
                : 'You\'re all caught up'}
            </Text>
          </View>
        </View>
        {unreadCount > 0 && (
          <TouchableOpacity
            style={styles.markAllBtn}
            onPress={markAllRead}
            activeOpacity={0.7}
          >
            <CheckCheck size={16} color={Colors.primary} />
            <Text style={styles.markAllText}>Read all</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Unread count badge bar ── */}
      {unreadCount > 0 && (
        <View style={styles.unreadBar}>
          <LinearGradient
            colors={[Palette.gradientStart, Palette.gradientEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.unreadBarGradient}
          >
            <Sparkles size={14} color="#FFFFFF" />
            <Text style={styles.unreadBarText}>
              {unreadCount} new update{unreadCount !== 1 ? 's' : ''} since your
              last visit
            </Text>
          </LinearGradient>
        </View>
      )}

      {/* ── List ── */}
      <FlatList
        data={flatData}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => {
          if (item.type === 'header') {
            return renderSectionHeader(item.title);
          }
          return renderNotification(item.data);
        }}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={[
          styles.listContent,
          flatData.length === 0 && styles.listContentEmpty,
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
            colors={[Colors.primary]}
          />
        }
      />
    </View>
  );
}

/* ────────────────────────── STYLES ────────────────────────── */

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Palette.surfaceMuted,
  },

  /* ── Header ── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    backgroundColor: Palette.cardBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Palette.separator,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: Palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  headerSubtitle: {
    fontSize: 12,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    marginTop: 1,
  },
  markAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: Palette.accentSoft,
  },
  markAllText: {
    fontSize: 12,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },

  /* ── Unread bar ── */
  unreadBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  unreadBarGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  unreadBarText: {
    fontSize: 13,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: '#FFFFFF',
  },

  /* ── List ── */
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  listContentEmpty: {
    flex: 1,
    justifyContent: 'center',
  },

  /* ── Section headers ── */
  sectionHeaderRow: {
    paddingTop: 20,
    paddingBottom: 8,
    paddingHorizontal: 4,
  },
  sectionHeaderText: {
    fontSize: 13,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  /* ── Notification card ── */
  notifCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Palette.cardBg,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 8,
    position: 'relative',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 6,
      },
      android: { elevation: 2 },
    }),
  },
  notifCardUnread: {
    backgroundColor: '#FAFAFF',
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.12)',
  },

  /* ── Unread dot ── */
  unreadDot: {
    position: 'absolute',
    top: 16,
    left: 6,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: Palette.unreadDot,
  },

  /* ── Icon ── */
  notifIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },

  /* ── Content ── */
  notifContent: {
    flex: 1,
  },
  notifTitle: {
    fontSize: 14,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.primary,
    marginBottom: 2,
  },
  notifTitleUnread: {
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  notifBody: {
    fontSize: 13,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    lineHeight: 18,
    marginBottom: 4,
  },
  notifTime: {
    fontSize: 11,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
  },

  notifChevron: {
    marginLeft: 8,
  },

  /* ── Swipe action ── */
  swipeAction: {
    backgroundColor: '#EF4444',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    marginBottom: 8,
    marginLeft: 8,
    gap: 4,
  },
  swipeActionText: {
    fontSize: 11,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: '#FFFFFF',
  },

  /* ── Empty state ── */
  emptyContainer: {
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: Palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    textAlign: 'center',
    lineHeight: 20,
  },
});