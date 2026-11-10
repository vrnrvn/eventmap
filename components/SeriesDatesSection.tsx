/**
 * Manage Event → "Upcoming dates" for a recurring series
 * (docs/CATEGORIES_AND_SERIES_PLAN.md §4.4). Lists the next dates with the
 * exceptions applied and lets the host Skip, Change time or Restore one date
 * (RPCs in 20261109140000). Each action confirms and offers to notify
 * attendees. Before the migration is applied the list still renders and the
 * actions explain they aren't available yet.
 */
import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SettingsSection } from '@/components/ui/SettingsSection';
import { ModalBackdrop } from '@/components/ui/ModalBackdrop';
import { Button } from '@/components/ui/Button';
import { WebDateTimeInput } from '@/components/WebDateTimeInput';
import { CalendarX, Clock, RotateCcw, Scissors } from '@/components/icons.generated';
import { useOccurrenceExceptions } from '@/hooks/useOccurrenceExceptions';
import { queryKeys } from '@/hooks/queryKeys';
import { occurrenceErrorMessage, occurrencesService } from '@/services/occurrences';
import { listOccurrences, type Occurrence } from '@/utils/occurrences';
import { describeRecurrence, type RecurrencePattern } from '@/utils/recurrence';
import { instantToPickerDate, isValidTimeZone, pickerDateToInstant } from '@/utils/timezone';
import { confirmAction } from '@/utils/confirm';
import { notify } from '@/utils/notify';
import { a11yState } from '@/utils/accessibility';
import { BorderRadius, Colors, Spacing, Typography } from '@/constants/theme';

type SeriesEvent = {
  id: string;
  start_datetime: string;
  end_datetime: string;
  is_recurring?: boolean;
  recurrence_pattern?: RecurrencePattern | null;
  timezone?: string | null;
};

const SHOWN = 8;

function formatWhen(d: Date, tz: string | null) {
  return d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    ...(tz ? { timeZone: tz } : {}),
  });
}

async function askNotify(title: string, message: string, confirmLabel: string): Promise<boolean | null> {
  const go = await confirmAction({ title, message, confirmLabel });
  if (!go) return null;
  return confirmAction({
    title: 'Tell attendees?',
    message: 'Send an in-app notice to people going, interested or who saved this event.',
    confirmLabel: 'Notify',
    cancelLabel: 'Don’t notify',
  });
}

export function SeriesDatesSection({ event, canEdit }: { event: SeriesEvent; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { exceptions, isError, refetch } = useOccurrenceExceptions(event.id, !!event.is_recurring);
  const tz = event.timezone && isValidTimeZone(event.timezone) ? event.timezone : null;
  const occurrences = useMemo(() => listOccurrences(event, exceptions, { count: SHOWN }), [event, exceptions]);
  const dateKeys = useMemo(() => occurrences.filter((o) => o.status !== 'cancelled').map((o) => o.dateKey), [occurrences]);
  // Per-date going counts (Phase F); {} before 20261109150000.
  const countsQuery = useQuery({
    queryKey: queryKeys.dateGoingCounts(event.id, dateKeys.join(',')),
    enabled: dateKeys.length > 0,
    queryFn: () => occurrencesService.getDateGoingCounts(event.id, dateKeys),
    staleTime: 30 * 1000,
  });
  const goingByDate = countsQuery.data?.going ?? {};
  const waitByDate = countsQuery.data?.waitlist ?? {};
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<Occurrence | null>(null);

  const after = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.occurrenceExceptions(event.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.eventDetails(event.id) });
  };

  const run = async (o: Occurrence, fn: () => Promise<{ notified: number }>, done: string) => {
    setBusyKey(o.dateKey);
    try {
      const r = await fn();
      await after();
      notify.success(r.notified > 0 ? `${done} ${r.notified} ${r.notified === 1 ? 'person was' : 'people were'} notified.` : done);
    } catch (e) {
      notify.error(occurrenceErrorMessage(e) ?? 'Couldn’t change that date. Try again.');
    } finally {
      setBusyKey(null);
    }
  };

  const skip = async (o: Occurrence) => {
    const when = formatWhen(o.start, tz);
    const n = await askNotify('Skip this date?', `${when} won't happen. The rest of the series is unchanged.`, 'Skip date');
    if (n === null) return;
    await run(o, () => occurrencesService.skipOccurrence(event.id, o.dateKey, { notify: n }), 'Date skipped.');
  };

  const restore = async (o: Occurrence) => {
    const n = await askNotify(
      'Restore this date?',
      `${formatWhen(o.originalStart, tz)} goes back to its original time.`,
      'Restore'
    );
    if (n === null) return;
    await run(o, () => occurrencesService.restoreOccurrence(event.id, o.dateKey, { notify: n }), 'Date restored.');
  };

  /** "This and following": split here, then edit the new series. */
  const splitFrom = async (o: Occurrence) => {
    const go = await confirmAction({
      title: 'Change this and following dates?',
      message: `The series will end before ${formatWhen(o.start, tz)} and a copy starts on that date, with everyone going carried over. You can then edit the new series without changing earlier dates.`,
      confirmLabel: 'Split series',
    });
    if (!go) return;
    setBusyKey(o.dateKey);
    try {
      const newId = await occurrencesService.splitSeriesFrom(event.id, o.dateKey);
      await after();
      notify.success('Series split. Edit the new series below.');
      router.push(`/business/edit-event/${newId}` as never);
    } catch (e) {
      notify.error(occurrenceErrorMessage(e) ?? 'Couldn’t split the series. Try again.');
    } finally {
      setBusyKey(null);
    }
  };

  const saveMove = async (o: Occurrence, start: Date, end: Date) => {
    setEditing(null);
    const n = await askNotify('Move this date?', `${formatWhen(o.originalStart, tz)} → ${formatWhen(start, tz)}`, 'Move date');
    if (n === null) return;
    await run(o, () => occurrencesService.rescheduleOccurrence(event.id, o.dateKey, start, end, { notify: n }), 'Date moved.');
  };

  return (
    <SettingsSection
      title="Upcoming dates"
      footer={`${describeRecurrence(event.recurrence_pattern, event.start_datetime, { withEnd: true })}. Changes here affect one date only; use Edit details to change the whole series.`}
    >
      {isError ? (
        <TouchableOpacity onPress={() => void refetch()} style={styles.row} accessibilityRole="button">
          <Text style={styles.muted}>Couldn’t load date changes. Tap to retry.</Text>
        </TouchableOpacity>
      ) : null}
      {occurrences.length === 0 ? (
        <View style={styles.row}>
          <Text style={styles.muted}>No upcoming dates.</Text>
        </View>
      ) : null}
      {occurrences.map((o) => {
        const busy = busyKey === o.dateKey;
        const label =
          o.status === 'cancelled'
            ? `${formatWhen(o.start, tz)}, skipped`
            : o.status === 'moved'
              ? `${formatWhen(o.start, tz)}, moved from ${formatWhen(o.originalStart, tz)}`
              : formatWhen(o.start, tz) + (goingByDate[o.dateKey] != null ? `, ${goingByDate[o.dateKey]} going` : '');
        return (
          <View key={o.dateKey} style={styles.row} accessible={false}>
            <View style={styles.rowText} accessible accessibilityLabel={label}>
              <Text style={[styles.when, o.status === 'cancelled' && styles.struck]}>{formatWhen(o.start, tz)}</Text>
              {o.status !== 'cancelled' && goingByDate[o.dateKey] != null ? (
                <Text style={styles.meta}>
                  {goingByDate[o.dateKey]} going{waitByDate[o.dateKey] ? ` · ${waitByDate[o.dateKey]} waiting` : ''}
                </Text>
              ) : null}
              {o.status === 'moved' ? (
                <Text style={styles.meta}>Moved from {formatWhen(o.originalStart, tz)}</Text>
              ) : o.status === 'cancelled' ? (
                <Text style={styles.metaWarn}>Skipped{o.note ? ` · ${o.note}` : ''}</Text>
              ) : null}
            </View>
            {canEdit ? (
              <View style={styles.actions}>
                {o.status === 'scheduled' ? (
                  <>
                    <TouchableOpacity
                      onPress={() => setEditing(o)}
                      disabled={busy}
                      style={styles.iconBtn}
                      accessibilityRole="button"
                      accessibilityLabel={`Change time of ${formatWhen(o.start, tz)}`}
                      {...a11yState({ disabled: busy, busy }, 'button')}
                    >
                      <Clock size={18} color={Colors.primary} />
                    </TouchableOpacity>
                    {o !== occurrences[0] && new Date(event.start_datetime) < o.originalStart ? (
                      <TouchableOpacity
                        onPress={() => void splitFrom(o)}
                        disabled={busy}
                        style={styles.iconBtn}
                        accessibilityRole="button"
                        accessibilityLabel={`Change ${formatWhen(o.start, tz)} and following dates`}
                        {...a11yState({ disabled: busy, busy }, 'button')}
                      >
                        <Scissors size={18} color={Colors.text.secondary} />
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      onPress={() => void skip(o)}
                      disabled={busy}
                      style={styles.iconBtn}
                      accessibilityRole="button"
                      accessibilityLabel={`Skip ${formatWhen(o.start, tz)}`}
                      {...a11yState({ disabled: busy, busy }, 'button')}
                    >
                      <CalendarX size={18} color={Colors.error} />
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity
                    onPress={() => void restore(o)}
                    disabled={busy}
                    style={styles.iconBtn}
                    accessibilityRole="button"
                    accessibilityLabel={`Restore ${formatWhen(o.originalStart, tz)}`}
                    {...a11yState({ disabled: busy, busy }, 'button')}
                  >
                    <RotateCcw size={18} color={Colors.primary} />
                  </TouchableOpacity>
                )}
              </View>
            ) : null}
          </View>
        );
      })}
      {editing ? (
        <MoveDateModal
          occurrence={editing}
          tz={tz}
          onCancel={() => setEditing(null)}
          onSave={(s, e) => void saveMove(editing, s, e)}
        />
      ) : null}
    </SettingsSection>
  );
}

/** Pick a new start for one date; the series duration is kept. */
function MoveDateModal({
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
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: 10, minHeight: 52 },
  rowText: { flex: 1, minWidth: 0 },
  when: { fontSize: Typography.sizes.md, fontFamily: Typography.fontFamilies.medium, color: Colors.text.primary },
  struck: { textDecorationLine: 'line-through', color: Colors.text.tertiary },
  meta: { fontSize: Typography.sizes.xs, fontFamily: Typography.fontFamilies.regular, color: Colors.text.secondary },
  metaWarn: { fontSize: Typography.sizes.xs, fontFamily: Typography.fontFamilies.medium, color: Colors.warningText },
  muted: { fontSize: Typography.sizes.sm, color: Colors.text.secondary, fontFamily: Typography.fontFamilies.regular },
  actions: { flexDirection: 'row', gap: Spacing.xs },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: BorderRadius.md },
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
