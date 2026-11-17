/**
 * Manage Event → "Upcoming dates" for a recurring series
 * (docs/CATEGORIES_AND_SERIES_PLAN.md §4.4). Lists the next dates with the
 * exceptions applied and lets the host Skip, Change time or Restore one date
 * (RPCs in 20261109140000). Each action confirms and offers to notify
 * attendees. Before the migration is applied the list still renders and the
 * actions explain they aren't available yet.
 */
import { useMemo } from 'react';
import { router } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { SettingsSection } from '@/components/ui/SettingsSection';
import { MoveDateModal } from '@/components/MoveDateModal';
import { CalendarX, Clock, RotateCcw, Scissors } from '@/components/icons.generated';
import { formatOccurrenceWhen as formatWhen, useOccurrenceActions } from '@/hooks/useOccurrenceActions';
import { useOccurrenceExceptions } from '@/hooks/useOccurrenceExceptions';
import { queryKeys } from '@/hooks/queryKeys';
import { occurrenceErrorMessage, occurrencesService } from '@/services/occurrences';
import { listOccurrences, type Occurrence } from '@/utils/occurrences';
import { describeRecurrence, type RecurrencePattern } from '@/utils/recurrence';
import { isValidTimeZone } from '@/utils/timezone';
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

export function SeriesDatesSection({ event, canEdit }: { event: SeriesEvent; canEdit: boolean }) {
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
  // Skip / move / restore are shared with the host dashboard (C5).
  const actions = useOccurrenceActions();
  const busyKeyFor = (o: Occurrence) => `${event.id}:${o.dateKey}`;
  const target = (o: Occurrence) => ({ eventId: event.id, tz, occurrence: o });
  const skip = (o: Occurrence) => actions.skip(target(o));
  const restore = (o: Occurrence) => actions.restore(target(o));

  /** "This and following": split here, then edit the new series. */
  const splitFrom = async (o: Occurrence) => {
    const go = await confirmAction({
      title: 'Change this and following dates?',
      message: `The series will end before ${formatWhen(o.start, tz)} and a copy starts on that date, with everyone going carried over. You can then edit the new series without changing earlier dates.`,
      confirmLabel: 'Split series',
    });
    if (!go) return;
    actions.setBusyKey(busyKeyFor(o));
    try {
      const newId = await occurrencesService.splitSeriesFrom(event.id, o.dateKey);
      await actions.after(event.id);
      notify.success('Series split. Edit the new series below.');
      router.push(`/business/edit-event/${newId}` as never);
    } catch (e) {
      notify.error(occurrenceErrorMessage(e) ?? 'Couldn’t split the series. Try again.');
    } finally {
      actions.setBusyKey(null);
    }
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
        const busy = actions.busyKey === busyKeyFor(o);
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
                      onPress={() => actions.startMove(target(o))}
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
      {actions.moving ? (
        <MoveDateModal
          occurrence={actions.moving.occurrence}
          tz={actions.moving.tz}
          onCancel={actions.cancelMove}
          onSave={(s, e) => void actions.saveMove(actions.moving!, s, e)}
        />
      ) : null}
    </SettingsSection>
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

});
