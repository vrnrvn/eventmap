import React, { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from '@/components/icons.generated';
import { Button } from '@/components/ui/Button';
import { CompareThumb } from '@/components/CompareThumb';
import { BorderRadius, Colors, FontScaleCaps, Shadows, Spacing, Typography } from '@/constants/theme';
import { COMPARE_MAX, compareCtaLabel } from '@/stores/compareStore';
import { useCompareSelection } from '@/hooks/useCompareSelection';
import { a11yState } from '@/utils/accessibility';

type Props = {
  /**
   * Reports the tray's rendered height (0 when hidden) so the list behind it
   * can pad its bottom and the last row stays reachable.
   */
  onHeight?: (height: number) => void;
  /** False when the tray sits above a tab bar that already owns the inset. */
  respectBottomInset?: boolean;
};

/**
 * The compare tray (docs/EVENT_COMPARISON_PLAN.md §3.1): a dock at the bottom
 * of a list screen that shows the shortlist as it builds and carries the one
 * call to action. Shown while compare mode is on or anything is selected, so
 * a shortlist started on Saved is still there in a collection.
 */
export function CompareTray({ onHeight, respectBottomInset = true }: Props) {
  const insets = useSafeAreaInsets();
  const { items, active, count, canCompare, remove, exit, openComparison } = useCompareSelection();
  const visible = active || count > 0;

  useEffect(() => {
    if (!visible) onHeight?.(0);
  }, [visible, onHeight]);

  if (!visible) return null;

  const emptySlots = Math.max(0, COMPARE_MAX - count);

  return (
    <View
      style={[styles.tray, { paddingBottom: respectBottomInset ? Math.max(insets.bottom, Spacing.sm) : Spacing.sm }]}
      onLayout={(e) => onHeight?.(e.nativeEvent.layout.height)}
    >
      <View style={styles.row}>
        <View style={styles.thumbs} accessibilityLabel={`${count} of ${COMPARE_MAX} events selected`}>
          {items.map((event) => (
            <View key={event.id} style={styles.thumbWrap}>
              <CompareThumb uri={event.coverImageUrl} title={event.title} size={40} />
              <TouchableOpacity
                style={styles.removeBtn}
                onPress={() => remove(event.id)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${event.title} from comparison`}
              >
                <X size={12} color={Colors.white} strokeWidth={3} />
              </TouchableOpacity>
            </View>
          ))}
          {Array.from({ length: emptySlots }).map((_, i) => (
            <View key={`slot-${i}`} style={[styles.thumb, styles.slot]} importantForAccessibility="no" />
          ))}
        </View>
        <Text style={styles.countText} numberOfLines={1} maxFontSizeMultiplier={FontScaleCaps.control}>
          {count === 0 ? 'Tick events to compare' : `${count} of ${COMPARE_MAX}`}
        </Text>
        <TouchableOpacity
          style={styles.exitBtn}
          onPress={exit}
          accessibilityRole="button"
          accessibilityLabel="Exit compare mode"
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <X size={20} color={Colors.text.secondary} />
        </TouchableOpacity>
      </View>
      <Button
        label={compareCtaLabel(count)}
        onPress={openComparison}
        disabled={!canCompare}
        fullWidth
        accessibilityLabel={canCompare ? `Compare ${count} selected events` : compareCtaLabel(count)}
        {...a11yState({ disabled: !canCompare })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tray: {
    paddingTop: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm + 2,
    backgroundColor: Colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border.light,
    ...Shadows.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  thumbs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  thumbWrap: {
    width: 40,
    height: 40,
  },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.background.secondary,
  },
  slot: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.border.light,
    backgroundColor: 'transparent',
  },
  removeBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.text.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.surface,
  },
  countText: {
    flex: 1,
    textAlign: 'right',
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.text.secondary,
  },
  exitBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
