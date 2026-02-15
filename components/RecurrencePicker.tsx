import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { NativeViewGestureHandler } from 'react-native-gesture-handler';
import { BottomSheetModal, BottomSheetView, TouchableOpacity } from '@gorhom/bottom-sheet';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
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
        snapPoints={['40%']}
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
            const isSelected =
              (opt.value === null && selectedValue === null) ||
              (opt.value &&
                selectedValue &&
                opt.value.frequency === selectedValue.frequency &&
                opt.value.interval === selectedValue.interval);
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
              >
                <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                  {opt.label}
                </Text>
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
    backgroundColor: Colors.background.primary,
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
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.xs,
  },
  optionSelected: {
    backgroundColor: Colors.primary + '20',
  },
  optionText: {
    fontSize: Typography.sizes.md,
    color: Colors.text.primary,
  },
  optionTextSelected: {
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },
});
