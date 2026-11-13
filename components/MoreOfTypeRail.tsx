/**
 * "More <type> near you" under a smart collection
 * (docs/EVENT_COLLECTIONS_PLAN.md §3.4, Phase D). Up to five upcoming events
 * of the collection's category near the viewer that are not already in the
 * collection, with "See all" handing off to Category Browse. Quiet when
 * there is nothing to add: no section at all rather than an empty one.
 */
import { memo, useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useCategories } from '@/hooks/useCategories';
import { DEFAULT_BROWSE_RADIUS_KM, WIDE_BROWSE_RADIUS_KM, useBrowseCenter } from '@/hooks/useBrowseCenter';
import { eventsService } from '@/services/events';
import { EventListItem } from '@/components/EventListItem';
import { ChevronRight } from '@/components/icons.generated';
import { cadenceLabel } from '@/utils/recurrence';
import { describeEventDateTime } from '@/utils/timezone';
import { formatDistance } from '@/utils/formatEventWhen';
import { Colors, Spacing, Typography } from '@/constants/theme';
import type { Collection, RankedEvent } from '@/types/database';

const RAIL_SIZE = 5;
const FETCH_SIZE = 12;
/** Fewer usable rows than this at the default radius → try the wide one too. */
const SPARSE_BELOW = 3;

type Props = {
  collection: Collection;
  /** Ids already shown in the collection; the rail never repeats them. */
  excludeIds: ReadonlySet<string>;
};

export const MoreOfTypeRail = memo(function MoreOfTypeRail({ collection, excludeIds }: Props) {
  const { profile } = useAuth();
  const { byId } = useCategories();
  const center = useBrowseCenter();
  const categoryId = collection.category_ids[0];
  const category = categoryId ? byId.get(categoryId) : undefined;
  const label = category?.label ?? collection.name;

  const query = useQuery({
    queryKey: ['collection-rail', collection.id, categoryId ?? 'none', center?.lat.toFixed(2) ?? '0', center?.lng.toFixed(2) ?? '0'],
    enabled: !!categoryId && !!center,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const fetchAt = (radiusKm: number) =>
        eventsService.getRankedEventsPage(
          center!.lat,
          center!.lng,
          { categories: collection.category_ids, radiusKm, preferredCategories: profile?.preferred_categories ?? undefined },
          { limit: FETCH_SIZE, offset: 0 }
        );
      const near = await fetchAt(DEFAULT_BROWSE_RADIUS_KM);
      const usable = near.items.filter((e) => e.status === 'active').length;
      if (usable >= SPARSE_BELOW) return { items: near.items, widened: false };
      // Sparse neighbourhood: widen once rather than show nothing (docs §7).
      const wide = await fetchAt(WIDE_BROWSE_RADIUS_KM);
      const seen = new Set(near.items.map((e) => e.id));
      return { items: [...near.items, ...wide.items.filter((e) => !seen.has(e.id))], widened: true };
    },
  });

  const items = useMemo(
    () => (query.data?.items ?? []).filter((e) => !excludeIds.has(e.id) && e.status === 'active').slice(0, RAIL_SIZE),
    [query.data, excludeIds]
  );
  const widened = query.data?.widened ?? false;

  if (!category || items.length === 0) return null;
  const seeAll = () => router.push(`/category/${category.slug}` as never);
  return (
    <View style={styles.section} accessibilityLabel={`More ${label} near you`}>
      <View style={styles.headerRow}>
        <Text style={styles.title} accessibilityRole="header">
          More {label.toLowerCase()} near you
        </Text>
        <TouchableOpacity
          onPress={seeAll}
          accessibilityRole="button"
          accessibilityLabel={`See all ${label} events`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.seeAll}
        >
          <Text style={styles.seeAllText}>See all</Text>
          <ChevronRight size={14} color={Colors.primary} />
        </TouchableOpacity>
      </View>
      <Text style={styles.hint}>
        {widened ? `Within ${WIDE_BROWSE_RADIUS_KM} km · ` : ''}Save or join one and it lands in this collection.
      </Text>
      {items.map((event) => (
        <RailRow key={event.id} event={event} />
      ))}
    </View>
  );
});

const RailRow = memo(function RailRow({ event }: { event: RankedEvent }) {
  const when = event.next_start_datetime || event.start_datetime;
  const display = describeEventDateTime(when, event.timezone);
  const meta: string[] = [];
  if (display.secondary) meta.push(display.secondary);
  if (event.distance_km > 0) meta.push(`${formatDistance(event.distance_km)} away`);
  return (
    <View style={styles.rowSpacing}>
      <EventListItem
        title={event.title}
        subtitle={event.business_name}
        dateLine={`${display.primary}${event.is_recurring ? ` · ${cadenceLabel(event.recurrence_pattern).toLowerCase() || 'repeats'}` : ''}`}
        thumbnailUrl={event.cover_image_url}
        metaLines={meta}
        rightAccessory={<ChevronRight size={18} color={Colors.border.medium} />}
        onPress={() => router.push(`/event/${event.id}` as never)}
        accessibilityLabel={`${event.title}, ${display.primary}`}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  section: { marginTop: Spacing.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: {
    flex: 1,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 32, paddingHorizontal: Spacing.xs },
  seeAllText: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamilies.semibold, color: Colors.primary },
  hint: { fontSize: Typography.sizes.xs, fontFamily: Typography.fontFamily, color: Colors.text.tertiary, marginBottom: Spacing.sm },
  rowSpacing: { marginBottom: 12 },
});
