/**
 * Single-select event category picker for Create and Edit
 * (docs/CATEGORIES_AND_SERIES_PLAN.md §3.4). Two-column cards with icon,
 * label and the one-line description, filled with the category colour when
 * chosen, plus an optional dismissible "Looks like …" hint derived from the
 * title/description (never applied on its own).
 *
 * Accessibility: a radiogroup of radios exposing `checked` (choiceA11y), same
 * semantics the old chip scroller had.
 */
import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { CategoryIcon } from '@/components/CategoryIcon';
import { X } from '@/components/icons.generated';
import { categoryTint, presentCategory } from '@/utils/categoryPresentation';
import { suggestCategoryFromText } from '@/utils/categoryBrowse';
import { choiceA11y } from '@/utils/accessibility';
import { BorderRadius, Colors, Spacing, Typography } from '@/constants/theme';
import type { Category } from '@/types/database';

type Props = {
  categories: readonly Category[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** Text the suggestion is derived from; omit both to hide the hint. */
  title?: string;
  description?: string;
};

export function CategorySelectGrid({ categories, selectedId, onSelect, title = '', description = '' }: Props) {
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const suggestion = useMemo(
    () => suggestCategoryFromText(title, description, categories),
    [title, description, categories]
  );
  const showHint = suggestion && suggestion.id !== selectedId && suggestion.id !== dismissedId;
  const hint = showHint ? presentCategory(suggestion) : null;

  return (
    <View>
      {hint && suggestion ? (
        <View style={[styles.hint, { borderColor: hint.color, backgroundColor: categoryTint(hint.color, 0.08) }]}>
          <CategoryIcon category={suggestion} size="sm" variant="minimal" />
          <Text style={styles.hintText} accessibilityLiveRegion="polite">
            Looks like <Text style={styles.hintStrong}>{hint.label}</Text>
          </Text>
          <TouchableOpacity
            onPress={() => onSelect(suggestion.id)}
            accessibilityRole="button"
            accessibilityLabel={`Use ${hint.label}`}
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
          >
            <Text style={[styles.hintAction, { color: hint.color }]}>Use it</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setDismissedId(suggestion.id)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss suggestion"
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
          >
            <X size={16} color={Colors.text.tertiary} />
          </TouchableOpacity>
        </View>
      ) : null}
      <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel="Category">
        {categories.map((c) => {
          const selected = selectedId === c.id;
          const { label, description: blurb, color } = presentCategory(c);
          return (
            <TouchableOpacity
              key={c.id}
              style={[styles.card, selected && { backgroundColor: color, borderColor: color }]}
              onPress={() => onSelect(c.id)}
              activeOpacity={0.75}
              {...choiceA11y(selected, label)}
              accessibilityHint={blurb || undefined}
            >
              <CategoryIcon
                category={c}
                size="sm"
                variant={selected ? 'minimal' : 'pill'}
                color={selected ? '#FFFFFF' : undefined}
              />
              <View style={styles.cardText}>
                <Text style={[styles.label, selected && styles.onColor]} numberOfLines={1}>
                  {label}
                </Text>
                {blurb ? (
                  <Text style={[styles.blurb, selected && styles.onColorMuted]} numberOfLines={2}>
                    {blurb}
                  </Text>
                ) : null}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    marginBottom: Spacing.sm,
    minHeight: 44,
  },
  hintText: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.regular,
    color: Colors.text.secondary,
  },
  hintStrong: { fontFamily: Typography.fontFamilies.semibold, color: Colors.text.primary },
  hintAction: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamilies.semibold },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  card: {
    // Two columns: (100% - one gap) / 2.
    flexBasis: '48%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: Spacing.sm,
    minHeight: 64,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border.light,
    backgroundColor: Colors.surface,
  },
  cardText: { flex: 1, minWidth: 0 },
  label: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.primary,
  },
  blurb: {
    marginTop: 2,
    fontSize: Typography.sizes.xs,
    lineHeight: 15,
    fontFamily: Typography.fontFamilies.regular,
    color: Colors.text.tertiary,
  },
  onColor: { color: '#FFFFFF' },
  onColorMuted: { color: 'rgba(255,255,255,0.88)' },
});
