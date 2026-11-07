import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
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
import { router } from 'expo-router';
import {
  BarChart3,
  CalendarClock,
  CalendarPlus,
  Crown,
  Eye,
  Heart,
  MapPin,
  Share2,
  Star,
  Ticket,
  TrendingUp,
  UserRound,
  Users,
} from '@/components/icons.generated';
import { useApp } from '@/contexts/AppContext';
import { usePremium } from '@/contexts/PremiumContext';
import {
  analyticsService,
  type AnalyticsTopEvent,
  type AnalyticsTrendPoint,
  type BusinessAnalytics,
} from '@/services/analytics';
import { queryKeys } from '@/hooks/queryKeys';
import { useRefetchOnFocus } from '@/hooks/useRefetchOnFocus';
import { TrendBars } from '@/components/analytics/TrendBars';
import { KpiTile } from '@/components/analytics/KpiTile';
import { ProUpsellCard } from '@/components/analytics/ProUpsellCard';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Business } from '@/types/database';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { alpha, Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';

const PERIOD_OPTIONS = [7, 30, 90] as const;
type PeriodDays = (typeof PERIOD_OPTIONS)[number];
type PeriodKey = '7' | '30' | '90';
// Same selector as event insights.
const PERIOD_SEGMENTS = PERIOD_OPTIONS.map((days) => ({ value: String(days) as PeriodKey, label: `${days} days` }));

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
  /** Server tier (20261104100000); null on older backends (client gating then). */
  tier: 'free' | 'premium' | null;
  periodDays: number;
  /** Premium window tap totals (20261104090000); null otherwise. */
  interactionTotals: BusinessAnalytics['interactionTotals'];
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
    tier: null,
    periodDays: 30,
    interactionTotals: null,
  };
}

export default function ProfileAnalyticsScreen() {
  const insets = useSafeAreaInsets();
  const { userBusiness, userMode, setUserMode, hasBusiness } = useApp();
  const { isPremium, canUse, currentPlan } = usePremium();

  const canAccessAnalytics = isPremium && canUse('analytics');
  const [period, setPeriod] = useState<PeriodDays>(30);
  const isBusinessMode = userMode === 'business';

  // Every owner loads: with 20261104100000 the server returns totals to free
  // businesses and keeps the premium sections empty. Previous data stays on
  // screen while a new period loads.
  const query = useQuery({
    queryKey: queryKeys.businessAnalytics(userBusiness?.id, period),
    enabled: !!userBusiness && isBusinessMode,
    queryFn: () => analyticsService.getBusinessAnalytics(userBusiness!.id, period),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  useRefetchOnFocus(
    query.refetch,
    !!userBusiness && isBusinessMode,
    queryKeys.businessAnalytics(userBusiness?.id, period)
  );
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void query.refetch().finally(() => setRefreshing(false));
  }, [query]);

  const loading = query.isPending && query.fetchStatus !== 'idle';
  const fetching = query.isFetching && !loading;
  // A failed refetch keeps the last loaded numbers; the error card is only
  // for "nothing loaded for this period".
  const errorMessage = query.isError && !query.data
    ? query.error instanceof Error
      ? query.error.message
      : 'Failed to load analytics data.'
    : null;
  const data = useMemo<AnalyticsData>(() => {
    if (!query.data || !userBusiness) return emptyAnalytics();
    return {
      ...query.data,
      profileCompleteness: getProfileCompleteness(userBusiness, query.data.totalPosts),
      topEvents: query.data.topEvents.slice(0, 3),
    };
  }, [query.data, userBusiness]);

  // Server tier wins (an expired plan is free even if the client still thinks
  // otherwise); older backends report no tier and keep the client gate.
  const premiumView = data.tier ? data.tier === 'premium' : canAccessAnalytics;
  const fullyLocked = data.tier === null && !canAccessAnalytics;
  const shownPeriod = premiumView ? period : data.periodDays;

  const trendPoints = useMemo(
    () => data.trend.map((point) => ({ date: point.date, value: point.views })),
    [data.trend]
  );

  return (
    <View style={styles.root}>
      {/* Header sits above the gradient so ScreenHeader's dark text stays legible. */}
      <ScreenHeader
        title="Analytics"
        right={<BarChart3 size={18} color={Colors.text.secondary} />}
      />
      <LinearGradient
        colors={[Colors.primary, Colors.secondary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
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
        ) : loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>Loading analytics...</Text>
          </View>
        ) : fullyLocked ? (
          <LockedAnalytics planName={currentPlan?.name ?? 'Premium'} />
        ) : errorMessage ? (
          <ErrorStateCard
            title="Failed to load analytics"
            description={errorMessage}
            ctaLabel="Try Again"
            onPress={onRefresh}
          />
        ) : (
          <>
            {premiumView ? (
            <View style={styles.section}>
              <View style={styles.sectionTitleRow}>
                <Text style={[styles.sectionTitle, styles.sectionTitleInRow]}>
                  Time Window
                </Text>
                {fetching && !refreshing ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : null}
              </View>
              <SegmentedControl<PeriodKey>
                options={PERIOD_SEGMENTS}
                value={String(period) as PeriodKey}
                onChange={(next) => setPeriod(Number(next) as PeriodDays)}
              />
            </View>
            ) : (
              <View style={styles.section}>
                <Text style={styles.freeWindowNote}>
                  All-time totals; posts and followers also show the last {data.periodDays} days.
                </Text>
              </View>
            )}

            {/* Dim (don't unmount) the dashboard while a refetch is in flight. */}
            <View style={fetching ? styles.contentFetching : null}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Posts</Text>
              <View style={styles.kpiGrid}>
                <KpiCard icon={<CalendarClock size={16} color={Colors.primary} />} label="Total Posts" value={formatNumber(data.totalPosts)} />
                <KpiCard icon={<TrendingUp size={16} color={Colors.primary} />} label={`Posted (${shownPeriod}d)`} value={formatNumber(data.postsThisPeriod)} />
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
                <KpiCard icon={<TrendingUp size={16} color={Colors.accentDark} />} label={`New (${shownPeriod}d)`} value={formatNumber(data.followersThisPeriod)} />
                <KpiCard icon={<Star size={16} color={Colors.accentDark} />} label="Avg Rating" value={data.reviewCount > 0 ? data.averageRating.toFixed(1) : '—'} />
                <KpiCard icon={<UserRound size={16} color={Colors.accentDark} />} label="Profile Health" value={`${data.profileCompleteness}%`} />
              </View>
            </View>

            {premiumView ? (
            <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Top Events</Text>
              <View style={styles.card}>
                {data.topEvents.length === 0 ? (
                  <Text style={styles.emptyInlineText}>No event data yet.</Text>
                ) : (
                  data.topEvents.map((event, index) => (
                    <TouchableOpacity
                      key={event.id}
                      style={[
                        styles.topEventRow,
                        index < data.topEvents.length - 1 && styles.topEventSeparator,
                      ]}
                      onPress={() => router.push(`/business/event-insights/${event.id}` as never)}
                      accessibilityRole="button"
                      accessibilityLabel={`${event.title}: open event insights`}
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
                    </TouchableOpacity>
                  ))
                )}
              </View>
            </View>

            {data.interactionTotals ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Taps ({shownPeriod}d)</Text>
                <View style={styles.kpiGrid}>
                  <KpiCard icon={<Share2 size={16} color={Colors.primary} />} label="Shares" value={formatNumber(data.interactionTotals.share)} />
                  <KpiCard icon={<CalendarPlus size={16} color={Colors.primary} />} label="Calendar adds" value={formatNumber(data.interactionTotals.calendar)} />
                  <KpiCard icon={<MapPin size={16} color={Colors.primary} />} label="Directions" value={formatNumber(data.interactionTotals.directions)} />
                  <KpiCard icon={<Ticket size={16} color={Colors.primary} />} label="Ticket link" value={formatNumber(data.interactionTotals.ticket)} />
                </View>
              </View>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Engagement Trend</Text>
              <View style={styles.card}>
                {data.trend.length === 0 ? (
                  <Text style={styles.emptyInlineText}>No trend data available yet.</Text>
                ) : (
                  <>
                    <View style={styles.trendChart}>
                      <TrendBars points={trendPoints} metricLabel="views" color={Colors.primary} />
                    </View>
                    <Text style={styles.trendCaption}>Daily views, last {data.trend.length} days</Text>
                  </>
                )}
              </View>
            </View>
            </>
            ) : (
              <View style={styles.section}>
                <ProUpsellCard
                  title="More with Pro"
                  description="Each event's own counts stay free in its insights."
                  items={['Your top events', 'Daily engagement trend', 'Shares, calendar adds and directions', 'A custom time window']}
                />
              </View>
            )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

/** Illustrative bar heights for the locked-state sample chart. */
const SAMPLE_TREND = [18, 34, 26, 48, 38, 64, 52];
const SAMPLE_TREND_MAX = Math.max(...SAMPLE_TREND);

function LockedAnalytics({ planName }: { planName: string }) {
  return (
    <View style={styles.lockedTeaserWrap}>
      {/* Sample dashboard behind the overlay — decorative, hidden from a11y. */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={styles.sampleBadge}>
          <Text style={styles.sampleBadgeText}>Sample data</Text>
        </View>
        <View style={styles.kpiGrid}>
          <KpiCard icon={<Eye size={16} color={Colors.secondary} />} label="Views" value="1.2K" />
          <KpiCard icon={<Heart size={16} color={Colors.secondary} />} label="Saves" value="248" />
          <KpiCard icon={<Users size={16} color={Colors.secondary} />} label="RSVPs" value="86" />
          <KpiCard icon={<TrendingUp size={16} color={Colors.secondary} />} label="Engagement" value="27.8%" />
        </View>
        <View style={[styles.card, styles.sampleChartCard]}>
          <View style={styles.trendBars}>
            {SAMPLE_TREND.map((value, index) => (
              <View key={index} style={styles.trendBarWrap}>
                <View
                  style={[
                    styles.trendBar,
                    { height: (value / SAMPLE_TREND_MAX) * 84 },
                  ]}
                />
              </View>
            ))}
          </View>
          <Text style={styles.trendCaption}>Engagement trend (sample)</Text>
        </View>
      </View>

      <View style={styles.lockedOverlay}>
        <View style={styles.lockedCard}>
          <View style={styles.lockedIcon}>
            <Crown size={24} color={Colors.premium} />
          </View>
          <Text style={styles.lockedTitle}>Unlock analytics for your business</Text>
          <Text style={styles.lockedDescription}>
            Upgrade to Pro to see real views, saves, RSVPs, and follower
            growth for your posts and profile.
          </Text>
          <TouchableOpacity
            style={styles.lockedButton}
            onPress={() => router.push('/premium/plans' as never)}
            activeOpacity={0.85}
          >
            <Text style={styles.lockedButtonText}>View Pro plans</Text>
          </TouchableOpacity>
          <Text style={styles.lockedFootnote}>Current plan: {planName}</Text>
        </View>
      </View>
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

function KpiCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <KpiTile icon={icon} label={label} value={value} style={styles.kpiCard} />;
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
    backgroundColor: Colors.background.primary,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    marginBottom: Spacing.md,
  },
  headerSubtitle: {
    color: alpha(Colors.white, 0.85),
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
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
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
    marginLeft: 2,
  },
  sectionTitleInRow: {
    marginBottom: 0,
    marginLeft: 0,
  },
  contentFetching: {
    opacity: 0.6,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  kpiCard: {
    width: '48.5%',
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border.light,
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
    borderBottomColor: Colors.border.light,
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
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
  },
  topEventPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: BorderRadius.round,
    backgroundColor: alpha(Colors.secondary, 0.1),
  },
  topEventPillText: {
    color: Colors.secondary,
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  freeWindowNote: {
    fontSize: Typography.sizes.xs,
    color: Colors.text.tertiary,
    lineHeight: 18,
  },
  trendBars: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    // 84pt max bar + value label + top padding.
    height: 112,
    // Baseline axis the bars sit on; zero bars read as zero against it.
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border.medium,
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
  trendBarValue: {
    marginBottom: 2,
    fontSize: 10,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.tertiary,
  },
  trendChart: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
  },
  trendCaption: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    paddingTop: Spacing.xs,
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
  },
  emptyInlineText: {
    padding: Spacing.md,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
  },
  loadingWrap: {
    alignItems: 'center',
    marginTop: 80,
  },
  loadingText: {
    marginTop: Spacing.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
  },
  lockedTeaserWrap: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
  },
  sampleBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.background.primary,
    borderWidth: 1,
    borderColor: Colors.border.light,
    marginBottom: Spacing.sm,
  },
  sampleBadgeText: {
    fontSize: 10,
    color: Colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontFamily: Typography.fontFamilies.semibold,
  },
  sampleChartCard: {
    marginTop: Spacing.sm,
  },
  lockedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: alpha(Colors.surface, 0.7),
    borderRadius: BorderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.md,
  },
  lockedCard: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: Colors.border.light,
    ...Shadows.md,
  },
  lockedIcon: {
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.premiumSoft,
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
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border.light,
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
    fontFamily: Typography.fontFamily,
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
