/**
 * Collections home — `/collections` (docs/EVENT_COLLECTIONS_PLAN.md §3.4).
 * The signed-in user's private collections as cards: cover, name, counts,
 * next date. Manual ones are created here; smart ones (favourited event
 * types) arrive from Category Browse in Phase D. Rename / delete via the
 * card's "more" button or a long-press. Works offline for what was loaded.
 */
import { memo, useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useCollectionsList, useInvalidateCollections } from '@/hooks/useCollections';
import { useScreenState } from '@/hooks/useScreenState';
import { queryKeys } from '@/hooks/queryKeys';
import { CollectionsUnavailableError, collectionsService } from '@/services/collections';
import { socialService } from '@/services/social';
import { PERSISTED_QUERY } from '@/utils/queryPersistence';
import { CollectionNameSheet } from '@/components/CollectionNameSheet';
import { CollectionActionsSheet } from '@/components/CollectionActionsSheet';
import { useCollectionCalendarExport } from '@/hooks/useCollectionCalendarExport';
import { CategoryIcon } from '@/components/CategoryIcon';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { FreshnessNote, OfflineState } from '@/components/ui/QueryStates';
import {
  ArrowUpDown,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Ellipsis,
  FolderHeart,
  FolderPlus,
  Repeat,
} from '@/components/icons.generated';
import { collectionErrorMessage, describeCollectionCounts } from '@/utils/collections';
import { categoryTint } from '@/utils/categoryPresentation';
import { formatEventWhen } from '@/utils/formatEventWhen';
import { moveItem } from '@/utils/reorder';
import { goBackOr } from '@/utils/navigation';
import { confirmAction } from '@/utils/confirm';
import { notify } from '@/utils/notify';
import { blockedOffline } from '@/utils/requireOnline';
import { a11yState } from '@/utils/accessibility';
import { BorderRadius, Colors, Spacing, Typography } from '@/constants/theme';
import type { Collection } from '@/types/database';

/**
 * Up to three covers in the 64 px tile: one fills it, two split it, three
 * put the first on the left and stack the other two on the right.
 */
function CoverMosaic({ urls }: { urls: string[] }) {
  const img = (uri: string, style: object, key: string) => (
    <Image key={key} source={{ uri }} style={style} contentFit="cover" cachePolicy="memory-disk" transition={150} />
  );
  if (urls.length >= 3) {
    return (
      <View style={styles.mosaicRow}>
        <View style={styles.mosaicHalf}>{img(urls[0], styles.mosaicFill, 'a')}</View>
        <View style={styles.mosaicHalf}>
          <View style={styles.mosaicQuarter}>{img(urls[1], styles.mosaicFill, 'b')}</View>
          <View style={styles.mosaicQuarter}>{img(urls[2], styles.mosaicFill, 'c')}</View>
        </View>
      </View>
    );
  }
  if (urls.length === 2) {
    return (
      <View style={styles.mosaicRow}>
        <View style={styles.mosaicHalf}>{img(urls[0], styles.mosaicFill, 'a')}</View>
        <View style={styles.mosaicHalf}>{img(urls[1], styles.mosaicFill, 'b')}</View>
      </View>
    );
  }
  return img(urls[0], styles.coverImage, 'a');
}

const CollectionCard = memo(function CollectionCard({
  collection,
  onOpen,
  onMore,
  reordering,
  onMove,
  isFirst,
  isLast,
}: {
  collection: Collection;
  onOpen: (c: Collection) => void;
  onMore: (c: Collection) => void;
  /** Reorder mode: up / down controls replace the more button. */
  reordering?: boolean;
  onMove?: (c: Collection, direction: -1 | 1) => void;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  const smart = collection.kind === 'smart';
  const tint = collection.color ? categoryTint(collection.color, 0.12) : Colors.primarySoft;
  const cover = collection.cover_urls[0] ?? null;
  const counts = describeCollectionCounts(collection);
  const next = collection.next_start_datetime ? `Next ${formatEventWhen(collection.next_start_datetime)}` : null;
  const label = `${collection.name}, ${counts}${next ? `, ${next}` : ''}${smart ? ', favourite event type' : ''}`;
  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.cardPress}
        activeOpacity={0.85}
        disabled={reordering}
        onPress={() => onOpen(collection)}
        onLongPress={() => onMore(collection)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Opens the collection"
      >
        <View style={[styles.cover, { backgroundColor: tint }]}>
          {cover ? <CoverMosaic urls={collection.cover_urls} /> : null}
          {collection.upcoming_count > 0 && collection.recurring_count === collection.upcoming_count ? (
            <View style={styles.coverRepeat} accessibilityElementsHidden importantForAccessibility="no">
              <Repeat size={10} color={Colors.white} />
            </View>
          ) : null}
          <View style={[styles.coverIcon, cover && styles.coverIconOnImage]}>
            {smart ? (
              <CategoryIcon
                category={{ label: collection.name, icon_key: collection.icon_key ?? undefined, color: collection.color }}
                size="sm"
                variant="minimal"
                color={cover ? Colors.white : undefined}
              />
            ) : (
              <FolderHeart size={16} color={cover ? Colors.white : Colors.primary} />
            )}
          </View>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {collection.name}
          </Text>
          <View style={styles.cardMetaRow}>
            {collection.recurring_count > 0 ? <Repeat size={12} color={Colors.text.tertiary} /> : null}
            <Text style={styles.cardMeta} numberOfLines={1}>
              {counts}
            </Text>
          </View>
          {next ? (
            <Text style={styles.cardMeta} numberOfLines={1}>
              {next}
            </Text>
          ) : null}
          {smart ? <Text style={styles.smartTag}>Favourite type</Text> : null}
        </View>
        <ChevronRight size={18} color={Colors.border.medium} />
      </TouchableOpacity>
      {reordering ? (
        <View style={styles.moveCol}>
          <Pressable
            style={[styles.moveBtn, isFirst && styles.moveBtnDisabled]}
            disabled={isFirst}
            onPress={() => onMove?.(collection, -1)}
            accessibilityRole="button"
            accessibilityLabel={`Move ${collection.name} up`}
            {...a11yState({ disabled: !!isFirst }, 'button')}
          >
            <ChevronUp size={18} color={isFirst ? Colors.text.disabled : Colors.text.primary} />
          </Pressable>
          <Pressable
            style={[styles.moveBtn, isLast && styles.moveBtnDisabled]}
            disabled={isLast}
            onPress={() => onMove?.(collection, 1)}
            accessibilityRole="button"
            accessibilityLabel={`Move ${collection.name} down`}
            {...a11yState({ disabled: !!isLast }, 'button')}
          >
            <ChevronDown size={18} color={isLast ? Colors.text.disabled : Colors.text.primary} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          style={styles.moreBtn}
          onPress={() => onMore(collection)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`More options for ${collection.name}`}
        >
          <Ellipsis size={18} color={Colors.text.secondary} />
        </Pressable>
      )}
    </View>
  );
});

const keyExtractor = (c: Collection) => c.id;

export default function Collections() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const query = useCollectionsList();
  const invalidate = useInvalidateCollections();
  const { exportUpcoming } = useCollectionCalendarExport();
  const collections = useMemo(() => query.data ?? [], [query.data]);
  const { state: screenState, freshness } = useScreenState(query, {
    hasData: query.data !== undefined,
    isEmpty: collections.length === 0,
  });
  const unavailable = query.error instanceof CollectionsUnavailableError;
  const [pulling, setPulling] = useState(false);
  const [editing, setEditing] = useState<
    { mode: 'create'; tab?: 'list' | 'type' } | { mode: 'rename'; target: Collection } | null
  >(null);
  const [actionsFor, setActionsFor] = useState<Collection | null>(null);
  const [busy, setBusy] = useState(false);
  // Reorder mode: moves are local until Done, then one reorder_collections
  // call persists them (rolled back visually if it fails). Order is null
  // outside the mode so server order always wins.
  const [draftOrder, setDraftOrder] = useState<Collection[] | null>(null);
  const reordering = draftOrder !== null;

  // "All saved" system row (§6 decision 4): Saved stays its own bucket and
  // appears above the collections. Counts come from the profile stats RPC.
  const countsQuery = useQuery({
    queryKey: queryKeys.attendanceCounts(user?.id),
    ...PERSISTED_QUERY,
    enabled: !!user?.id,
    queryFn: () => socialService.getUserAttendanceCounts(user!.id),
    staleTime: 30_000,
  });
  const savedCount = countsQuery.data?.saved ?? null;

  const onRefresh = useCallback(() => {
    setPulling(true);
    void query
      .refetch()
      .then((r) => {
        if (r.isError && r.data) notify.backgroundError("Couldn't refresh collections.", r.error);
      })
      .finally(() => setPulling(false));
  }, [query]);

  const open = useCallback((c: Collection) => {
    router.push(`/collections/${c.id}` as never);
  }, []);

  const submitName = useCallback(
    async (name: string) => {
      if (!editing || blockedOffline(editing.mode === 'create' ? 'Creating a collection' : 'Renaming a collection')) return;
      setBusy(true);
      try {
        if (editing.mode === 'create') {
          const created = await collectionsService.create({ kind: 'manual', name });
          setEditing(null);
          invalidate();
          notify.withAction(`Created “${created.name}”.`, { label: 'Open', onPress: () => open(created) });
        } else {
          await collectionsService.update(editing.target.id, { name });
          setEditing(null);
          invalidate(editing.target.id);
        }
      } catch (err) {
        notify.error(collectionErrorMessage(err) ?? (editing.mode === 'create' ? "Couldn't create the collection." : "Couldn't rename the collection."));
      } finally {
        setBusy(false);
      }
    },
    [editing, invalidate, open]
  );

  const favouritedIds = useMemo(
    () => collections.filter((c) => c.kind === 'smart' && c.category_ids.length === 1).map((c) => c.category_ids[0]),
    [collections]
  );
  const favouriteTypes = useCallback(
    async (categoryIds: string[]) => {
      if (blockedOffline('Favouriting an event type')) return;
      setBusy(true);
      const made: string[] = [];
      try {
        for (const id of categoryIds) made.push(await collectionsService.favouriteCategory(id));
        setEditing(null);
        invalidate();
        if (made.length === 1) {
          notify.withAction('Added to your collections.', { label: 'Open', onPress: () => router.push(`/collections/${made[0]}` as never) });
        } else {
          notify.success(`Added ${made.length} favourite types to your collections.`);
        }
      } catch (err) {
        if (made.length > 0) invalidate();
        notify.error(collectionErrorMessage(err) ?? "Couldn't favourite that type.");
      } finally {
        setBusy(false);
      }
    },
    [invalidate]
  );

  const remove = useCallback(
    async (c: Collection) => {
      setActionsFor(null);
      const smart = c.kind === 'smart';
      const ok = await confirmAction({
        title: smart ? `Remove “${c.name}” from favourites?` : `Delete “${c.name}”?`,
        message: smart
          ? 'Events you saved or joined stay saved; only this view of them goes away.'
          : c.item_count > 0
            ? `Its ${describeCollectionCounts(c)} stay saved or joined as before.`
            : undefined,
        confirmLabel: smart ? 'Remove' : 'Delete',
        destructive: true,
      });
      if (!ok || blockedOffline('Deleting a collection')) return;
      const key = queryKeys.collections(user?.id);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Collection[]>(key);
      queryClient.setQueryData<Collection[]>(key, (old) => old?.filter((x) => x.id !== c.id));
      try {
        await collectionsService.remove(c.id);
        void queryClient.removeQueries({ queryKey: queryKeys.collectionEventsPrefix(user?.id, c.id) });
        invalidate();
        notify.success(smart ? `Removed “${c.name}” from favourites.` : `Deleted “${c.name}”.`);
      } catch (err) {
        queryClient.setQueryData(key, previous);
        notify.error(collectionErrorMessage(err) ?? "Couldn't delete the collection.");
      }
    },
    [invalidate, queryClient, user?.id]
  );

  const shown = draftOrder ?? collections;

  const move = useCallback((c: Collection, direction: -1 | 1) => {
    setDraftOrder((current) => {
      if (!current) return current;
      const from = current.findIndex((x) => x.id === c.id);
      return from < 0 ? current : moveItem(current, from, from + direction);
    });
  }, []);

  const finishReorder = useCallback(async () => {
    const order = draftOrder;
    setDraftOrder(null);
    if (!order) return;
    const unchanged = order.every((c, i) => collections[i]?.id === c.id);
    if (unchanged || blockedOffline('Reordering collections')) return;
    const key = queryKeys.collections(user?.id);
    await queryClient.cancelQueries({ queryKey: key });
    const previous = queryClient.getQueryData<Collection[]>(key);
    queryClient.setQueryData<Collection[]>(key, order.map((c, i) => ({ ...c, sort_order: i + 1 })));
    try {
      await collectionsService.reorder(order.map((c) => c.id));
      invalidate();
    } catch (err) {
      queryClient.setQueryData(key, previous);
      notify.error(collectionErrorMessage(err) ?? "Couldn't save the new order.");
    }
  }, [draftOrder, collections, user?.id, queryClient, invalidate]);

  const renderItem = useCallback(
    ({ item, index }: { item: Collection; index: number }) => (
      <CollectionCard
        collection={item}
        onOpen={open}
        onMore={setActionsFor}
        reordering={reordering}
        onMove={move}
        isFirst={index === 0}
        isLast={index === shown.length - 1}
      />
    ),
    [open, reordering, move, shown.length]
  );

  const empty = (() => {
    if (screenState === 'loading') {
      return (
        <View style={styles.centerBox} accessibilityLabel="Loading your collections" {...a11yState({ busy: true })}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      );
    }
    if (unavailable) {
      return (
        <View style={styles.emptyBox}>
          <View style={styles.emptyIconWrap}>
            <FolderHeart size={34} color={Colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>Collections are coming soon</Text>
          <Text style={styles.emptyText}>This server doesn’t have collections yet. Your saved events are still in Saved.</Text>
          <Button label="Go to Saved" variant="secondary" onPress={() => router.push('/saved-events' as never)} />
        </View>
      );
    }
    if (screenState === 'offline') return <OfflineState onRetry={() => void query.refetch()} />;
    if (screenState === 'error') return <ErrorState title="Couldn't load collections" onRetry={() => void query.refetch()} />;
    return (
      <View style={styles.emptyBox}>
        <View style={styles.emptyIconWrap}>
          <FolderHeart size={34} color={Colors.primary} />
        </View>
        <Text style={styles.emptyTitle}>No collections yet</Text>
        <Text style={styles.emptyText}>
          Group events into lists like “Weekend plans”, or favourite an event type to collect everything you save or join in it.
        </Text>
        <Button label="New collection" icon={<FolderPlus size={16} color={Colors.white} />} onPress={() => setEditing({ mode: 'create' })} />
        <Button label="Favourite an event type" variant="secondary" onPress={() => setEditing({ mode: 'create', tab: 'type' })} />
      </View>
    );
  })();

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <ScreenHeader
        title="Collections"
        onBack={() => goBackOr(router, '/(tabs)/profile')}
        right={
          !unavailable ? (
            <View style={styles.headerActions}>
              {reordering ? (
                <TouchableOpacity
                  style={styles.headerDone}
                  onPress={() => void finishReorder()}
                  accessibilityRole="button"
                  accessibilityLabel="Done reordering"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Check size={16} color={Colors.white} />
                  <Text style={styles.headerDoneText}>Done</Text>
                </TouchableOpacity>
              ) : (
                <>
                  {collections.length > 1 ? (
                    <TouchableOpacity
                      style={styles.headerBtn}
                      onPress={() => setDraftOrder(collections)}
                      accessibilityRole="button"
                      accessibilityLabel="Reorder collections"
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <ArrowUpDown size={20} color={Colors.text.primary} />
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    style={styles.headerBtn}
                    onPress={() => setEditing({ mode: 'create' })}
                    accessibilityRole="button"
                    accessibilityLabel="New collection"
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <FolderPlus size={22} color={Colors.primary} />
                  </TouchableOpacity>
                </>
              )}
            </View>
          ) : undefined
        }
      />
      <FlatList
        data={screenState === 'offline' || screenState === 'error' ? [] : shown}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={[styles.list, collections.length === 0 && styles.listEmpty]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} enabled={!reordering} />}
        ListHeaderComponent={
          collections.length > 0 || (!unavailable && screenState === 'content' && savedCount !== null) ? (
            <View>
              {reordering ? (
                <Text style={styles.subtitle}>Use the arrows, then Done</Text>
              ) : (
                <Text style={styles.subtitle}>
                  {collections.length} {collections.length === 1 ? 'collection' : 'collections'}
                </Text>
              )}
              {!reordering && !unavailable ? (
                <TouchableOpacity
                  style={styles.savedRow}
                  onPress={() => router.push('/saved-events' as never)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={`All saved events${savedCount !== null ? `, ${savedCount} ${savedCount === 1 ? 'event' : 'events'}` : ''}`}
                >
                  <View style={styles.savedIconWrap}>
                    <Bookmark size={16} color={Colors.primary} />
                  </View>
                  <View style={styles.cardBody}>
                    <Text style={styles.cardTitle}>All saved</Text>
                    <Text style={styles.cardMeta}>
                      {savedCount === null
                        ? 'Everything you bookmarked'
                        : `${savedCount} ${savedCount === 1 ? 'event' : 'events'} you bookmarked`}
                    </Text>
                  </View>
                  <ChevronRight size={18} color={Colors.border.medium} />
                </TouchableOpacity>
              ) : null}
              <FreshnessNote text={freshness} />
            </View>
          ) : null
        }
        ListEmptyComponent={empty}
      />
      <CollectionNameSheet
        visible={editing !== null}
        initialName={editing?.mode === 'rename' ? editing.target.name : undefined}
        collectionId={editing?.mode === 'rename' ? editing.target.id : undefined}
        existing={collections}
        busy={busy}
        onClose={() => (busy ? undefined : setEditing(null))}
        onSubmit={(name) => void submitName(name)}
        allowType
        initialTab={editing?.mode === 'create' ? editing.tab ?? 'list' : 'list'}
        favouritedCategoryIds={favouritedIds}
        onFavouriteTypes={(ids) => void favouriteTypes(ids)}
      />
      <CollectionActionsSheet
        target={actionsFor}
        onClose={() => setActionsFor(null)}
        onRename={(c) => {
          setActionsFor(null);
          setEditing({ mode: 'rename', target: c });
        }}
        onDelete={(c) => void remove(c)}
        onExportCalendar={(c) => {
          setActionsFor(null);
          void exportUpcoming(c);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background.primary },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  subtitle: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border.light,
  },
  cardPress: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: Spacing.md, gap: Spacing.md, minHeight: 44 },
  cover: { width: 64, height: 64, borderRadius: BorderRadius.md, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  coverImage: { ...StyleSheet.absoluteFillObject },
  coverIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  coverIconOnImage: { backgroundColor: Colors.overlay.dark },
  coverRepeat: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, gap: 2 },
  cardTitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardMeta: { fontSize: Typography.sizes.xs, fontFamily: Typography.fontFamily, color: Colors.text.tertiary },
  smartTag: {
    alignSelf: 'flex-start',
    marginTop: 2,
    fontSize: Typography.sizes.xxs,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.primary,
    backgroundColor: Colors.primarySoft,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  moreBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: Spacing.xs },
  moveCol: { marginRight: Spacing.xs, gap: 2 },
  moveBtn: {
    width: 40,
    height: 31,
    borderRadius: 8,
    backgroundColor: Colors.neutralSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveBtnDisabled: { opacity: 0.4 },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  headerDone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 36,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.primary,
  },
  headerDoneText: { color: Colors.white, fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamilies.semibold },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border.light,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  savedIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mosaicRow: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', gap: 1 },
  mosaicHalf: { flex: 1, gap: 1 },
  mosaicQuarter: { flex: 1, overflow: 'hidden' },
  mosaicFill: { flex: 1 },
  centerBox: { paddingVertical: Spacing.xxl, alignItems: 'center' },
  emptyBox: { alignItems: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.sm },
  emptyIconWrap: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  emptyTitle: {
    fontSize: Typography.sizes.xl,
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
