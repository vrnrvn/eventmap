import { memo, useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, Platform } from 'react-native';
import { ChevronLeft, ChevronRight } from '@/components/icons.generated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import { monthMatrix, type CalendarSource, type DayMarker, type MonthCell, type WeekStart } from '@/utils/calendar';

/** Marker colour per source; order matches SOURCE_PRIORITY so the first dot is the strongest commitment. */
export const SOURCE_COLORS: Record<CalendarSource, string> = {
  going: Colors.primary,
  hosting: Colors.success,
  interested: Colors.secondary,
  saved: Colors.accentDark,
  collections: Colors.secondaryDark,
};

export const SOURCE_LABELS: Record<CalendarSource, string> = {
  going: 'Going',
  interested: 'Interested',
  saved: 'Saved',
  hosting: 'Hosting',
  collections: 'Collections',
};

const MAX_DOTS = 3;
const SWIPE_DISTANCE = 48;

type Props = {
  year: number;
  month0: number;
  weekStart: WeekStart;
  todayKey: string;
  selectedKey: string | null;
  /** Dots per day (see `dayMarkers`), already ordered; days without events are absent. */
  markers: ReadonlyMap<string, readonly DayMarker[]>;
  /** Event count per day for the accessibility label. */
  counts: ReadonlyMap<string, number>;
  onSelectDay: (dayKey: string) => void;
  onShiftMonth: (delta: number) => void;
  locale?: string;
};

function weekdayLabels(weekStart: WeekStart, locale?: string): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  // 4 Jan 1970 was a Sunday; UTC arithmetic keeps the labels zone-independent.
  const labels: string[] = [];
  for (let i = 0; i < 7; i++) {
    const weekday = (weekStart + i) % 7;
    labels.push(fmt.format(new Date(Date.UTC(1970, 0, 4 + weekday, 12))));
  }
  return labels;
}

function monthTitle(year: number, month0: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month0, 1, 12))
  );
}

function cellLabel(cell: MonthCell, count: number, locale?: string): string {
  const date = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(Number(cell.dayKey.slice(0, 4)), Number(cell.dayKey.slice(5, 7)) - 1, cell.day, 12))
  );
  const events = count === 0 ? 'no events' : count === 1 ? '1 event' : `${count} events`;
  return `${cell.isToday ? 'Today, ' : ''}${date}, ${events}`;
}

export const MonthGrid = memo(function MonthGrid({
  year,
  month0,
  weekStart,
  todayKey,
  selectedKey,
  markers,
  counts,
  onSelectDay,
  onShiftMonth,
  locale,
}: Props) {
  const matrix = useMemo(() => monthMatrix(year, month0, weekStart, todayKey), [year, month0, weekStart, todayKey]);
  const labels = useMemo(() => weekdayLabels(weekStart, locale), [weekStart, locale]);
  const title = useMemo(() => monthTitle(year, month0, locale), [year, month0, locale]);
  // Horizontal swipe changes month. It only activates after a clear sideways
  // move and fails on vertical movement, so the surrounding list keeps
  // scrolling; the arrows stay as the accessible / no-gesture path.
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetX([-24, 24])
        .failOffsetY([-12, 12])
        .onEnd((e) => {
          if (Math.abs(e.translationX) > SWIPE_DISTANCE) onShiftMonth(e.translationX < 0 ? 1 : -1);
        }),
    [onShiftMonth]
  );

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.arrow}
          onPress={() => onShiftMonth(-1)}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ChevronLeft size={20} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title} accessibilityRole="header" accessibilityLiveRegion="polite">
          {title}
        </Text>
        <TouchableOpacity
          style={styles.arrow}
          onPress={() => onShiftMonth(1)}
          accessibilityRole="button"
          accessibilityLabel="Next month"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ChevronRight size={20} color={Colors.text.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.weekRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {labels.map((label, i) => (
          <Text key={`${label}-${i}`} style={styles.weekLabel}>
            {label}
          </Text>
        ))}
      </View>

      <GestureDetector gesture={swipe}>
        <View>
          {matrix.map((row, r) => (
            <View key={r} style={styles.weekRow}>
              {row.map((cell) => {
                const dayDots = markers.get(cell.dayKey) ?? [];
                const count = counts.get(cell.dayKey) ?? 0;
                const selected = cell.dayKey === selectedKey;
                return (
                  <TouchableOpacity
                    key={cell.dayKey}
                    style={styles.cell}
                    onPress={() => onSelectDay(cell.dayKey)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    // aria-selected is invalid on a button; on web the state
                    // goes into the label instead (native keeps the state).
                    accessibilityLabel={`${cellLabel(cell, count, locale)}${Platform.OS === 'web' && selected ? ', selected' : ''}`}
                    accessibilityState={Platform.OS === 'web' ? undefined : { selected }}
                  >
                    <View style={[styles.dayCircle, selected && styles.daySelected, cell.isToday && !selected && styles.dayToday]}>
                      <Text
                        style={[
                          styles.dayText,
                          !cell.inMonth && styles.dayTextMuted,
                          cell.isToday && styles.dayTextToday,
                          selected && styles.dayTextSelected,
                        ]}
                      >
                        {cell.day}
                      </Text>
                    </View>
                    <View style={styles.dots}>
                      {dayDots.slice(0, MAX_DOTS).map((marker) => {
                        const color = selected
                          ? Colors.white
                          : marker.kind === 'cancelled'
                            ? Colors.text.disabled
                            : SOURCE_COLORS[marker.kind];
                        // Pending requests and cancelled-only days draw as rings.
                        const hollow = marker.pending || marker.kind === 'cancelled';
                        return (
                          <View
                            key={marker.kind}
                            style={[
                              styles.dot,
                              hollow ? { borderWidth: 1.25, borderColor: color } : { backgroundColor: color },
                              !cell.inMonth && styles.dotMuted,
                            ]}
                          />
                        );
                      })}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>
      </GestureDetector>
    </View>
  );
});

const CELL_HEIGHT = 48;

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xs,
    paddingVertical: Spacing.sm,
  },
  arrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background.secondary,
  },
  title: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.primary,
    textTransform: 'capitalize',
  },
  weekRow: {
    flexDirection: 'row',
  },
  weekLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.medium,
    color: Colors.text.tertiary,
    paddingBottom: Spacing.xs,
    textTransform: 'capitalize',
  },
  cell: {
    flex: 1,
    height: CELL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 2,
  },
  dayCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  daySelected: {
    backgroundColor: Colors.primary,
  },
  dayToday: {
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  dayText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    color: Colors.text.primary,
  },
  dayTextMuted: {
    color: Colors.text.disabled,
  },
  dayTextToday: {
    color: Colors.primary,
    fontFamily: Typography.fontFamilies.bold,
  },
  dayTextSelected: {
    color: Colors.white,
    fontFamily: Typography.fontFamilies.bold,
  },
  dots: {
    flexDirection: 'row',
    gap: 3,
    height: 6,
    marginTop: 3,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: BorderRadius.sm,
  },
  dotMuted: {
    opacity: 0.4,
  },
});
