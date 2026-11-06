import { useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarPlus,
  Eye,
  Heart,
  Hourglass,
  MapPin,
  Megaphone,
  MessageCircle,
  Share2,
  Ticket,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react-native';
import { queryKeys } from '@/hooks/queryKeys';
import { shouldRetryQuery } from '@/utils/queryRetry';
import { useRefetchOnFocus } from '@/hooks/useRefetchOnFocus';
import { analyticsService, InsightsForbiddenError, InsightsNotFoundError } from '@/services/analytics';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ErrorState } from '@/components/ui/ErrorState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { TrendBars } from '@/components/analytics/TrendBars';
import { KpiTile } from '@/components/analytics/KpiTile';
import { ProUpsellCard } from '@/components/analytics/ProUpsellCard';
import { AnalyticsSection } from '@/components/analytics/AnalyticsSection';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import {
  announcementReadRate,
  deltaVsMedian,
  describeRsvpChanges,
  dropOffRate,
  INTERACTION_LABELS,
  interactionTotal,
  formatPercent,
  funnelSteps,
  leadTimeSummary,
  type EventInsights,
  type MedianDelta,
} from '@/utils/analytics';
import { describeEventDateTime } from '@/utils/timezone';

type Period = '7' | '30' | '90';
type TrendMetric = 'views' | 'saves' | 'going';

const PERIOD_OPTIONS = [
  { value: '7' as const, label: '7 days' },
  { value: '30' as const, label: '30 days' },
  { value: '90' as const, label: '90 days' },
];
const METRIC_OPTIONS = [
  { value: 'views' as const, label: 'Views' },
  { value: 'saves' as const, label: 'Saves' },
  { value: 'going' as const, label: 'Going' },
];
const INTERACTION_ICONS = {
  share: <Share2 size={16} color={Colors.primary} />,
  calendar: <CalendarPlus size={16} color={Colors.success} />,
  directions: <MapPin size={16} color={Colors.secondary} />,
  ticket: <Ticket size={16} color={Colors.accentDark} />,
} as const;

const METRIC_COLORS: Record<TrendMetric, string> = {
  views: Colors.primary,
  saves: Colors.accentDark,
  going: Colors.success,
};

export default function EventInsightsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [period, setPeriod] = useState<Period>('30');
  const [metric, setMetric] = useState<TrendMetric>('views');
  const days = Number(period);

  const query = useQuery({
    queryKey: queryKeys.eventInsights(id, days),
    enabled: !!id,
    queryFn: () => analyticsService.getEventInsights(id!, days),
    staleTime: 60_000,
    retry: (count, error) =>
      !(error instanceof InsightsForbiddenError || error instanceof InsightsNotFoundError) &&
      shouldRetryQuery(count, error),
  });
  useRefetchOnFocus(query.refetch, !!id);
  const [pulling, setPulling] = useState(false);

  const data = query.data;

  let body: ReactNode;
  if (query.isPending) {
    body = (
      <View style={styles.center} accessibilityLabel="Loading insights" accessibilityState={{ busy: true }}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  } else if (query.error instanceof InsightsForbiddenError) {
    body = (
      <ErrorState
        title="Insights are for the host"
        message="Only the business that hosts this event can see its insights."
        onRetry={() => router.back()}
        retryLabel="Go back"
        style={styles.center}
      />
    );
  } else if (query.error instanceof InsightsNotFoundError) {
    body = (
      <ErrorState
        title="Event not found"
        message="It may have been deleted."
        onRetry={() => router.back()}
        retryLabel="Go back"
        style={styles.center}
      />
    );
  } else if (!data) {
    // A failed refetch keeps the last insights on screen.
    body = (
      <ErrorState
        title="Couldn't load insights"
        message="Check your connection and try again."
        onRetry={() => void query.refetch()}
        style={styles.center}
      />
    );
  } else {
    body = (
      <InsightsBody
        data={data}
        period={period}
        onPeriodChange={setPeriod}
        metric={metric}
        onMetricChange={setMetric}
        refreshing={query.isFetching && !pulling}
      />
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title="Event insights" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={() => {
              setPulling(true);
              void query.refetch().finally(() => setPulling(false));
            }}
            tintColor={Colors.primary}
          />
        }
      >
        {body}
      </ScrollView>
    </View>
  );
}

function InsightsBody({
  data,
  period,
  onPeriodChange,
  metric,
  onMetricChange,
  refreshing,
}: {
  data: EventInsights;
  period: Period;
  onPeriodChange: (w: Period) => void;
  metric: TrendMetric;
  onMetricChange: (m: TrendMetric) => void;
  refreshing: boolean;
}) {
  const { totals, event } = data;
  const premium = data.tier === 'premium' && data.source === 'insights_rpc';
  const funnel = useMemo(() => funnelSteps(totals), [totals]);
  const viewsDelta = deltaVsMedian(totals.views, data.businessMedian?.views);
  const goingDelta = deltaVsMedian(totals.going, data.businessMedian?.going);
  const trendPoints = useMemo(
    () =>
      (data.trend ?? []).map((p) => ({
        date: p.date,
        value: metric === 'views' ? p.views : metric === 'saves' ? p.saves : p.going,
      })),
    [data.trend, metric]
  );
  const statusBadge =
    event.status === 'cancelled' ? 'Cancelled' : event.status === 'postponed' ? 'Postponed' : null;
  const showRequested = event.rsvpMode === 'approval' || totals.requested > 0;
  const showWaitlist = event.maxAttendees !== null || totals.waitlist > 0;
  // The overview fallback has no per-window saves / RSVP counts.
  const hasPeriodCounts = data.source === 'insights_rpc';
  // Event-zone start with a "your time" line, like Event Detail and the lists.
  const startDisplay = event.startDatetime ? describeEventDateTime(event.startDatetime, event.timezone) : null;

  return (
    <View style={styles.body}>
      {/* Header */}
      <View style={styles.card}>
        <View style={styles.titleRow}>
          <Text style={styles.eventTitle} numberOfLines={2}>
            {event.title}
          </Text>
          {statusBadge ? (
            <View style={styles.statusBadge}>
              <Text style={styles.statusBadgeText}>{statusBadge}</Text>
            </View>
          ) : null}
          {refreshing ? <ActivityIndicator size="small" color={Colors.text.tertiary} /> : null}
        </View>
        {startDisplay ? (
          <Text style={styles.muted}>
            {event.isRecurring ? 'Repeating series · first ' : ''}
            {startDisplay.primary}
            {startDisplay.secondary ? `\n${startDisplay.secondary}` : ''}
          </Text>
        ) : null}
        {viewsDelta || goingDelta ? (
          <View style={styles.deltaRow}>
            {viewsDelta ? <DeltaPill label="Views" delta={viewsDelta} /> : null}
            {goingDelta ? <DeltaPill label="Going" delta={goingDelta} /> : null}
          </View>
        ) : null}
      </View>

      {/* Period */}
      {premium ? (
        <Section title="Time window" card={false}>
          <SegmentedControl<Period> options={PERIOD_OPTIONS} value={period} onChange={onPeriodChange} />
        </Section>
      ) : (
        <Text style={styles.windowNote}>
          {data.source === 'overview_fallback'
            ? 'All-time totals'
            : `All-time totals. Views, saves and RSVPs also show the last ${data.periodDays} days.`}
        </Text>
      )}

      {/* Counts (every host) */}
      <Section title="At a glance" card={false}>
        <View style={styles.kpiGrid}>
          <Kpi
            icon={<Eye size={16} color={Colors.primary} />}
            label="Views"
            value={totals.views}
            hint={`${totals.viewsPeriod} in the last ${data.source === 'overview_fallback' ? 7 : data.periodDays} days`}
          />
          {/* The overview fallback has no distinct-viewer count; don't show a guess. */}
          {data.source === 'insights_rpc' ? (
            <Kpi icon={<UserCheck size={16} color={Colors.primary} />} label="People who viewed" value={totals.uniqueViewers} />
          ) : null}
          <Kpi
            icon={<Heart size={16} color={Colors.accentDark} />}
            label="Saves"
            value={totals.saves}
            hint={hasPeriodCounts ? `${totals.savesPeriod} in the last ${data.periodDays} days` : undefined}
          />
          <Kpi
            icon={<Users size={16} color={Colors.success} />}
            label="Going"
            value={totals.going}
            hint={
              [
                event.maxAttendees ? `of ${event.maxAttendees} spots` : null,
                hasPeriodCounts ? `${totals.goingPeriod} new in ${data.periodDays} days` : null,
              ]
                .filter(Boolean)
                .join(' · ') || undefined
            }
            fill={totals.fillRate}
          />
          <Kpi icon={<Users size={16} color={Colors.secondary} />} label="Interested" value={totals.interested} />
          {showWaitlist ? (
            <Kpi icon={<Hourglass size={16} color={Colors.secondary} />} label="Waitlist" value={totals.waitlist} />
          ) : null}
          {showRequested ? (
            <Kpi icon={<UserPlus size={16} color={Colors.primary} />} label="Requests" value={totals.requested} />
          ) : null}
        </View>
      </Section>

      {/* Funnel (every host) */}
      <Section title="From view to RSVP">
        {funnel.map((step) => (
          <View key={step.key} style={styles.funnelRow}>
            <Text style={styles.funnelLabel}>{step.label}</Text>
            <View style={styles.funnelTrack}>
              <View
                style={[
                  styles.funnelFill,
                  { width: `${Math.min(step.ratioOfFirst, 1) * 100}%`, backgroundColor: METRIC_COLORS[step.key] },
                ]}
              />
            </View>
            <Text style={styles.funnelValue}>
              {step.value}
              {step.key !== 'views' ? ` · ${formatPercent(step.ratioOfFirst)}` : ''}
            </Text>
          </View>
        ))}
        {totals.uniqueViewers === 0 ? <Text style={styles.muted}>No views yet. Share the event to get started.</Text> : null}
      </Section>

      {/* Premium sections */}
      {premium ? (
        <PremiumSections data={data} metric={metric} onMetricChange={onMetricChange} trendPoints={trendPoints} />
      ) : data.source === 'overview_fallback' ? (
        <View style={[styles.card, styles.noticeCard]}>
          <Text style={styles.noticeTitle}>More insights are on the way</Text>
          <Text style={styles.muted}>
            Daily trends, RSVP timing and audience need a database update that hasn&apos;t been applied yet.
          </Text>
        </View>
      ) : (
        <LockedPremium />
      )}

      <Text style={styles.footnote}>
        Views count each signed-in person once a day. Your own visits are not counted.
        {premium && data.leadTime?.available ? ' RSVP timing uses when people first RSVP’d.' : ''}
      </Text>
    </View>
  );
}

function PremiumSections({
  data,
  metric,
  onMetricChange,
  trendPoints,
}: {
  data: EventInsights;
  metric: TrendMetric;
  onMetricChange: (m: TrendMetric) => void;
  trendPoints: { date: string; value: number }[];
}) {
  const lead = data.leadTime;
  const leadSummary = lead && lead.available ? leadTimeSummary(lead) : null;
  const audience = data.audience;
  const audienceTotal = audience ? audience.returningGoing + audience.firstTimeGoing : 0;
  return (
    <>
      <Section title="Daily activity">
        <SegmentedControl<TrendMetric> options={METRIC_OPTIONS} value={metric} onChange={onMetricChange} />
        <View style={styles.chart}>
          <TrendBars points={trendPoints} color={METRIC_COLORS[metric]} metricLabel={metric} />
        </View>
      </Section>

      <Section title="When people RSVP">
        {leadSummary ? (
          <>
            {leadSummary.reading ? <Text style={styles.reading}>{leadSummary.reading}</Text> : null}
            {leadSummary.buckets.map((b) => (
              <View key={b.key} style={styles.funnelRow}>
                <Text style={styles.funnelLabel}>{b.label}</Text>
                <View style={styles.funnelTrack}>
                  <View style={[styles.funnelFill, { width: `${b.share * 100}%`, backgroundColor: Colors.success }]} />
                </View>
                <Text style={styles.funnelValue}>{b.value}</Text>
              </View>
            ))}
            {leadSummary.total === 0 ? <Text style={styles.muted}>No one is going yet.</Text> : null}
          </>
        ) : (
          <Text style={styles.muted}>Not shown for repeating events: RSVPs cover the whole series, not one date.</Text>
        )}
      </Section>

      {audience ? (
        <Section title="Who is going" card={false}>
          <View style={styles.kpiGrid}>
            <Kpi icon={<Users size={16} color={Colors.success} />} label="Returning guests" value={audience.returningGoing} />
            <Kpi icon={<Users size={16} color={Colors.primary} />} label="First time with you" value={audience.firstTimeGoing} />
            <Kpi icon={<Heart size={16} color={Colors.accentDark} />} label="Your followers" value={audience.followersGoing} />
          </View>
          {audienceTotal === 0 ? <Text style={[styles.muted, styles.gridNote]}>No one is going yet.</Text> : null}
        </Section>
      ) : null}

      {data.interactions ? (
        <Section title="Taps on your event page" card={false}>
          {interactionTotal(data.interactions) === 0 ? (
            <Text style={styles.muted}>No shares, calendar adds, directions or ticket taps yet.</Text>
          ) : (
            <View style={styles.kpiGrid}>
              {INTERACTION_LABELS.map(({ key, label }) => (
                <Kpi key={key} icon={INTERACTION_ICONS[key]} label={label} value={data.interactions![key]} half />
              ))}
            </View>
          )}
          <Text style={[styles.kpiHint, styles.gridNote]}>
            Each person counts once a day per action. {data.interactions.period} in the last {data.periodDays} days.
          </Text>
        </Section>
      ) : null}

      {data.rsvpChanges ? (
        <Section title="RSVP changes">
          {data.rsvpChanges.trackedSince === null ? (
            <Text style={styles.muted}>Nothing recorded yet. Changes are tracked from now on.</Text>
          ) : (
            <>
              <Text style={styles.reading}>
                {describeRsvpChanges(data.rsvpChanges, data.periodDays) ?? `No changes in the last ${data.periodDays} days`}
              </Text>
              {dropOffRate(data.rsvpChanges) !== null ? (
                <Text style={styles.muted}>
                  Drop-off: {formatPercent(dropOffRate(data.rsvpChanges)!)} of new RSVPs left or switched to interested.
                </Text>
              ) : null}
              {data.rsvpChanges.declined + data.rsvpChanges.removed > 0 ? (
                <Text style={styles.kpiHint}>
                  You declined {data.rsvpChanges.declined} and removed {data.rsvpChanges.removed} in this period.
                </Text>
              ) : null}
            </>
          )}
        </Section>
      ) : null}

      {data.announcements && data.announcements.sent > 0 ? (
        <Section title="Announcements">
          <View style={styles.inlineStat}>
            <Megaphone size={16} color={Colors.primary} />
            <Text style={styles.inlineStatText}>
              {data.announcements.sent} sent · {data.announcements.recipients} delivered ·{' '}
              {formatPercent(announcementReadRate(data.announcements))} read
            </Text>
          </View>
        </Section>
      ) : null}

      {data.chat && data.chat.messages > 0 ? (
        <Section title="Event chat">
          <View style={styles.inlineStat}>
            <MessageCircle size={16} color={Colors.primary} />
            <Text style={styles.inlineStatText}>
              {data.chat.messages} messages from {data.chat.activeSenders}{' '}
              {data.chat.activeSenders === 1 ? 'person' : 'people'} · {data.chat.messagesPeriod} in the last{' '}
              {data.periodDays} days
            </Text>
          </View>
        </Section>
      ) : null}
    </>
  );
}

function LockedPremium() {
  return (
    <ProUpsellCard
      title="More with Pro"
      items={[
        'Daily views, saves and RSVPs',
        'When people RSVP',
        'Returning guests and followers',
        'Shares, calendar adds and directions',
        'Who left or switched to interested',
        'Announcement read rate',
        'Comparison with your usual event',
      ]}
    />
  );
}

function Section({ title, children, card = true }: { title: string; children: ReactNode; card?: boolean }) {
  return (
    <AnalyticsSection title={title} card={card}>
      {children}
    </AnalyticsSection>
  );
}

/** Three tiles per row on phones, wrapping to fewer on narrow widths. */
function Kpi({
  icon,
  label,
  value,
  hint,
  fill,
  half,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  hint?: string;
  fill?: number | null;
  /** Two per row (for groups of four). */
  half?: boolean;
}) {
  return (
    <KpiTile
      icon={icon}
      label={label}
      value={value.toLocaleString()}
      hint={hint}
      fill={fill}
      style={half ? styles.kpiHalf : styles.kpi}
    />
  );
}

function DeltaPill({ label, delta }: { label: string; delta: MedianDelta }) {
  const tone =
    delta.direction === 'up'
      ? { bg: Colors.successSoft, fg: Colors.successText }
      : delta.direction === 'down'
        ? { bg: Colors.warningSoft, fg: Colors.warningText }
        : { bg: Colors.neutralSoft, fg: Colors.text.secondary };
  return (
    <View style={[styles.deltaPill, { backgroundColor: tone.bg }]}>
      <Text style={[styles.deltaText, { color: tone.fg }]}>
        {label}: {delta.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background.primary },
  scroll: { paddingBottom: Spacing.xxl, flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  body: { padding: Spacing.md, gap: Spacing.md },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border.light,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadows.sm,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  eventTitle: {
    flexShrink: 1,
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.displayFontFamilies.bold,
    color: Colors.text.primary,
  },
  statusBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.errorSoft,
  },
  statusBadgeText: { fontSize: Typography.sizes.xs, fontFamily: Typography.fontFamilies.semibold, color: Colors.error },
  muted: { fontSize: Typography.sizes.sm, color: Colors.text.secondary, lineHeight: 20 },
  deltaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  deltaPill: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: BorderRadius.round },
  deltaText: { fontSize: Typography.sizes.xs, fontFamily: Typography.fontFamilies.semibold },
  windowNote: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.text.tertiary,
    paddingHorizontal: Spacing.xs,
  },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  kpi: { flexGrow: 1, flexBasis: '30%', minWidth: 100 },
  kpiHalf: { flexGrow: 1, flexBasis: '45%' },
  gridNote: { marginTop: Spacing.sm, marginLeft: 2 },
  kpiHint: { fontSize: Typography.sizes.xs, lineHeight: 16, color: Colors.text.tertiary },
  funnelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  funnelLabel: { width: 76, fontSize: Typography.sizes.sm, color: Colors.text.secondary },
  funnelTrack: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.background.tertiary,
    overflow: 'hidden',
  },
  funnelFill: { height: 10, borderRadius: 5 },
  funnelValue: {
    minWidth: 64,
    textAlign: 'right',
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.primary,
  },
  chart: { marginTop: Spacing.xs },
  reading: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamilies.semibold, color: Colors.text.primary },
  inlineStat: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  inlineStatText: { flex: 1, fontSize: Typography.sizes.sm, color: Colors.text.primary },
  noticeCard: { backgroundColor: Colors.background.secondary },
  noticeTitle: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamilies.semibold, color: Colors.text.primary },
  footnote: { fontSize: Typography.sizes.xs, color: Colors.text.tertiary, lineHeight: 18, paddingHorizontal: Spacing.xs },
});
