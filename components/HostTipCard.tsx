import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors, Typography, BorderRadius } from '@/constants/theme';
import { Lightbulb, X, ChevronRight } from '@/components/icons.generated';
import { hostTip, type HostTipId, type HostTipTarget } from '@/utils/hostTips';

/**
 * One-time host tip (HOST_ONBOARDING_PLAN.md §4 Stage 5). Explains a
 * situation the host has just run into, once, and gets out of the way.
 *
 * Always dismissible, never blocking: the screen behind it stays usable.
 */
export function HostTipCard({
  tip,
  onDismiss,
  onAction,
  style,
}: {
  /** Null renders nothing, so callers can mount it unconditionally. */
  tip: HostTipId | null;
  onDismiss: () => void;
  /**
   * Called with the tip's target; the screen decides where that goes. Using
   * the action also dismisses the tip.
   */
  onAction?: (target: HostTipTarget) => void;
  style?: object;
}) {
  if (!tip) return null;
  const { title, body, action } = hostTip(tip);
  return (
    <View style={[styles.card, style]} accessibilityRole="summary">
      <View style={styles.header}>
        <View style={styles.iconWell}>
          <Lightbulb size={16} color={Colors.primary} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        <TouchableOpacity
          onPress={onDismiss}
          style={styles.dismissBtn}
          accessibilityRole="button"
          accessibilityLabel={`Dismiss tip: ${title}`}
        >
          <X size={16} color={Colors.text.tertiary} />
        </TouchableOpacity>
      </View>
      <Text style={styles.body}>{body}</Text>
      {action && onAction ? (
        <TouchableOpacity
          onPress={() => {
            // Acting on a tip counts as having read it, so it does not come
            // back the next time the screen opens.
            onAction(action.target);
            onDismiss();
          }}
          style={styles.actionBtn}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          <Text style={styles.actionText}>{action.label}</Text>
          <ChevronRight size={16} color={Colors.primary} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.primarySoft,
    borderRadius: BorderRadius.lg,
    padding: 14,
    gap: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWell: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.text.primary,
  },
  // 44 px target: hitSlop does not enlarge the box on web.
  dismissBtn: { width: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center' },
  body: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    lineHeight: 19,
  },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  actionText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.primary,
  },
});
