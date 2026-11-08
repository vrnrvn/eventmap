import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Copy, Flag, Pin, RotateCcw, ShieldOff, Trash2, Undo2, UserMinus, UserRound, X } from '@/components/icons.generated';
import {
  CHAT_BLOCK_DURATIONS,
  CHAT_REPORT_REASONS,
  ChatReportReason,
} from '@/services/eventChat';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import { ModalBackdrop } from '@/components/ui/ModalBackdrop';

export type ChatMessageActionsTarget = {
  id: string;
  body: string;
  senderId: string;
  senderName: string;
  mine: boolean;
  failed: boolean;
  sending: boolean;
  /** Message is a tombstone (removed). */
  deleted: boolean;
  /** The author retracted it themselves; it cannot be restored. */
  deletedBySender: boolean;
  /** Viewer is the event host or an admin: may delete any message / block senders. */
  canModerate: boolean;
  /** The viewer has globally blocked this sender. */
  senderBlocked: boolean;
};

type Props = {
  target: ChatMessageActionsTarget | null;
  onClose: () => void;
  onCopy: (target: ChatMessageActionsTarget) => void;
  onReport: (target: ChatMessageActionsTarget, reason: ChatReportReason) => void;
  onDelete: (target: ChatMessageActionsTarget) => void;
  onRestore: (target: ChatMessageActionsTarget) => void;
  /** Pin/unpin for moderators (20261103160000); omit to hide the row. */
  onTogglePin?: (target: ChatMessageActionsTarget) => void;
  pinnedMessageId?: string | null;
  onBlockUser: (target: ChatMessageActionsTarget, durationMinutes: number | null) => void;
  onRetry: (target: ChatMessageActionsTarget) => void;
  onDiscard: (target: ChatMessageActionsTarget) => void;
  /** Open the sender's public profile. */
  onViewProfile: (target: ChatMessageActionsTarget) => void;
  /** Global (account-level) block, as opposed to the host's chat removal. */
  onToggleGlobalBlock: (target: ChatMessageActionsTarget) => void;
  /** Report the person rather than this one message. */
  onReportUser: (target: ChatMessageActionsTarget) => void;
};

type ConfirmStep = 'delete' | 'report' | 'block' | null;

/**
 * Bottom action sheet for a long-pressed chat message. Implemented with a
 * plain Modal (not Alert) so it works identically on iOS, Android and web.
 */
export function ChatMessageActionsSheet({
  target,
  onClose,
  onCopy,
  onReport,
  onDelete,
  onRestore,
  onTogglePin,
  pinnedMessageId,
  onBlockUser,
  onRetry,
  onDiscard,
  onViewProfile,
  onToggleGlobalBlock,
  onReportUser,
}: Props) {
  const insets = useSafeAreaInsets();
  const [confirm, setConfirm] = useState<ConfirmStep>(null);
  const [reason, setReason] = useState<ChatReportReason | null>(null);
  const [blockMinutes, setBlockMinutes] = useState<number | null>(CHAT_BLOCK_DURATIONS[1].minutes);

  useEffect(() => {
    if (!target) {
      setConfirm(null);
      setReason(null);
      setBlockMinutes(CHAT_BLOCK_DURATIONS[1].minutes);
    }
  }, [target]);

  if (!target) return null;

  const run = (action: (t: ChatMessageActionsTarget) => void) => {
    action(target);
    onClose();
  };

  const renderConfirm = () => {
    if (confirm === 'report') {
      return (
        <View>
          <Text style={styles.confirmTitle}>Report this message</Text>
          <Text style={styles.confirmBody}>
            Tell us what&apos;s wrong. A moderator will review it; the sender isn&apos;t notified.
          </Text>
          <View style={styles.reasonList}>
            {CHAT_REPORT_REASONS.map((option) => {
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
                >
                  <Text style={[styles.reasonChipText, selected && styles.reasonChipTextSelected]}>
                    {option}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.confirmRow}>
            <Pressable
              style={({ pressed }) => [styles.confirmButton, styles.confirmCancel, pressed && styles.pressed]}
              onPress={() => setConfirm(null)}
              accessibilityRole="button"
            >
              <Text style={styles.confirmCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.confirmButton,
                styles.confirmDestructive,
                !reason && styles.confirmDisabled,
                pressed && styles.pressed,
              ]}
              disabled={!reason}
              onPress={() => reason && run((t) => onReport(t, reason))}
              accessibilityRole="button"
            >
              <Text style={styles.confirmDestructiveText}>Report</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    const isDelete = confirm === 'delete';
    return (
      <View>
        <Text style={styles.confirmTitle}>
          {isDelete ? 'Delete this message?' : `Remove ${target.senderName} from this chat?`}
        </Text>
        <Text style={styles.confirmBody}>
          {isDelete
            ? target.mine
              ? 'It will be removed for everyone in the chat.'
              : 'It will be removed for everyone and recorded in the moderation log. You can restore it later.'
            : 'They can keep reading but can no longer post here. You can undo this from Manage chat.'}
        </Text>
        {!isDelete ? (
          <View style={styles.reasonList}>
            {CHAT_BLOCK_DURATIONS.map((option) => {
              const selected = blockMinutes === option.minutes;
              return (
                <Pressable
                  key={option.label}
                  onPress={() => setBlockMinutes(option.minutes)}
                  style={({ pressed }) => [
                    styles.reasonChip,
                    selected && styles.reasonChipSelected,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.reasonChipText, selected && styles.reasonChipTextSelected]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <View style={styles.confirmRow}>
          <Pressable
            style={({ pressed }) => [styles.confirmButton, styles.confirmCancel, pressed && styles.pressed]}
            onPress={() => setConfirm(null)}
            accessibilityRole="button"
          >
            <Text style={styles.confirmCancelText}>Cancel</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.confirmButton, styles.confirmDestructive, pressed && styles.pressed]}
            onPress={() => run(isDelete ? onDelete : (t) => onBlockUser(t, blockMinutes))}
            accessibilityRole="button"
          >
            <Text style={styles.confirmDestructiveText}>{isDelete ? 'Delete' : 'Remove'}</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  const renderActions = () => {
    if (target.deleted) {
      return (
        <View>
          {!target.deletedBySender ? (
            <ActionRow icon={<Undo2 size={20} color={Colors.text.primary} />} label="Restore message" onPress={() => run(onRestore)} />
          ) : (
            <Text style={styles.confirmBody}>The author deleted this message; it can&apos;t be restored.</Text>
          )}
          {!target.mine ? (
            <ActionRow
              icon={<ShieldOff size={20} color={Colors.error} />}
              label={`Remove ${target.senderName} from chat`}
              destructive
              onPress={() => setConfirm('block')}
            />
          ) : null}
        </View>
      );
    }
    if (target.failed) {
      return (
        <View>
          <ActionRow icon={<RotateCcw size={20} color={Colors.text.primary} />} label="Retry sending" onPress={() => run(onRetry)} />
          <ActionRow icon={<Copy size={20} color={Colors.text.primary} />} label="Copy text" onPress={() => run(onCopy)} />
          <ActionRow icon={<Trash2 size={20} color={Colors.error} />} label="Discard message" destructive onPress={() => run(onDiscard)} />
        </View>
      );
    }
    const pinned = pinnedMessageId != null && pinnedMessageId === target.id;
    return (
      <View>
        <ActionRow icon={<Copy size={20} color={Colors.text.primary} />} label="Copy text" onPress={() => run(onCopy)} />
        {target.canModerate && onTogglePin && !target.sending ? (
          <ActionRow
            icon={<Pin size={20} color={Colors.text.primary} />}
            label={pinned ? 'Unpin message' : 'Pin message'}
            onPress={() => run(onTogglePin)}
          />
        ) : null}
        {/* Previously the only way to reach a participant was to leave the
            chat and find them in the attendee list. */}
        {!target.mine ? (
          <ActionRow
            icon={<UserRound size={20} color={Colors.text.primary} />}
            label={`View ${target.senderName}'s profile`}
            onPress={() => run(onViewProfile)}
          />
        ) : null}
        {!target.mine ? (
          <ActionRow
            icon={<UserMinus size={20} color={target.senderBlocked ? Colors.text.primary : Colors.error} />}
            label={target.senderBlocked ? `Unblock ${target.senderName}` : `Block ${target.senderName}`}
            destructive={!target.senderBlocked}
            onPress={() => run(onToggleGlobalBlock)}
          />
        ) : null}
        {!target.mine ? (
          <ActionRow icon={<Flag size={20} color={Colors.error} />} label="Report message" destructive onPress={() => setConfirm('report')} />
        ) : null}
        {!target.mine ? (
          <ActionRow
            icon={<Flag size={20} color={Colors.error} />}
            label={`Report ${target.senderName}`}
            destructive
            onPress={() => run(onReportUser)}
          />
        ) : null}
        {(target.mine && !target.sending) || (!target.mine && target.canModerate) ? (
          <ActionRow
            icon={<Trash2 size={20} color={Colors.error} />}
            label={target.mine ? 'Delete message' : 'Delete message (moderator)'}
            destructive
            onPress={() => setConfirm('delete')}
          />
        ) : null}
        {!target.mine && target.canModerate ? (
          <ActionRow
            icon={<ShieldOff size={20} color={Colors.error} />}
            label={`Remove ${target.senderName} from chat`}
            destructive
            onPress={() => setConfirm('block')}
          />
        ) : null}
      </View>
    );
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <ModalBackdrop onPress={onClose} label="Close message actions" />
        <View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
        >
          <View style={styles.grabber} />
          <View style={styles.previewHeader}>
            <View style={styles.previewText}>
              <Text style={styles.previewSender} numberOfLines={1}>
                {target.senderName}
              </Text>
              <Text style={[styles.previewBody, target.deleted && styles.previewBodyRemoved]} numberOfLines={3}>
                {target.deleted ? 'Removed message' : target.body}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <X size={18} color={Colors.text.secondary} />
            </Pressable>
          </View>
          <View style={styles.divider} />
          {confirm ? renderConfirm() : renderActions()}
        </View>
      </View>
    </Modal>
  );
}

function ActionRow({
  icon,
  label,
  onPress,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.actionIcon}>{icon}</View>
      <Text style={[styles.actionLabel, destructive && styles.actionLabelDestructive]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: Colors.overlay.dark,
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    ...Shadows.lg,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.border.medium,
    marginBottom: Spacing.sm,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  previewText: {
    flex: 1,
    minWidth: 0,
  },
  previewSender: {
    fontSize: Typography.sizes.xs,
    lineHeight: 16,
    color: Colors.primary,
    fontFamily: Typography.labelFontFamilies.semibold,
    marginBottom: 2,
  },
  previewBody: {
    fontSize: Typography.sizes.sm,
    lineHeight: 20,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.regular,
  },
  previewBodyRemoved: {
    fontStyle: 'italic',
    color: Colors.text.tertiary,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.round,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background.secondary,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border.light,
    marginVertical: Spacing.xs,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: 14,
    paddingHorizontal: Spacing.xs,
    borderRadius: BorderRadius.md,
  },
  actionIcon: {
    width: 24,
    alignItems: 'center',
  },
  actionLabel: {
    flex: 1,
    fontSize: Typography.sizes.md,
    lineHeight: 20,
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.medium,
  },
  actionLabelDestructive: {
    color: Colors.error,
  },
  pressed: {
    opacity: 0.6,
  },
  confirmTitle: {
    marginTop: Spacing.sm,
    fontSize: Typography.sizes.lg,
    lineHeight: 24,
    color: Colors.text.primary,
    fontFamily: Typography.displayFontFamilies.bold,
  },
  confirmBody: {
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
    paddingHorizontal: 14,
    height: 36,
    justifyContent: 'center',
    borderRadius: BorderRadius.round,
    borderWidth: 1,
    borderColor: Colors.border.medium,
    backgroundColor: Colors.surface,
  },
  reasonChipSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.accentLight,
  },
  reasonChipText: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.medium,
  },
  reasonChipTextSelected: {
    color: Colors.primary,
  },
  confirmRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  confirmButton: {
    flex: 1,
    height: 48,
    borderRadius: BorderRadius.round,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmCancel: {
    backgroundColor: Colors.background.secondary,
  },
  confirmCancelText: {
    fontSize: Typography.sizes.md,
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.semibold,
  },
  confirmDestructive: {
    backgroundColor: Colors.error,
  },
  confirmDisabled: {
    opacity: 0.4,
  },
  confirmDestructiveText: {
    fontSize: Typography.sizes.md,
    color: Colors.white,
    fontFamily: Typography.fontFamilies.semibold,
  },
});
