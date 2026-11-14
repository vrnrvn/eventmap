import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable } from 'react-native';
import { Colors, Typography, BorderRadius } from '@/constants/theme';
import { Check, ChevronRight, ChevronDown, ChevronUp, ListChecks, X } from '@/components/icons.generated';
import { a11yState } from '@/utils/accessibility';
import {
  STAGE_TITLE,
  type EventPlaybook,
  type PlaybookItem,
  type PlaybookItemId,
  type PlaybookTarget,
  type PlaybookVisibility,
} from '@/utils/eventPlaybook';

/**
 * Per-event checklist card (docs/HOST_EVENT_PLAYBOOK_PLAN.md P2), mounted at
 * the top of Manage event → Overview. Shows the list for the event's current
 * stage; derived items tick themselves and open the relevant tool, manual
 * items have a real checkbox.
 *
 * Collapsed shows progress and the next step only. Dismiss hides this
 * stage's list; the next stage still gets its own.
 */
export function EventPlaybookCard({
  playbook,
  visibility,
  onAction,
  onTick,
  onDismiss,
  initialExpanded,
  compact = false,
  style,
}: {
  playbook: EventPlaybook | null;
  visibility: PlaybookVisibility;
  /**
   * The screen maps a target to a route, a hub tab or a sheet. Omitted where
   * there is nowhere to go (the Edit form is already the tool), which makes
   * the rows informational instead of falsely tappable.
   */
  onAction?: (target: PlaybookTarget, item: PlaybookItem) => void;
  onTick: (item: PlaybookItemId, done: boolean) => void;
  /** Omitted where the card is not dismissible (inside the preview sheet). */
  onDismiss?: () => void;
  /** Opens expanded regardless of the collapse heuristic (deep link from My Events). */
  initialExpanded?: boolean;
  /**
   * One-line summary until tapped, for places where vertical space is the
   * scarce resource — the publish preview, where the collapsed card alone
   * pushed the event preview off a 320 px screen.
   */
  compact?: boolean;
  style?: object;
}) {
  const [expandedByUser, setExpandedByUser] = useState<boolean | null>(null);
  if (!playbook || visibility === 'hidden' || playbook.stage === 'none') return null;

  const expanded = expandedByUser ?? initialExpanded ?? (compact ? false : visibility === 'expanded');
  const { doneCount, total, next, items } = playbook;
  const stageTitle = STAGE_TITLE[playbook.stage];
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  if (compact && !expanded) {
    return (
      <Pressable
        style={[styles.compactRow, style]}
        onPress={() => setExpandedByUser(true)}
        accessibilityRole="button"
        accessibilityLabel={`Checklist, ${doneCount} of ${total} done.${next ? ` Next: ${next.title}.` : ''} Show the list`}
        {...a11yState({ expanded: false })}
      >
        <View style={styles.iconWellSm}>
          <ListChecks size={14} color={Colors.primary} />
        </View>
        {/* Named, not just a ratio: "3 of 7" alone says nothing about what. */}
        <Text style={styles.compactCount}>{`Checklist ${doneCount}/${total}`}</Text>
        <Text style={styles.compactNext} numberOfLines={1}>
          {next ? next.title : stageTitle}
        </Text>
        <ChevronDown size={16} color={Colors.text.secondary} />
      </Pressable>
    );
  }

  return (
    <View style={[styles.card, style]}>
      <View style={styles.header}>
        <View style={styles.iconWell}>
          <ListChecks size={16} color={Colors.primary} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title} accessibilityRole="header">
            Checklist · {stageTitle}
          </Text>
          <Text style={styles.progress}>{`${doneCount} of ${total} done`}</Text>
        </View>
        <TouchableOpacity
          onPress={() => setExpandedByUser(!expanded)}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Collapse checklist' : 'Expand checklist'}
          {...a11yState({ expanded })}
          style={styles.headerBtn}
        >
          {expanded ? <ChevronUp size={18} color={Colors.text.secondary} /> : <ChevronDown size={18} color={Colors.text.secondary} />}
        </TouchableOpacity>
        {onDismiss ? (
          <TouchableOpacity
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel={`Hide the ${stageTitle.toLowerCase()} checklist`}
            style={styles.headerBtn}
          >
            <X size={18} color={Colors.text.tertiary} />
          </TouchableOpacity>
        ) : null}
      </View>

      <View
        style={styles.track}
        accessibilityRole="progressbar"
        accessibilityLabel="Checklist progress"
        accessibilityValue={{ min: 0, max: total, now: doneCount }}
      >
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>

      {expanded ? (
        <View style={styles.list}>
          {items.map((item) => (
            <Row
              key={item.id}
              item={item}
              onAction={onAction ? () => onAction(item.target, item) : undefined}
              onTick={(done) => onTick(item.id, done)}
            />
          ))}
        </View>
      ) : next ? (
        <Pressable
          style={styles.nextRow}
          onPress={() => (onAction && !(next.manual && next.target === 'none') ? onAction(next.target, next) : setExpandedByUser(true))}
          accessibilityRole="button"
          accessibilityLabel={`Next: ${next.title}. ${next.description}`}
        >
          <Text style={styles.nextLabel}>Next</Text>
          <Text style={styles.nextTitle} numberOfLines={1}>
            {next.title}
          </Text>
          <ChevronRight size={16} color={Colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

function Row({ item, onAction, onTick }: { item: PlaybookItem; onAction?: () => void; onTick: (done: boolean) => void }) {
  const hasAction = !!onAction && item.target !== 'none';
  // A manual item's tick is its own control; the rest of the row opens the tool.
  const tick = item.manual ? (
    <TouchableOpacity
      onPress={() => onTick(!item.done)}
      style={styles.tickHit}
      accessibilityRole="checkbox"
      accessibilityLabel={item.title}
      {...a11yState({ checked: item.done })}
    >
      <View style={[styles.tick, styles.tickManual, item.done && styles.tickDone]}>
        {item.done ? <Check size={13} color={Colors.white} /> : null}
      </View>
    </TouchableOpacity>
  ) : (
    <View style={styles.tickHit} accessible={false}>
      <View style={[styles.tick, item.done && styles.tickDone]}>{item.done ? <Check size={13} color={Colors.white} /> : null}</View>
    </View>
  );

  const body = (
    <View style={styles.rowText}>
      <Text style={[styles.rowTitle, item.done && styles.rowTitleDone]}>{item.title}</Text>
      {!item.done ? <Text style={styles.rowDesc}>{item.description}</Text> : null}
    </View>
  );

  return (
    <View style={styles.row}>
      {tick}
      {hasAction && !item.done ? (
        <Pressable
          style={styles.rowPress}
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={`${item.title}. ${item.description}`}
        >
          {body}
          <ChevronRight size={16} color={Colors.text.tertiary} />
        </Pressable>
      ) : (
        <View style={styles.rowPress} accessibilityRole="text" accessibilityLabel={`${item.title}. ${item.done ? 'Done' : item.description}`}>
          {body}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border.light,
    padding: 14,
    gap: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // One-line summary (compact); 44 px tall so it is still a real target.
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border.light,
  },
  iconWellSm: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactCount: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.text.primary,
  },
  compactNext: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
  },
  iconWell: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  // 44 px targets: hitSlop does not enlarge the box on web.
  headerBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: Typography.sizes.md, fontFamily: Typography.labelFontFamilies.medium, color: Colors.text.primary },
  progress: { fontSize: Typography.sizes.xs, fontFamily: Typography.fontFamily, color: Colors.text.tertiary },
  track: { height: 4, borderRadius: 2, backgroundColor: Colors.border.light, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2, backgroundColor: Colors.primary },
  list: { gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  rowPress: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 4 },
  tickHit: { width: 44, minHeight: 44, alignItems: 'flex-start', justifyContent: 'center' },
  tick: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Square corners tell a sighted host "you can tick this one yourself".
  tickManual: { borderRadius: 5 },
  tickDone: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  rowText: { flex: 1 },
  rowTitle: { fontSize: Typography.sizes.sm, fontFamily: Typography.labelFontFamilies.medium, color: Colors.text.primary },
  rowTitleDone: { color: Colors.text.tertiary, textDecorationLine: 'line-through' },
  rowDesc: { marginTop: 1, fontSize: Typography.sizes.xs, fontFamily: Typography.fontFamily, color: Colors.text.secondary, lineHeight: 16 },
  nextRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  nextLabel: {
    fontSize: Typography.sizes.xxs,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  nextTitle: { flex: 1, fontSize: Typography.sizes.sm, fontFamily: Typography.labelFontFamilies.medium, color: Colors.primary },
});
