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
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { socialService } from '@/services/social';
import { businessesService } from '@/services/businesses';
import { Business } from '@/types/database';
import { Colors, Typography } from '@/constants/theme';
import { ArrowLeft, Heart, HeartOff, ChevronRight, Building2 } from 'lucide-react-native';
import { Avatar } from '@/components/Avatar';

const Palette = {
  gradientStart: '#6366F1',
  gradientEnd: '#8B5CF6',
  cardBg: '#FFFFFF',
  surfaceMuted: '#F8F9FC',
  accentSoft: 'rgba(99,102,241,0.08)',
  accentMedium: 'rgba(99,102,241,0.14)',
  separator: '#F0F0F5',
  badge: '#6366F1',
};

type FollowedBusiness = Business & { followId: string };

export default function Following() {
  const insets = useSafeAreaInsets();
  const [businesses, setBusinesses] = useState<FollowedBusiness[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unfollowingId, setUnfollowingId] = useState<string | null>(null);

  const loadFollowing = useCallback(async () => {
    try {
      const follows = await socialService.getUserFollows();
      const businessList: FollowedBusiness[] = [];
      for (const f of follows) {
        const biz = await businessesService.getBusiness(f.business_id);
        if (biz) {
          businessList.push({ ...biz, followId: f.id });
        }
      }
      setBusinesses(businessList);
    } catch (error) {
      console.error('Failed to load following:', error);
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

  const handleUnfollow = (business: FollowedBusiness) => {
    Alert.alert(
      'Unfollow',
      `Stop following ${business.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unfollow',
          style: 'destructive',
          onPress: async () => {
            setUnfollowingId(business.id);
            try {
              await socialService.unfollowBusiness(business.id);
              setBusinesses((prev) => prev.filter((b) => b.id !== business.id));
            } catch {
              Alert.alert('Error', 'Failed to unfollow');
            } finally {
              setUnfollowingId(null);
            }
          },
        },
      ]
    );
  };

  const [followerCounts, setFollowerCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (businesses.length === 0) return;
    const loadCounts = async () => {
      const counts: Record<string, number> = {};
      await Promise.all(
        businesses.map(async (b) => {
          const count = await businessesService.getFollowerCount(b.id);
          counts[b.id] = count;
        })
      );
      setFollowerCounts(counts);
    };
    loadCounts();
  }, [businesses]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <ArrowLeft size={22} color={Colors.text.primary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerIconWrap}>
            <Heart size={18} color={Palette.gradientStart} />
          </View>
          <View>
            <Text style={styles.headerTitle}>Following</Text>
            <Text style={styles.headerSubtitle}>
              {loading
                ? 'Loading…'
                : `${businesses.length} business${businesses.length !== 1 ? 'es' : ''}`}
            </Text>
          </View>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <View style={styles.loadingIconWrap}>
            <Heart size={28} color={Palette.gradientStart} />
          </View>
          <ActivityIndicator
            size="large"
            color={Palette.gradientStart}
            style={{ marginTop: 20 }}
          />
          <Text style={styles.loadingText}>Loading businesses you follow…</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            businesses.length === 0 && styles.scrollContentEmpty,
            { paddingBottom: insets.bottom + 40 },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Palette.gradientStart}
              colors={[Palette.gradientStart]}
            />
          }
        >
          {businesses.length === 0 ? (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconWrap}>
                <Heart size={36} color={Palette.gradientStart} />
              </View>
              <Text style={styles.emptyTitle}>Not Following Anyone</Text>
              <Text style={styles.emptySubtitle}>
                Follow businesses to see their events first and get notified when they post something new.
              </Text>
              <TouchableOpacity
                style={styles.exploreCta}
                onPress={() => router.push('/(tabs)/discover' as never)}
                activeOpacity={0.8}
              >
                <Text style={styles.exploreCtaText}>Discover Events</Text>
                <ChevronRight size={16} color={Palette.gradientStart} />
              </TouchableOpacity>
            </View>
          ) : (
            businesses.map((business) => (
              <TouchableOpacity
                key={business.id}
                style={styles.businessCard}
                onPress={() => router.push(`/business/${business.id}` as never)}
                activeOpacity={0.8}
              >
                <View style={styles.followStrip} />
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
                        <Building2 size={12} color={Colors.text.tertiary} />
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
                    >
                      <HeartOff size={18} color={Colors.error} />
                      <Text style={styles.unfollowText}>Unfollow</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.cardFooter}>
                    <Text style={styles.viewLabel}>View events</Text>
                    <ChevronRight size={16} color={Palette.gradientStart} />
                  </View>
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Palette.surfaceMuted,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: Palette.cardBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Palette.separator,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Palette.surfaceMuted,
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
    backgroundColor: Palette.accentSoft,
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
    backgroundColor: Palette.accentSoft,
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
    backgroundColor: Palette.accentSoft,
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
    marginBottom: 24,
  },
  exploreCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: Palette.accentSoft,
  },
  exploreCtaText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Palette.gradientStart,
  },
  businessCard: {
    flexDirection: 'row',
    backgroundColor: Palette.cardBg,
    borderRadius: 20,
    marginBottom: 12,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
      },
      android: { elevation: 3 },
    }),
  },
  followStrip: {
    width: 4,
    backgroundColor: Palette.badge,
    borderTopLeftRadius: 20,
    borderBottomLeftRadius: 20,
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
    backgroundColor: 'rgba(239,68,68,0.1)',
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
    borderTopColor: Palette.separator,
  },
  viewLabel: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Palette.gradientStart,
  },
});
