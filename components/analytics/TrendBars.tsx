import { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import { trendMax } from '@/utils/analytics';

export type TrendBarPoint = { date: string; value: number };

type Props = {
  points: readonly TrendBarPoint[];
  color?: string;
  height?: number;
  /** Metric name for the accessibility summary, e.g. "views". */
  metricLabel: string;
  locale?: string;
};

function shortDate(date: string, locale?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))
  );
}

/**
 * Daily bar chart built from Views (no chart dependency). Bars scale to the
 * busiest day; the first and last dates label the axis. Screen readers get
 * one summary instead of a bar-by-bar walk.
 */
export const TrendBars = memo(function TrendBars({
  points,
  color = Colors.primary,
  height = 96,
  metricLabel,
  locale,
}: Props) {
  const max = useMemo(() => trendMax(points, (p) => p.value), [points]);
  const total = useMemo(() => points.reduce((n, p) => n + p.value, 0), [points]);
  const summary = useMemo(() => {
    if (points.length === 0) return `No ${metricLabel} data`;
    const peak = points.reduce((best, p) => (p.value > best.value ? p : best), points[0]);
    return `${total} ${metricLabel} over ${points.length} days${
      peak.value > 0 ? `, busiest ${shortDate(peak.date, locale)} with ${peak.value}` : ''
    }`;
  }, [points, total, metricLabel, locale]);

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary}>
      <View style={[styles.bars, { height }]}>
        {points.map((p) => (
          <View key={p.date} style={styles.barSlot}>
            <View
              style={[
                styles.bar,
                {
                  height: p.value > 0 ? Math.max((p.value / max) * height, 3) : 1,
                  backgroundColor: p.value > 0 ? color : Colors.border.light,
                },
              ]}
            />
          </View>
        ))}
      </View>
      {points.length > 1 ? (
        <View style={styles.axis}>
          <Text style={styles.axisText}>{shortDate(points[0].date, locale)}</Text>
          <Text style={styles.axisText}>{shortDate(points[points.length - 1].date, locale)}</Text>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  barSlot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  bar: {
    borderTopLeftRadius: BorderRadius.sm / 2,
    borderTopRightRadius: BorderRadius.sm / 2,
  },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.xs,
  },
  axisText: {
    fontSize: Typography.sizes.xxs,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.text.tertiary,
  },
});
