import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { CloudOff } from 'lucide-react-native';
import { Colors, Typography, Spacing, BorderRadius } from '@/constants/theme';
import { Button } from '@/components/ui/Button';

/**
 * Small shared pieces for the screen-state rule (utils/screenState.ts).
 */

/** "Offline · Updated 3 h ago" above data that may be out of date. */
export function FreshnessNote({ text, style }: { text: string | null; style?: StyleProp<ViewStyle> }) {
  if (!text) return null;
  return (
    <View style={[styles.note, style]} accessibilityRole="text" accessibilityLabel={text} testID="freshness-note">
      <CloudOff size={13} color={Colors.text.secondary} />
      <Text style={styles.noteText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

/** Nothing loaded yet and no connection: it will load on reconnect. */
export function OfflineState({
  title = "You're offline",
  message = 'This will load when you reconnect.',
  onRetry,
  style,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.offline, style]} accessibilityLiveRegion="polite" testID="offline-state">
      <View style={styles.iconWell}>
        <CloudOff size={28} color={Colors.text.secondary} />
      </View>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.message}>{message}</Text>
      {onRetry ? <Button label="Try again" onPress={onRetry} variant="secondary" style={styles.retry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.xs + 2,
    backgroundColor: Colors.neutralSoft,
    borderRadius: BorderRadius.round,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm + 2,
    marginBottom: Spacing.sm,
  },
  noteText: {
    color: Colors.text.secondary,
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.medium,
    fontWeight: Typography.weights.medium,
  },
  offline: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  iconWell: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.neutralSoft,
    marginBottom: Spacing.md,
  },
  title: {
    color: Colors.text.primary,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    textAlign: 'center',
    marginBottom: Spacing.xs,
  },
  message: {
    color: Colors.text.secondary,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.regular,
    textAlign: 'center',
    lineHeight: 20,
  },
  retry: {
    marginTop: Spacing.md,
  },
});
