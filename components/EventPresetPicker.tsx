import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Colors, Typography, BorderRadius } from '@/constants/theme';
import { Check } from '@/components/icons.generated';
import { choiceA11y } from '@/utils/accessibility';
import { EVENT_PRESETS, describePresetSettings, type EventPresetId } from '@/utils/eventPresets';

/**
 * Event size presets at the top of Create (HOST_ONBOARDING_PLAN.md §11.2).
 * Prefill only: picking one never overwrites what the host already typed, and
 * the screen says so when a value is kept.
 */
export function EventPresetPicker({
  value,
  onSelect,
  keptNotice,
  suggested,
}: {
  value: EventPresetId | null;
  onSelect: (id: EventPresetId) => void;
  /** Shown when a preset left a host-entered value alone. */
  keptNotice?: string | null;
  /** Marked as suggested for this host type; never applied on its own. */
  suggested?: EventPresetId | null;
}) {
  const selected = value ? EVENT_PRESETS.find((p) => p.id === value) ?? null : null;
  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        accessibilityRole="radiogroup"
        accessibilityLabel="Event size"
      >
        {EVENT_PRESETS.map((preset) => {
          const isSelected = preset.id === value;
          const isSuggested = !value && preset.id === suggested;
          return (
            <TouchableOpacity
              key={preset.id}
              style={[styles.chip, isSelected && styles.chipSelected, isSuggested && styles.chipSuggested]}
              onPress={() => onSelect(preset.id)}
              activeOpacity={0.85}
              {...choiceA11y(
                isSelected,
                `${preset.label}, ${preset.sizeHint}${isSuggested ? ', suggested' : ''}. ${describePresetSettings(preset.id)}`
              )}
            >
              {isSelected ? <Check size={14} color={Colors.primary} /> : null}
              <Text style={[styles.chipLabel, isSelected && styles.chipLabelSelected]}>{preset.label}</Text>
              <Text style={[styles.chipHint, isSelected && styles.chipHintSelected]}>{preset.sizeHint}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      {selected ? (
        <Text style={styles.description}>{selected.description}</Text>
      ) : suggested ? (
        <Text style={styles.description}>
          Suggested for you: {EVENT_PRESETS.find((p) => p.id === suggested)?.label}. Tap to prefill; nothing changes until you do.
        </Text>
      ) : null}
      {keptNotice ? <Text style={styles.kept}>{keptNotice}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingVertical: 2, paddingRight: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: BorderRadius.round,
    borderWidth: 1.5,
    borderColor: Colors.border.light,
    backgroundColor: Colors.surface,
  },
  chipSelected: { borderColor: Colors.primary, backgroundColor: Colors.primarySoft },
  chipSuggested: { borderStyle: 'dashed', borderColor: Colors.primary },
  chipLabel: { fontSize: Typography.sizes.sm, fontFamily: Typography.labelFontFamilies.medium, color: Colors.text.primary },
  chipLabelSelected: { color: Colors.primary },
  chipHint: { fontSize: Typography.sizes.xs, fontFamily: Typography.fontFamily, color: Colors.text.tertiary },
  chipHintSelected: { color: Colors.primary },
  description: {
    marginTop: 8,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
  },
  kept: {
    marginTop: 4,
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
  },
});
