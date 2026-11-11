import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Colors, Typography, BorderRadius } from '@/constants/theme';
import { Check, ChevronRight, ChevronDown, ChevronUp, Sparkles, X } from '@/components/icons.generated';
import { a11yState } from '@/utils/accessibility';
import { useHostChecklist } from '@/hooks/useHostChecklist';
import type { ChecklistItem } from '@/utils/hostChecklist';

/**
 * Getting-started checklist card (HOST_ONBOARDING_PLAN.md §4 Stage 4).
 * Mounted at the top of Profile (hosting mode) and My Events; it decides for
 * itself whether to render, so both call sites are one line.
 *
 * Collapsed shows progress and the next step only — that is the state hosts
 * who were already active get, so they are never greeted with a list of
 * things they "should" do.
 */
export function HostChecklistCard({
  style,
  forceVisible = false,
}: {
  style?: object;
  /** Settings → Host profile: show even when dismissed or complete. */
  forceVisible?: boolean;
}) {
  const { checklist, visibility, ready, dismiss } = useHostChecklist();
  const [expandedByUser, setExpandedByUser] = useState<boolean | null>(null);

  if (!checklist) return null;
  if (forceVisible ? !ready || checklist.total === 0 : visibility === 'hidden') return null;
  const expanded = expandedByUser ?? (forceVisible ? false : visibility === 'expanded');
  const { doneCount, total, next, items } = checklist;
  const progressLabel = `${doneCount} of ${total} done`;

  const go = (item: ChecklistItem) => router.push(item.route as never);

  return (
    <View style={[styles.card, style]}>
      <View style={styles.header}>
        <View style={styles.iconWell}>
          <Sparkles size={16} color={Colors.primary} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title} accessibilityRole="header">
            Getting started
          </Text>
          <Text style={styles.progress}>
            {checklist.complete ? 'All done' : progressLabel}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => setExpandedByUser(!expanded)}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Collapse getting started' : 'Expand getting started'}
          {...a11yState({ expanded })}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.headerBtn}
        >
          {expanded ? (
            <ChevronUp size={18} color={Colors.text.secondary} />
          ) : (
            <ChevronDown size={18} color={Colors.text.secondary} />
          )}
        </TouchableOpacity>
        {!forceVisible ? (
          <TouchableOpacity
            onPress={dismiss}
            accessibilityRole="button"
            accessibilityLabel="Hide getting started"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.headerBtn}
          >
            <X size={18} color={Colors.text.tertiary} />
          </TouchableOpacity>
        ) : null}
      </View>

      <View
        style={styles.track}
        accessibilityRole="progressbar"
        accessibilityLabel="Getting started progress"
        accessibilityValue={{ min: 0, max: total, now: doneCount }}
      >
        <View style={[styles.fill, { width: `${total > 0 ? Math.round((doneCount / total) * 100) : 0}%` }]} />
      </View>

      {expanded ? (
        <View style={styles.list}>
          {items.map((item) => (
            <Row key={item.id} item={item} onPress={() => go(item)} />
          ))}
        </View>
      ) : next ? (
        <Pressable
          style={styles.nextRow}
          onPress={() => go(next)}
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

function Row({ item, onPress }: { item: ChecklistItem; onPress: () => void }) {
  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      disabled={item.done}
      accessibilityRole={item.done ? 'text' : 'button'}
      accessibilityLabel={`${item.title}. ${item.done ? 'Done' : item.description}`}
    >
      <View style={[styles.tick, item.done && styles.tickDone]}>
        {item.done ? <Check size={13} color={Colors.white} /> : null}
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, item.done && styles.rowTitleDone]}>
          {item.title}
          {item.premiumRequired ? ' · Premium' : ''}
        </Text>
        {!item.done ? <Text style={styles.rowDesc}>{item.description}</Text> : null}
      </View>
      {!item.done ? <ChevronRight size={16} color={Colors.text.tertiary} /> : null}
    </Pressable>
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
  iconWell: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  headerBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: Typography.sizes.md, fontFamily: Typography.labelFontFamilies.medium, color: Colors.text.primary },
  progress: { fontSize: Typography.sizes.xs, fontFamily: Typography.fontFamily, color: Colors.text.tertiary },
  track: { height: 4, borderRadius: 2, backgroundColor: Colors.border.light, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2, backgroundColor: Colors.primary },
  list: { gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 4 },
  tick: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
