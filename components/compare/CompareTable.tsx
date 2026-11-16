import React, { useCallback, useRef, useState } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CompareThumb } from '@/components/CompareThumb';
import { CompareActions, type CompareActionHandlers } from '@/components/compare/CompareActions';
import { Colors, FontScaleCaps, BorderRadius, Spacing, Typography } from '@/constants/theme';
import { a11yState } from '@/utils/accessibility';
import { cellAccessibilityLabel, type CompareRow } from '@/utils/compare';
import type { CompareColumn } from '@/hooks/useCompareEvents';

/** The attribute column. Fixed so the value columns can be measured against it. */
export const LABEL_WIDTH = 96;

/**
 * Column width for a given screen: two columns fit a phone with the third
 * peeking as the scroll hint (plan §3.2); wider screens just show more.
 */
export function columnWidthFor(screenWidth: number): number {
  const available = screenWidth - LABEL_WIDTH - Spacing.md * 2;
  return Math.max(150, Math.min(240, Math.floor(available / 2.15)));
}

type Props = CompareActionHandlers & {
  columns: CompareColumn[];
  /** Rows that differ between columns, in display order. */
  rows: CompareRow[];
  /** Rows every column agrees on; rendered dimmed when `showIdentical`. */
  identicalRows: CompareRow[];
  showIdentical: boolean;
  onToggleIdentical: () => void;
  signedIn: boolean;
  busyIds: ReadonlySet<string>;
  columnWidth: number;
  bottomInset: number;
};

/**
 * The side-by-side view (plan §3.2): a sticky attribute column on the left,
 * event columns scrolling horizontally, a header row (cover, title, host)
 * that stays pinned while scrolling down, and a footer row of actions that
 * stays pinned at the bottom. Header and footer follow the body's
 * horizontal scroll so the columns stay lined up.
 *
 * React Native has no table semantics, so every cell carries its own spoken
 * label naming the row and the event (§3.8).
 */
export function CompareTable({
  columns,
  rows,
  identicalRows,
  showIdentical,
  onToggleIdentical,
  signedIn,
  busyIds,
  columnWidth,
  bottomInset,
  onOpen,
  onJoin,
  onToggleSave,
}: Props) {
  const headRef = useRef<ScrollView>(null);
  const footRef = useRef<ScrollView>(null);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [footerHeight, setFooterHeight] = useState(0);

  const syncHorizontal = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    headRef.current?.scrollTo({ x, animated: false });
    footRef.current?.scrollTo({ x, animated: false });
  }, []);

  const measure = useCallback((key: string, height: number) => {
    setHeights((prev) => (prev[key] === height ? prev : { ...prev, [key]: height }));
  }, []);

  const visible = showIdentical ? [...rows, ...identicalRows] : rows;
  const identicalKeys = new Set(identicalRows.map((r) => r.key));

  return (
    <View style={styles.root}>
      <ScrollView
        stickyHeaderIndices={[0]}
        contentContainerStyle={{ paddingBottom: footerHeight + Spacing.md }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header row (sticky) ── */}
        <View style={styles.headerRow}>
          <View style={[styles.corner, { width: LABEL_WIDTH }]} />
          <ScrollView ref={headRef} horizontal scrollEnabled={false} showsHorizontalScrollIndicator={false}>
            {columns.map((col, i) => (
              // The open-event press area and the retry link are siblings: a
              // touchable inside a touchable is one VoiceOver element.
              <View key={col.input.id} style={[styles.headerCell, { width: columnWidth }]}>
                <TouchableOpacity
                  style={styles.headerOpen}
                  onPress={() => onOpen(col.input.id)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={`${col.input.title}, event ${i + 1} of ${columns.length}. Open event`}
                >
                  <CompareThumb uri={col.input.coverImageUrl} title={col.input.title} size={44} />
                  <Text style={styles.headerTitle} numberOfLines={2} accessibilityRole="header" maxFontSizeMultiplier={FontScaleCaps.cell}>
                    {col.input.title}
                  </Text>
                  <Text style={styles.headerHost} numberOfLines={1} maxFontSizeMultiplier={FontScaleCaps.control}>
                    {col.input.hostName}
                  </Text>
                </TouchableOpacity>
                {col.missing ? (
                  <Text style={styles.headerNote}>No longer available</Text>
                ) : col.error ? (
                  <TouchableOpacity
                    onPress={col.refetch}
                    accessibilityRole="button"
                    accessibilityLabel={`Retry loading ${col.input.title}`}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.headerRetry}>Couldn&apos;t refresh · Retry</Text>
                  </TouchableOpacity>
                ) : col.loading ? (
                  <Text style={styles.headerNote}>Updating…</Text>
                ) : null}
              </View>
            ))}
          </ScrollView>
        </View>

        {/* ── Body: label column + horizontally scrolling values ── */}
        <View style={styles.bodyRow}>
          <View style={[styles.labelColumn, { width: LABEL_WIDTH }]}>
            {visible.map((row) => (
              <View
                key={row.key}
                style={[styles.labelCell, { height: heights[row.key] ?? MIN_ROW_HEIGHT }]}
                importantForAccessibility="no-hide-descendants"
              >
                <Text style={[styles.labelText, identicalKeys.has(row.key) && styles.dimmedText]} numberOfLines={2} maxFontSizeMultiplier={FontScaleCaps.cell}>
                  {row.label}
                </Text>
              </View>
            ))}
          </View>
          <ScrollView
            horizontal
            onScroll={syncHorizontal}
            scrollEventThrottle={16}
            showsHorizontalScrollIndicator
            contentContainerStyle={styles.valuesContent}
          >
            <View>
              {visible.map((row) => {
                const dimmed = identicalKeys.has(row.key);
                return (
                  <View
                    key={row.key}
                    style={styles.valueRow}
                    onLayout={(e) => measure(row.key, e.nativeEvent.layout.height)}
                  >
                    {row.cells.map((cell, i) => {
                      const best = row.best === i;
                      return (
                        <View
                          key={columns[i]?.input.id ?? i}
                          style={[styles.valueCell, { width: columnWidth }, best && styles.valueCellBest]}
                          accessible
                          accessibilityLabel={cellAccessibilityLabel(row, i, columns[i]?.input.title ?? '')}
                        >
                          <Text
                            maxFontSizeMultiplier={FontScaleCaps.cell}
                            style={[
                              styles.valueText,
                              best && styles.valueTextBest,
                              !cell.text && styles.mutedText,
                              dimmed && styles.dimmedText,
                            ]}
                          >
                            {best ? '★ ' : ''}
                            {cell.text || 'Not stated'}
                          </Text>
                          {cell.detail ? (
                            <Text style={[styles.detailText, dimmed && styles.dimmedText]}>{cell.detail}</Text>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          </ScrollView>
        </View>

        {/* ── Identical rows toggle ── */}
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
      </ScrollView>

      {/* ── Footer actions (pinned) ── */}
      <View
        style={[styles.footer, { paddingBottom: Math.max(bottomInset, Spacing.sm) }]}
        onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
      >
        <View style={[styles.corner, { width: LABEL_WIDTH }]}>
          <Text style={styles.labelText}>Actions</Text>
        </View>
        <ScrollView ref={footRef} horizontal scrollEnabled={false} showsHorizontalScrollIndicator={false}>
          {columns.map((col) => (
            <View key={col.input.id} style={[styles.footerCell, { width: columnWidth }]}>
              <CompareActions
                input={col.input}
                signedIn={signedIn}
                busy={busyIds.has(col.input.id)}
                compact
                onOpen={onOpen}
                onJoin={onJoin}
                onToggleSave={onToggleSave}
              />
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const MIN_ROW_HEIGHT = 44;

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: Colors.background.primary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border.light,
    paddingHorizontal: Spacing.md,
  },
  corner: { justifyContent: 'flex-end', paddingBottom: Spacing.sm },
  headerCell: {
    paddingVertical: Spacing.sm,
    paddingRight: Spacing.sm,
    gap: 4,
  },
  headerOpen: { gap: 4 },
  headerTitle: {
    fontSize: Typography.sizes.sm,
    lineHeight: 18,
    fontFamily: Typography.displayFontFamilies.bold,
    color: Colors.text.primary,
  },
  headerHost: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.text.secondary,
  },
  headerNote: { fontSize: Typography.sizes.xxs, fontFamily: Typography.fontFamily, color: Colors.text.tertiary },
  headerRetry: { fontSize: Typography.sizes.xxs, fontFamily: Typography.fontFamilies.semibold, color: Colors.primary },
  bodyRow: { flexDirection: 'row', paddingHorizontal: Spacing.md },
  labelColumn: {},
  labelCell: {
    justifyContent: 'center',
    paddingRight: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border.light,
  },
  labelText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.text.tertiary,
  },
  valuesContent: {},
  valueRow: {
    flexDirection: 'row',
    minHeight: MIN_ROW_HEIGHT,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border.light,
  },
  valueCell: {
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
    paddingRight: Spacing.sm,
  },
  valueCellBest: { backgroundColor: Colors.primarySoft, borderRadius: BorderRadius.sm },
  valueText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.primary,
  },
  valueTextBest: { color: Colors.primary, paddingLeft: 4 },
  mutedText: { color: Colors.text.disabled, fontFamily: Typography.fontFamily },
  dimmedText: { color: Colors.text.tertiary },
  detailText: {
    marginTop: 1,
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
  },
  identicalToggle: {
    minHeight: 44,
    marginHorizontal: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identicalText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.primary,
  },
  footer: {
    flexDirection: 'row',
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.background.primary,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border.light,
  },
  footerCell: { paddingRight: Spacing.sm },
});
