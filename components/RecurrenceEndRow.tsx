import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { CalendarCheck, X } from 'lucide-react-native';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import { WebDateTimeInput } from '@/components/WebDateTimeInput';
import {
  parseRecurrenceEndDate,
  toRecurrenceEndDate,
  type RecurrencePattern,
} from '@/utils/recurrence';

type Props = {
  /** The current pattern; the row is only meaningful when non-null. */
  pattern: RecurrencePattern;
  /** Earliest selectable end date — the series' first occurrence. */
  seriesStart: Date;
  onChange: (next: RecurrencePattern) => void;
  /** Visual variant matching the host form. */
  variant?: 'card' | 'flat';
};

const MAX_END = new Date();
MAX_END.setFullYear(MAX_END.getFullYear() + 10);

/**
 * "Repeats until" control for recurring events. Without an end date a
 * series never leaves discovery and stays RSVP-able forever (server
 * `event_has_ended` treats a missing endDate as open-ended), so hosts need
 * a way to set one. Stores `RecurencePattern.endDate` as a local
 * 'YYYY-MM-DD', which both the client helpers and the SQL (`left(...,10)::date`)
 * understand.
 */
export function RecurrenceEndRow({ pattern, seriesStart, onChange, variant = 'card' }: Props) {
  const [showPicker, setShowPicker] = useState(false);
  const endDate = parseRecurrenceEndDate(pattern.endDate);
  const minDate = seriesStart.getTime() > Date.now() ? seriesStart : new Date();

  const setEnd = (d: Date | null) => {
    const next = { ...pattern };
    if (d) next.endDate = toRecurrenceEndDate(d);
    else delete next.endDate;
    onChange(next);
  };

  const openPicker = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: endDate ?? minDate,
        mode: 'date',
        minimumDate: minDate,
        maximumDate: MAX_END,
        onChange: (ev, d) => {
          if (ev.type === 'set' && d) setEnd(d);
        },
      });
      return;
    }
    // iOS / web show an inline picker pre-filled with the minimum date but
    // only report changes on interaction; commit that first value so "Done"
    // never leaves the row saying "Never" while the wheel shows a date.
    if (!endDate && !showPicker) setEnd(minDate);
    setShowPicker((v) => !v);
  };

  const label = endDate
    ? endDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    : 'Never (series continues until you cancel it)';

  return (
    <View>
      <TouchableOpacity
        style={variant === 'card' ? styles.rowCard : styles.rowFlat}
        onPress={openPicker}
        activeOpacity={0.6}
        accessibilityRole="button"
        accessibilityLabel={endDate ? `Repeats until ${label}. Change end date` : 'Set an end date for this series'}
      >
        <CalendarCheck size={18} color={Colors.primary} />
        <View style={styles.textBlock}>
          <Text style={styles.label}>Repeats until</Text>
          <Text style={[styles.value, !endDate && styles.valueMuted]} numberOfLines={1}>
            {label}
          </Text>
        </View>
        {endDate ? (
          <TouchableOpacity
            onPress={() => {
              setShowPicker(false);
              setEnd(null);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Remove end date"
            style={styles.clearBtn}
          >
            <X size={16} color={Colors.text.tertiary} />
          </TouchableOpacity>
        ) : null}
      </TouchableOpacity>

      {Platform.OS === 'web' && showPicker ? (
        <View style={styles.pickerWrap}>
          <WebDateTimeInput
            mode="date"
            value={endDate ?? minDate}
            minimumDate={minDate}
            maximumDate={MAX_END}
            accessibilityLabel="Series end date"
            onChange={(d) => setEnd(d)}
          />
        </View>
      ) : null}

      {Platform.OS === 'ios' && showPicker ? (
        <View style={styles.pickerWrap}>
          <DateTimePicker
            value={endDate ?? minDate}
            mode="date"
            display="spinner"
            minimumDate={minDate}
            maximumDate={MAX_END}
            textColor={Colors.text.primary}
            themeVariant="light"
            onChange={(_, d) => {
              if (d) setEnd(d);
            }}
          />
          <TouchableOpacity
            style={styles.doneBtn}
            onPress={() => setShowPicker(false)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Done choosing end date"
          >
            <Text style={styles.doneText}>Done</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  rowFlat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border.light,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    marginBottom: Spacing.md,
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    fontSize: Typography.sizes.xs,
    color: Colors.text.tertiary,
    fontFamily: Typography.labelFontFamilies.semibold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  value: {
    fontSize: Typography.sizes.md,
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.semibold,
  },
  valueMuted: {
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.regular,
  },
  clearBtn: {
    padding: 4,
  },
  pickerWrap: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  doneBtn: {
    alignSelf: 'flex-end',
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  doneText: {
    color: Colors.primary,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
  },
});
