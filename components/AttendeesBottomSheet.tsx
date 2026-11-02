import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { BottomSheetModal, BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Search, Users } from 'lucide-react-native';
import { Avatar } from '@/components/Avatar';
import { socialService } from '@/services/social';
import { PublicAttendee } from '@/types/database';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';

const PAGE_SIZE = 30;
const SEARCH_DEBOUNCE_MS = 300;

export type AttendeesBottomSheetHandle = {
  present: () => void;
  dismiss: () => void;
};

type AttendeesBottomSheetProps = {
  eventId: string;
  /** Bump to make an open sheet refetch (e.g. after the viewer's own RSVP changed). */
  refreshToken?: number;
};

/**
 * Paginated "Who's going" list. Owns its own data: pages of 30 from the
 * attendees RPC, server-side name search, and load-more on scroll.
 */
export const AttendeesBottomSheet = forwardRef<
  AttendeesBottomSheetHandle,
  AttendeesBottomSheetProps
>(function AttendeesBottomSheet({ eventId, refreshToken = 0 }, ref) {
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<PublicAttendee[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const isOpenRef = useRef(false);
  const requestSeq = useRef(0);

  const loadPage = useCallback(
    async (offset: number, search: string) => {
      const seq = ++requestSeq.current;
      if (offset === 0) setLoading(true);
      else setLoadingMore(true);
      try {
        const page = await socialService.getEventAttendeesPage(eventId, {
          limit: PAGE_SIZE,
          offset,
          search,
        });
        if (seq !== requestSeq.current) return;
        setItems((prev) => {
          if (offset === 0) return page.items;
          const seen = new Set(prev.map((a) => a.id));
          return [...prev, ...page.items.filter((a) => !seen.has(a.id))];
        });
        setTotal(page.total);
        setHasMore(page.has_more);
        setError(null);
      } catch {
        if (seq !== requestSeq.current) return;
        setError('Failed to load attendees');
        if (offset === 0) setItems([]);
        setHasMore(false);
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [eventId]
  );

  useImperativeHandle(ref, () => ({
    // Open immediately so the tap gets instant feedback; the list shows its own spinner.
    present: () => {
      isOpenRef.current = true;
      setSearchQuery('');
      setActiveSearch('');
      bottomSheetRef.current?.present();
      void loadPage(0, '');
    },
    dismiss: () => bottomSheetRef.current?.dismiss(),
  }));

  // Debounced server-side search while open.
  useEffect(() => {
    if (!isOpenRef.current) return;
    const next = searchQuery.trim();
    const timer = setTimeout(() => {
      if (next !== activeSearch) {
        setActiveSearch(next);
        void loadPage(0, next);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery, activeSearch, loadPage]);

  // Parent signals that the list changed (viewer joined or left).
  useEffect(() => {
    if (refreshToken > 0 && isOpenRef.current) void loadPage(0, activeSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  const handleAttendeePress = (userId: string) => {
    bottomSheetRef.current?.dismiss();
    router.push(`/user/${userId}` as any);
  };

  const onEndReached = () => {
    if (loading || loadingMore || !hasMore) return;
    void loadPage(items.length, activeSearch);
  };

  const renderItem = ({ item }: { item: PublicAttendee }) => (
    <TouchableOpacity
      style={styles.row}
      onPress={() => !item.is_anonymous && handleAttendeePress(item.id)}
      activeOpacity={item.is_anonymous ? 1 : 0.7}
      disabled={item.is_anonymous}
      accessibilityRole={item.is_anonymous ? undefined : 'button'}
      accessibilityLabel={item.is_anonymous ? 'Anonymous attendee' : `View ${item.name}'s profile`}
    >
      <Avatar imageUrl={item.avatar_url} name={item.name} size={44} />
      <View style={styles.rowText}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        {item.bio && !item.is_anonymous ? (
          <Text style={styles.bio} numberOfLines={1}>
            {item.bio}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );

  const renderEmpty = () => {
    if (loading) {
      return (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading attendees...</Text>
        </View>
      );
    }
    if (error) {
      return (
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            onPress={() => void loadPage(0, activeSearch)}
            style={styles.retryButton}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (activeSearch) {
      return (
        <View style={styles.centerState}>
          <Text style={styles.emptySubtitle}>No attendees match “{activeSearch}”</Text>
        </View>
      );
    }
    return (
      <View style={styles.centerState}>
        <Users size={48} color={Colors.text.tertiary} />
        <Text style={styles.emptyTitle}>No one going yet</Text>
      </View>
    );
  };

  const subtitle = loading
    ? 'Loading…'
    : activeSearch
      ? `${total} ${total === 1 ? 'match' : 'matches'}`
      : total > 0
        ? `${total} going`
        : '';

  return (
    <BottomSheetModal
      ref={bottomSheetRef}
      snapPoints={['100%']}
      // topInset keeps the sheet below the status bar on all devices; the
      // header then needs no safe-area padding of its own (no double inset).
      topInset={insets.top + Spacing.sm}
      index={0}
      enablePanDownToClose
      enableDismissOnClose
      onDismiss={() => {
        isOpenRef.current = false;
      }}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.background}
    >
      <View style={[styles.header, { paddingTop: Spacing.sm }]}>
        <Text style={styles.title}>Who&apos;s Going</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        <View style={styles.searchRow}>
          <Search size={18} color={Colors.text.tertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name..."
            placeholderTextColor={Colors.text.tertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
            accessibilityLabel="Search attendees by name"
          />
          {searchQuery ? (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
      <BottomSheetFlatList
        data={items}
        keyExtractor={(item: PublicAttendee) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator size="small" color={Colors.primary} style={styles.footerSpinner} />
          ) : hasMore ? (
            <TouchableOpacity
              onPress={onEndReached}
              style={styles.loadMore}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Load more attendees"
            >
              <Text style={styles.loadMoreText}>Show more ({total - items.length} left)</Text>
            </TouchableOpacity>
          ) : null
        }
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        contentContainerStyle={[
          styles.listContent,
          items.length === 0 && styles.listContentEmpty,
        ]}
        keyboardShouldPersistTaps="handled"
      />
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  handleIndicator: {
    backgroundColor: Colors.border.medium,
  },
  background: {
    backgroundColor: Colors.background.primary,
  },
  header: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.md,
  },
  title: {
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  subtitle: {
    marginTop: 2,
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
  },
  searchRow: {
    marginTop: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.background.secondary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: Typography.sizes.md,
    color: Colors.text.primary,
    paddingVertical: 0,
  },
  clearText: {
    fontSize: Typography.sizes.sm,
    color: Colors.primary,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  listContent: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
  },
  listContentEmpty: {
    flexGrow: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.light,
  },
  rowText: {
    flex: 1,
  },
  name: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  bio: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
    marginTop: 2,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xl * 2,
  },
  loadingText: {
    marginTop: Spacing.md,
    fontSize: Typography.sizes.md,
    color: Colors.text.secondary,
  },
  errorText: {
    fontSize: Typography.sizes.md,
    color: Colors.error,
  },
  retryButton: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.background.secondary,
  },
  retryText: {
    fontSize: Typography.sizes.sm,
    color: Colors.primary,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  emptyTitle: {
    marginTop: Spacing.md,
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  emptySubtitle: {
    marginTop: Spacing.xs,
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
  },
  footerSpinner: {
    paddingVertical: Spacing.lg,
  },
  loadMore: {
    alignSelf: 'center',
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.background.secondary,
  },
  loadMoreText: {
    fontSize: Typography.sizes.sm,
    color: Colors.primary,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
});
