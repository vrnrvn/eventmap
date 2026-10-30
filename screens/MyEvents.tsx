import { useState, useCallback } from 'react';
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
import { confirmAction } from '@/utils/confirm';
import { notify } from '@/utils/notify';
import { Button } from '@/components/ui/Button';
import { EventListItem, formatEventDate } from '@/components/EventListItem';
import { Event } from '@/types/database';
import { alpha, Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import {
  ArrowLeft,
  BarChart3,
  Calendar,
  Megaphone,
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
  accentSoft: Colors.primarySoft,
  textOnGradient: Colors.text.inverse,
  textOnGradientMuted: alpha(Colors.surface, 0.75),
  separator: Colors.border.light,
  badge: Colors.primary,
  editSoft: Colors.primarySoft,
  deleteSoft: Colors.errorSoft,
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
        await loadInitial();
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
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      // RPC ships with migration 20261030112000; tolerate it being unapplied.
      if (code === '42883' || code === 'PGRST202') {
        notify.error('Not enabled on this server yet.');
      } else {
        notify.error('Failed to notify followers');
      }
    }
  }, []);

  const isUpcoming = (dateString: string) =>
    new Date(dateString).getTime() > Date.now();

  const renderItem = useCallback(
    ({ item }: { item: Event }) => {
      const upcoming = isUpcoming(item.start_datetime);
      // Tolerant check: events.status only exists once 20261030106000 is
      // applied (rows arrive via select('*')); absent field = active.
      const cancelled =
        (item as Event & { status?: string }).status === 'cancelled';

      return (
        <View style={styles.cardSpacing}>
          <EventListItem
            title={item.title}
            dateLine={formatEventDate(item.start_datetime)}
            thumbnailUrl={(item as Event & { cover_image_url?: string | null }).cover_image_url}
            dimmed={cancelled || !upcoming}
            badge={
              cancelled
                ? { label: 'Cancelled', tone: 'danger' }
                : upcoming
                  ? { label: 'Upcoming', tone: 'primary' }
                  : { label: 'Past', tone: 'neutral' }
            }
            dateIcon={<Clock size={12} color={Colors.text.tertiary} />}
            onPress={() => router.push(`/event/${item.id}` as never)}
            actions={
              <>
                <TouchableOpacity
                  style={styles.editBtn}
                  onPress={() =>
                    router.push(`/business/edit-event/${item.id}` as never)
                  }
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${item.title}`}
                >
                  <Pencil size={14} color={Palette.gradientStart} />
                  <Text style={styles.editBtnText}>Edit</Text>
                </TouchableOpacity>

                {!cancelled && (
                  <TouchableOpacity
                    style={styles.iconActionBtn}
                    onPress={() => handleNotifyFollowers(item)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Notify followers about ${item.title}`}
                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  >
                    <Megaphone size={14} color={Palette.gradientStart} />
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
                  <BarChart3 size={14} color={Palette.gradientStart} />
                </TouchableOpacity>

                {!cancelled && (
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => handleCancelEvent(item)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Cancel ${item.title}`}
                  >
                    <Trash2 size={14} color={Palette.deleteColor} />
                    <Text style={styles.deleteBtnText}>Cancel</Text>
                  </TouchableOpacity>
                )}
              </>
            }
          />
        </View>
      );
    },
    [handleCancelEvent, handleNotifyFollowers]
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
            <Button
              label="Create Event"
              onPress={() => router.push('/(tabs)/create' as never)}
              variant="ghost"
              icon={<PlusCircle size={16} color={Palette.gradientStart} />}
              style={styles.emptyCta}
            />
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
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
          <Button
            label="Create Business"
            onPress={() => router.push('/business/onboarding' as never)}
            size="lg"
            gradient
            icon={<ChevronRight size={18} color="#fff" />}
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
    borderRadius: 12,
    backgroundColor: Palette.editSoft,
  },
  editBtnText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Palette.gradientStart,
  },
  iconActionBtn: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Palette.editSoft,
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
    backgroundColor: Palette.accentSoft,
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