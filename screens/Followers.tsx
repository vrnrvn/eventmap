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
import { businessesService } from '@/services/businesses';
import { useApp } from '@/contexts/AppContext';
import { alpha, BorderRadius, Colors, Shadows, Spacing, Typography } from '@/constants/theme';
import { ChevronRight, Users } from 'lucide-react-native';
import { Avatar } from '@/components/Avatar';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ErrorState } from '@/components/ui/ErrorState';

type Follower = {
  id: string;
  user_id: string;
  created_at: string;
  profile: { name: string; avatar_url: string | null };
};

export default function Followers() {
  const insets = useSafeAreaInsets();
  const { userBusiness } = useApp();
  const [followers, setFollowers] = useState<Follower[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const loadFollowers = useCallback(async () => {
    if (!userBusiness) return;
    try {
      const list = await businessesService.getFollowers(userBusiness.id);
      setFollowers(list);
      setLoadError(false);
    } catch (error) {
      console.error('Failed to load followers:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [userBusiness]);

  useEffect(() => {
    if (userBusiness) {
      loadFollowers();
    } else {
      setLoading(false);
    }
  }, [userBusiness, loadFollowers]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadFollowers().finally(() => setRefreshing(false));
  }, [loadFollowers]);

  const retryLoad = useCallback(() => {
    setLoading(true);
    loadFollowers();
  }, [loadFollowers]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays < 1) return 'Today';
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (!userBusiness) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <ScreenHeader title="Followers" safeArea={false} />
        <View style={styles.centerContainer}>
          <Text style={styles.emptySubtitle}>No business profile</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScreenHeader title="Followers" safeArea={false} />
      <Text style={styles.headerSubtitle}>
        {loading
          ? 'Loading…'
          : `${followers.length} follower${followers.length !== 1 ? 's' : ''}`}
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
          data={loadError ? [] : followers}
          keyExtractor={(item) => item.id}
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            (loadError || followers.length === 0) && styles.scrollContentEmpty,
            { paddingBottom: insets.bottom + 40 },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.secondary}
              colors={[Colors.secondary]}
            />
          }
          ListEmptyComponent={
            loadError ? (
              <ErrorState
                title="Couldn't load followers"
                onRetry={retryLoad}
              />
            ) : (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconWrap}>
                  <Users size={36} color={Colors.secondary} />
                </View>
                <Text style={styles.emptyTitle}>No Followers Yet</Text>
                <Text style={styles.emptySubtitle}>
                  When people follow your business, they&apos;ll appear here. Share your events to
                  grow your audience!
                </Text>
              </View>
            )
          }
          renderItem={({ item: follower }) => {
            // Rows come straight from the follows table, so user_id should
            // always exist — but guard anyway so a malformed row renders as
            // a non-tappable card instead of navigating to a broken profile.
            const canOpenProfile = !!follower.user_id;
            return (
              <TouchableOpacity
                style={styles.followerCard}
                onPress={
                  canOpenProfile
                    ? () => router.push(`/user/${follower.user_id}` as never)
                    : undefined
                }
                disabled={!canOpenProfile}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`View ${follower.profile?.name || 'User'}'s profile`}
              >
                <Avatar
                  imageUrl={follower.profile?.avatar_url}
                  name={follower.profile?.name || 'User'}
                  size={48}
                />
                <View style={styles.followerInfo}>
                  <Text style={styles.followerName} numberOfLines={1}>
                    {follower.profile?.name || 'User'}
                  </Text>
                  <Text style={styles.followerDate}>
                    Following since {formatDate(follower.created_at)}
                  </Text>
                </View>
                {canOpenProfile ? (
                  <ChevronRight size={20} color={Colors.text.tertiary} />
                ) : null}
              </TouchableOpacity>
            );
          }}
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
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
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
    backgroundColor: alpha(Colors.secondary, 0.12),
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
  },
  followerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: 12,
    gap: 14,
    ...Shadows.card,
  },
  followerInfo: {
    flex: 1,
    minWidth: 0,
  },
  followerName: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  followerDate: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    marginTop: 2,
  },
});
