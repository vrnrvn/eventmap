/**
 * Multi-select interests picker (event categories), shared by onboarding and
 * Settings → Interests. Chips fill with the category colour when selected;
 * the colour, label and glyph come from the category row through
 * utils/categoryPresentation, so the picker needs no per-slug styling.
 *
 * Accessibility: each chip is a checkbox exposing `checked`; the summary line
 * is a live region so screen readers hear the count change.
 */
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Check } from '@/components/icons.generated';
import { CategoryIcon } from '@/components/CategoryIcon';
import { presentCategory } from '@/utils/categoryPresentation';
import { a11yState } from '@/utils/accessibility';
import { Colors, Typography, BorderRadius, Shadows } from '@/constants/theme';
import type { Category } from '@/types/database';

export type CategoryPickerStatus = 'loading' | 'error' | 'loaded';

type Props = {
  categories: readonly Category[];
  status: CategoryPickerStatus;
  onRetry: () => void;
  selectedIds: readonly string[];
  onToggle: (id: string) => void;
  /** 'spacious' = onboarding (md text, taller chips); 'compact' = forms. */
  density?: 'spacious' | 'compact';
  /** Show the "N selected" line under the grid. */
  showCount?: boolean;
  /** Copy for the error state; defaults to "interests". */
  noun?: string;
};

const CHIP_SKELETON_WIDTHS = [104, 128, 88, 140, 96, 120, 84, 112];

export function CategoryPicker({
  categories,
  status,
  onRetry,
  selectedIds,
  onToggle,
  density = 'spacious',
  showCount = true,
  noun = 'interests',
}: Props) {
  const compact = density === 'compact';
  const none = selectedIds.length === 0;

  if (status === 'error') {
    return (
      <View style={styles.error}>
        <Text style={styles.errorText}>
          Couldn&apos;t load {noun}. Check your connection and try again.
        </Text>
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={onRetry}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`Retry loading ${noun}`}
        >
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (status === 'loading') {
    return (
      <View
        style={[styles.grid, compact && styles.gridCompact]}
        accessible
        accessibilityLabel={`Loading ${noun}`}
        {...a11yState({ busy: true })}
      >
        {CHIP_SKELETON_WIDTHS.map((width, i) => (
          <View key={i} style={[styles.skeleton, compact && styles.skeletonCompact, { width }]} />
        ))}
      </View>
    );
  }

  return (
    <View>
      <View style={[styles.grid, compact && styles.gridCompact]}>
        {categories.map((cat) => {
          const isSelected = selectedIds.includes(cat.id);
          const { label, color } = presentCategory(cat);
          return (
            <TouchableOpacity
              key={cat.id}
              style={[
                styles.chip,
                compact && styles.chipCompact,
                isSelected && { backgroundColor: color, borderColor: color },
              ]}
              onPress={() => onToggle(cat.id)}
              activeOpacity={0.7}
              accessibilityRole="checkbox"
              {...a11yState({ checked: isSelected })}
              accessibilityLabel={label}
              hitSlop={compact ? { top: 4, bottom: 4, left: 2, right: 2 } : undefined}
            >
              {isSelected ? (
                <Check size={14} color={Colors.text.inverse} />
              ) : (
                <CategoryIcon category={cat} size="sm" variant="minimal" />
              )}
              <Text
                style={[
                  styles.chipText,
                  compact && styles.chipTextCompact,
                  isSelected && styles.chipTextSelected,
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {showCount ? (
        <Text style={styles.count} accessibilityLiveRegion="polite">
          {none ? 'Nothing selected yet' : `${selectedIds.length} selected`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  gridCompact: {
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.border.light,
    ...Shadows.sm,
  },
  chipCompact: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  chipText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.primary,
  },
  chipTextCompact: {
    fontSize: Typography.sizes.sm,
  },
  chipTextSelected: {
    color: Colors.text.inverse,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  skeleton: {
    height: 44,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.background.tertiary,
  },
  skeletonCompact: {
    height: 36,
  },
  error: {
    marginTop: 24,
    alignItems: 'center',
    gap: 14,
  },
  errorText: {
    fontSize: Typography.sizes.md,
    color: Colors.text.secondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  retryText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },
  count: {
    marginTop: 16,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
    color: Colors.text.tertiary,
    textAlign: 'center',
  },
});
