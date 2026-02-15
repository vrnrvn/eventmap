import { useState, useEffect, useCallback } from 'react';
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
import { router } from 'expo-router';
import { socialService } from '@/services/social';
import { RankedEvent } from '@/types/database';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Bookmark,
  BookmarkX,
  ChevronRight,
  Users,
  Navigation,
} from 'lucide-react-native';

const Palette = {
  gradientStart: '#6366F1',
  gradientEnd: '#8B5CF6',
  cardBg: '#FFFFFF',
  surfaceMuted: '#F8F9FC',
  accentSoft: 'rgba(99,102,241,0.08)',
  accentMedium: 'rgba(99,102,241,0.14)',
  separator: '#F0F0F5',
  badge: '#6366F1',
};

export default function SavedEvents() {
  const insets = useSafeAreaInsets();
  const [events, setEvents] = useState<RankedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadSavedEvents();
  }, []);

  const loadSavedEvents = async () => {
    try {
      const list = await socialService.getUserSavedEventsWithDetails();
      setEvents(list);
    } catch (error) {
      console.error('Failed to load saved events:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadSavedEvents().finally(() => setRefreshing(false));
  }, []);

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

      {/* ── Loading ── */}
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
          {events.length === 0 ? (
            /* ── Empty state ── */
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconWrap}>
                <BookmarkX size={36} color={Palette.gradientStart} />
              </View>
              <Text style={styles.emptyTitle}>No Saved Events</Text>
              <Text style={styles.emptySubtitle}>
                Events you bookmark will appear here.{'\n'}Start exploring to
                find something you love!
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
            /* ── Event list ── */
            events.map((event, index) => (
              <TouchableOpacity
                key={event.id}
                style={styles.eventCard}
                onPress={() => router.push(`/event/${event.id}` as never)}
                activeOpacity={0.8}
              >
                {/* Saved indicator */}
                <View style={styles.savedStrip} />

                <View style={styles.cardBody}>
                  {/* Title row */}
                  <View style={styles.titleRow}>
                    <Text style={styles.eventTitle} numberOfLines={2}>
                      {event.title}
                    </Text>
                    <View style={styles.bookmarkBadge}>
                      <Bookmark size={14} color={Palette.gradientStart} />
                    </View>
                  </View>

                  {/* Meta */}
                  <View style={styles.eventMeta}>
                    <View style={styles.metaRow}>
                      <View style={styles.metaIconWrap}>
                        <Calendar size={13} color={Palette.gradientStart} />
                      </View>
                      <Text style={styles.metaText}>
                        {formatDate(event.start_datetime)}
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

                    {event.rsvp_count > 0 && (
                      <View style={styles.metaRow}>
                        <View style={styles.metaIconWrap}>
                          <Users size={13} color={Palette.gradientStart} />
                        </View>
                        <Text style={styles.metaText}>
                          {event.rsvp_count}{' '}
                          {event.rsvp_count === 1 ? 'person' : 'people'} going
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Footer */}
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
            ))
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