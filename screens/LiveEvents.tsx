import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, Clock, Flame } from '@/components/icons.generated';
import { EventListItem } from '@/components/EventListItem';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { FreshnessNote, OfflineState } from '@/components/ui/QueryStates';
import { useAuth } from '@/contexts/AuthContext';
import { useBrowseCenter } from '@/hooks/useBrowseCenter';
import { useRefetchOnFocus } from '@/hooks/useRefetchOnFocus';
import { useScreenState } from '@/hooks/useScreenState';
import { liveEventsService, type LiveEvent } from '@/services/liveEvents';
import { Colors, Spacing, Typography } from '@/constants/theme';
import { formatDistance } from '@/utils/formatEventWhen';
import { minutesLabel, rebucket } from '@/utils/liveEvents';

/** How often the list re-asks the server and the countdowns re-render. */
const REFRESH_MS = 60_000;
/** The "starting soon" block stays small by design (owner decision). */
const SOON_SHOWN = 6;

export default function LiveEvents() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const center = useBrowseCenter();
  // One sprinkle seed per visit: the list varies between visits but a refresh
  // or refetch does not reshuffle it under the reader.
  const seedRef = useRef(Math.random().toString(36).slice(2));
  const [now, setNow] = useState(() => new Date());

  const query = useQuery({
    queryKey: ['events', 'live', center ? `${center.lat.toFixed(3)},${center.lng.toFixed(3)}` : 'none'],
    enabled: !!center,
    staleTime: 30_000,
    refetchInterval: REFRESH_MS,
    queryFn: () =>
      liveEventsService.getLiveEvents(center!.lat, center!.lng, {
        preferredCategories: profile?.preferred_categories?.length ? profile.preferred_categories : undefined,
        seed: seedRef.current,
      }),
  });
  useRefetchOnFocus(query.refetch, !!center);

  // Countdowns tick with the refetch cadence even when the data is unchanged.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  // Re-bucketed against the ticking clock, not just the last fetch: ended
  // sessions drop out and started "soon" rows move up between refreshes.
  const { live, soon } = useMemo(() => rebucket(query.data?.items ?? [], now), [query.data, now]);
  const sections = useMemo(
    () => [
      ...(live.length ? [{ key: 'live', title: 'Happening now', data: live }] : []),
      ...(soon.length ? [{ key: 'soon', title: 'Starting soon', data: soon.slice(0, SOON_SHOWN) }] : []),
    ],
    [live, soon]
  );
  // The pull-to-refresh spinner only for a pull, not the minute timer.
  const [pulling, setPulling] = useState(false);
  const onPull = useCallback(async () => {
    setPulling(true);
    try {
      await query.refetch();
    } finally {
      setPulling(false);
      setNow(new Date());
    }
  }, [query]);

  const { state, freshness } = useScreenState(query, {
    hasData: query.data !== undefined,
    isEmpty: sections.length === 0,
  });

  const renderItem = useCallback(
    ({ item }: { item: LiveEvent }) => {
      const live = item.live_status === 'live' || new Date(item.occ_start).getTime() <= now.getTime();
      const meta = [
        [formatDistance(item.distance_km), item.rsvp_count > 0 ? `${item.rsvp_count} going` : null]
          .filter(Boolean)
          .join(' · '),
      ].filter((s) => s.length > 0);
      const timeLine =
        (live ? minutesLabel('Ends', item.occ_end, now) : minutesLabel('Starts', item.occ_start, now)) ??
        (live ? 'Happening now' : 'Starting soon');
      return (
        <EventListItem
          title={item.title}
          subtitle={item.business_name}
          dateLine={timeLine}
          dateIcon={<Clock size={14} color={live ? Colors.successText : Colors.text.tertiary} />}
          thumbnailUrl={item.cover_image_url}
          badge={live ? { label: 'Live', tone: 'success' } : { label: 'Soon', tone: 'primary' }}
          metaLines={meta}
          onPress={() => router.push(`/event/${item.id}` as never)}
          // Every visible word, in visible order (WCAG 2.5.3 label-in-name):
          // a voice-control user says what they see.
          accessibilityLabel={[item.title, live ? 'Live' : 'Soon', item.business_name, timeLine, ...meta].join(', ')}
          testID={`live-row-${item.id}`}
        />
      );
    },
    [now]
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/discover' as never))}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ArrowLeft size={22} color={Colors.text.primary} />
        </TouchableOpacity>
        <Flame size={18} color={Colors.error} />
        <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
          Live near you
        </Text>
      </View>
      {freshness ? <FreshnessNote text={freshness} /> : null}
      {center && !center.precise ? (
        <Text style={styles.approxNote} accessibilityRole="text">
          {"Showing events around your area. Allow location access for what's right around you."}
        </Text>
      ) : null}

      {!center ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No location yet</Text>
          <Text style={styles.emptyText}>Open Discover once so we know where to look, or allow location access.</Text>
          <Button label="Open Discover" onPress={() => router.replace('/(tabs)/discover' as never)} />
        </View>
      ) : state === 'error' ? (
        <ErrorState message="Couldn't load what's on right now." onRetry={() => query.refetch()} />
      ) : state === 'offline' ? (
        <OfflineState onRetry={() => query.refetch()} />
      ) : state === 'empty' ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nothing on right now</Text>
          <Text style={styles.emptyText}>
            Nothing nearby is live or starting within the hour. Discover shows everything coming up.
          </Text>
          <Button label="Browse upcoming events" onPress={() => router.replace('/(tabs)/discover' as never)} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => `${item.id}-${item.occ_start}`}
          renderItem={renderItem}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionTitle} accessibilityRole="header">
              {section.title}
            </Text>
          )}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} />}
          ListHeaderComponent={
            live.length === 0 ? (
              <Text style={styles.nothingLive}>Nothing is live nearby right now. These start within the hour.</Text>
            ) : null
          }
          stickySectionHeadersEnabled={false}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: 16,
    paddingVertical: Spacing.md,
  },
  // 44 × 44 touch target around the 22 px icon.
  backBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -Spacing.sm },
  title: {
    flexShrink: 1,
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  sectionTitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  // Same gutters and gaps as Joined / Saved (16 px sides, 10 px between).
  listContent: { paddingHorizontal: 16, paddingBottom: Spacing.xl },
  approxNote: {
    fontSize: Typography.sizes.xs,
    color: Colors.text.secondary,
    paddingHorizontal: 16,
    paddingBottom: Spacing.xs,
  },
  nothingLive: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
    paddingTop: Spacing.md,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  emptyTitle: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  emptyText: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
    textAlign: 'center',
  },
});
