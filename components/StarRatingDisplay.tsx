import { View, Text, StyleSheet } from 'react-native';
import { Star } from 'lucide-react-native';
import { Colors, Spacing, Typography } from '@/constants/theme';

type StarRatingDisplayProps = {
  average: number;
  count: number;
  size?: number;
};

export function StarRatingDisplay({ average, count, size = 18 }: StarRatingDisplayProps) {
  const hasReviews = count > 0;
  // Math.min/max pass NaN through, and bad API data can also leave `average`
  // undefined at runtime (`.toFixed` would throw) — normalize first.
  const clamped = Math.min(5, Math.max(0, Number.isFinite(average) ? average : 0));

  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={
        hasReviews
          ? `${clamped.toFixed(1)} out of 5 stars, ${count} review${count !== 1 ? 's' : ''}`
          : 'No reviews yet'
      }
    >
      <View style={styles.stars}>
        {Array.from({ length: 5 }).map((_, i) => {
          // Per-star fill ratio: 4.3 → 1, 1, 1, 1, 0.3. A filled star is
          // overlaid on the outline and clipped to a width percentage, so
          // fractional ratings render as partially filled stars.
          const fillRatio = Math.min(1, Math.max(0, clamped - i));
          return (
            <View key={i} style={{ width: size, height: size }}>
              <Star size={size} color={Colors.border.light} fill="transparent" />
              {fillRatio > 0 && (
                <View style={[styles.starFillClip, { width: `${fillRatio * 100}%` }]}>
                  <Star size={size} color={Colors.warning} fill={Colors.warning} />
                </View>
              )}
            </View>
          );
        })}
      </View>
      <Text style={styles.text}>
        {hasReviews
          ? `${clamped.toFixed(1)} (${count} review${count !== 1 ? 's' : ''})`
          : 'No reviews yet'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  stars: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  starFillClip: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  text: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
  },
});
