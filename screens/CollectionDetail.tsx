/**
 * One collection — `/collections/[id]` (docs/EVENT_COLLECTIONS_PLAN.md §3.4,
 * §3.5). Segments Upcoming | Repeating | Past (server filter), a sort row
 * (next up, most popular, recently added, A to Z), rows in the shared
 * EventListItem with source chips (Saved / Going / Added…) and a remove
 * action for pinned events (undo toast, queueable offline). Series rows
 * carry a Series badge and their next effective date; the per-date
 * expansion is Phase E.
 */
import { memo, useCallback, useMemo, useState } from 'react';
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
import { useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useCollectionEvents, useCollectionsList, useInvalidateCollections } from '@/hooks/useCollections';
import { useEffectiveNextDates, useOccurrenceExceptionsForEvents } from '@/hooks/useEffectiveNextDates';
import { occurrencesService } from '@/services/occurrences';
import { SeriesDatesPreview } from '@/components/SeriesDatesPreview';
import { useScreenState } from '@/hooks/useScreenState';
import { queryKeys } from '@/hooks/queryKeys';
import { CollectionsUnavailableError, collectionsService } from '@/services/collections';
import { runOrQueue } from '@/services/pendingWrites';
import { EventListItem } from '@/components/EventListItem';
import { CollectionNameSheet } from '@/components/CollectionNameSheet';
import { CollectionActionsSheet } from '@/components/CollectionActionsSheet';
import { useCollectionCalendarExport } from '@/hooks/useCollectionCalendarExport';
import { MoreOfTypeRail } from '@/components/MoreOfTypeRail';
import { CategoryIcon } from '@/components/CategoryIcon';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { FreshnessNote, OfflineState } from '@/components/ui/QueryStates';
import { ChevronDown, ChevronRight, ChevronUp, Ellipsis, FolderHeart, Repeat, X } from '@/components/icons.generated';
import {
  COLLECTION_SORTS,
  collectionErrorMessage,
  collectionItemTarget,
  collectionSourceLabel,
  describeCollectionCounts,
  visibleSources,
} from '@/utils/collections';
import { categoryTint } from '@/utils/categoryPresentation';
import { cadenceLabel } from '@/utils/recurrence';
import { describeEventDateTime } from '@/utils/timezone';
import { goBackOr } from '@/utils/navigation';
import { confirmAction } from '@/utils/confirm';
import { notify } from '@/utils/notify';
import { blockedOffline } from '@/utils/requireOnline';
import { a11yState } from '@/utils/accessibility';
import { BorderRadius, Colors, Spacing, Typography } from '@/constants/theme';
import type { Collection, CollectionEvent, CollectionFilter, CollectionSort } from '@/types/database';
import type { OccurrenceException } from '@/utils/occurrences';

type Segment = Extract<CollectionFilter, 'upcoming' | 'repeating' | 'past'>;
const SEGMENTS: readonly { value: Segment; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'repeating', label: 'Repeating' },
  { value: 'past', label: 'Past' },
];

/**
 * Phase E: the next five dates of a series row in the Repeating segment.
 * Per-date overrides (rsvp_occurrences) are fetched only once expanded, one
 * small query per open row; exceptions come batched from the list.
 */
const SeriesDatesBlock = memo(function SeriesDatesBlock({
  event,
  exceptions,
  userId,
}: {
  event: CollectionEvent;
  exceptions: readonly OccurrenceException[];
  userId: string | undefined;
}) {
  const overridesQuery = useQuery({
    queryKey: queryKeys.dateRsvps(event.id, userId ?? 'anon'),
    enabled: !!userId,
    queryFn: () => occurrencesService.listMyDateRsvps(event.id, userId!),
    staleTime: 30 * 1000,
  });
  // get_collection_events carries no user_rsvp; "going" in sources is the series RSVP.
  const seriesStatus = event.sources.includes('going') ? 'going' : null;
  return (
    <SeriesDatesPreview
      event={event}
      exceptions={exceptions}
      seriesStatus={seriesStatus}
      overrides={overridesQuery.data ?? []}
      onPressDate={(dateKey) => router.push(`/event/${event.id}?date=${dateKey}` as never)}
    />
  );
});

const CollectionEventRow = memo(function CollectionEventRow({
  event,
  kind,
  nextIso,
  onRemove,
  expandable,
  expanded,
  onToggleExpand,
  exceptions,
  userId,
}: {
  event: CollectionEvent;
  kind: Collection['kind'];
  nextIso?: string;
  onRemove: (event: CollectionEvent) => void;
  /** Repeating segment: offer the next-dates expansion. */
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: (id: string) => void;
  exceptions?: readonly OccurrenceException[];
  userId?: string;
}) {
  const ended = event.has_ended;
  const cancelled = event.status === 'cancelled';
  const when = ended ? event.start_datetime : nextIso || event.next_start_datetime || event.start_datetime;
  const display = describeEventDateTime(when, event.timezone);
  const chips = visibleSources(event.sources, kind).map(collectionSourceLabel);
  const metaLines: string[] = [];
  if (display.secondary && !ended) metaLines.push(display.secondary);
  if (chips.length > 0) metaLines.push(chips.join(' · '));
  if (event.note) metaLines.push(`“${event.note}”`);
  const pinned = event.sources.includes('pinned');
  return (
    <View style={styles.rowSpacing}>
      <EventListItem
        title={event.title}
        subtitle={event.business_name}
        dateLine={`${display.primary}${event.is_recurring && !ended ? ` · ${cadenceLabel(event.recurrence_pattern).toLowerCase() || 'repeats'}` : ''}`}
        thumbnailUrl={event.cover_image_url}
        dimmed={ended || cancelled}
        badge={
          cancelled
            ? { label: 'Cancelled', tone: 'danger' }
            : ended
              ? { label: 'Ended', tone: 'neutral' }
              : event.is_recurring
                ? { label: 'Series', tone: 'primary' }
                : null
        }
        dateIcon={event.is_recurring ? <Repeat size={12} color={Colors.text.tertiary} /> : undefined}
        metaLines={metaLines}
        rightAccessory={pinned ? undefined : <ChevronRight size={18} color={Colors.border.medium} />}
        rightAction={
          pinned ? (
            <TouchableOpacity
              style={styles.removeBtn}
              onPress={() => onRemove(event)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${event.title} from this collection`}
            >
              <X size={16} color={Colors.text.secondary} />
            </TouchableOpacity>
          ) : undefined
        }
        actions={
          expandable && event.is_recurring && !ended ? (
            <View style={styles.datesBlock}>
              <TouchableOpacity
                style={styles.datesToggle}
                onPress={() => onToggleExpand?.(event.id)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={expanded ? `Hide dates of ${event.title}` : `Show next dates of ${event.title}`}
                {...a11yState({ expanded: !!expanded }, 'button')}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Text style={styles.datesToggleText}>{expanded ? 'Hide dates' : 'Next dates'}</Text>
                {expanded ? <ChevronUp size={14} color={Colors.primary} /> : <ChevronDown size={14} color={Colors.primary} />}
              </TouchableOpacity>
              {expanded ? <SeriesDatesBlock event={event} exceptions={exceptions ?? []} userId={userId} /> : null}
            </View>
          ) : undefined
        }
        onPress={() => router.push(`/event/${event.id}` as never)}
        accessibilityLabel={`${event.title}, ${display.primary}${event.is_recurring ? ', repeating series' : ''}${chips.length ? `, ${chips.join(', ')}` : ''}${ended ? ', ended' : ''}`}
      />
    </View>
  );
});

const keyExtractor = (e: CollectionEvent) => e.id;

export default function CollectionDetail() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [segment, setSegment] = useState<Segment>('upcoming');
  const [sort, setSort] = useState<CollectionSort>('next');
  const listQuery = useCollectionsList();
  const collection = useMemo(() => listQuery.data?.find((c) => c.id === id) ?? null, [listQuery.data, id]);
  const query = useCollectionEvents(id, sort, segment);
  const invalidate = useInvalidateCollections();
  const { exportUpcoming } = useCollectionCalendarExport();
  const events = useMemo(() => {
    const seen = new Set<string>();
    return (query.data?.pages.flat() ?? []).filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
  }, [query.data]);
  const nextById = useEffectiveNextDates(events, segment !== 'past');
  // Repeating segment: exceptions per series for the expanded date lists
  // (same batched query as the next dates above, so no extra request).
  const { byEvent: exceptionsByEvent } = useOccurrenceExceptionsForEvents(events, segment === 'repeating');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggleExpanded = useCallback((eventId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  }, []);
  const { state: screenState, freshness } = useScreenState(query, {
    hasData: query.data !== undefined,
    isEmpty: events.length === 0,
  });
  const unavailable = query.error instanceof CollectionsUnavailableError || listQuery.error instanceof CollectionsUnavailableError;
  const [pulling, setPulling] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);

  const onRefresh = useCallback(() => {
    setPulling(true);
    void Promise.all([query.refetch(), listQuery.refetch()])
      .then(([r]) => {
        if (r.isError && r.data) notify.backgroundError("Couldn't refresh this collection.", r.error);
      })
      .finally(() => setPulling(false));
  }, [query, listQuery]);

  const onEndReached = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, [query]);

  /** Unpin with undo. Optimistic across every cached page of this sort / filter. */
  const handleRemove = useCallback(
    async (event: CollectionEvent) => {
      if (!id || !collection) return;
      const key = queryKeys.collectionEvents(user?.id, id, sort, segment);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      const stillByRule = event.sources.some((s) => s !== 'pinned');
      queryClient.setQueryData<InfiniteData<CollectionEvent[], number>>(key, (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((page) =>
                stillByRule
                  ? page.map((e) => (e.id === event.id ? { ...e, sources: e.sources.filter((s) => s !== 'pinned'), note: null } : e))
                  : page.filter((e) => e.id !== event.id)
              ),
            }
          : old
      );
      const write = { kind: 'collectionItem' as const, targetId: collectionItemTarget(id, event.id), label: event.title, collectionName: collection.name };
      try {
        const result = await runOrQueue({ ...write, on: false });
        if (result === 'done') invalidate(id);
        const tail = result === 'queued' ? " It will sync when you're back online." : '';
        notify.undo(`Removed “${event.title}” from ${collection.name}.${tail}`, () => {
          void (async () => {
            try {
              const undo = await runOrQueue({ ...write, on: true });
              if (undo === 'queued') queryClient.setQueryData(key, previous);
              else invalidate(id);
            } catch {
              notify.error("Couldn't put the event back.");
              invalidate(id);
            }
          })();
        });
      } catch (err) {
        queryClient.setQueryData(key, previous);
        notify.error(collectionErrorMessage(err) ?? "Couldn't remove the event.");
      }
    },
    [id, collection, user?.id, sort, segment, queryClient, invalidate]
  );

  const rename = useCallback(
    async (name: string) => {
      if (!collection || blockedOffline('Renaming a collection')) return;
      setBusy(true);
      try {
        await collectionsService.update(collection.id, { name });
        setRenaming(false);
        invalidate(collection.id);
      } catch (err) {
        notify.error(collectionErrorMessage(err) ?? "Couldn't rename the collection.");
      } finally {
        setBusy(false);
      }
    },
    [collection, invalidate]
  );

  const remove = useCallback(async () => {
    if (!collection) return;
    setActionsOpen(false);
    const smart = collection.kind === 'smart';
    const ok = await confirmAction({
      title: smart ? `Remove “${collection.name}” from favourites?` : `Delete “${collection.name}”?`,
      message: smart ? 'Events you saved or joined stay saved; only this view of them goes away.' : 'Its events stay saved or joined as before.',
      confirmLabel: smart ? 'Remove' : 'Delete',
      destructive: true,
    });
    if (!ok || blockedOffline('Deleting a collection')) return;
    try {
      await collectionsService.remove(collection.id);
      void queryClient.removeQueries({ queryKey: queryKeys.collectionEventsPrefix(user?.id, collection.id) });
      invalidate();
      notify.success(smart ? `Removed “${collection.name}” from favourites.` : `Deleted “${collection.name}”.`);
      router.back();
    } catch (err) {
      notify.error(collectionErrorMessage(err) ?? "Couldn't delete the collection.");
    }
  }, [collection, invalidate, queryClient, user?.id]);

  const renderItem = useCallback(
    ({ item }: { item: CollectionEvent }) => (
      <CollectionEventRow
        event={item}
        kind={collection?.kind ?? 'manual'}
        nextIso={nextById.get(item.id)}
        onRemove={handleRemove}
        expandable={segment === 'repeating'}
        expanded={expanded.has(item.id)}
        onToggleExpand={toggleExpanded}
        exceptions={exceptionsByEvent.get(item.id)}
        userId={user?.id}
      />
    ),
    [collection?.kind, nextById, handleRemove, segment, expanded, toggleExpanded, exceptionsByEvent, user?.id]
  );

  const smart = collection?.kind === 'smart';
  const tint = collection?.color ? categoryTint(collection.color, 0.12) : Colors.primarySoft;
  const shownIds = useMemo(() => new Set(events.map((e) => e.id)), [events]);
  // Phase D: discovery rail under a smart collection's upcoming list, once
  // the list has settled (not while paging, not on past / repeating views).
  const showRail = !!collection && smart && segment === 'upcoming' && !query.hasNextPage && screenState !== 'loading' && !unavailable;

  const header = (
    <View>
      {collection ? (
        <View style={[styles.hero, { backgroundColor: tint }]}>
          <View style={styles.heroIcon}>
            {smart ? (
              <CategoryIcon category={{ label: collection.name, icon_key: collection.icon_key ?? undefined, color: collection.color }} size="md" />
            ) : (
              <FolderHeart size={22} color={Colors.primary} />
            )}
          </View>
          <View style={styles.heroText}>
            <Text style={styles.heroMeta}>
              {describeCollectionCounts(collection)}
              {smart ? ' · favourite event type' : ''}
            </Text>
            {smart ? (
              <Text style={styles.heroHint}>Everything you save or join in this type, plus anything you add.</Text>
            ) : null}
          </View>
        </View>
      ) : null}
      <SegmentedControl options={SEGMENTS} value={segment} onChange={setSegment} style={styles.segments} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sortRow} accessibilityLabel="Sort by">
        {COLLECTION_SORTS.map((s) => {
          const selected = sort === s.value;
          return (
            <TouchableOpacity
              key={s.value}
              style={[styles.sortChip, selected && styles.sortChipSelected]}
              onPress={() => setSort(s.value)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`Sort by ${s.label}`}
              {...a11yState({ selected }, 'button')}
              hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
            >
              <Text style={[styles.sortText, selected && styles.sortTextSelected]}>{s.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      {events.length > 0 ? <FreshnessNote text={freshness} /> : null}
    </View>
  );

  const empty = (() => {
    if (screenState === 'loading' || (listQuery.isPending && !collection)) {
      return (
        <View style={styles.centerBox} accessibilityLabel="Loading events" {...a11yState({ busy: true })}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      );
    }
    if (unavailable) {
      return <ErrorState title="Collections are coming soon" message="This server doesn’t have collections yet." onRetry={() => void query.refetch()} />;
    }
    if (screenState === 'offline') return <OfflineState onRetry={() => void query.refetch()} />;
    if (screenState === 'error') return <ErrorState title="Couldn't load this collection" onRetry={() => void query.refetch()} />;
    if (!collection && listQuery.data) {
      return <ErrorState title="Collection not found" message="It may have been deleted." onRetry={() => router.back()} />;
    }
    const copy =
      segment === 'repeating'
        ? { title: 'No repeating events here', text: 'Series you save, join or add to this collection show up here with their next date.' }
        : segment === 'past'
          ? { title: 'Nothing has happened yet', text: 'Events move here once they end.' }
          : smart
            ? { title: 'Nothing upcoming yet', text: 'Save or join an event of this type and it appears here automatically.' }
            : { title: 'This collection is empty', text: 'Add events from an event page, or from your Saved list.' };
    return (
      <View style={styles.emptyBox}>
        <Text style={styles.emptyTitle}>{copy.title}</Text>
        <Text style={styles.emptyText}>{copy.text}</Text>
        {segment === 'upcoming' ? (
          <Button label={smart ? 'Browse events' : 'Go to Saved'} variant="secondary" onPress={() => router.push((smart ? '/(tabs)/discover' : '/saved-events') as never)} />
        ) : null}
      </View>
    );
  })();

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <ScreenHeader
        title={collection?.name ?? 'Collection'}
        onBack={() => goBackOr(router, '/collections')}
        right={
          collection ? (
            <TouchableOpacity
              style={styles.headerBtn}
              onPress={() => setActionsOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Collection options"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ellipsis size={22} color={Colors.text.primary} />
            </TouchableOpacity>
          ) : undefined
        }
      />
      <FlatList
        data={screenState === 'offline' || screenState === 'error' || unavailable ? [] : events}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <ActivityIndicator color={Colors.primary} style={styles.loadMore} accessibilityLabel="Loading more events" />
          ) : query.isFetchNextPageError && query.hasNextPage ? (
            <TouchableOpacity
              style={styles.loadMore}
              onPress={() => void query.fetchNextPage()}
              accessibilityRole="button"
              accessibilityLabel="Retry loading more events"
            >
              <Text style={styles.loadMoreRetryText}>Couldn&apos;t load more · Retry</Text>
            </TouchableOpacity>
          ) : showRail ? (
            <MoreOfTypeRail collection={collection} excludeIds={shownIds} />
          ) : null
        }
      />
      <CollectionActionsSheet
        target={actionsOpen ? collection : null}
        onClose={() => setActionsOpen(false)}
        onRename={() => {
          setActionsOpen(false);
          setRenaming(true);
        }}
        onDelete={() => void remove()}
        onExportCalendar={(c) => {
          setActionsOpen(false);
          void exportUpcoming(c);
        }}
      />
      <CollectionNameSheet
        visible={renaming && !!collection}
        initialName={collection?.name}
        collectionId={collection?.id}
        existing={listQuery.data ?? []}
        busy={busy}
        onClose={() => (busy ? undefined : setRenaming(false))}
        onSubmit={(name) => void rename(name)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background.primary },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.xxl, flexGrow: 1 },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.md,
  },
  heroIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  heroText: { flex: 1, gap: 2 },
  heroMeta: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamilies.semibold, color: Colors.text.primary },
  heroHint: { fontSize: Typography.sizes.xs, fontFamily: Typography.fontFamily, color: Colors.text.tertiary, lineHeight: 16 },
  segments: { marginBottom: Spacing.sm },
  sortRow: { gap: Spacing.sm, paddingBottom: Spacing.md },
  sortChip: {
    paddingHorizontal: Spacing.md,
    minHeight: 32,
    justifyContent: 'center',
    borderRadius: BorderRadius.round,
    borderWidth: 1,
    borderColor: Colors.border.light,
    backgroundColor: Colors.surface,
  },
  sortChipSelected: { backgroundColor: Colors.text.primary, borderColor: Colors.text.primary },
  sortText: { fontSize: Typography.sizes.xs, fontFamily: Typography.fontFamilies.semibold, color: Colors.text.secondary },
  sortTextSelected: { color: Colors.white },
  rowSpacing: { marginBottom: 12 },
  datesBlock: { flex: 1, gap: Spacing.sm },
  datesToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', minHeight: 32 },
  datesToggleText: { fontSize: Typography.sizes.xs, fontFamily: Typography.fontFamilies.semibold, color: Colors.primary },
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: Colors.neutralSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadMore: { alignSelf: 'center', marginTop: Spacing.sm },
  loadMoreRetryText: {
    fontSize: Typography.sizes.sm,
    color: Colors.primary,
    fontFamily: Typography.fontFamilies.semibold,
    paddingVertical: Spacing.sm,
  },
  centerBox: { paddingVertical: Spacing.xxl, alignItems: 'center' },
  emptyBox: { alignItems: 'center', paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl, gap: Spacing.sm },
  emptyTitle: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Spacing.sm,
  },
});
