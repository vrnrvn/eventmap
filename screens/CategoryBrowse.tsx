/**
 * Category browse screen — `/category/[slug]` (docs/CATEGORIES_AND_SERIES_PLAN.md
 * §3.3). List-first: a coloured hero (icon, label, description), date preset
 * chips, then the category's events near the viewer from get_ranked_events
 * with `category_ids = [id]`. "Show on map" hands off to Discover with the
 * category selected.
 *
 * Reached from the category pill on Event Detail, the search overlay's
 * category suggestions, Discover's empty state, and shared links
 * (eventmap://category/live-music, https://…/category/live-music).
 */
import { cadenceLabel } from '@/utils/recurrence';
import { PERSISTED_QUERY } from '@/utils/queryPersistence';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Clipboard from 'expo-clipboard';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useCategories } from '@/hooks/useCategories';
import { queryKeys } from '@/hooks/queryKeys';
import { useScreenState } from '@/hooks/useScreenState';
import { eventsService } from '@/services/events';
import { CategoryIcon } from '@/components/CategoryIcon';
import { EventListItem } from '@/components/EventListItem';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ErrorState } from '@/components/ui/ErrorState';
import { FreshnessNote, OfflineState } from '@/components/ui/QueryStates';
import { Button } from '@/components/ui/Button';
import { MapPin, Share2 } from '@/components/icons.generated';
import { findCategoryBySlug, getCategoryWebUrl } from '@/utils/categoryBrowse';
import { categoryTint, presentCategory } from '@/utils/categoryPresentation';
import { DATE_PRESETS, type DatePresetKey } from '@/utils/datePresets';
import { filterEventsByDateRange } from '@/utils/recurrence';
import { formatDistance } from '@/utils/formatEventWhen';
import { describeEventDateTime } from '@/utils/timezone';
import { shareEventLink } from '@/utils/eventShare';
import { a11yState } from '@/utils/accessibility';
import { notify } from '@/utils/notify';
import { BorderRadius, Colors, Spacing, Typography } from '@/constants/theme';
import type { RankedEvent } from '@/types/database';

const PAGE_SIZE = 30;
const DEFAULT_RADIUS_KM = 25;
const WIDE_RADIUS_KM = 100;
/** Same fallback centre as Discover when no location is known. */
const DEFAULT_CENTER = { lat: 37.7749, lng: -122.4194 };
/** Presets offered here ('custom' needs the search overlay's picker). */
const PRESET_KEYS: DatePresetKey[] = ['any', 'today', 'tomorrow', 'weekend', 'week', 'month'];

type Center = { lat: number; lng: number; precise: boolean };

/**
 * Where to look: the profile's home area, else the device's last known fix
 * (only if permission was already granted — this screen never prompts), else
 * Discover's default centre.
 */
function useBrowseCenter(): Center | null {
  const { profile } = useAuth();
  const [center, setCenter] = useState<Center | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.granted) {
          const last = await Location.getLastKnownPositionAsync();
          if (last && !cancelled) {
            setCenter({ lat: last.coords.latitude, lng: last.coords.longitude, precise: true });
            return;
          }
        }
      } catch {
        // Fall through to the profile area / default.
      }
      if (cancelled) return;
      if (profile?.lat != null && profile?.lng != null) {
        setCenter({ lat: profile.lat, lng: profile.lng, precise: false });
      } else {
        setCenter({ ...DEFAULT_CENTER, precise: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile?.lat, profile?.lng]);
  return center;
}

const BrowseRow = memo(function BrowseRow({ event }: { event: RankedEvent }) {
  const when = event.next_start_datetime || event.start_datetime;
  const display = describeEventDateTime(when, event.timezone);
  const meta: string[] = [];
  if (display.secondary) meta.push(display.secondary);
  if (event.distance_km > 0) meta.push(`${formatDistance(event.distance_km)} away`);
  if (event.rsvp_count > 0) meta.push(`${event.rsvp_count} going`);
  return (
    <View style={styles.rowSpacing}>
      <EventListItem
        title={event.title}
        subtitle={event.business_name}
        dateLine={`${display.primary}${event.is_recurring ? ` · ${cadenceLabel(event.recurrence_pattern).toLowerCase() || 'repeats'}` : ''}`}
        thumbnailUrl={event.cover_image_url}
        metaLines={meta}
        badge={event.user_rsvp === 'going' ? { label: 'Going', tone: 'success' } : null}
        onPress={() => router.push(`/event/${event.id}` as never)}
        accessibilityLabel={`${event.title}, ${display.primary}${event.business_name ? `, ${event.business_name}` : ''}`}
      />
    </View>
  );
});

export default function CategoryBrowseScreen() {
  const insets = useSafeAreaInsets();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { profile } = useAuth();
  const { allCategories, isPending: categoriesPending, isError: categoriesError, refetch: refetchCategories } =
    useCategories();
  const category = useMemo(() => findCategoryBySlug(allCategories, slug), [allCategories, slug]);
  const presentation = presentCategory(category ?? slug ?? null);
  const center = useBrowseCenter();
  const [preset, setPreset] = useState<DatePresetKey>('any');
  const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS_KM);
  const [pulling, setPulling] = useState(false);

  const range = useMemo(() => DATE_PRESETS.find((p) => p.key === preset)?.build() ?? null, [preset]);

  const query = useInfiniteQuery({
    queryKey: queryKeys.categoryBrowse(category?.id ?? 'none', center?.lat ?? 0, center?.lng ?? 0, preset, radiusKm),
    enabled: !!category && !!center,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      eventsService.getRankedEventsPage(
        center!.lat,
        center!.lng,
        {
          categories: [category!.id],
          radiusKm,
          startDate: range?.start ?? null,
          endDate: range?.end ?? null,
          preferredCategories: profile?.preferred_categories ?? undefined,
        },
        { limit: PAGE_SIZE, offset: pageParam }
      ),
    getNextPageParam: (last, all) =>
      last.hasMore ? all.reduce((n, p) => n + p.items.length, 0) : undefined,
    staleTime: 60 * 1000,
    // G5: the default view (any time, default radius) is kept on the device
    // so a category opens offline like Discover's last area does.
    ...(preset === 'any' && radiusKm === DEFAULT_RADIUS_KM ? PERSISTED_QUERY : {}),
  });

  const events = useMemo(() => {
    const seen = new Set<string>();
    const flat = (query.data?.pages ?? []).flatMap((p) => p.items).filter((e) =>
      seen.has(e.id) ? false : (seen.add(e.id), true)
    );
    // Recurring series overlap the window server-side; keep only those with
    // an occurrence inside it (same as Discover).
    return range ? filterEventsByDateRange(flat, range.start, range.end) : flat;
  }, [query.data, range]);

  const { state, freshness } = useScreenState(query, {
    hasData: query.data !== undefined,
    isEmpty: events.length === 0,
  });

  const onRefresh = useCallback(async () => {
    setPulling(true);
    try {
      await query.refetch();
    } finally {
      setPulling(false);
    }
  }, [query]);

  const showOnMap = useCallback(() => {
    if (!category) return;
    router.navigate({ pathname: '/(tabs)/discover', params: { category: category.slug } } as never);
  }, [category]);

  const share = useCallback(async () => {
    if (!category) return;
    try {
      const outcome = await shareEventLink({
        title: presentation.label,
        url: getCategoryWebUrl(category.slug),
        copyToClipboard: (text) => Clipboard.setStringAsync(text).then(() => {}),
      });
      if (outcome === 'copied') notify.success('Link copied to clipboard.');
    } catch {
      notify.error("Couldn't share this link.");
    }
  }, [category, presentation.label]);

  const header = (
    <View>
      <View style={[styles.hero, { backgroundColor: categoryTint(presentation.color, 0.1) }]}>
        <CategoryIcon category={category ?? presentation.label} size="lg" />
        <View style={styles.heroText}>
          <Text style={styles.heroTitle} accessibilityRole="header">
            {presentation.label}
          </Text>
          {presentation.description ? (
            <Text style={styles.heroDescription}>{presentation.description}</Text>
          ) : null}
          <Text style={styles.heroMeta}>
            {center?.precise ? 'Near you' : 'Near your area'} · within {radiusKm} km
          </Text>
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.presetRow}
        accessibilityLabel="When"
      >
        {PRESET_KEYS.map((key) => {
          const p = DATE_PRESETS.find((d) => d.key === key)!;
          const selected = preset === key;
          return (
            <TouchableOpacity
              key={key}
              style={[
                styles.presetChip,
                selected && { backgroundColor: presentation.color, borderColor: presentation.color },
              ]}
              onPress={() => setPreset(key)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={p.label}
              {...a11yState({ selected }, 'button')}
              hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
            >
              <Text style={[styles.presetText, selected && styles.presetTextSelected]}>{p.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <FreshnessNote text={freshness} />
    </View>
  );

  const empty = (() => {
    if (state === 'loading' || !center) {
      return (
        <View style={styles.centerBox} accessibilityLabel="Loading events" {...a11yState({ busy: true })}>
          <ActivityIndicator color={presentation.color} />
        </View>
      );
    }
    if (state === 'offline') return <OfflineState onRetry={() => void query.refetch()} />;
    if (state === 'error') return <ErrorState onRetry={() => void query.refetch()} />;
    const wider = radiusKm < WIDE_RADIUS_KM;
    const later = preset !== 'any' && preset !== 'month';
    return (
      <View style={styles.centerBox}>
        <Text style={styles.emptyTitle}>
          No {presentation.label.toLowerCase()} events {preset === 'any' ? 'nearby' : 'for these dates'}
        </Text>
        <Text style={styles.emptyText}>
          {wider || later ? 'Try a wider search:' : 'Check back soon, or browse another category.'}
        </Text>
        <View style={styles.emptyActions}>
          {later ? (
            <Button label="Next 30 days" variant="secondary" onPress={() => setPreset('month')} />
          ) : null}
          {wider ? (
            <Button label={`Within ${WIDE_RADIUS_KM} km`} variant="secondary" onPress={() => setRadiusKm(WIDE_RADIUS_KM)} />
          ) : null}
        </View>
      </View>
    );
  })();

  // Unknown slug (after categories loaded) or categories unavailable.
  if (!category) {
    const loadingCats = categoriesPending && allCategories.length === 0;
    return (
      <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
        <ScreenHeader title="Category" />
        {loadingCats ? (
          <View style={styles.centerBox}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : categoriesError && allCategories.length === 0 ? (
          <ErrorState onRetry={() => void refetchCategories()} />
        ) : (
          <ErrorState
            title="Category not found"
            message="This category doesn't exist anymore. Browse events on the map instead."
            retryLabel="Go to Discover"
            onRetry={() => router.navigate('/(tabs)/discover' as never)}
          />
        )}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={presentation.label}
        right={
          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={showOnMap}
              accessibilityRole="button"
              accessibilityLabel={`Show ${presentation.label} on the map`}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.headerBtn}
            >
              <MapPin size={20} color={Colors.text.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void share()}
              accessibilityRole="button"
              accessibilityLabel={`Share ${presentation.label}`}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.headerBtn}
            >
              <Share2 size={20} color={Colors.text.primary} />
            </TouchableOpacity>
          </View>
        }
      />
      <FlatList
        data={state === 'content' ? events : []}
        keyExtractor={(e) => e.id}
        renderItem={({ item }) => <BrowseRow event={item} />}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={
          query.isFetchingNextPage ? <ActivityIndicator style={styles.footer} color={presentation.color} /> : null
        }
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background.primary },
  headerActions: { flexDirection: 'row', gap: Spacing.sm },
  headerBtn: { padding: Spacing.xs },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
  },
  heroText: { flex: 1, minWidth: 0 },
  heroTitle: {
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.displayFontFamilies.bold,
    color: Colors.text.primary,
  },
  heroDescription: {
    marginTop: 2,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.regular,
    color: Colors.text.secondary,
  },
  heroMeta: {
    marginTop: Spacing.xs,
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.text.tertiary,
  },
  presetRow: { gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  presetChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BorderRadius.round,
    borderWidth: 1,
    borderColor: Colors.border.light,
    backgroundColor: Colors.surface,
  },
  presetText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    color: Colors.text.primary,
  },
  presetTextSelected: { color: '#FFFFFF' },
  rowSpacing: { paddingHorizontal: Spacing.md, marginBottom: Spacing.sm },
  centerBox: { padding: Spacing.xl, alignItems: 'center', gap: Spacing.sm },
  emptyTitle: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.primary,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.regular,
    color: Colors.text.secondary,
    textAlign: 'center',
  },
  emptyActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, justifyContent: 'center', marginTop: Spacing.sm },
  footer: { marginVertical: Spacing.lg },
});
