import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import {
  ArrowLeft,
  BarChart3,
  CalendarClock,
  Crown,
  Eye,
  Heart,
  Star,
  TrendingUp,
  UserRound,
  Users,
} from 'lucide-react-native';
import { useApp } from '@/contexts/AppContext';
import { usePremium } from '@/contexts/PremiumContext';
import { analyticsService, type AnalyticsTopEvent, type AnalyticsTrendPoint } from '@/services/analytics';
import { Business } from '@/types/database';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';

const Palette = {
  gradientStart: Colors.primary,
  gradientEnd: Colors.accent,
  cardBg: Colors.background.primary,
  surfaceMuted: Colors.background.primary,
  accentSoft: 'rgba(196, 92, 62, 0.12)',
  separator: Colors.border.light,
};

const PERIOD_OPTIONS = [7, 30, 90] as const;
type PeriodDays = (typeof PERIOD_OPTIONS)[number];

type AnalyticsData = {
  totalPosts: number;
  postsThisPeriod: number;
  recurringPosts: number;
  upcomingEvents: number;
  totalViews: number;
  totalSaves: number;
  totalRsvps: number;
  engagementRate: number;
  followerTotal: number;
  followersThisPeriod: number;
  averageRating: number;
  reviewCount: number;
  profileCompleteness: number;
  topEvents: AnalyticsTopEvent[];
  trend: AnalyticsTrendPoint[];
};

function emptyAnalytics(): AnalyticsData {
  return {
    totalPosts: 0,
    postsThisPeriod: 0,
    recurringPosts: 0,
    upcomingEvents: 0,
    totalViews: 0,
    totalSaves: 0,
    totalRsvps: 0,
    engagementRate: 0,
    followerTotal: 0,
    followersThisPeriod: 0,
    averageRating: 0,
    reviewCount: 0,
    profileCompleteness: 0,
    topEvents: [],
    trend: [],
  };
}

export default function ProfileAnalyticsScreen() {
  const insets = useSafeAreaInsets();
  const { userBusiness, userMode, setUserMode, hasBusiness } = useApp();
  const { isPremium, canUse, currentPlan } = usePremium();

  const canAccessAnalytics = isPremium && canUse('analytics');
  const [period, setPeriod] = useState<PeriodDays>(30);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [data, setData] = useState<AnalyticsData>(emptyAnalytics());

  const isBusinessMode = userMode === 'business';

  const loadAnalytics = useCallback(async () => {
    if (!userBusiness || !canAccessAnalytics) {
      setData(emptyAnalytics());
      setErrorMessage(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      setErrorMessage(null);
      const analytics = await analyticsService.getBusinessAnalytics(
        userBusiness.id,
        period
      );

      setData({
        ...analytics,
        profileCompleteness: getProfileCompleteness(
          userBusiness,
          analytics.totalPosts
        ),
        topEvents: analytics.topEvents.slice(0, 3),
      });
    } catch (error) {
      console.error('Failed to load analytics data', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to load analytics data.'
      );
      setData(emptyAnalytics());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userBusiness, canAccessAnalytics, period]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadAnalytics();
    }, [loadAnalytics])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadAnalytics();
  }, [loadAnalytics]);

  const trendMax = useMemo(
    () => Math.max(...data.trend.map((point) => point.views), 0),
    [data.trend]
  );

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[Palette.gradientStart, Palette.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + Spacing.md }]}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.8}
          >
            <ArrowLeft size={18} color={Colors.text.inverse} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Analytics</Text>
          <View style={styles.headerRight}>
            <BarChart3 size={18} color={Colors.text.inverse} />
          </View>
        </View>
        <Text style={styles.headerSubtitle}>
          Posts, event engagement, and profile growth insights
        </Text>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {!hasBusiness ? (
          <EmptyStateCard
            title="Business profile required"
            description="Create a business profile to unlock analytics and event insights."
            ctaLabel="Create Business"
            onPress={() => router.push('/business/onboarding' as never)}
          />
        ) : !isBusinessMode ? (
          <EmptyStateCard
            title="Switch to business mode"
            description="Analytics are available while you're in business mode."
            ctaLabel="Switch Mode"
            onPress={() => setUserMode('business')}
          />
        ) : !canAccessAnalytics ? (
          <LockedAnalytics planName={currentPlan?.name ?? 'Premium'} />
        ) : errorMessage ? (
          <ErrorStateCard
            title="Failed to load analytics"
            description={errorMessage}
            ctaLabel="Try Again"
            onPress={onRefresh}
          />
        ) : loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={Palette.gradientStart} />
            <Text style={styles.loadingText}>Loading analytics...</Text>
          </View>
        ) : (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Time Window</Text>
              <View style={styles.periodRow}>
                {PERIOD_OPTIONS.map((option) => (
                  <TouchableOpacity
                    key={option}
                    style={[
                      styles.periodChip,
                      period === option && styles.periodChipActive,
                    ]}
                    onPress={() => setPeriod(option)}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.periodChipText,
                        period === option && styles.periodChipTextActive,
                      ]}
                    >
                      {option} days
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Posts</Text>
              <View style={styles.kpiGrid}>
                <KpiCard icon={<CalendarClock size={16} color={Colors.primary} />} label="Total Posts" value={formatNumber(data.totalPosts)} />
                <KpiCard icon={<TrendingUp size={16} color={Colors.primary} />} label={`Posted (${period}d)`} value={formatNumber(data.postsThisPeriod)} />
                <KpiCard icon={<BarChart3 size={16} color={Colors.primary} />} label="Recurring" value={formatNumber(data.recurringPosts)} />
                <KpiCard icon={<CalendarClock size={16} color={Colors.primary} />} label="Upcoming" value={formatNumber(data.upcomingEvents)} />
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Events</Text>
              <View style={styles.kpiGrid}>
                <KpiCard icon={<Eye size={16} color={Colors.secondary} />} label="Views" value={formatNumber(data.totalViews)} />
                <KpiCard icon={<Heart size={16} color={Colors.secondary} />} label="Saves" value={formatNumber(data.totalSaves)} />
                <KpiCard icon={<Users size={16} color={Colors.secondary} />} label="RSVPs" value={formatNumber(data.totalRsvps)} />
                <KpiCard icon={<TrendingUp size={16} color={Colors.secondary} />} label="Engagement" value={`${data.engagementRate.toFixed(1)}%`} />
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Profile</Text>
              <View style={styles.kpiGrid}>
                <KpiCard icon={<Users size={16} color={Colors.accentDark} />} label="Followers" value={formatNumber(data.followerTotal)} />
                <KpiCard icon={<TrendingUp size={16} color={Colors.accentDark} />} label={`New (${period}d)`} value={formatNumber(data.followersThisPeriod)} />
                <KpiCard icon={<Star size={16} color={Colors.accentDark} />} label="Avg Rating" value={data.reviewCount > 0 ? data.averageRating.toFixed(1) : '—'} />
                <KpiCard icon={<UserRound size={16} color={Colors.accentDark} />} label="Profile Health" value={`${data.profileCompleteness}%`} />
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Top Events</Text>
              <View style={styles.card}>
                {data.topEvents.length === 0 ? (
                  <Text style={styles.emptyInlineText}>No event data yet.</Text>
                ) : (
                  data.topEvents.map((event, index) => (
                    <View
                      key={event.id}
                      style={[
                        styles.topEventRow,
                        index < data.topEvents.length - 1 && styles.topEventSeparator,
                      ]}
                    >
                      <View style={styles.topEventMain}>
                        <Text style={styles.topEventTitle} numberOfLines={1}>
                          {event.title}
                        </Text>
                        <Text style={styles.topEventMeta}>
                          {formatNumber(event.views)} views • {formatNumber(event.saves)} saves •{' '}
                          {formatNumber(event.rsvps)} RSVPs
                        </Text>
                      </View>
                      <View style={styles.topEventPill}>
                        <Text style={styles.topEventPillText}>
                          {event.conversion.toFixed(1)}%
                        </Text>
                      </View>
                    </View>
                  ))
                )}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Engagement Trend</Text>
              <View style={styles.card}>
                {data.trend.length === 0 ? (
                  <Text style={styles.emptyInlineText}>No trend data available yet.</Text>
                ) : (
                  <>
                    <View style={styles.trendBars}>
                      {data.trend.slice(-10).map((point) => (
                        <View key={point.date} style={styles.trendBarWrap}>
                          <View
                            style={[
                              styles.trendBar,
                              {
                                height: Math.max(
                                  8,
                                  trendMax > 0 ? (point.views / trendMax) * 84 : 8
                                ),
                              },
                            ]}
                          />
                        </View>
                      ))}
                    </View>
                    <Text style={styles.trendCaption}>
                      Last {Math.min(10, data.trend.length)} periods from top events
                    </Text>
                  </>
                )}
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function LockedAnalytics({ planName }: { planName: string }) {
  return (
    <View style={styles.lockedWrap}>
      <View style={styles.lockedIcon}>
        <Crown size={24} color={Colors.accent} />
      </View>
      <Text style={styles.lockedTitle}>Premium analytics is locked</Text>
      <Text style={styles.lockedDescription}>
        Activate a premium subscription to access business analytics for posts, events, and profile performance.
      </Text>
      <TouchableOpacity
        style={styles.lockedButton}
        onPress={() => router.push('/premium/plans' as never)}
        activeOpacity={0.85}
      >
        <Text style={styles.lockedButtonText}>Upgrade to Premium</Text>
      </TouchableOpacity>
      <Text style={styles.lockedFootnote}>Current plan: {planName}</Text>
    </View>
  );
}

function EmptyStateCard({
  title,
  description,
  ctaLabel,
  onPress,
}: {
  title: string;
  description: string;
  ctaLabel: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.emptyStateCard}>
      <Text style={styles.emptyStateTitle}>{title}</Text>
      <Text style={styles.emptyStateDescription}>{description}</Text>
      <TouchableOpacity style={styles.emptyStateButton} onPress={onPress} activeOpacity={0.85}>
        <Text style={styles.emptyStateButtonText}>{ctaLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

function ErrorStateCard({
  title,
  description,
  ctaLabel,
  onPress,
}: {
  title: string;
  description: string;
  ctaLabel: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.emptyStateCard}>
      <Text style={styles.emptyStateTitle}>{title}</Text>
      <Text style={styles.emptyStateDescription}>{description}</Text>
      <TouchableOpacity style={styles.emptyStateButton} onPress={onPress} activeOpacity={0.85}>
        <Text style={styles.emptyStateButtonText}>{ctaLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

function KpiCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.kpiCard}>
      <View style={styles.kpiIcon}>{icon}</View>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

function getProfileCompleteness(
  business: Business,
  totalPosts: number
) {
  const checks = [
    !!business.logo_url,
    !!business.description?.trim(),
    !!business.contact_email?.trim(),
    !!business.address?.trim(),
    !!business.category?.trim(),
    !!business.social_handles?.instagram || !!business.social_handles?.facebook,
    totalPosts > 0,
  ];
  const filled = checks.filter(Boolean).length;
  return Math.round((filled / checks.length) * 100);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', {
    notation: value >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value);
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Palette.surfaceMuted,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    marginBottom: Spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    marginRight: 36,
    color: Colors.text.inverse,
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  headerRight: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: Typography.sizes.sm,
    lineHeight: 20,
  },
  section: {
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
  },
  sectionTitle: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: Spacing.sm,
    marginLeft: 2,
  },
  periodRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  periodChip: {
    flex: 1,
    alignItems: 'center',
    borderRadius: BorderRadius.md,
    paddingVertical: 10,
    backgroundColor: Colors.background.secondary,
    borderWidth: 1,
    borderColor: Colors.border.light,
  },
  periodChipActive: {
    backgroundColor: 'rgba(196,92,62,0.12)',
    borderColor: 'rgba(196,92,62,0.35)',
  },
  periodChipText: {
    color: Colors.text.secondary,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
  },
  periodChipTextActive: {
    color: Colors.primary,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  kpiCard: {
    width: '48.5%',
    backgroundColor: Palette.cardBg,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Palette.separator,
    ...Shadows.sm,
  },
  kpiIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.accentSoft,
    marginBottom: 10,
  },
  kpiValue: {
    fontSize: 20,
    color: Colors.text.primary,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  kpiLabel: {
    marginTop: 2,
    color: Colors.text.tertiary,
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
  },
  card: {
    backgroundColor: Palette.cardBg,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Palette.separator,
    overflow: 'hidden',
    ...Shadows.sm,
  },
  topEventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
  },
  topEventSeparator: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Palette.separator,
  },
  topEventMain: {
    flex: 1,
  },
  topEventTitle: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  topEventMeta: {
    marginTop: 3,
    fontSize: Typography.sizes.xs,
    color: Colors.text.tertiary,
  },
  topEventPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: BorderRadius.round,
    backgroundColor: 'rgba(13,79,79,0.1)',
  },
  topEventPillText: {
    color: Colors.secondary,
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  trendBars: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 100,
  },
  trendBarWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  trendBar: {
    width: 12,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    backgroundColor: Colors.primary,
  },
  trendCaption: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    paddingTop: Spacing.xs,
    fontSize: Typography.sizes.xs,
    color: Colors.text.tertiary,
  },
  emptyInlineText: {
    padding: Spacing.md,
    fontSize: Typography.sizes.sm,
    color: Colors.text.tertiary,
  },
  loadingWrap: {
    alignItems: 'center',
    marginTop: 80,
  },
  loadingText: {
    marginTop: Spacing.sm,
    color: Colors.text.secondary,
  },
  lockedWrap: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.xl,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    backgroundColor: Palette.cardBg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Palette.separator,
    ...Shadows.md,
  },
  lockedIcon: {
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(232,168,56,0.15)',
    marginBottom: Spacing.md,
  },
  lockedTitle: {
    textAlign: 'center',
    fontSize: Typography.sizes.lg,
    color: Colors.text.primary,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  lockedDescription: {
    marginTop: Spacing.sm,
    textAlign: 'center',
    color: Colors.text.secondary,
    fontSize: Typography.sizes.sm,
    lineHeight: 20,
  },
  lockedButton: {
    marginTop: Spacing.lg,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 12,
  },
  lockedButtonText: {
    color: Colors.text.inverse,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  lockedFootnote: {
    marginTop: Spacing.sm,
    color: Colors.text.tertiary,
    fontSize: Typography.sizes.xs,
  },
  emptyStateCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.xl,
    borderRadius: BorderRadius.lg,
    backgroundColor: Palette.cardBg,
    borderWidth: 1,
    borderColor: Palette.separator,
    padding: Spacing.lg,
    ...Shadows.sm,
  },
  emptyStateTitle: {
    fontSize: Typography.sizes.lg,
    color: Colors.text.primary,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  emptyStateDescription: {
    marginTop: Spacing.xs,
    color: Colors.text.secondary,
    lineHeight: 20,
    fontSize: Typography.sizes.sm,
  },
  emptyStateButton: {
    marginTop: Spacing.md,
    alignSelf: 'flex-start',
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  emptyStateButtonText: {
    color: Colors.text.inverse,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
});
