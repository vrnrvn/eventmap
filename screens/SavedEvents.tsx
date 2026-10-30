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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { socialService } from '@/services/social';
import { confirmAction } from '@/utils/confirm';
import { notify } from '@/utils/notify';
import { Button } from '@/components/ui/Button';
import { EventListItem, formatEventDate } from '@/components/EventListItem';
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
      notify.error('Failed to remove saved event');
    }
  }, [events]);

  const upcoming = events.filter((e) => !e.has_ended);
  const past = events.filter((e) => e.has_ended);

  const renderCard = (event: RankedEvent) => {
    const ended = !!event.has_ended;
    const when = ended ? event.start_datetime : event.next_start_datetime || event.start_datetime;
    const metaLines: string[] = [];
    if (event.distance_km > 0) {
      metaLines.push(`${(event.distance_km * 0.621371).toFixed(1)} mi away`);
    }
    if (event.rsvp_count > 0 && !ended) {
      metaLines.push(
        `${event.rsvp_count} ${event.rsvp_count === 1 ? 'person' : 'people'} going`
      );
    }
    return (
      <View key={event.id} style={styles.cardSpacing}>
        <EventListItem
          title={event.title}
          subtitle={event.business_name}
          dateLine={`${formatEventDate(when)}${event.is_recurring && !ended ? ' · repeats' : ''}`}
          thumbnailUrl={event.cover_image_url}
          dimmed={ended}
          badge={ended ? { label: 'Ended', tone: 'neutral' } : null}
          dateIcon={
            event.is_recurring ? <Repeat size={12} color={Colors.text.tertiary} /> : undefined
          }
          metaLines={metaLines}
          rightAccessory={
            <TouchableOpacity
              style={styles.bookmarkBadge}
              onPress={() => handleUnsave(event)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Remove from saved events"
            >
              <Bookmark size={14} color={Colors.primary} fill={Colors.primary} />
            </TouchableOpacity>
          }
          onPress={() => router.push(`/event/${event.id}` as never)}
          accessibilityLabel={`${event.title}, ${formatEventDate(when)}${ended ? ', ended' : ''}`}
        />
      </View>
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
            <Bookmark size={18} color={Colors.primary} />
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
            <Bookmark size={28} color={Colors.primary} />
          </View>
          <ActivityIndicator
            size="large"
            color={Colors.primary}
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
              tintColor={Colors.primary}
              colors={[Colors.primary]}
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
    backgroundColor: Colors.background.primary,
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
    backgroundColor: Colors.primarySoft,
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