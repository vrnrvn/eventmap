import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { NativeViewGestureHandler } from 'react-native-gesture-handler';
import { BottomSheetModal, BottomSheetScrollView, TouchableOpacity } from '@gorhom/bottom-sheet';
import { Check, Minus, Plus } from '@/components/icons.generated';
import { alpha, Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import {
  describeRecurrence,
  endDateAfterCount,
  getNextOccurrences,
  getRecurrenceLabel as labelForPattern,
  normalizeWeekdays,
  validateRecurrencePattern,
  weekOfMonthFor,
  type RecurrenceFrequency,
  type RecurrenceOption,
  type RecurrencePattern,
} from '@/utils/recurrence';
import { a11yState } from '@/utils/accessibility';

export type RecurrencePickerHandle = {
  present: () => void;
  dismiss: () => void;
};

type RecurrencePickerProps = {
  selectedValue: RecurrenceOption;
  /**
   * Called on Done with the new pattern (or null for "Doesn't repeat"). When
   * the host used "Ends after N times" the pattern carries the computed
   * `endDate`; otherwise it has none and callers keep their own end date.
   */
  onSelect: (value: RecurrenceOption) => void;
  /** First occurrence, as the form's picker date (event-zone wall clock). */
  seriesStart?: Date;
  /**
   * Lets the sheet move the form's start to the first chosen weekday when
   * the start isn't one (G6), so the stored start is always an occurrence.
   */
  onMoveStart?: (next: Date) => void;
  /**
   * When true only "Doesn't repeat" is selectable. Used for hosts whose
   * premium has lapsed: they may still turn recurrence off on an existing
   * series (the DB trigger allows it) but not pick a new pattern.
   */
  noneOnly?: boolean;
};

type Freq = 'none' | RecurrenceFrequency;

const FREQS: { key: Freq; label: string; unit: [string, string] }[] = [
  { key: 'none', label: "Doesn't repeat", unit: ['', ''] },
  { key: 'daily', label: 'Daily', unit: ['day', 'days'] },
  { key: 'weekly', label: 'Weekly', unit: ['week', 'weeks'] },
  { key: 'monthly', label: 'Monthly', unit: ['month', 'months'] },
];
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDINAL = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', [-1]: 'last' } as Record<number, string>;
const MAX_INTERVAL = 99;
const MAX_COUNT = 200;
/** Above this many dates the preview warns: a very long series is usually a mistake. */
const LONG_SERIES = 200;

type Draft = {
  freq: Freq;
  interval: number;
  days: number[];
  monthly: 'dayOfMonth' | 'nthWeekday';
  /** 0 = no count limit ("Never" / the form's end date row decides). */
  count: number;
};

function draftFrom(value: RecurrenceOption, start: Date): Draft {
  return {
    freq: value?.frequency ?? 'none',
    interval: Math.min(Math.max(Math.floor(Number(value?.interval) || 1), 1), MAX_INTERVAL),
    days: normalizeWeekdays(value?.byWeekday) ?? [start.getDay()],
    monthly: value?.monthly === 'nthWeekday' ? 'nthWeekday' : 'dayOfMonth',
    count: 0,
  };
}

function patternFrom(d: Draft, start: Date): RecurrencePattern | null {
  if (d.freq === 'none') return null;
  const p: RecurrencePattern = { frequency: d.freq, interval: d.interval };
  if (d.freq === 'weekly') {
    // Only store byWeekday when it says more than the start's weekday, so a
    // plain "every week" stays the original v1 shape.
    const only = d.days.length === 1 && d.days[0] === start.getDay();
    if (!only) p.byWeekday = [...d.days].sort((a, b) => a - b);
  }
  if (d.freq === 'monthly' && d.monthly === 'nthWeekday') p.monthly = 'nthWeekday';
  return p;
}

const fmt = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  label: string;
}) {
  return (
    <View style={styles.stepper} accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ now: value, min, max }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment') onChange(Math.min(value + 1, max));
        if (e.nativeEvent.actionName === 'decrement') onChange(Math.max(value - 1, min));
      }}
    >
      <TouchableOpacity
        onPress={() => onChange(Math.max(value - 1, min))}
        disabled={value <= min}
        style={[styles.stepBtn, value <= min && styles.dim]}
        accessibilityElementsHidden
        importantForAccessibility="no"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Minus size={16} color={Colors.text.primary} />
      </TouchableOpacity>
      <Text style={styles.stepValue}>{value}</Text>
      <TouchableOpacity
        onPress={() => onChange(Math.min(value + 1, max))}
        disabled={value >= max}
        style={[styles.stepBtn, value >= max && styles.dim]}
        accessibilityElementsHidden
        importantForAccessibility="no"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Plus size={16} color={Colors.text.primary} />
      </TouchableOpacity>
    </View>
  );
}

export const RecurrencePicker = forwardRef<RecurrencePickerHandle, RecurrencePickerProps>(
  function RecurrencePicker({ selectedValue, onSelect, seriesStart, noneOnly = false, onMoveStart }, ref) {
    const bottomSheetRef = useRef<BottomSheetModal>(null);
    const startMs = seriesStart?.getTime();
    // Stable per start instant so the preview memos don't recompute every render.
    const start = useMemo(() => (startMs != null ? new Date(startMs) : new Date()), [startMs]);
    const [draft, setDraft] = useState<Draft>(() => draftFrom(selectedValue, start));

    useImperativeHandle(ref, () => ({
      present: () => {
        // Re-seed from the form each time so a cancelled edit is discarded.
        setDraft(draftFrom(selectedValue, seriesStart ?? new Date()));
        bottomSheetRef.current?.present();
      },
      dismiss: () => bottomSheetRef.current?.dismiss(),
    }));

    const pattern = useMemo(() => patternFrom(draft, start), [draft, start]);
    const error = pattern ? validateRecurrencePattern(pattern) : null;

    const preview = useMemo(() => {
      if (!pattern || error) return null;
      const event = { start_datetime: start.toISOString(), is_recurring: true, recurrence_pattern: pattern };
      const from = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const upcoming = getNextOccurrences(event, 4, from);
      const endDate = draft.count > 0 ? endDateAfterCount(event, draft.count) : null;
      return { upcoming, endDate };
    }, [pattern, error, start, draft.count]);

    const commit = () => {
      if (error) return;
      if (!pattern) onSelect(null);
      else if (draft.count > 0 && preview?.endDate) onSelect({ ...pattern, endDate: preview.endDate });
      else onSelect(pattern);
      requestAnimationFrame(() => bottomSheetRef.current?.dismiss());
    };

    const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
    const unit = FREQS.find((f) => f.key === draft.freq)?.unit ?? ['', ''];
    const startWeek = weekOfMonthFor(start);

    return (
      <BottomSheetModal
        ref={bottomSheetRef}
        enableDynamicSizing
        enablePanDownToClose
        enableDismissOnClose
        handleIndicatorStyle={styles.handleIndicator}
        backgroundStyle={styles.background}
      >
        <BottomSheetScrollView>
          <NativeViewGestureHandler disallowInterruption>
            <View style={styles.body}>
              <Text style={styles.title} accessibilityRole="header">Repeat</Text>
              {noneOnly ? (
                <Text style={styles.subtitle}>Recurring events need Premium. You can still turn repeating off.</Text>
              ) : null}

              <View style={styles.freqRow} accessibilityRole="radiogroup" accessibilityLabel="How often">
                {FREQS.map((f) => {
                  const selected = draft.freq === f.key;
                  const disabled = noneOnly && f.key !== 'none';
                  return (
                    <TouchableOpacity
                      key={f.key}
                      style={[styles.freqChip, selected && styles.freqChipOn, disabled && styles.dim]}
                      onPress={() => !disabled && set({ freq: f.key })}
                      disabled={disabled}
                      activeOpacity={0.7}
                      accessibilityRole="radio"
                      accessibilityLabel={f.label}
                      {...a11yState({ checked: selected, disabled })}
                    >
                      <Text style={[styles.freqText, selected && styles.freqTextOn]}>{f.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {draft.freq !== 'none' ? (
                <>
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>Every</Text>
                    <Stepper
                      value={draft.interval}
                      min={1}
                      max={MAX_INTERVAL}
                      onChange={(n) => set({ interval: n })}
                      label={`Repeat every ${draft.interval} ${draft.interval === 1 ? unit[0] : unit[1]}`}
                    />
                    <Text style={styles.rowUnit}>{draft.interval === 1 ? unit[0] : unit[1]}</Text>
                  </View>

                  {draft.freq === 'weekly' ? (
                    <View>
                      <Text style={styles.sectionLabel}>On</Text>
                      <View style={styles.daysRow}>
                        {DAY_LETTERS.map((letter, day) => {
                          const on = draft.days.includes(day);
                          return (
                            <TouchableOpacity
                              key={day}
                              style={[styles.day, on && styles.dayOn]}
                              onPress={() =>
                                set({ days: on ? draft.days.filter((x) => x !== day) : [...draft.days, day] })
                              }
                              activeOpacity={0.7}
                              accessibilityRole="checkbox"
                              accessibilityLabel={DAY_NAMES[day]}
                              {...a11yState({ checked: on })}
                            >
                              <Text style={[styles.dayText, on && styles.dayTextOn]}>{letter}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      <View style={styles.quickRow}>
                        {[
                          { label: 'Weekdays', days: [1, 2, 3, 4, 5] },
                          { label: 'Weekends', days: [0, 6] },
                          { label: `Only ${DAY_NAMES[start.getDay()]}`, days: [start.getDay()] },
                        ].map((q) => (
                          <TouchableOpacity
                            key={q.label}
                            onPress={() => set({ days: q.days })}
                            style={styles.quick}
                            accessibilityRole="button"
                            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                          >
                            <Text style={styles.quickText}>{q.label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  ) : null}

                  {draft.freq === 'monthly' ? (
                    <View accessibilityRole="radiogroup" accessibilityLabel="Which day of the month">
                      {[
                        { key: 'dayOfMonth' as const, label: `On day ${start.getDate()}` },
                        // The week comes from the start date (server rule):
                        // a start in the month's last seven days means "last".
                        { key: 'nthWeekday' as const, label: `On the ${ORDINAL[startWeek]} ${DAY_NAMES[start.getDay()]}` },
                      ].map((o) => {
                        const selected = draft.monthly === o.key;
                        return (
                          <TouchableOpacity
                            key={o.label}
                            style={[styles.option, selected && styles.optionSelected]}
                            onPress={() => set({ monthly: o.key })}
                            activeOpacity={0.7}
                            accessibilityRole="radio"
                            accessibilityLabel={o.label}
                            {...a11yState({ checked: selected })}
                          >
                            <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{o.label}</Text>
                            {selected ? <Check size={18} color={Colors.primary} /> : null}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ) : null}

                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>Ends after</Text>
                    <Stepper
                      value={draft.count}
                      min={0}
                      max={MAX_COUNT}
                      onChange={(n) => set({ count: n })}
                      label={draft.count === 0 ? 'No limit on the number of dates' : `Ends after ${draft.count} dates`}
                    />
                    <Text style={styles.rowUnit}>{draft.count === 0 ? 'no limit' : draft.count === 1 ? 'time' : 'times'}</Text>
                  </View>

                  <View style={styles.preview} accessibilityLiveRegion="polite">
                    {error ? (
                      <Text style={styles.errorText}>{error}</Text>
                    ) : pattern ? (
                      <>
                        <Text style={styles.previewTitle}>{describeRecurrence(pattern, start)}</Text>
                        {preview?.upcoming.length ? (
                          <Text style={styles.previewDates}>
                            Starting {preview.upcoming.map(fmt).join(', ')}
                            {draft.count === 0 || draft.count > preview.upcoming.length ? '…' : ''}
                          </Text>
                        ) : null}
                        {draft.count > 0 && preview?.endDate ? (
                          <Text style={styles.previewDates}>
                            {draft.count} dates, last on{' '}
                            {new Date(`${preview.endDate}T12:00:00`).toLocaleDateString(undefined, {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </Text>
                        ) : null}
                        {draft.count >= LONG_SERIES ? (
                          <Text style={styles.warnText}>That is a long series — double-check the count.</Text>
                        ) : null}
                        {draft.freq === 'weekly' && !draft.days.includes(start.getDay()) ? (
                          <View style={styles.warnRow}>
                            <Text style={[styles.warnText, styles.warnFlex]}>
                              The start date ({DAY_NAMES[start.getDay()]}) isn&apos;t one of the chosen days, so the
                              series begins on {preview?.upcoming[0] ? fmt(preview.upcoming[0]) : 'the next chosen day'}.
                            </Text>
                            {onMoveStart && preview?.upcoming[0] ? (
                              <TouchableOpacity
                                onPress={() => onMoveStart(preview.upcoming[0])}
                                accessibilityRole="button"
                                accessibilityLabel={`Move the start to ${fmt(preview.upcoming[0])}`}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              >
                                <Text style={styles.quickText}>Move start</Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        ) : null}
                      </>
                    ) : (
                      <Text style={styles.previewDates}>One date only.</Text>
                    )}
                  </View>
                </>
              ) : null}

              <TouchableOpacity
                style={[styles.done, error && styles.dim]}
                onPress={commit}
                disabled={!!error}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Done"
                {...a11yState({ disabled: !!error }, 'button')}
              >
                <Text style={styles.doneText}>Done</Text>
              </TouchableOpacity>
            </View>
          </NativeViewGestureHandler>
        </BottomSheetScrollView>
      </BottomSheetModal>
    );
  }
);

/** Label for the form's Repeat row. Uses the start for "Every Tuesday" etc. */
export function getRecurrenceLabel(value: RecurrenceOption, start?: Date): string {
  if (!value) return "Doesn't repeat";
  return start ? describeRecurrence(value, start) : labelForPattern(value);
}

const styles = StyleSheet.create({
  handleIndicator: { backgroundColor: Colors.border.medium },
  background: { backgroundColor: Colors.surface },
  body: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xl, gap: Spacing.md },
  title: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  subtitle: { fontSize: Typography.sizes.sm, color: Colors.text.secondary, fontFamily: Typography.fontFamilies.regular },
  freqRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  freqChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: BorderRadius.round,
    borderWidth: 1,
    borderColor: Colors.border.light,
  },
  freqChipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  freqText: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamilies.medium, color: Colors.text.primary },
  freqTextOn: { color: '#FFFFFF' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  rowLabel: {
    width: 76,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    color: Colors.text.secondary,
  },
  rowUnit: { fontSize: Typography.sizes.md, fontFamily: Typography.fontFamilies.regular, color: Colors.text.primary },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border.light,
    borderRadius: BorderRadius.md,
  },
  stepBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  stepValue: {
    minWidth: 32,
    textAlign: 'center',
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.primary,
  },
  sectionLabel: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    color: Colors.text.secondary,
    marginBottom: Spacing.xs,
  },
  daysRow: { flexDirection: 'row', justifyContent: 'space-between' },
  day: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border.light,
  },
  dayOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  dayText: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamilies.semibold, color: Colors.text.primary },
  dayTextOn: { color: '#FFFFFF' },
  quickRow: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.sm },
  quick: { paddingVertical: 4 },
  quickText: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamilies.medium, color: Colors.primary },
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
  optionSelected: { backgroundColor: alpha(Colors.primary, 0.12) },
  optionText: { fontSize: Typography.sizes.md, fontFamily: Typography.fontFamilies.regular, color: Colors.text.primary },
  optionTextSelected: {
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },
  preview: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.background.secondary,
    gap: 4,
  },
  previewTitle: { fontSize: Typography.sizes.md, fontFamily: Typography.fontFamilies.semibold, color: Colors.text.primary },
  previewDates: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamilies.regular, color: Colors.text.secondary },
  warnRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  warnFlex: { flex: 1 },
  warnText: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamilies.regular, color: Colors.warningText },
  errorText: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamilies.medium, color: Colors.error },
  done: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primary,
  },
  doneText: { fontSize: Typography.sizes.md, fontFamily: Typography.fontFamilies.semibold, color: '#FFFFFF' },
  dim: { opacity: 0.45 },
});
