import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';

type Props = {
  title: string;
  /** Right side of the title row (spinner, link). */
  accessory?: ReactNode;
  /** Wrap children in a card (default). Off for grids of tiles. */
  card?: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * Section with the app's uppercase label above it (same look as
 * SettingsSection and the business analytics screen).
 */
export function AnalyticsSection({ title, accessory, card = true, children, style }: Props) {
  return (
    <View style={style}>
      <View style={styles.titleRow}>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {accessory}
      </View>
      {card ? <View style={styles.card}>{children}</View> : children}
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
    marginLeft: 2,
  },
  title: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border.light,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadows.sm,
  },
});
