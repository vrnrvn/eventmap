import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CompareThumb } from '@/components/CompareThumb';
import { CompareActions, type CompareActionHandlers } from '@/components/compare/CompareActions';
import { Colors, BorderRadius, Shadows, Spacing, Typography } from '@/constants/theme';
import { a11yState } from '@/utils/accessibility';
import { cellAccessibilityLabel, type CompareRow } from '@/utils/compare';
import type { CompareColumn } from '@/hooks/useCompareEvents';

type Props = CompareActionHandlers & {
  columns: CompareColumn[];
  rows: CompareRow[];
  identicalRows: CompareRow[];
  showIdentical: boolean;
  onToggleIdentical: () => void;
  signedIn: boolean;
  busyIds: ReadonlySet<string>;
  onRemove: (id: string) => void;
  bottomInset: number;
  note: string;
};

/**
 * Cards mode (plan §3.2): one card per event, attributes as a linear list.
 * The accessible and the small-screen layout — it is what a screen reader or
 * large text gets by default (decision D4) — and not a lesser mode: the same
 * rows, marks and actions as the table.
 */
export function CompareCards({
  columns,
  rows,
  identicalRows,
  showIdentical,
  onToggleIdentical,
  signedIn,
  busyIds,
  onRemove,
  bottomInset,
  note,
  onOpen,
  onJoin,
  onToggleSave,
}: Props) {
  const visible = showIdentical ? [...rows, ...identicalRows] : rows;
  const identicalKeys = new Set(identicalRows.map((r) => r.key));
  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset + Spacing.xl }]}>
      <Text style={styles.note}>{note}</Text>
      {identicalRows.length > 0 ? (
        <TouchableOpacity
          style={styles.identicalToggle}
          onPress={onToggleIdentical}
          activeOpacity={0.7}
          accessibilityRole="button"
          {...a11yState({ expanded: showIdentical }, 'button')}
          accessibilityLabel={
            showIdentical
              ? `Hide the ${identicalRows.length} rows where every event is the same`
              : `Show the ${identicalRows.length} rows where every event is the same`
          }
        >
          <Text style={styles.identicalText}>
            {showIdentical
              ? 'Hide identical rows'
              : `${identicalRows.length} identical ${identicalRows.length === 1 ? 'row' : 'rows'} hidden · Show`}
          </Text>
        </TouchableOpacity>
      ) : null}
      {columns.map((col, index) => {
        const event = col.input;
        return (
          <View key={event.id} style={styles.card}>
            <TouchableOpacity
              style={styles.cardHeader}
              onPress={() => onOpen(event.id)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`${event.title}, event ${index + 1} of ${columns.length}. Open event`}
            >
              <CompareThumb uri={event.coverImageUrl} title={event.title} size={56} />
              <View style={styles.cardTitleBlock}>
                <Text style={styles.cardTitle} numberOfLines={2} accessibilityRole="header">
                  {event.title}
                </Text>
                <Text style={styles.cardHost} numberOfLines={1}>
                  {event.hostName}
                </Text>
                {col.missing ? (
                  <Text style={styles.cardNote}>No longer available</Text>
                ) : col.error ? (
                  <Text style={styles.cardNote}>Couldn&apos;t refresh — showing what was saved</Text>
                ) : col.loading ? (
                  <Text style={styles.cardNote}>Updating…</Text>
                ) : null}
              </View>
            </TouchableOpacity>
            {visible.map((row) => {
              const cell = row.cells[index];
              const best = row.best === index;
              const dimmed = identicalKeys.has(row.key);
              return (
                <View
                  key={row.key}
                  style={styles.line}
                  accessible
                  accessibilityLabel={cellAccessibilityLabel(row, index, event.title)}
                >
                  <Text style={[styles.lineLabel, dimmed && styles.dimmed]}>{row.label}</Text>
                  <View style={styles.lineValueWrap}>
                    <Text
                      style={[
                        styles.lineValue,
                        best && styles.lineValueBest,
                        !cell.text && styles.lineValueMuted,
                        dimmed && styles.dimmed,
                      ]}
                    >
                      {best ? '★ ' : ''}
                      {cell.text || 'Not stated'}
                    </Text>
                    {cell.detail ? <Text style={[styles.lineDetail, dimmed && styles.dimmed]}>{cell.detail}</Text> : null}
                  </View>
                </View>
              );
            })}
            <View style={styles.cardActions}>
              <View style={styles.cardActionsMain}>
                <CompareActions
                  input={event}
                  signedIn={signedIn}
                  busy={busyIds.has(event.id)}
                  onOpen={onOpen}
                  onJoin={onJoin}
                  onToggleSave={onToggleSave}
                />
              </View>
              <TouchableOpacity
                style={styles.removeLink}
                onPress={() => onRemove(event.id)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${event.title} from comparison`}
              >
                <Text style={styles.removeText}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.md, gap: Spacing.md, paddingTop: Spacing.xs },
  note: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    lineHeight: 16,
  },
  identicalToggle: { minHeight: 44, justifyContent: 'center', marginTop: -Spacing.sm },
  identicalText: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamilies.semibold, color: Colors.primary },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadows.card,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm + 2, marginBottom: Spacing.xs },
  cardTitleBlock: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: Typography.sizes.lg, fontFamily: Typography.displayFontFamilies.bold, color: Colors.text.primary },
  cardHost: { marginTop: 2, fontSize: Typography.sizes.xs, fontFamily: Typography.labelFontFamilies.medium, color: Colors.text.secondary },
  cardNote: { marginTop: 2, fontSize: Typography.sizes.xxs, fontFamily: Typography.fontFamily, color: Colors.text.tertiary },
  line: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border.light,
  },
  lineLabel: { width: 96, fontSize: Typography.sizes.xs, fontFamily: Typography.labelFontFamilies.medium, color: Colors.text.tertiary, paddingTop: 2 },
  lineValueWrap: { flex: 1, minWidth: 0 },
  lineValue: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamilies.semibold, color: Colors.text.primary },
  lineValueBest: { color: Colors.primary },
  lineValueMuted: { color: Colors.text.disabled, fontFamily: Typography.fontFamily },
  lineDetail: { marginTop: 1, fontSize: Typography.sizes.xs, fontFamily: Typography.fontFamily, color: Colors.text.secondary },
  dimmed: { color: Colors.text.tertiary },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
  cardActionsMain: { flex: 1 },
  removeLink: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.xs },
  removeText: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamilies.semibold, color: Colors.text.secondary },
});
