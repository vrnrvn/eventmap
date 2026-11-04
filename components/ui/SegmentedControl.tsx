import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, ViewStyle, StyleProp } from 'react-native';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  /** Spoken label; defaults to `label`. */
  accessibilityLabel?: string;
  /** Small count rendered after the label (e.g. attendees in a tab). */
  count?: number | null;
};

type Props<T extends string> = {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * Pill-shaped tab strip shared by the host screens. Extracted from the
 * Upcoming / Past control in `screens/MyEvents.tsx` so new hubs don't keep
 * re-rolling the same styles.
 */
export function SegmentedControl<T extends string>({ options, value, onChange, style }: Props<T>) {
  return (
    <View style={[styles.row, style]} accessibilityRole="tablist">
      {options.map((option) => {
        const active = option.value === value;
        const countLabel =
          option.count !== undefined && option.count !== null ? ` ${option.count}` : '';
        return (
          <TouchableOpacity
            key={option.value}
            style={[styles.segment, active && styles.segmentActive]}
            onPress={() => onChange(option.value)}
            activeOpacity={0.8}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.accessibilityLabel ?? option.label}
          >
            <Text style={[styles.text, active && styles.textActive]} numberOfLines={1}>
              {option.label}
              {countLabel ? <Text style={styles.count}>{countLabel}</Text> : null}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.xs,
    padding: 4,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.background.tertiary,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    paddingVertical: 8,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.round,
  },
  segmentActive: {
    backgroundColor: Colors.surface,
    shadowColor: Colors.background.dark,
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  text: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.semibold,
  },
  textActive: {
    color: Colors.primary,
  },
  count: {
    fontFamily: Typography.fontFamilies.regular,
    color: Colors.text.tertiary,
  },
});
