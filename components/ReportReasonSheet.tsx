import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from '@/components/icons.generated';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';

export const REPORT_REASONS = [
  'Spam or misleading',
  'Safety concern',
  'Inappropriate content',
  'Not a real event',
  'Other',
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

const DETAIL_MAX = 300;

type Props = {
  visible: boolean;
  title: string;
  description?: string;
  /** Reasons to offer; defaults to the event-report set. */
  reasons?: readonly string[];
  onClose: () => void;
  onSubmit: (reason: string) => void;
};

/**
 * Cross-platform reason picker for reports. Replaces the old split between a
 * native 4-option `Alert` and a web chain of yes/no dialogs (where "Other"
 * was unreachable and Cancel confusingly meant "next question"). Free-text
 * detail is appended to the chosen reason.
 */
export function ReportReasonSheet({
  visible,
  title,
  description = 'Tell us what’s wrong. A moderator will review it; the organizer isn’t told who reported.',
  reasons = REPORT_REASONS,
  onClose,
  onSubmit,
}: Props) {
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<string | null>(null);
  const [detail, setDetail] = useState('');

  useEffect(() => {
    if (!visible) {
      setReason(null);
      setDetail('');
    }
  }, [visible]);

  const submit = () => {
    if (!reason) return;
    const trimmed = detail.trim();
    onSubmit(trimmed ? `${reason}: ${trimmed}` : reason);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss report" />
      <View
        style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <X size={20} color={Colors.text.secondary} />
          </Pressable>
        </View>
        <Text style={styles.description}>{description}</Text>

        <View style={styles.reasonList}>
          {reasons.map((option) => {
            const selected = reason === option;
            return (
              <Pressable
                key={option}
                onPress={() => setReason(option)}
                style={({ pressed }) => [
                  styles.reasonChip,
                  selected && styles.reasonChipSelected,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={option}
              >
                <Text style={[styles.reasonText, selected && styles.reasonTextSelected]}>
                  {option}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <TextInput
          value={detail}
          onChangeText={setDetail}
          placeholder="Add detail (optional)"
          placeholderTextColor={Colors.text.tertiary}
          style={styles.detailInput}
          multiline
          maxLength={DETAIL_MAX}
          accessibilityLabel="Additional detail"
        />

        <View style={styles.actions}>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.button, styles.cancel, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={submit}
            disabled={!reason}
            style={({ pressed }) => [
              styles.button,
              styles.submit,
              !reason && styles.submitDisabled,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !reason }}
          >
            <Text style={styles.submitText}>Send report</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xxl,
    borderTopRightRadius: BorderRadius.xxl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    ...Shadows.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: Typography.sizes.lg,
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  description: {
    marginTop: Spacing.xs,
    fontSize: Typography.sizes.sm,
    lineHeight: 20,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.regular,
  },
  reasonList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  reasonChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderRadius: BorderRadius.round,
    borderWidth: 1,
    borderColor: Colors.border.light,
    backgroundColor: Colors.background.secondary,
  },
  reasonChipSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primarySoft,
  },
  reasonText: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.medium,
  },
  reasonTextSelected: {
    color: Colors.primary,
    fontFamily: Typography.fontFamilies.semibold,
  },
  detailInput: {
    marginTop: Spacing.md,
    minHeight: 72,
    borderWidth: 1,
    borderColor: Colors.border.light,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: Typography.sizes.sm,
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.regular,
    textAlignVertical: 'top',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  button: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderRadius: BorderRadius.round,
  },
  cancel: {
    backgroundColor: Colors.background.secondary,
  },
  cancelText: {
    fontSize: Typography.sizes.md,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.semibold,
  },
  submit: {
    backgroundColor: Colors.error,
  },
  submitDisabled: {
    opacity: 0.45,
  },
  submitText: {
    fontSize: Typography.sizes.md,
    color: Colors.white,
    fontFamily: Typography.fontFamilies.semibold,
  },
  pressed: {
    opacity: 0.75,
  },
});
