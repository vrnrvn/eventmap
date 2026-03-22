import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Mail,
  Clock3,
  RefreshCcw,
  BellRing,
  ChevronRight,
  History,
} from 'lucide-react-native';
import { Colors, Typography, BorderRadius } from '@/constants/theme';
import {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  subscribeToNotifications,
  type Notification as ApiNotification,
} from '@/services/notifications';
import { useAuth } from '@/contexts/AuthContext';

type Notification = ApiNotification;
type NotificationType = ApiNotification['type'];

const Palette = {
  surface: Colors.background.primary,
  card: '#FFFFFF',
  cardRead: 'rgba(255,255,255,0.55)',
  text: Colors.text.primary,
  muted: Colors.text.secondary,
  subtle: Colors.text.tertiary,
  primary: Colors.primary,
  secondary: Colors.secondary,
  border: 'rgba(0,0,0,0.06)',
  readIconBg: Colors.background.tertiary,
};

const FALLBACK_FOLLOWER_IMAGE =
  'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=300&q=60';

const formatRelativeLabel = (date: Date): string => {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'JUST NOW';
  if (diffMin < 60) return `${diffMin}M AGO`;
  if (diffHr < 24) return `${diffHr}H AGO`;
  if (diffDay === 1) return 'YESTERDAY';
  if (diffDay < 7) return `${diffDay} DAYS AGO`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
};

const isUnreadStyle = (n: Notification) => !n.read;

const getIconMeta = (type: NotificationType) => {
  switch (type) {
    case 'new_follower':
      return {
        kind: 'avatar' as const,
        Icon: Mail,
        bg: 'rgba(180, 25, 36, 0.08)',
        color: Palette.primary,
      };
    case 'event_reminder':
      return { kind: 'icon' as const, Icon: Clock3, bg: 'rgba(155, 62, 32, 0.12)', color: Palette.secondary };
    case 'event_update':
      return { kind: 'icon' as const, Icon: RefreshCcw, bg: Palette.readIconBg, color: Palette.subtle };
    case 'promotion':
      return { kind: 'icon' as const, Icon: BellRing, bg: 'rgba(180, 25, 36, 0.08)', color: Palette.primary };
    default:
      return { kind: 'icon' as const, Icon: Mail, bg: 'rgba(180, 25, 36, 0.08)', color: Palette.primary };
  }
};

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    if (!user?.id) return;
    const unsubscribe = subscribeToNotifications(user.id, {
      onInsert: (incoming) => {
        setNotifications((prev) => {
          if (prev.some((n) => n.id === incoming.id)) return prev;
          return [incoming, ...prev];
        });
      },
      onUpdate: (updated) => {
        setNotifications((prev) =>
          prev.map((n) => (n.id === updated.id ? updated : n))
        );
      },
      onDelete: (id) => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
      },
    });
    return unsubscribe;
  }, [user?.id]);

  const unreadCount = notifications.filter((n) => !n.read).length;

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
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    deleteNotification(id).catch(() => {});
  }, []);

  const handlePress = useCallback(
    (notification: Notification) => {
      if (!notification.read) markAsRead(notification.id);
      if (notification.eventId) {
        router.push(`/event/${notification.eventId}` as never);
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

  const handleInviteAccept = useCallback(
    (notification: Notification) => {
      markAsRead(notification.id);
      handlePress(notification);
    },
    [handlePress, markAsRead]
  );

  const handleInviteDecline = useCallback((notification: Notification) => {
    dismissNotification(notification.id);
  }, [dismissNotification]);

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
          paddingTop: insets.top + 18,
          paddingBottom: insets.bottom + 130,
          paddingHorizontal: 16,
        }}
      >
        <View style={styles.editorialHeader}>
          <View style={styles.brandRow}>
            <Image source={require('@/assets/images/EMlogo.png')} style={styles.brandLogo} />
            <Text style={styles.brandText}>EventMaps</Text>
          </View>
          <Text style={styles.editorialTitle}>Updates</Text>
          <Text style={styles.editorialSubtitle}>
            Stay in the loop with your latest event activity.
          </Text>
          {!loading && unreadCount > 0 ? (
            <TouchableOpacity style={styles.readAllChip} onPress={markAllRead} activeOpacity={0.8}>
              <Text style={styles.readAllChipText}>
                {unreadCount} unread • Mark all read
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.listWrap}>
          {loading ? (
            <NotificationSkeleton />
          ) : notifications.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>All caught up</Text>
              <Text style={styles.emptySub}>
                You have no notifications right now. We will let you know when something happens.
              </Text>
            </View>
          ) : (
            notifications.map((notification) => {
              const unread = isUnreadStyle(notification);
              const iconMeta = getIconMeta(notification.type);
              const isInvite = notification.type === 'rsvp' && unread;

              return (
                <TouchableOpacity
                  key={notification.id}
                  style={[styles.card, !unread && styles.cardRead]}
                  activeOpacity={0.86}
                  onPress={() => handlePress(notification)}
                >
                  <View style={styles.cardTopRow}>
                    <View style={styles.cardLeft}>
                      {iconMeta.kind === 'avatar' ? (
                        <View style={styles.avatarWrap}>
                          <Image source={{ uri: FALLBACK_FOLLOWER_IMAGE }} style={styles.avatarImage} />
                        </View>
                      ) : (
                        <View style={[styles.iconWrap, { backgroundColor: unread ? iconMeta.bg : Palette.readIconBg }]}>
                          <iconMeta.Icon
                            size={22}
                            color={unread ? iconMeta.color : Palette.subtle}
                          />
                        </View>
                      )}

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

                  {isInvite ? (
                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        style={styles.acceptButton}
                        activeOpacity={0.85}
                        onPress={() => handleInviteAccept(notification)}
                      >
                        <Text style={styles.acceptButtonText}>Accept</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.declineButton}
                        activeOpacity={0.85}
                        onPress={() => handleInviteDecline(notification)}
                      >
                        <Text style={styles.declineButtonText}>Decline</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.dismissButton}
                      onPress={() => dismissNotification(notification.id)}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    >
                      <ChevronRight size={16} color={Palette.subtle} />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              );
            })
          )}
        </View>

        <TouchableOpacity style={styles.historyButton} activeOpacity={0.84} onPress={markAllRead}>
          <Text style={styles.historyText}>View Past History</Text>
          <History size={17} color={Palette.text} />
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function NotificationSkeleton() {
  return (
    <View style={styles.skeletonWrap}>
      {[0, 1, 2].map((key) => (
        <View key={`skeleton-${key}`} style={styles.skeletonCard} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Palette.surface,
  },
  topBarWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 20,
  },
  brandText: {
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.2,
    fontFamily: Typography.displayFontFamilies.extrabold,
    fontWeight: '800',
    color: Palette.primary,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandLogo: {
    width: 30,
    height: 30,
    borderRadius: 8,
    tintColor: Colors.primary,
  },
  editorialHeader: {
    marginTop: 6,
    marginBottom: 20,
    gap: 8,
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
    backgroundColor: 'rgba(180,25,36,0.08)',
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
  avatarWrap: {
    width: 52,
    height: 52,
    borderRadius: BorderRadius.round,
    overflow: 'hidden',
    opacity: 0.84,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
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
    fontSize: 12,
    letterSpacing: 0.9,
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
    fontSize: 16,
    lineHeight: 31,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
  },
  bodyRead: {
    opacity: 0.88,
  },
  actionRow: {
    marginTop: 16,
    marginLeft: 64,
    flexDirection: 'row',
    gap: 10,
  },
  acceptButton: {
    borderRadius: BorderRadius.round,
    overflow: 'hidden',
    backgroundColor: Palette.primary,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  acceptButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  declineButton: {
    borderRadius: BorderRadius.round,
    backgroundColor: '#D9DCDD',
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  declineButtonText: {
    color: Palette.text,
    fontSize: 13,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  dismissButton: {
    alignSelf: 'flex-end',
    marginTop: 8,
    marginRight: 4,
  },
  emptyCard: {
    backgroundColor: Palette.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Palette.border,
    padding: 20,
  },
  emptyTitle: {
    fontSize: 20,
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
  historyButton: {
    marginTop: 26,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 26,
    paddingVertical: 14,
    backgroundColor: Palette.card,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: BorderRadius.round,
  },
  historyText: {
    color: Palette.text,
    fontSize: 15,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  skeletonWrap: {
    gap: 12,
  },
  skeletonCard: {
    height: 138,
    borderRadius: 24,
    backgroundColor: '#ECEEEF',
  },
});
