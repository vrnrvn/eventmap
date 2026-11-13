/**
 * The next dates of a recurring series, compact, for list rows
 * (docs/EVENT_COLLECTIONS_PLAN.md §3.5, Phase E). Mirrors the attendee
 * section on Event Detail: exceptions applied (cancelled struck through,
 * moved marked), and the viewer's per-date state (Going / Not going /
 * Waitlist) when a series RSVP or overrides are known. Read-only; tapping a
 * date opens the event, where dates can be toggled.
 */
import { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CalendarDays } from '@/components/icons.generated';
import { listOccurrences, dateAttendance, type DateRsvpOverride, type OccurrenceException } from '@/utils/occurrences';
import { describeEventDateTime } from '@/utils/timezone';
import type { RecurrencePattern } from '@/utils/recurrence';
import { BorderRadius, Colors, Typography } from '@/constants/theme';

type SeriesLike = {
  id: string;
  start_datetime: string;
  end_datetime: string;
  is_recurring?: boolean;
  recurrence_pattern?: RecurrencePattern | null;
  timezone?: string | null;
};

type Props = {
  event: SeriesLike;
  exceptions: readonly OccurrenceException[];
  /** 'going' when the viewer is going to the series; null / undefined otherwise. */
  seriesStatus?: string | null;
  /** The viewer's per-date overrides (rsvp_occurrences). */
  overrides?: readonly DateRsvpOverride[];
  count?: number;
  onPressDate?: (dateKey: string) => void;
};

const ATTENDANCE_LABEL = { going: 'Going', not_going: 'Not going', waitlist: 'Waitlist', none: '' } as const;

export const SeriesDatesPreview = memo(function SeriesDatesPreview({
  event,
  exceptions,
  seriesStatus,
  overrides = [],
  count = 5,
  onPressDate,
}: Props) {
  // listOccurrences does not count cancelled dates towards `count`; the
  // preview promises exactly `count` rows, cancelled ones included.
  const dates = listOccurrences(event, exceptions, { count, strict: true }).slice(0, count);
  if (dates.length === 0) {
    return <Text style={styles.empty}>No more dates scheduled.</Text>;
  }
  return (
    <View style={styles.list} accessibilityLabel={`Next ${dates.length} dates`}>
      {dates.map((o) => {
        const display = describeEventDateTime(o.start, event.timezone);
        const attendance = o.status === 'cancelled' ? 'none' : dateAttendance(seriesStatus, overrides, o.dateKey);
        const label =
          `${display.primary}` +
          (o.status === 'cancelled' ? ', cancelled' : o.status === 'moved' ? ', moved' : '') +
          (attendance !== 'none' ? `, ${ATTENDANCE_LABEL[attendance].toLowerCase()}` : '') +
          (o.note ? `, ${o.note}` : '');
        const Row = onPressDate ? TouchableOpacity : View;
        return (
          <Row
            key={o.dateKey}
            style={styles.row}
            {...(onPressDate
              ? { onPress: () => onPressDate(o.dateKey), activeOpacity: 0.7, accessibilityRole: 'button' as const, accessibilityLabel: label }
              : { accessibilityLabel: label })}
          >
            <CalendarDays size={12} color={o.status === 'cancelled' ? Colors.text.disabled : Colors.text.tertiary} />
            <Text style={[styles.date, o.status === 'cancelled' && styles.dateCancelled]} numberOfLines={1}>
              {display.primary}
              {o.status === 'cancelled' ? ' · cancelled' : o.status === 'moved' ? ' · moved' : ''}
            </Text>
            {attendance !== 'none' ? (
              <View style={[styles.chip, attendance === 'going' ? styles.chipGoing : attendance === 'waitlist' ? styles.chipWait : styles.chipNo]}>
                <Text style={[styles.chipText, attendance === 'going' ? styles.chipTextGoing : attendance === 'waitlist' ? styles.chipTextWait : styles.chipTextNo]}>
                  {ATTENDANCE_LABEL[attendance]}
                </Text>
              </View>
            ) : null}
          </Row>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  list: { gap: 6 },
  empty: { fontSize: Typography.sizes.xs, fontFamily: Typography.fontFamily, color: Colors.text.tertiary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 28 },
  date: { flex: 1, fontSize: Typography.sizes.xs, fontFamily: Typography.fontFamily, color: Colors.text.secondary },
  dateCancelled: { textDecorationLine: 'line-through', color: Colors.text.disabled },
  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: BorderRadius.sm },
  chipGoing: { backgroundColor: Colors.successSoft },
  chipNo: { backgroundColor: Colors.neutralSoft },
  chipWait: { backgroundColor: Colors.warningSoft },
  chipText: { fontSize: Typography.sizes.xxs, fontFamily: Typography.fontFamilies.semibold },
  chipTextGoing: { color: Colors.successText },
  chipTextNo: { color: Colors.text.secondary },
  chipTextWait: { color: Colors.warningText },
});
