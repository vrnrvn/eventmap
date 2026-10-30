import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { socialService } from '@/services/social';
import { confirmAction } from '@/utils/confirm';
import { RankedEvent } from '@/types/database';
import { Colors, Typography } from '@/constants/theme';
import {
  ArrowLeft,
  Calendar,
  Bookmark,
  BookmarkX,
  ChevronRight,
  Users,
  Navigation,
  Repeat,
} from 'lucide-react-native';

const Palette = {
  gradientStart: Colors.primary,
  gradientEnd: Colors.accent,
  cardBg: Colors.background.primary,
  surfaceMuted: Colors.background.primary,
  accentSoft: 'rgba(196, 92, 62, 0.12)',
  separator: Colors.border.light,
  badge: Colors.primary,
};

export default function SavedEvents() {
  const insets = useSafeAreaInsets();
  const [events, setEvents] = useState<RankedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSavedEvents = useCallback(async () => {
    try {
      const list = await socialService.getUserSavedEventsWithDetails();
      setEvents(list);
      setError(null);
    } catch {
      setError('Could not load saved events. Pull to retry.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Saves are toggled from event pages; refresh whenever we come back here.
  useFocusEffect(
    useCallback(() => {
      void loadSavedEvents();
    }, [loadSavedEvents])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadSavedEvents().finally(() => setRefreshing(false));
  }, [loadSavedEvents]);

  const handleUnsave = useCallback(async (event: RankedEvent) => {
    const ok = await confirmAction({
      title: 'Remove saved event',
      message: `Remove "${event.title}" from your saved events?`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    const previous = events;
    setEvents((prev) => prev.filter((e) => e.id !== event.id));
    try {
      await socialService.unsaveEvent(event.id);
    } catch {
      setEvents(previous);
      Alert.alert('Error', 'Failed to remove saved event');
    }
  }, [events]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const upcoming = events.filter((e) => !e.has_ended);
  const past = events.filter((e) => e.has_ended);

  const renderCard = (event: RankedEvent) => {
    const ended = !!event.has_ended;
    const when = ended ? event.start_datetime : event.next_start_datetime || event.start_datetime;
    return (
      <TouchableOpacity
        key={event.id}
        style={[styles.eventCard, ended && styles.eventCardPast]}
        onPress={() => router.push(`/event/${event.id}` as never)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`${event.title}, ${formatDate(when)}${ended ? ', ended' : ''}`}
      >
        <View style={[styles.savedStrip, ended && styles.savedStripPast]} />

        <View style={styles.cardBody}>
          <View style={styles.titleRow}>
            <Text style={styles.eventTitle} numberOfLines={2}>
              {event.title}
            </Text>
            <TouchableOpacity
              style={styles.bookmarkBadge}
              onPress={() => handleUnsave(event)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Remove from saved events"
            >
              <Bookmark size={14} color={Palette.gradientStart} fill={Palette.gradientStart} />
            </TouchableOpacity>
          </View>

          <View style={styles.eventMeta}>
            <View style={styles.metaRow}>
              <View style={styles.metaIconWrap}>
                {event.is_recurring ? (
                  <Repeat size={13} color={Palette.gradientStart} />
                ) : (
                  <Calendar size={13} color={Palette.gradientStart} />
                )}
              </View>
              <Text style={styles.metaText}>
                {formatDate(when)}
                {ended ? ' · Ended' : event.is_recurring ? ' · repeats' : ''}
              </Text>
            </View>

            {event.distance_km > 0 && (
              <View style={styles.metaRow}>
                <View style={styles.metaIconWrap}>
                  <Navigation size={13} color={Palette.gradientStart} />
                </View>
                <Text style={styles.metaText}>
                  {event.distance_km < 1
                    ? `${(event.distance_km * 1000).toFixed(0)} m away`
                    : `${event.distance_km.toFixed(1)} km away`}
                </Text>
              </View>
            )}

            {event.rsvp_count > 0 && !ended && (
              <View style={styles.metaRow}>
                <View style={styles.metaIconWrap}>
                  <Users size={13} color={Palette.gradientStart} />
                </View>
                <Text style={styles.metaText}>
                  {event.rsvp_count} {event.rsvp_count === 1 ? 'person' : 'people'} going
                </Text>
              </View>
            )}
          </View>

          <View style={styles.cardFooter}>
            <Text style={styles.businessName} numberOfLines={1}>
              {event.business_name}
            </Text>
            <View style={styles.viewPill}>
              <Text style={styles.viewPillText}>View</Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

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
        >
          <ArrowLeft size={22} color={Colors.text.primary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerIconWrap}>
            <Bookmark size={18} color={Palette.gradientStart} />
          </View>
          <View>
            <Text style={styles.headerTitle}>Saved Events</Text>
            <Text style={styles.headerSubtitle}>
              {loading
                ? 'Loading…'
                : `${events.length} saved event${events.length !== 1 ? 's' : ''}`}
            </Text>
          </View>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <View style={styles.loadingIconWrap}>
            <Bookmark size={28} color={Palette.gradientStart} />
          </View>
          <ActivityIndicator
            size="large"
            color={Palette.gradientStart}
            style={{ marginTop: 20 }}
          />
          <Text style={styles.loadingText}>Loading your saved events…</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            events.length === 0 && styles.scrollContentEmpty,
            { paddingBottom: insets.bottom + 40 },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Palette.gradientStart}
              colors={[Palette.gradientStart]}
            />
          }
        >
          {error ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : events.length === 0 ? (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconWrap}>
                <BookmarkX size={36} color={Palette.gradientStart} />
              </View>
              <Text style={styles.emptyTitle}>No Saved Events</Text>
              <Text style={styles.emptySubtitle}>
                Tap the bookmark on any event to keep it here for later.
              </Text>
              <TouchableOpacity
                style={styles.exploreCta}
                onPress={() => router.push('/(tabs)/discover' as never)}
                activeOpacity={0.8}
              >
                <Text style={styles.exploreCtaText}>Explore Events</Text>
                <ChevronRight size={16} color={Palette.gradientStart} />
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {upcoming.map(renderCard)}
              {past.length > 0 ? (
                <>
                  <Text style={styles.groupLabel}>
                    {upcoming.length > 0 ? 'Already happened' : 'All of these have ended'}
                  </Text>
                  {past.map(renderCard)}
                </>
              ) : null}
            </>
          )}
        </ScrollView>
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
  eventCardPast: {
    opacity: 0.72,
  },
  savedStripPast: {
    backgroundColor: Colors.text.tertiary,
  },
  errorText: {
    fontSize: Typography.sizes.sm,
    color: Colors.error,
    textAlign: 'center',
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
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
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
  exploreCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: Palette.accentSoft,
  },
  exploreCtaText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Palette.gradientStart,
  },

  /* ── Event card ── */
  eventCard: {
    flexDirection: 'row',
    backgroundColor: Palette.cardBg,
    borderRadius: 20,
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
  savedStrip: {
    width: 4,
    backgroundColor: Palette.badge,
    borderTopLeftRadius: 20,
    borderBottomLeftRadius: 20,
  },
  cardBody: {
    flex: 1,
    padding: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  eventTitle: {
    flex: 1,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
    lineHeight: 22,
  },
  bookmarkBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: Palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Meta ── */
  eventMeta: {
    gap: 6,
    marginBottom: 12,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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

  /* ── Footer ── */
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Palette.separator,
  },
  businessName: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.tertiary,
  },
  viewPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: Palette.accentSoft,
  },
  viewPillText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Palette.gradientStart,
  },
});