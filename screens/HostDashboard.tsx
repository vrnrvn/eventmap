import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useApp } from '@/contexts/AppContext';
import { useHostDashboard } from '@/hooks/useHostDashboard';
import { formatOccurrenceWhen, useOccurrenceActions, type OccurrenceTarget } from '@/hooks/useOccurrenceActions';
import { AgendaDateActionsSheet } from '@/components/AgendaDateActionsSheet';
import { MoveDateModal } from '@/components/MoveDateModal';
import { FreshnessNote, OfflineState } from '@/components/ui/QueryStates';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button } from '@/components/ui/Button';
import { describeEventTime, isValidTimeZone } from '@/utils/timezone';
import { a11yState } from '@/utils/accessibility';
import {
  AGENDA_DAYS,
  AGENDA_EVENT_LIMIT,
  MAX_OVERVIEW_TARGETS,
  dateActionsFor,
  describeAttendance,
  describeAttention,
  type AgendaDay,
  type AgendaEntry,
  type AttentionItem,
} from '@/utils/hostDashboard';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import {
  AlertCircle,
  ArrowLeft,
  Briefcase,
  CalendarClock,
  CalendarDays,
  CalendarX,
  ChevronRight,
  Clock,
  Ellipsis,
  FileText,
  Megaphone,
  MessageCircle,
  PlusCircle,
  Repeat,
  UserPlus,
  Users,
} from '@/components/icons.generated';

/**
 * Host dashboard, phase C1 (docs/HOST_DASHBOARD_PLAN.md): today and the next
 * six days across every event the host runs, with series expanded into the
 * dates they actually happen. Read-only; every row opens Manage event.
 *
 * Placement (DC1): its own screen at /hosting, reached from the Profile
 * "Today" card and the My Events header. Free for every host (DC2).
 */
export default function HostDashboard() {
  const insets = useSafeAreaInsets();
  const { hasBusiness, userBusiness } = useApp();
  const { days, summary, data, attention, attentionTruncated, state, freshness, refresh } = useHostDashboard(
    userBusiness?.id
  );
  const [refreshing, setRefreshing] = useState(false);
  // C5: per-date operations, through the same hook Manage event uses.
  const dateOps = useOccurrenceActions();
  const [optionsFor, setOptionsFor] = useState<AgendaEntry | null>(null);
  const optionsTarget = optionsFor ? toOccurrenceTarget(optionsFor) : null;
  // Close the sheet before the confirm dialogs: a dialog over a modal is
  // unreliable on iOS and on web.
  const fromSheet = (fn: (t: OccurrenceTarget) => unknown) => () => {
    const t = optionsTarget;
    setOptionsFor(null);
    if (t) void fn(t);
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void Promise.resolve(refresh()).finally(() => setRefreshing(false));
  }, [refresh]);

  const header = (
    <View style={styles.header}>
      <TouchableOpacity
        style={styles.iconBtn}
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
          <CalendarClock size={18} color={Colors.primary} />
        </View>
        <View>
          <Text style={styles.headerTitle} accessibilityRole="header">
            Hosting
          </Text>
          <Text style={styles.headerSubtitle}>Today and the next {AGENDA_DAYS - 1} days</Text>
        </View>
      </View>
      {hasBusiness ? (
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => router.push('/my-events')}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="All my events"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <CalendarDays size={20} color={Colors.text.primary} />
        </TouchableOpacity>
      ) : (
        <View style={styles.headerSpacer} />
      )}
    </View>
  );

  if (!hasBusiness) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {header}
        <View style={styles.centered}>
          <View style={styles.bigIconWrap}>
            <Briefcase size={36} color={Colors.primary} />
          </View>
          <Text style={styles.centeredTitle}>Business Required</Text>
          <Text style={styles.centeredText}>Create a business profile to start hosting events.</Text>
          <Button
            label="Create Business"
            onPress={() => router.push('/business/onboarding' as never)}
            size="lg"
            gradient
            icon={<ChevronRight size={18} color={Colors.white} />}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {header}
      {state === 'loading' ? (
        <View style={styles.body} accessibilityLabel="Loading your schedule" {...a11yState({ busy: true })}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.skeletonRow} />
          ))}
        </View>
      ) : state === 'offline' ? (
        <OfflineState onRetry={() => void refresh()} style={styles.stateBox} />
      ) : state === 'error' ? (
        <ErrorState title="Couldn't load your schedule" onRetry={() => void refresh()} style={styles.stateBox} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + Spacing.xl }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >
          <FreshnessNote text={freshness} style={styles.freshness} />

          {attention.length > 0 && (
            <View style={styles.daySection}>
              <Text style={styles.dayTitle} accessibilityRole="header">
                Needs you
              </Text>
              <View style={styles.dayCard}>
                {attention.map((item, i) => (
                  <AttentionRow key={item.key} item={item} last={i === attention.length - 1} />
                ))}
              </View>
            </View>
          )}

          {/* Shown even with an empty queue: silence must not read as "all
              clear" when only the next few events were inspected. */}
          {attentionTruncated && (
            <Text style={styles.footnote}>
              Checked your next {MAX_OVERVIEW_TARGETS} events for requests and reports.
            </Text>
          )}

          {state === 'empty' ? (
            <View style={styles.emptyCard}>
              <View style={styles.bigIconWrap}>
                <CalendarClock size={32} color={Colors.primary} />
              </View>
              <Text style={styles.centeredTitle}>Nothing on this week</Text>
              <Text style={styles.centeredText}>
                Events you host in the next {AGENDA_DAYS} days, and each date of your series, will show up here.
              </Text>
            </View>
          ) : days.length === 0 ? (
            // Nothing scheduled, but the queue above has something to do.
            <Text style={styles.footnote}>Nothing scheduled in the next {AGENDA_DAYS} days.</Text>
          ) : (
            <>
              <View style={styles.summary} accessibilityRole="summary">
                <SummaryStat value={summary.today} label="today" />
                <SummaryStat value={summary.week} label="this week" />
                {!data?.countsUnavailable && <SummaryStat value={summary.goingToday} label="going today" />}
              </View>
              {days.map((day) => (
                <DaySection key={day.key} day={day} onOptions={setOptionsFor} busyKey={dateOps.busyKey} />
              ))}
            </>
          )}

          {data?.truncated && (
            <Text style={styles.footnote}>
              Showing your first {AGENDA_EVENT_LIMIT} upcoming events. Open My Events for the full list.
            </Text>
          )}
          {data?.countsUnavailable && state !== 'empty' && (
            <Text style={styles.footnote}>Attendance numbers couldn’t be loaded. Pull down to try again.</Text>
          )}

          <View style={styles.actions}>
            <Button
              label="Create event"
              onPress={() => router.push('/(tabs)/create' as never)}
              gradient
              icon={<PlusCircle size={16} color={Colors.white} />}
              style={styles.actionBtn}
            />
            <Button
              label="My events"
              onPress={() => router.push('/my-events')}
              variant="ghost"
              icon={<CalendarDays size={16} color={Colors.primary} />}
              style={styles.actionBtn}
            />
          </View>
        </ScrollView>
      )}

      <AgendaDateActionsSheet
        entry={optionsFor}
        actions={optionsFor ? dateActionsFor(optionsFor, new Date()) : []}
        when={optionsTarget ? formatOccurrenceWhen(optionsTarget.occurrence.originalStart, optionsTarget.tz) : ''}
        onClose={() => setOptionsFor(null)}
        onMove={fromSheet(dateOps.startMove)}
        onSkip={fromSheet(dateOps.skip)}
        onRestore={fromSheet(dateOps.restore)}
        onOpenManage={() => {
          const id = optionsFor?.eventId;
          setOptionsFor(null);
          if (id) router.push(`/business/manage-event/${id}` as never);
        }}
      />
      {dateOps.moving ? (
        <MoveDateModal
          occurrence={dateOps.moving.occurrence}
          tz={dateOps.moving.tz}
          onCancel={dateOps.cancelMove}
          onSave={(start, end) => void dateOps.saveMove(dateOps.moving!, start, end)}
        />
      ) : null}
    </View>
  );
}

/** The hook's target for an agenda row (series rows only). */
function toOccurrenceTarget(entry: AgendaEntry): OccurrenceTarget {
  return {
    eventId: entry.eventId,
    tz: entry.timezone && isValidTimeZone(entry.timezone) ? entry.timezone : null,
    occurrence: {
      dateKey: entry.dateKey ?? '',
      start: entry.start,
      end: entry.end,
      originalStart: entry.originalStart,
      status: entry.status === 'cancelled' ? 'cancelled' : entry.status === 'moved' ? 'moved' : 'scheduled',
      note: entry.note,
    },
  };
}

const ATTENTION_ICONS = {
  chat_reports: MessageCircle,
  requests: UserPlus,
  postponed: CalendarX,
  waitlist: Users,
  stale_draft: FileText,
  closed_soon: AlertCircle,
  just_filled: Megaphone,
} as const;

function AttentionRow({ item, last }: { item: AttentionItem; last: boolean }) {
  const Icon = ATTENTION_ICONS[item.kind];
  const action = item.severity === 'action';
  const line = describeAttention(item);
  const onPress = () => {
    if (item.target.screen === 'edit') {
      router.push(`/business/edit-event/${item.eventId}` as never);
      return;
    }
    const params = [item.target.tab ? `tab=${item.target.tab}` : '', item.target.seg ? `seg=${item.target.seg}` : '']
      .filter(Boolean)
      .join('&');
    router.push(`/business/manage-event/${item.eventId}${params ? `?${params}` : ''}` as never);
  };

  return (
    <TouchableOpacity
      style={[styles.row, !last && styles.rowDivider]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${line}, ${item.title}`}
      accessibilityHint={item.target.screen === 'edit' ? 'Opens the event editor' : 'Opens Manage event'}
    >
      <View style={[styles.attentionIcon, action ? styles.attentionIconAction : styles.attentionIconHint]}>
        <Icon size={16} color={action ? Colors.primary : Colors.text.secondary} />
      </View>
      <View style={styles.mainCol}>
        <Text style={[styles.title, !action && styles.titleHint]} numberOfLines={1}>
          {line}
        </Text>
        <Text style={styles.metaText} numberOfLines={1}>
          {item.title}
        </Text>
      </View>
      <ChevronRight size={18} color={Colors.text.tertiary} />
    </TouchableOpacity>
  );
}

function SummaryStat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${value} ${label}`}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function dayTitle(day: AgendaDay): string {
  if (day.relative === 'today') return 'Today';
  if (day.relative === 'tomorrow') return 'Tomorrow';
  return day.date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}

function DaySection({
  day,
  onOptions,
  busyKey,
}: {
  day: AgendaDay;
  onOptions: (entry: AgendaEntry) => void;
  busyKey: string | null;
}) {
  return (
    <View style={styles.daySection}>
      <Text style={styles.dayTitle} accessibilityRole="header">
        {dayTitle(day)}
      </Text>
      <View style={styles.dayCard}>
        {day.entries.map((entry, i) => (
          <AgendaRow
            key={entry.key}
            entry={entry}
            last={i === day.entries.length - 1}
            onOptions={onOptions}
            busy={busyKey === `${entry.eventId}:${entry.dateKey}`}
          />
        ))}
      </View>
    </View>
  );
}

function AgendaRow({
  entry,
  last,
  onOptions,
  busy,
}: {
  entry: AgendaEntry;
  last: boolean;
  onOptions: (entry: AgendaEntry) => void;
  busy: boolean;
}) {
  const hasOptions = dateActionsFor(entry, new Date()).length > 0;
  const when = describeEventTime(entry.start, entry.timezone);
  const attendance = describeAttendance(entry);
  const skipped = entry.status === 'cancelled';
  const badge =
    entry.status === 'live'
      ? { text: 'Happening now', tone: styles.badgeLive }
      : entry.status === 'moved'
        ? { text: 'Moved', tone: styles.badgeMoved }
        : skipped
          ? { text: 'Skipped', tone: styles.badgeSkipped }
          : null;

  // Title first: a row is "what, then when". Measured 2026-11-16: axe's
  // label-content-name-mismatch (WCAG 2.5.3, experimental) fires either way,
  // because the comma-separated name is not a literal substring of the
  // visible text; clearing it would mean dropping the punctuation that gives
  // a screen reader its pauses. Warned, not failed, as elsewhere in the app.
  const a11yParts = [
    entry.title,
    when.primary,
    when.secondary,
    entry.isSeries ? 'Series' : null,
    badge?.text,
    !skipped ? attendance : null,
    entry.note,
  ].filter(Boolean);

  return (
    <View style={[styles.rowOuter, !last && styles.rowDivider]}>
    <TouchableOpacity
      style={styles.row}
      onPress={() => router.push(`/business/manage-event/${entry.eventId}` as never)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={a11yParts.join(', ')}
      accessibilityHint="Opens Manage event"
    >
      <View style={styles.timeCol}>
        <Text style={[styles.time, skipped && styles.struck]}>{when.primary}</Text>
        {when.secondary ? <Text style={styles.timeSecondary}>{when.secondary}</Text> : null}
      </View>
      <View style={styles.mainCol}>
        <Text style={[styles.title, skipped && styles.struck]} numberOfLines={2}>
          {entry.title}
        </Text>
        <View style={styles.metaRow}>
          {entry.isSeries && (
            <View style={styles.meta}>
              <Repeat size={12} color={Colors.text.tertiary} />
              <Text style={styles.metaText}>Series</Text>
            </View>
          )}
          {badge && (
            <View style={[styles.badge, badge.tone]}>
              {skipped ? (
                <CalendarX size={12} color={Colors.text.secondary} />
              ) : (
                <Clock size={12} color={Colors.text.secondary} />
              )}
              <Text style={styles.badgeText}>{badge.text}</Text>
            </View>
          )}
          {attendance && !skipped && (
            <View style={styles.meta}>
              <Users size={12} color={Colors.text.tertiary} />
              <Text style={styles.metaText}>{attendance}</Text>
            </View>
          )}
        </View>
        {entry.note ? (
          <Text style={styles.note} numberOfLines={2}>
            {entry.note}
          </Text>
        ) : null}
      </View>
      <ChevronRight size={18} color={Colors.text.tertiary} />
    </TouchableOpacity>
    {hasOptions ? (
      // A sibling, not a child: a button inside the row's touchable would be
      // a nested interactive control.
      <TouchableOpacity
        style={styles.optionsBtn}
        onPress={() => onOptions(entry)}
        disabled={busy}
        activeOpacity={0.7}
        accessibilityRole="button"
        // The date, not just the time: a daily series has the same time on
        // every row, and identical labels can't be told apart by ear.
        accessibilityLabel={`Date options for ${entry.title}, ${formatOccurrenceWhen(
          entry.originalStart,
          entry.timezone && isValidTimeZone(entry.timezone) ? entry.timezone : null
        )}`}
        {...a11yState({ disabled: busy, busy }, 'button')}
        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      >
        <Ellipsis size={18} color={busy ? Colors.text.tertiary : Colors.text.secondary} />
      </TouchableOpacity>
    ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background.primary },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    backgroundColor: Colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border.light,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.background.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  headerIconWrap: {
    width: 42,
    height: 42,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primarySoft,
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
  headerSpacer: { width: 44 },

  body: { paddingHorizontal: Spacing.md, paddingTop: Spacing.md },
  stateBox: { marginTop: Spacing.xl },
  freshness: { marginBottom: Spacing.sm },

  summary: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  stat: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border.light,
    paddingVertical: Spacing.sm + 2,
    alignItems: 'center',
  },
  statValue: {
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  statLabel: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    marginTop: 2,
  },

  daySection: { marginBottom: Spacing.md },
  dayTitle: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.xs + 2,
  },
  dayCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border.light,
    overflow: 'hidden',
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    minHeight: 56,
  },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border.light },
  rowOuter: { flexDirection: 'row', alignItems: 'center' },
  optionsBtn: {
    width: 44,
    height: 44,
    marginRight: Spacing.xs,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Grows with the text instead of wrapping "12:00 PM UTC" over three lines
  // at large accessibility sizes (O-4); 78 px keeps rows aligned at the
  // default size, where every row's time is the same shape.
  timeCol: { minWidth: 78, flexShrink: 0, maxWidth: '45%' },
  time: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.primary,
  },
  timeSecondary: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    marginTop: 2,
  },
  mainCol: { flex: 1, gap: 4 },
  title: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.primary,
  },
  struck: { textDecorationLine: 'line-through', color: Colors.text.secondary },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: Typography.sizes.xs, fontFamily: Typography.fontFamily, color: Colors.text.secondary },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: BorderRadius.round,
  },
  badgeLive: { backgroundColor: Colors.primarySoft },
  badgeMoved: { backgroundColor: Colors.background.secondary },
  badgeSkipped: { backgroundColor: Colors.background.secondary },
  badgeText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.secondary,
  },
  note: { fontSize: Typography.sizes.xs, fontFamily: Typography.fontFamily, color: Colors.text.secondary },

  attentionIcon: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attentionIconAction: { backgroundColor: Colors.primarySoft },
  attentionIconHint: { backgroundColor: Colors.background.secondary },
  titleHint: { color: Colors.text.secondary },

  skeletonRow: {
    height: 64,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.background.secondary,
    marginBottom: 12,
  },

  emptyCard: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border.light,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  bigIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  centeredTitle: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
    textAlign: 'center',
  },
  centeredText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  footnote: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    textAlign: 'center',
    marginVertical: Spacing.sm,
  },
  actions: { gap: Spacing.sm, marginTop: Spacing.md },
  actionBtn: { alignSelf: 'stretch' },
});
