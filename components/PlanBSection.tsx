/**
 * Plan B on the event page (docs/PLAN_B_PLAN.md §3): a few alternatives
 * that fit the plan that fell through, each with the reasons it fits.
 * Quiet until there is something to show — no empty state, like
 * MoreOfTypeRail; "See more nearby" is the way onward.
 */
import { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { EventListItem } from '@/components/EventListItem';
import { ChevronRight, Sparkles } from '@/components/icons.generated';
import { describeEventDateTime } from '@/utils/timezone';
import { planBChips, planBSectionCopy, type PlanBAnchor, type PlanBPick } from '@/utils/planB';
import { Colors, Spacing, Typography } from '@/constants/theme';

type Props = {
  anchor: PlanBAnchor;
  picks: readonly PlanBPick[];
  /** Searched the wider radius because the near one was sparse. */
  widened?: boolean;
  /** The cancelled date's label, for T2's title. */
  dateLabel?: string;
  /** Where "See more nearby" goes; omitted = no link. */
  seeMoreHref?: string;
  now?: Date;
  /** Section wrapper style (spacing differs between the page and the sheet). */
  compact?: boolean;
};

export const PlanBSection = memo(function PlanBSection({
  anchor,
  picks,
  widened,
  dateLabel,
  seeMoreHref,
  now = new Date(),
  compact,
}: Props) {
  if (picks.length === 0) return null;
  const copy = planBSectionCopy(anchor, dateLabel);
  return (
    <View style={[styles.section, compact && styles.sectionCompact]} testID="plan-b-section">
      <View style={styles.headerRow}>
        <Sparkles size={18} color={Colors.primary} />
        <Text style={styles.title} accessibilityRole="header">
          {copy.title}
        </Text>
      </View>
      <Text style={styles.subtitle}>
        {copy.subtitle}
        {widened ? ' Searched a little further out.' : ''}
      </Text>
      {picks.map((pick) => (
        <PickRow key={pick.event.id} pick={pick} anchor={anchor} now={now} />
      ))}
      {seeMoreHref ? (
        <TouchableOpacity
          style={styles.seeMore}
          onPress={() => router.push(seeMoreHref as never)}
          accessibilityRole="link"
          accessibilityLabel="See more events nearby"
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Text style={styles.seeMoreText}>See more nearby</Text>
          <ChevronRight size={14} color={Colors.primary} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
});

const PickRow = memo(function PickRow({ pick, anchor, now }: { pick: PlanBPick; anchor: PlanBAnchor; now: Date }) {
  const display = describeEventDateTime(pick.start.toISOString(), pick.event.timezone);
  const chips = planBChips(pick, anchor, now);
  return (
    <View style={styles.rowSpacing}>
      <EventListItem
        title={pick.event.title}
        subtitle={pick.event.business_name}
        dateLine={display.primary}
        thumbnailUrl={pick.event.cover_image_url}
        // Meta lines are single-line; two reasons per line keeps all three
        // visible on a phone (one line truncated the third).
        metaLines={chips.length ? [chips.slice(0, 2).join(' · '), ...chips.slice(2)] : undefined}
        rightAccessory={<ChevronRight size={18} color={Colors.border.medium} />}
        onPress={() => router.push(`/event/${pick.event.id}` as never)}
        accessibilityLabel={`${pick.event.title}, ${display.primary}${chips.length ? `. ${chips.join(', ')}` : ''}`}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  section: {
    marginTop: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border.light,
  },
  sectionCompact: { marginTop: Spacing.sm, paddingTop: 0, borderTopWidth: 0 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  title: {
    flex: 1,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  subtitle: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    marginTop: 2,
    marginBottom: Spacing.sm,
  },
  rowSpacing: { marginBottom: 12 },
  seeMore: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 2, minHeight: 44 },
  seeMoreText: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamilies.semibold, color: Colors.primary },
});
