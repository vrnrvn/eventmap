import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Platform,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useApp } from '@/contexts/AppContext';
import { eventsService } from '@/services/events';
import { Event } from '@/types/database';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import { ArrowLeft, Calendar, Pencil, Trash2, PlusCircle } from 'lucide-react-native';

const PAGE_SIZE = 30;

export default function MyEvents() {
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

  const handleDeleteEvent = useCallback((event: Event) => {
    Alert.alert(
      'Delete Event',
      `Delete "${event.title}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await eventsService.deleteEvent(event.id);
              setEvents((prev) => prev.filter((e) => e.id !== event.id));
            } catch {
              Alert.alert('Error', 'Failed to delete event');
            }
          },
        },
      ]
    );
  }, []);

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  const renderItem = useCallback(
    ({ item }: { item: Event }) => (
      <View style={styles.eventRow}>
        <TouchableOpacity
          style={styles.eventRowMain}
          onPress={() => router.push(`/event/${item.id}` as any)}
          activeOpacity={0.7}
        >
          <Text style={styles.eventTitle} numberOfLines={2}>
            {item.title}
          </Text>
          <View style={styles.eventMeta}>
            <Calendar size={14} color={Colors.text.secondary} />
            <Text style={styles.eventDate}>{formatDate(item.start_datetime)}</Text>
          </View>
        </TouchableOpacity>
        <View style={styles.eventActions}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => router.push(`/business/edit-event/${item.id}` as any)}
          >
            <Pencil size={18} color={Colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => handleDeleteEvent(item)}
          >
            <Trash2 size={18} color={Colors.error} />
          </TouchableOpacity>
        </View>
      </View>
    ),
    [handleDeleteEvent]
  );

  const keyExtractor = useCallback((item: Event) => item.id, []);

  const ListHeader = useCallback(
    () =>
      hasBusiness ? (
        <TouchableOpacity
          style={styles.createButton}
          onPress={() => router.push('/(tabs)/create' as any)}
        >
          <PlusCircle size={20} color={Colors.text.inverse} />
          <Text style={styles.createButtonText}>Create Event</Text>
        </TouchableOpacity>
      ) : null,
    [hasBusiness]
  );

  const ListEmpty = useCallback(
    () =>
      !loading && !refreshing ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No events yet</Text>
          <Text style={styles.emptySubtitle}>
            {hasBusiness
              ? 'Create your first event to get started'
              : 'You need a business profile to create events'}
          </Text>
          {hasBusiness && (
            <TouchableOpacity
              style={styles.createEventLink}
              onPress={() => router.push('/(tabs)/create' as any)}
            >
              <Text style={styles.createEventLinkText}>Create Event</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : null,
    [loading, refreshing, hasBusiness]
  );

  const ListFooter = useCallback(
    () =>
      loadingMore ? (
        <View style={styles.footerLoader}>
          <ActivityIndicator size="small" color={Colors.primary} />
        </View>
      ) : null,
    [loadingMore]
  );

  if (!hasBusiness) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <ArrowLeft size={24} color={Colors.text.primary} />
          </TouchableOpacity>
          <Text style={styles.title}>My Events</Text>
        </View>
        <View style={styles.centerContainer}>
          <Text style={styles.noBusinessText}>You need a business profile</Text>
          <Text style={styles.noBusinessSubtext}>
            Create a business to manage events
          </Text>
          <TouchableOpacity
            style={styles.createBusinessButton}
            onPress={() => router.push('/business/onboarding' as any)}
          >
            <Text style={styles.createBusinessButtonText}>Create Business</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ArrowLeft size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>My Events</Text>
        {events.length > 0 && (
          <Text style={styles.count}>
            {events.length}
            {hasMore ? '+' : ''}
          </Text>
        )}
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={events}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={[
            styles.listContent,
            events.length === 0 && styles.listContentEmpty,
          ]}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={ListEmpty}
          ListFooterComponent={ListFooter}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[Colors.primary]}
              tintColor={Colors.primary}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingTop: Platform.OS === 'ios' ? Spacing.xxl + 24 : Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.light,
  },
  backButton: {
    padding: Spacing.sm,
    marginRight: Spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  count: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.tertiary,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noBusinessText: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
  },
  noBusinessSubtext: {
    fontSize: Typography.sizes.md,
    color: Colors.text.secondary,
    marginBottom: Spacing.lg,
  },
  createBusinessButton: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.md,
  },
  createBusinessButtonText: {
    color: Colors.text.inverse,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  listContent: {
    padding: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  listContentEmpty: {
    flexGrow: 1,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.lg,
  },
  createButtonText: {
    color: Colors.text.inverse,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background.secondary,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    ...Shadows.sm,
  },
  eventRowMain: {
    flex: 1,
    minWidth: 0,
  },
  eventTitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  eventMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  eventDate: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
  },
  eventActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginLeft: Spacing.sm,
  },
  actionButton: {
    padding: Spacing.sm,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xxl,
  },
  emptyTitle: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
  },
  emptySubtitle: {
    fontSize: Typography.sizes.md,
    color: Colors.text.secondary,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  createEventLink: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
  },
  createEventLinkText: {
    color: Colors.text.inverse,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  footerLoader: {
    paddingVertical: Spacing.lg,
    alignItems: 'center',
  },
});
