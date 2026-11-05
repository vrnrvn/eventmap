import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';

type Props = {
  icon: ReactNode;
  label: string;
  /** Pre-formatted value ("1.2K", "26.2%", "—"). */
  value: string;
  /** Small line under the label ("of 10 spots", "23 in the last 7 days"). */
  hint?: string;
  /** 0..1 progress bar under the value (e.g. capacity filled); hidden when null/undefined. */
  fill?: number | null;
  /** Width / flex overrides from the grid (2 or 3 per row). */
  style?: StyleProp<ViewStyle>;
};

/**
 * The one KPI card used by every analytics screen (business analytics and
 * event insights): tinted icon well, display-font value, muted label.
 */
export function KpiTile({ icon, label, value, hint, fill, style }: Props) {
  return (
    <View style={[styles.card, style]} accessible accessibilityLabel={`${label}: ${value}${hint ? `, ${hint}` : ''}`}>
      <View style={styles.iconWell}>{icon}</View>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {fill !== undefined && fill !== null ? (
        <View style={styles.track}>
          <View style={[styles.bar, { width: `${Math.min(Math.max(fill, 0), 1) * 100}%` }]} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border.light,
    ...Shadows.sm,
  },
  iconWell: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primarySoft,
    marginBottom: 10,
  },
  value: {
    fontSize: 20,
    color: Colors.text.primary,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  label: {
    marginTop: 2,
    color: Colors.text.tertiary,
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
  },
  hint: {
    marginTop: 2,
    color: Colors.text.tertiary,
    fontSize: Typography.sizes.xxs,
    fontFamily: Typography.fontFamilies.regular,
  },
  track: {
    marginTop: Spacing.sm,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.background.tertiary,
    overflow: 'hidden',
  },
  bar: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.success,
  },
});
