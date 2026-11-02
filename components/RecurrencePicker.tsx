import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { NativeViewGestureHandler } from 'react-native-gesture-handler';
import { BottomSheetModal, BottomSheetView, TouchableOpacity } from '@gorhom/bottom-sheet';
import { Check } from 'lucide-react-native';
import { alpha, Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import { RECURRENCE_OPTIONS, type RecurrenceOption } from '@/utils/recurrence';

export type RecurrencePickerHandle = {
  present: () => void;
  dismiss: () => void;
};

type RecurrencePickerProps = {
  selectedValue: RecurrenceOption;
  onSelect: (value: RecurrenceOption) => void;
};

function getLabel(value: RecurrenceOption): string {
  const opt = RECURRENCE_OPTIONS.find((o) => {
    if (value === null && o.value === null) return true;
    if (value && o.value && value.frequency === o.value.frequency && value.interval === o.value.interval)
      return true;
    return false;
  });
  return opt?.label ?? 'None';
}

export const RecurrencePicker = forwardRef<RecurrencePickerHandle, RecurrencePickerProps>(
  function RecurrencePicker({ selectedValue, onSelect }, ref) {
    const bottomSheetRef = useRef<BottomSheetModal>(null);

    useImperativeHandle(ref, () => ({
      present: () => bottomSheetRef.current?.present(),
      dismiss: () => bottomSheetRef.current?.dismiss(),
    }));

    return (
      <BottomSheetModal
        ref={bottomSheetRef}
        // Content-sized: dynamic sizing measures the BottomSheetView child, so
        // every option stays visible on small screens.
        enableDynamicSizing
        enablePanDownToClose
        enableDismissOnClose
        handleIndicatorStyle={styles.handleIndicator}
        backgroundStyle={styles.background}
      >
        <BottomSheetView>
          <NativeViewGestureHandler disallowInterruption>
            <View>
              <View style={styles.header}>
                <Text style={styles.title}>Repeat</Text>
              </View>
              <View style={styles.options}>
            {RECURRENCE_OPTIONS.map((opt) => {
            const isSelected = Boolean(
              (opt.value === null && selectedValue === null) ||
                (opt.value &&
                  selectedValue &&
                  opt.value.frequency === selectedValue.frequency &&
                  opt.value.interval === selectedValue.interval)
            );
            return (
              <TouchableOpacity
                key={opt.label}
                style={[styles.option, isSelected && styles.optionSelected]}
                onPress={() => {
                  onSelect(opt.value);
                  requestAnimationFrame(() => {
                    bottomSheetRef.current?.dismiss();
                  });
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Repeat ${opt.label}`}
                accessibilityState={{ selected: isSelected }}
              >
                <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                  {opt.label}
                </Text>
                {isSelected ? <Check size={18} color={Colors.primary} /> : null}
              </TouchableOpacity>
            );
          })}
              </View>
            </View>
          </NativeViewGestureHandler>
        </BottomSheetView>
      </BottomSheetModal>
    );
  }
);

export { getLabel as getRecurrenceLabel };

const styles = StyleSheet.create({
  handleIndicator: {
    backgroundColor: Colors.border.medium,
  },
  background: {
    backgroundColor: Colors.surface,
  },
  header: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.md,
  },
  title: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  options: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.xs,
  },
  optionSelected: {
    backgroundColor: alpha(Colors.primary, 0.12),
  },
  optionText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.regular,
    color: Colors.text.primary,
  },
  optionTextSelected: {
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },
});
