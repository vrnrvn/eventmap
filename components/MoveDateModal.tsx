/**
 * Pick a new start for one date of a series; the series duration is kept.
 * Extracted unchanged from components/SeriesDatesSection.tsx so Manage event
 * and the host dashboard (docs/HOST_DASHBOARD_PLAN.md C5) share one picker.
 */
import { useState } from 'react';
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { ModalBackdrop } from '@/components/ui/ModalBackdrop';
import { Button } from '@/components/ui/Button';
import { WebDateTimeInput } from '@/components/WebDateTimeInput';
import type { Occurrence } from '@/utils/occurrences';
import { instantToPickerDate, pickerDateToInstant } from '@/utils/timezone';
import { formatOccurrenceWhen as formatWhen } from '@/hooks/useOccurrenceActions';
import { BorderRadius, Colors, Spacing, Typography } from '@/constants/theme';

/** Pick a new start for one date; the series duration is kept. */
export function MoveDateModal({
  occurrence,
  tz,
  onCancel,
  onSave,
}: {
  occurrence: Occurrence;
  tz: string | null;
  onCancel: () => void;
  onSave: (start: Date, end: Date) => void;
}) {
  const duration = occurrence.end.getTime() - occurrence.start.getTime();
  // Pickers work on the event zone's wall clock (same as Create/Edit).
  const toPicker = (d: Date) => (tz ? instantToPickerDate(d, tz) : d);
  const fromPicker = (d: Date) => (tz ? pickerDateToInstant(d, tz) : d);
  const [value, setValue] = useState(() => toPicker(occurrence.start));
  const start = fromPicker(value);
  const inPast = start.getTime() <= Date.now();

  const openAndroid = () => {
    DateTimePickerAndroid.open({
      value,
      mode: 'date',
      minimumDate: new Date(),
      onChange: (ev, d) => {
        if (ev.type !== 'set' || !d) return;
        const withDate = new Date(value);
        withDate.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
        DateTimePickerAndroid.open({
          value: withDate,
          mode: 'time',
          onChange: (ev2, t) => {
            if (ev2.type !== 'set' || !t) return setValue(withDate);
            const next = new Date(withDate);
            next.setHours(t.getHours(), t.getMinutes(), 0, 0);
            setValue(next);
          },
        });
      },
    });
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <ModalBackdrop onPress={onCancel} label="Close" style={styles.backdrop} />
      <View style={styles.sheet} accessibilityViewIsModal onAccessibilityEscape={onCancel}>
        <Text style={styles.sheetTitle} accessibilityRole="header">Move this date</Text>
        <Text style={styles.meta}>Originally {formatWhen(occurrence.originalStart, tz)}</Text>
        {Platform.OS === 'web' ? (
          <WebDateTimeInput mode="datetime" value={value} minimumDate={new Date()} accessibilityLabel="New start" onChange={setValue} />
        ) : Platform.OS === 'ios' ? (
          <DateTimePicker value={value} mode="datetime" display="inline" minimumDate={new Date()} onChange={(_, d) => d && setValue(d)} />
        ) : (
          <TouchableOpacity onPress={openAndroid} style={styles.androidPick} accessibilityRole="button">
            <Text style={styles.when}>{formatWhen(start, tz)}</Text>
            <Text style={styles.meta}>Tap to change</Text>
          </TouchableOpacity>
        )}
        {inPast ? <Text style={styles.metaWarn}>Pick a time in the future.</Text> : null}
        <View style={styles.sheetActions}>
          <Button label="Cancel" variant="ghost" onPress={onCancel} />
          <Button label="Move date" onPress={() => onSave(start, new Date(start.getTime() + duration))} disabled={inPast} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  when: { fontSize: Typography.sizes.md, fontFamily: Typography.fontFamilies.medium, color: Colors.text.primary },
  meta: { fontSize: Typography.sizes.xs, fontFamily: Typography.fontFamilies.regular, color: Colors.text.secondary },
  metaWarn: { fontSize: Typography.sizes.xs, fontFamily: Typography.fontFamilies.medium, color: Colors.warningText },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    top: '20%',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  sheetTitle: { fontSize: Typography.sizes.lg, fontFamily: Typography.fontFamilies.semibold, color: Colors.text.primary },
  sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.sm, marginTop: Spacing.sm },
  androidPick: { paddingVertical: Spacing.md },
});
