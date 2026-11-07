import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Crown, Lock } from '@/components/icons.generated';
import { Button } from '@/components/ui/Button';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';

type Props = {
  title: string;
  description?: string;
  /** What Pro adds here; rendered as a locked checklist. */
  items?: readonly string[];
};

/**
 * The single "this part is Pro" card for analytics surfaces, so event
 * insights and business analytics name the plan and offer the same action.
 */
export function ProUpsellCard({ title, description, items }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconWell}>
          <Crown size={18} color={Colors.premium} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
      </View>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {items?.map((item) => (
        <View key={item} style={styles.row}>
          <Lock size={14} color={Colors.text.tertiary} />
          <Text style={styles.item}>{item}</Text>
        </View>
      ))}
      <Button
        label="View Pro plans"
        onPress={() => router.push('/premium/plans' as never)}
        style={styles.button}
        accessibilityLabel="View Pro plans"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border.light,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadows.sm,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  iconWell: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.premiumSoft,
  },
  title: {
    flex: 1,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.displayFontFamilies.semibold,
    color: Colors.text.primary,
  },
  description: { fontSize: Typography.sizes.sm, color: Colors.text.secondary, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  item: { flex: 1, fontSize: Typography.sizes.sm, color: Colors.text.secondary },
  button: { marginTop: Spacing.xs },
});
