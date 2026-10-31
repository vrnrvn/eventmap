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
import { businessesService } from '@/services/businesses';
import { useApp } from '@/contexts/AppContext';
import { alpha, Colors, Typography } from '@/constants/theme';
import { ArrowLeft, ChevronRight, Users } from 'lucide-react-native';
import { Avatar } from '@/components/Avatar';

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

  const loadFollowers = useCallback(async () => {
    if (!userBusiness) return;
    try {
      const list = await businessesService.getFollowers(userBusiness.id);
      setFollowers(list);
    } catch (error) {
      console.error('Failed to load followers:', error);
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

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays < 1) return 'Today';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (!userBusiness) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <ArrowLeft size={22} color={Colors.text.primary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Followers</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.centerContainer}>
          <Text style={styles.emptySubtitle}>No business profile</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ArrowLeft size={22} color={Colors.text.primary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerIconWrap}>
            <Users size={18} color={Colors.secondary} />
          </View>
          <View>
            <Text style={styles.headerTitle}>Followers</Text>
            <Text style={styles.headerSubtitle}>
              {loading
                ? 'Loading…'
                : `${followers.length} follower${followers.length !== 1 ? 's' : ''}`}
            </Text>
          </View>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <View style={styles.loadingIconWrap}>
            <Users size={28} color={Colors.secondary} />
          </View>
          <ActivityIndicator
            size="large"
            color={Colors.secondary}
            style={{ marginTop: 20 }}
          />
          <Text style={styles.loadingText}>Loading followers…</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            followers.length === 0 && styles.scrollContentEmpty,
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
        >
          {followers.length === 0 ? (
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
          ) : (
            followers.map((follower) => {
              // Rows come straight from the follows table, so user_id should
              // always exist — but guard anyway so a malformed row renders as
              // a non-tappable card instead of navigating to a broken profile.
              const canOpenProfile = !!follower.user_id;
              return (
                <TouchableOpacity
                  key={follower.id}
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
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: Colors.background.primary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border.light,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.background.primary,
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
    backgroundColor: alpha(Colors.secondary, 0.12),
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
    backgroundColor: alpha(Colors.secondary, 0.12),
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
  },
  followerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background.primary,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    gap: 14,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 6,
      },
      android: { elevation: 2 },
    }),
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
