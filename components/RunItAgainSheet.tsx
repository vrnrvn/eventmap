/**
 * Pick when a duplicated event runs, before the copy is made.
 *
 * Seeded with `defaultRunAgainDay` at the source's own time of day, so the
 * common "same thing, next week" needs one tap. The duration is kept, like
 * MoveDateModal — hosts change the length in Edit, which opens straight after.
 * Platform split (web input / iOS inline / Android two-step) mirrors
 * MoveDateModal so there is one picker behaviour in the host tools.
 */
import { useState } from 'react';
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { ModalBackdrop } from '@/components/ui/ModalBackdrop';
import { Button } from '@/components/ui/Button';
import { WebDateTimeInput } from '@/components/WebDateTimeInput';
import { defaultRunAgainDay, runAgainWhen } from '@/utils/duplicateDate';
import { instantToPickerDate, pickerDateToInstant } from '@/utils/timezone';
import { formatOccurrenceWhen as formatWhen } from '@/hooks/useOccurrenceActions';
import { BorderRadius, Colors, Spacing, Typography } from '@/constants/theme';
import type { DuplicateSource } from '@/hooks/useDuplicateEvent';

export function RunItAgainSheet({
  source,
  busy = false,
  onCancel,
  onConfirm,
}: {
  source: DuplicateSource;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (when: { start: Date; end: Date }) => void;
}) {
  const duration = Math.max(0, source.end.getTime() - source.start.getTime());
  const toPicker = (d: Date) => instantToPickerDate(d, source.zone);
  const fromPicker = (d: Date) => pickerDateToInstant(d, source.zone);
  const [value, setValue] = useState(() =>
    toPicker(runAgainWhen(source, defaultRunAgainDay(source.start, source.zone), source.zone).start)
  );
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
      <ModalBackdrop onPress={busy ? () => {} : onCancel} label="Close" style={styles.backdrop} />
      <View style={styles.sheet} accessibilityViewIsModal onAccessibilityEscape={onCancel}>
        <Text style={styles.sheetTitle} accessibilityRole="header">
          Run it again
        </Text>
        <Text style={styles.meta}>Last time: {formatWhen(source.start, source.zone)}</Text>
        {Platform.OS === 'web' ? (
          <WebDateTimeInput
            mode="datetime"
            value={value}
            minimumDate={new Date()}
            accessibilityLabel="New date and time"
            onChange={setValue}
          />
        ) : Platform.OS === 'ios' ? (
          <DateTimePicker
            value={value}
            mode="datetime"
            display="inline"
            minimumDate={new Date()}
            onChange={(_, d) => d && setValue(d)}
          />
        ) : (
          <TouchableOpacity onPress={openAndroid} style={styles.androidPick} accessibilityRole="button">
            <Text style={styles.when}>{formatWhen(start, source.zone)}</Text>
            <Text style={styles.meta}>Tap to change</Text>
          </TouchableOpacity>
        )}
        {inPast ? (
          <Text style={styles.metaWarn}>Pick a time in the future.</Text>
        ) : (
          <Text style={styles.meta}>
            Copies the details, links and photos into a new draft.
            {source.isRecurring ? ' The repeat is not copied — set it again in Edit.' : ''}
          </Text>
        )}
        <View style={styles.sheetActions}>
          <Button label="Cancel" variant="ghost" onPress={onCancel} disabled={busy} />
          <Button
            label={busy ? 'Creating…' : 'Create draft'}
            onPress={() => onConfirm({ start, end: new Date(start.getTime() + duration) })}
            disabled={inPast || busy}
          />
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
