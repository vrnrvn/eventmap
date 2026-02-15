import { View, Text, StyleSheet } from 'react-native';
import { Star } from 'lucide-react-native';
import { Colors, Typography } from '@/constants/theme';

type StarRatingDisplayProps = {
  average: number;
  count: number;
  size?: number;
};

export function StarRatingDisplay({ average, count, size = 18 }: StarRatingDisplayProps) {
  const fullStars = Math.round(average);
  const emptyStars = 5 - fullStars;

  return (
    <View style={styles.row}>
      <View style={styles.stars}>
        {Array.from({ length: fullStars }).map((_, i) => (
          <Star key={`full-${i}`} size={size} color="#F59E0B" fill="#F59E0B" />
        ))}
        {Array.from({ length: emptyStars }).map((_, i) => (
          <Star key={`empty-${i}`} size={size} color="#D1D5DB" fill="transparent" />
        ))}
      </View>
      <Text style={styles.text}>
        {average > 0 ? average.toFixed(1) : '—'} ({count} review{count !== 1 ? 's' : ''})
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stars: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  text: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
  },
});
