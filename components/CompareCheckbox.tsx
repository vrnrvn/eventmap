import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Check } from '@/components/icons.generated';
import { Colors, BorderRadius } from '@/constants/theme';
import { choiceA11y } from '@/utils/accessibility';

type Props = {
  selected: boolean;
  /** Event title, for the spoken label ("Compare Jazz Night"). */
  title: string;
  onToggle: () => void;
  /** Ended or cancelled events have nothing to compare. */
  disabled?: boolean;
};

/**
 * The per-row selection control shown while compare mode is on. It takes the
 * row's `rightAction` slot, which EventListItem keeps outside the row's own
 * press area, so tapping the row still opens the event and only the box
 * selects (plan §3.1). 44 px target around a 24 px box.
 */
export function CompareCheckbox({ selected, title, onToggle, disabled }: Props) {
  return (
    <TouchableOpacity
      style={[styles.target, disabled && styles.targetDisabled]}
      onPress={onToggle}
      disabled={disabled}
      activeOpacity={0.7}
      {...choiceA11y(selected, `Compare ${title}`, 'checkbox')}
    >
      <View style={[styles.box, selected && styles.boxSelected]}>
        {selected ? <Check size={16} color={Colors.white} strokeWidth={3} /> : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  target: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  targetDisabled: {
    opacity: 0.35,
  },
  box: {
    width: 24,
    height: 24,
    borderRadius: BorderRadius.sm,
    borderWidth: 2,
    borderColor: Colors.border.medium,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary,
  },
});
