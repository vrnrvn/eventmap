import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { socialService } from '@/services/social';
import { runOrQueueWithNotice } from '@/services/pendingWrites';
import { connectionErrorMessage } from '@/utils/networkErrors';
import { notify, notifyConfirm } from '@/utils/notify';
import { Business } from '@/types/database';
import { BorderRadius, Colors, Shadows, Spacing, Typography } from '@/constants/theme';
import { Heart, HeartOff, ChevronRight } from 'lucide-react-native';
import { Avatar } from '@/components/Avatar';
import { CategoryIcon } from '@/components/CategoryIcon';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ErrorState } from '@/components/ui/ErrorState';
import { OfflineState } from '@/components/ui/QueryStates';
import { useConnectivity } from '@/services/connectivity';

type FollowedBusiness = Business & { followId: string };

export default function Following() {
  const connectivity = useConnectivity();
  const insets = useSafeAreaInsets();
  const [businesses, setBusinesses] = useState<FollowedBusiness[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unfollowingId, setUnfollowingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const loadFollowing = useCallback(async () => {
    try {
      const follows = await socialService.getUserFollows();
      // One batched query instead of one getBusiness call per follow.
      const businessesById = new Map(
        (await socialService.getBusinessesByIds(follows.map((f) => f.business_id))).map(
          (b) => [b.id, b] as const
        )
      );
      const businessList: FollowedBusiness[] = [];
      for (const f of follows) {
        const biz = businessesById.get(f.business_id);
        if (biz) {
          businessList.push({ ...biz, followId: f.id });
        }
      }
      setBusinesses(businessList);
      setLoadError(false);
    } catch (error) {
      console.error('Failed to load following:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFollowing();
  }, [loadFollowing]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadFollowing().finally(() => setRefreshing(false));
  }, [loadFollowing]);

  const retryLoad = useCallback(() => {
    setLoading(true);
    loadFollowing();
  }, [loadFollowing]);

  const handleUnfollow = (business: FollowedBusiness) => {
    notifyConfirm({
      title: 'Unfollow',
      message: `Stop following ${business.name}?`,
      confirmLabel: 'Unfollow',
      destructive: true,
      onConfirm: async () => {
        setUnfollowingId(business.id);
        try {
          await runOrQueueWithNotice({ kind: 'follow', targetId: business.id, on: false, label: business.name });
          setBusinesses((prev) => prev.filter((b) => b.id !== business.id));
        } catch (err) {
          notify.error(connectionErrorMessage(err) ?? 'Failed to unfollow');
        } finally {
          setUnfollowingId(null);
        }
      },
    });
  };

  const [followerCounts, setFollowerCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (businesses.length === 0) return;
    const loadCounts = async () => {
      // One follows query for all businesses instead of a count query each.
      const counts = await socialService.getFollowerCountsByBusinessIds(
        businesses.map((b) => b.id)
      );
      setFollowerCounts(counts);
    };
    loadCounts().catch(() => {
      // Counts are decorative; the list renders fine without them.
    });
  }, [businesses]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScreenHeader title="Following" safeArea={false} />
      <Text style={styles.headerSubtitle}>
        {loading
          ? 'Loading…'
          : loadError && businesses.length === 0
            ? 'Not loaded yet'
            : `${businesses.length} business${businesses.length !== 1 ? 'es' : ''}`}
      </Text>

      {loading ? (
        <View style={styles.skeletonList}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.skeletonCard}>
              <View style={styles.skeletonCircle} />
              <View style={styles.skeletonLines}>
                <View style={styles.skeletonBar} />
                <View style={[styles.skeletonBar, styles.skeletonBarShort]} />
              </View>
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={loadError ? [] : businesses}
          keyExtractor={(item) => item.id}
          // Rows read these from state; FlatList needs them to know when to re-render.
          extraData={[followerCounts, unfollowingId]}
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            (loadError || businesses.length === 0) && styles.scrollContentEmpty,
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
          ListEmptyComponent={
            loadError && connectivity === 'offline' ? (
              <OfflineState onRetry={retryLoad} />
            ) : loadError ? (
              <ErrorState
                title="Couldn't load who you follow"
                onRetry={retryLoad}
              />
            ) : (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconWrap}>
                  <Heart size={36} color={Colors.primary} />
                </View>
                <Text style={styles.emptyTitle}>Not Following Anyone</Text>
                <Text style={styles.emptySubtitle}>
                  Follow businesses to see their events first and get notified when they post something new.
                </Text>
                <TouchableOpacity
                  style={styles.exploreCta}
                  onPress={() => router.push('/(tabs)/discover' as never)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Discover Events"
                >
                  <Text style={styles.exploreCtaText}>Discover Events</Text>
                  <ChevronRight size={16} color={Colors.primary} />
                </TouchableOpacity>
              </View>
            )
          }
          renderItem={({ item: business }) => (
              <TouchableOpacity
                style={styles.businessCard}
                onPress={() => router.push(`/business/${business.id}` as never)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`View ${business.name}`}
              >
                <View style={styles.cardBody}>
                  <View style={styles.cardTop}>
                    <Avatar
                      imageUrl={business.logo_url}
                      name={business.name}
                      size={48}
                    />
                    <View style={styles.cardInfo}>
                      <Text style={styles.businessName} numberOfLines={1}>
                        {business.name}
                      </Text>
                      <View style={styles.categoryRow}>
                        <CategoryIcon category={business.category} size="sm" variant="pill" />
                        <Text style={styles.categoryText}>{business.category}</Text>
                      </View>
                      {followerCounts[business.id] !== undefined && (
                        <Text style={styles.followerText}>
                          {followerCounts[business.id]} follower{followerCounts[business.id] !== 1 ? 's' : ''}
                        </Text>
                      )}
                    </View>
                    <TouchableOpacity
                      style={[
                        styles.unfollowBtn,
                        unfollowingId === business.id && styles.unfollowBtnDisabled,
                      ]}
                      onPress={(e) => {
                        e.stopPropagation();
                        handleUnfollow(business);
                      }}
                      disabled={unfollowingId === business.id}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Unfollow ${business.name}`}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <HeartOff size={18} color={Colors.error} />
                      <Text style={styles.unfollowText}>Unfollow</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.cardFooter}>
                    <Text style={styles.viewLabel}>View events</Text>
                    <ChevronRight size={16} color={Colors.text.secondary} />
                  </View>
                </View>
              </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  headerSubtitle: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    textAlign: 'center',
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border.light,
  },
  skeletonList: {
    paddingHorizontal: Spacing.md,
    paddingTop: 20,
  },
  skeletonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: 12,
    gap: 14,
    ...Shadows.card,
  },
  skeletonCircle: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.background.tertiary,
  },
  skeletonLines: {
    flex: 1,
    gap: Spacing.sm,
  },
  skeletonBar: {
    height: 12,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.background.tertiary,
    width: '70%',
  },
  skeletonBarShort: {
    width: '45%',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.md,
    paddingTop: 20,
  },
  scrollContentEmpty: {
    flex: 1,
    justifyContent: 'center',
  },
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
    fontFamily: Typography.displayFontFamilies.bold,
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
    backgroundColor: Colors.primarySoft,
  },
  exploreCtaText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },
  businessCard: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 20,
    marginBottom: 12,
    overflow: 'hidden',
    ...Shadows.card,
  },
  cardBody: {
    flex: 1,
    padding: 16,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardInfo: {
    flex: 1,
    minWidth: 0,
  },
  businessName: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  categoryText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
  },
  followerText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    marginTop: 2,
  },
  unfollowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: Colors.errorSoft,
  },
  unfollowBtnDisabled: {
    opacity: 0.6,
  },
  unfollowText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.error,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border.light,
  },
  viewLabel: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.secondary,
  },
});
