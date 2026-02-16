import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useApp } from '@/contexts/AppContext';
import { eventsService } from '@/services/events';
import { Event } from '@/types/database';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import {
  ArrowLeft,
  Calendar,
  Pencil,
  Trash2,
  PlusCircle,
  CalendarDays,
  Briefcase,
  ChevronRight,
  Clock,
  FileText,
} from 'lucide-react-native';

const Palette = {
  gradientStart: Colors.primary,
  gradientEnd: Colors.accent,
  cardBg: Colors.background.primary,
  surfaceMuted: Colors.background.primary,
  accentSoft: 'rgba(196, 92, 62, 0.12)',
  textOnGradient: Colors.text.inverse,
  textOnGradientMuted: 'rgba(250, 248, 245, 0.75)',
  separator: Colors.border.light,
  badge: Colors.primary,
  editSoft: 'rgba(196, 92, 62, 0.12)',
  deleteSoft: 'rgba(196, 92, 62, 0.12)',
  deleteColor: Colors.error,
};

const PAGE_SIZE = 30;

export default function MyEvents() {
  const insets = useSafeAreaInsets();
  const { hasBusiness, userBusiness } = useApp();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const loadInitial = useCallback(async () => {
    if (!userBusiness) {
      setEvents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await eventsService.getBusinessEvents(userBusiness.id, {
        limit: PAGE_SIZE,
        offset: 0,
      });
      setEvents(data);
      setOffset(data.length);
      setHasMore(data.length >= PAGE_SIZE);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [userBusiness?.id]);

  const loadMore = useCallback(async () => {
    if (!userBusiness || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const data = await eventsService.getBusinessEvents(userBusiness.id, {
        limit: PAGE_SIZE,
        offset,
      });
      setEvents((prev) => [...prev, ...data]);
      setOffset((o) => o + data.length);
      setHasMore(data.length >= PAGE_SIZE);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [userBusiness?.id, offset, loadingMore, hasMore]);

  const handleRefresh = useCallback(async () => {
    if (!userBusiness) return;
    setRefreshing(true);
    try {
      const data = await eventsService.getBusinessEvents(userBusiness.id, {
        limit: PAGE_SIZE,
        offset: 0,
      });
      setEvents(data);
      setOffset(data.length);
      setHasMore(data.length >= PAGE_SIZE);
    } catch {
      setEvents([]);
    } finally {
      setRefreshing(false);
    }
  }, [userBusiness?.id]);

  useFocusEffect(
    useCallback(() => {
      if (hasBusiness && userBusiness) {
        loadInitial();
      } else {
        setEvents([]);
        setLoading(false);
      }
    }, [hasBusiness, userBusiness?.id])
  );

  const handleDeleteEvent = useCallback((event: Event) => {
    Alert.alert(
      'Delete Event',
      `Delete "${event.title}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await eventsService.deleteEvent(event.id);
              setEvents((prev) => prev.filter((e) => e.id !== event.id));
            } catch {
              Alert.alert('Error', 'Failed to delete event');
            }
          },
        },
      ]
    );
  }, []);

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  const isUpcoming = (dateString: string) =>
    new Date(dateString).getTime() > Date.now();

  const renderItem = useCallback(
    ({ item }: { item: Event }) => {
      const upcoming = isUpcoming(item.start_datetime);

      return (
        <TouchableOpacity
          style={styles.eventCard}
          onPress={() => router.push(`/event/${item.id}` as never)}
          activeOpacity={0.8}
        >
          {/* Status strip */}
          <View
            style={[
              styles.statusStrip,
              { backgroundColor: upcoming ? Palette.badge : Colors.text.tertiary },
            ]}
          />

          <View style={styles.cardBody}>
            {/* Top row: title + status */}
            <View style={styles.cardTopRow}>
              <Text style={styles.eventTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <View
                style={[
                  styles.statusPill,
                  upcoming ? styles.statusPillUpcoming : styles.statusPillPast,
                ]}
              >
                <Text
                  style={[
                    styles.statusPillText,
                    upcoming
                      ? styles.statusPillTextUpcoming
                      : styles.statusPillTextPast,
                  ]}
                >
                  {upcoming ? 'Upcoming' : 'Past'}
                </Text>
              </View>
            </View>

            {/* Date */}
            <View style={styles.metaRow}>
              <View style={styles.metaIconWrap}>
                <Clock size={13} color={Palette.gradientStart} />
              </View>
              <Text style={styles.metaText}>
                {formatDate(item.start_datetime)}
              </Text>
            </View>

            {/* Actions */}
            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={styles.editBtn}
                onPress={() =>
                  router.push(`/business/edit-event/${item.id}` as never)
                }
                activeOpacity={0.7}
              >
                <Pencil size={14} color={Palette.gradientStart} />
                <Text style={styles.editBtnText}>Edit</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() => handleDeleteEvent(item)}
                activeOpacity={0.7}
              >
                <Trash2 size={14} color={Palette.deleteColor} />
                <Text style={styles.deleteBtnText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    [handleDeleteEvent]
  );

  const keyExtractor = useCallback((item: Event) => item.id, []);

  const ListHeader = useCallback(
    () =>
      hasBusiness ? (
        <TouchableOpacity
          style={styles.createCardWrap}
          onPress={() => router.push('/(tabs)/create' as never)}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={[Palette.gradientStart, Palette.gradientEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.createCardGradient}
          >
            <View style={styles.createCardIcon}>
              <PlusCircle size={20} color={Palette.gradientStart} />
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
      ) : null,
    [hasBusiness]
  );

  const ListEmpty = useCallback(
    () =>
      !loading && !refreshing ? (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconWrap}>
            <FileText size={36} color={Palette.gradientStart} />
          </View>
          <Text style={styles.emptyTitle}>No Events Yet</Text>
          <Text style={styles.emptySubtitle}>
            {hasBusiness
              ? 'Create your first event to start reaching\nyour local community.'
              : 'You need a business profile to create and manage events.'}
          </Text>
          {hasBusiness && (
            <TouchableOpacity
              style={styles.emptyCta}
              onPress={() => router.push('/(tabs)/create' as never)}
              activeOpacity={0.8}
            >
              <PlusCircle size={16} color={Palette.gradientStart} />
              <Text style={styles.emptyCtaText}>Create Event</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : null,
    [loading, refreshing, hasBusiness]
  );

  const ListFooter = useCallback(
    () =>
      loadingMore ? (
        <View style={styles.footerLoader}>
          <ActivityIndicator size="small" color={Palette.gradientStart} />
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
          >
            <ArrowLeft size={22} color={Colors.text.primary} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <View style={styles.headerIconWrap}>
              <CalendarDays size={18} color={Palette.gradientStart} />
            </View>
            <Text style={styles.headerTitle}>My Events</Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.noBizContainer}>
          <View style={styles.noBizIconWrap}>
            <Briefcase size={36} color={Palette.gradientStart} />
          </View>
          <Text style={styles.noBizTitle}>Business Required</Text>
          <Text style={styles.noBizSubtitle}>
            Create a business profile to start{'\n'}managing your events.
          </Text>
          <TouchableOpacity
            style={styles.noBizCta}
            onPress={() => router.push('/business/onboarding' as never)}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={[Palette.gradientStart, Palette.gradientEnd]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.noBizCtaGradient}
            >
              <Text style={styles.noBizCtaText}>Create Business</Text>
              <ChevronRight size={18} color="#fff" />
            </LinearGradient>
          </TouchableOpacity>
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
        >
          <ArrowLeft size={22} color={Colors.text.primary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerIconWrap}>
            <CalendarDays size={18} color={Palette.gradientStart} />
          </View>
          <View>
            <Text style={styles.headerTitle}>My Events</Text>
            <Text style={styles.headerSubtitle}>
              {loading
                ? 'Loading…'
                : `${events.length}${hasMore ? '+' : ''} event${events.length !== 1 ? 's' : ''}`}
            </Text>
          </View>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.noBizContainer}>
          <View style={styles.loadingIconWrap}>
            <CalendarDays size={28} color={Palette.gradientStart} />
          </View>
          <ActivityIndicator
            size="large"
            color={Palette.gradientStart}
            style={{ marginTop: 20 }}
          />
          <Text style={styles.loadingText}>Loading your events…</Text>
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
              colors={[Palette.gradientStart]}
              tintColor={Palette.gradientStart}
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
    backgroundColor: Palette.surfaceMuted,
  },

  /* ── Header ── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: Palette.cardBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Palette.separator,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Palette.surfaceMuted,
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
    backgroundColor: Palette.accentSoft,
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

  /* ── Loading ── */
  loadingIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.secondary,
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
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: 20,
    ...Platform.select({
      ios: {
        shadowColor: Palette.gradientStart,
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
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
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
    color: Palette.textOnGradient,
  },
  createCardSubtitle: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Palette.textOnGradientMuted,
    marginTop: 2,
  },

  /* ── Event card ── */
  eventCard: {
    flexDirection: 'row',
    backgroundColor: Palette.cardBg,
    borderRadius: 18,
    marginBottom: 12,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
      },
      android: { elevation: 3 },
    }),
  },
  statusStrip: {
    width: 4,
    borderTopLeftRadius: 18,
    borderBottomLeftRadius: 18,
  },
  cardBody: {
    flex: 1,
    padding: 16,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  eventTitle: {
    flex: 1,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
    lineHeight: 22,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusPillUpcoming: {
    backgroundColor: Palette.accentSoft,
  },
  statusPillPast: {
    backgroundColor: Palette.surfaceMuted,
  },
  statusPillText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  statusPillTextUpcoming: {
    color: Palette.gradientStart,
  },
  statusPillTextPast: {
    color: Colors.text.tertiary,
  },

  /* ── Meta ── */
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  metaIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: Palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaText: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.secondary,
  },

  /* ── Action buttons ── */
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Palette.separator,
  },
  editBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Palette.editSoft,
  },
  editBtnText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Palette.gradientStart,
  },
  deleteBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Palette.deleteSoft,
  },
  deleteBtnText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Palette.deleteColor,
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
    borderRadius: 24,
    backgroundColor: Palette.accentSoft,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: Palette.accentSoft,
  },
  emptyCtaText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Palette.gradientStart,
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
    borderRadius: 24,
    backgroundColor: Palette.accentSoft,
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
  noBizCta: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  noBizCtaGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    paddingHorizontal: 32,
  },
  noBizCtaText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: '#FFFFFF',
  },
});