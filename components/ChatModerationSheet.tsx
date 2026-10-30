import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Lock, ShieldCheck, Timer, X } from 'lucide-react-native';
import { Avatar } from '@/components/Avatar';
import {
  eventChatService,
  CHAT_SLOW_MODE_OPTIONS,
  ChatBlockedUser,
  ChatModerationEntry,
  ChatReportedMessage,
  ChatSlowModeSeconds,
} from '@/services/eventChat';
import { alpha, Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';

type Props = {
  eventId: string;
  visible: boolean;
  locked: boolean;
  slowModeSeconds: number;
  onClose: () => void;
  onNotice: (text: string) => void;
  /** Persist lock / slow-mode changes; resolves after the server accepted them. */
  onUpdateSettings: (settings: { locked?: boolean; slowModeSeconds?: ChatSlowModeSeconds }) => Promise<void>;
};

function slowModeLabel(seconds: number): string {
  if (seconds === 0) return 'Off';
  if (seconds < 60) return `${seconds}s`;
  return `${seconds / 60}m`;
}

const ACTION_LABEL: Record<ChatModerationEntry['action'], string> = {
  delete: 'removed a message',
  block: 'removed someone from the chat',
  unblock: 'let someone back in',
  dismiss_reports: 'dismissed reports',
  resolve_reports: 'confirmed a removal',
  restore: 'restored a message',
  auto_hide: 'hid a message automatically',
  lock: 'locked the chat',
  unlock: 'unlocked the chat',
  slow_mode: 'changed slow mode',
};

function when(iso: string): string {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Host/admin tools for one event chat: who is blocked (with undo) and the
 * recent moderation history. Message-level actions live in the long-press
 * sheet; this is the room-level view.
 */
export function ChatModerationSheet({
  eventId,
  visible,
  locked,
  slowModeSeconds,
  onClose,
  onNotice,
  onUpdateSettings,
}: Props) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  const updateSettings = async (settings: { locked?: boolean; slowModeSeconds?: ChatSlowModeSeconds }) => {
    setSavingSettings(true);
    try {
      await onUpdateSettings(settings);
      void load();
    } catch {
      onNotice("Couldn't update chat settings. Please try again.");
    } finally {
      setSavingSettings(false);
    }
  };
  const [blocked, setBlocked] = useState<ChatBlockedUser[]>([]);
  const [log, setLog] = useState<ChatModerationEntry[]>([]);
  const [reported, setReported] = useState<ChatReportedMessage[]>([]);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextBlocked, nextLog, nextReported] = await Promise.all([
        eventChatService.getBlockedUsers(eventId),
        eventChatService.getModerationLog(eventId),
        eventChatService.getReportedMessages(eventId),
      ]);
      setBlocked(nextBlocked);
      setLog(nextLog);
      setReported(nextReported);
    } catch {
      onNotice("Couldn't load moderation details.");
    } finally {
      setLoading(false);
    }
  }, [eventId, onNotice]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  const unblock = async (user: ChatBlockedUser) => {
    setBusyUser(user.userId);
    try {
      await eventChatService.unblockUser(eventId, user.userId);
      setBlocked((current) => current.filter((item) => item.userId !== user.userId));
      onNotice(`${user.name} can post again.`);
      void load();
    } catch {
      onNotice("Couldn't undo the block. Please try again.");
    } finally {
      setBusyUser(null);
    }
  };

  const removeReported = async (item: ChatReportedMessage) => {
    setBusyMessage(item.message_id);
    try {
      const deleted = await eventChatService.deleteMessage(item.message_id);
      if (!deleted) throw new Error('not deleted');
      setReported((current) => current.filter((row) => row.message_id !== item.message_id));
      onNotice('Message removed.');
      void load();
    } catch {
      onNotice("Couldn't remove the message. Please try again.");
    } finally {
      setBusyMessage(null);
    }
  };

  const keepReported = async (item: ChatReportedMessage) => {
    setBusyMessage(item.message_id);
    try {
      await eventChatService.dismissReports(item.message_id);
      setReported((current) => current.filter((row) => row.message_id !== item.message_id));
      onNotice('Reports dismissed.');
      void load();
    } catch {
      onNotice("Couldn't dismiss the reports. Please try again.");
    } finally {
      setBusyMessage(null);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close moderation tools">
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}
          onPress={() => {}}
        >
          <View style={styles.grabber} />
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <ShieldCheck size={18} color={Colors.primary} />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>Manage chat</Text>
              <Text style={styles.subtitle}>Long-press any message to remove it or its sender.</Text>
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

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} bounces={false}>
            <Text style={styles.sectionTitle}>Chat controls</Text>
            <View style={styles.controlRow}>
              <View style={styles.controlIcon}>
                <Lock size={16} color={locked ? Colors.error : Colors.text.secondary} />
              </View>
              <View style={styles.controlText}>
                <Text style={styles.controlTitle}>Lock chat</Text>
                <Text style={styles.controlDesc}>
                  {locked ? 'Only you can post right now.' : 'Attendees can post.'}
                </Text>
              </View>
              <Switch
                value={locked}
                disabled={savingSettings}
                onValueChange={(value) => void updateSettings({ locked: value })}
                trackColor={{ false: Colors.border.medium, true: alpha(Colors.primary, 0.5) }}
                thumbColor={locked ? Colors.primary : Colors.background.secondary}
                accessibilityLabel="Lock chat"
              />
            </View>
            <View style={[styles.controlRow, styles.controlRowLast]}>
              <View style={styles.controlIcon}>
                <Timer size={16} color={slowModeSeconds > 0 ? Colors.primary : Colors.text.secondary} />
              </View>
              <View style={styles.controlText}>
                <Text style={styles.controlTitle}>Slow mode</Text>
                <Text style={styles.controlDesc}>
                  {slowModeSeconds > 0
                    ? `Attendees can post once every ${slowModeLabel(slowModeSeconds)}.`
                    : 'No wait between messages.'}
                </Text>
                <View style={styles.chipRow}>
                  {CHAT_SLOW_MODE_OPTIONS.map((option) => {
                    const selected = slowModeSeconds === option;
                    return (
                      <Pressable
                        key={option}
                        disabled={savingSettings}
                        onPress={() => void updateSettings({ slowModeSeconds: option })}
                        style={({ pressed }) => [
                          styles.chip,
                          selected && styles.chipSelected,
                          pressed && styles.pressed,
                        ]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`Slow mode ${slowModeLabel(option)}`}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                          {slowModeLabel(option)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>

            <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>
              Reported messages{reported.length > 0 ? ` (${reported.length})` : ''}
            </Text>
            {loading && reported.length === 0 ? (
              <ActivityIndicator style={styles.spinner} color={Colors.text.tertiary} />
            ) : reported.length === 0 ? (
              <Text style={styles.emptyText}>Nothing reported. Attendees can long-press a message to report it.</Text>
            ) : (
              reported.map((item) => (
                <View key={item.message_id} style={styles.reportCard}>
                  <Text style={styles.reportMeta} numberOfLines={1}>
                    <Text style={styles.logActor}>{item.sender_name}</Text>
                    {` · ${when(item.created_at)} · ${item.report_count} ${item.report_count === 1 ? 'report' : 'reports'}`}
                    {item.reasons.length > 0 ? ` · ${item.reasons.join(', ')}` : ''}
                  </Text>
                  <Text style={[styles.reportBody, item.deleted_at && styles.reportBodyRemoved]} numberOfLines={3}>
                    {item.deleted_at ? 'Already removed' : item.body}
                  </Text>
                  <View style={styles.reportActions}>
                    <Pressable
                      onPress={() => void keepReported(item)}
                      disabled={busyMessage === item.message_id}
                      style={({ pressed }) => [styles.reportButton, pressed && styles.pressed]}
                      accessibilityRole="button"
                    >
                      <Text style={styles.reportButtonText}>Keep</Text>
                    </Pressable>
                    {!item.deleted_at ? (
                      <Pressable
                        onPress={() => void removeReported(item)}
                        disabled={busyMessage === item.message_id}
                        style={({ pressed }) => [styles.reportButton, styles.reportButtonDanger, pressed && styles.pressed]}
                        accessibilityRole="button"
                      >
                        {busyMessage === item.message_id ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Text style={styles.reportButtonDangerText}>Remove</Text>
                        )}
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ))
            )}

            <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>Removed from this chat</Text>
            {loading && blocked.length === 0 ? (
              <ActivityIndicator style={styles.spinner} color={Colors.text.tertiary} />
            ) : blocked.length === 0 ? (
              <Text style={styles.emptyText}>Nobody is blocked. Everyone going can post.</Text>
            ) : (
              blocked.map((user) => (
                <View key={user.userId} style={styles.blockedRow}>
                  <Avatar imageUrl={user.avatarUrl} name={user.name} size={36} />
                  <View style={styles.blockedText}>
                    <Text style={styles.blockedName} numberOfLines={1}>
                      {user.name}
                    </Text>
                    <Text style={styles.blockedMeta} numberOfLines={1}>
                      {user.expiresAt ? `Until ${when(user.expiresAt)}` : 'Until undone'}
                      {user.reason ? ` · ${user.reason}` : ''}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => void unblock(user)}
                    disabled={busyUser === user.userId}
                    style={({ pressed }) => [styles.unblockButton, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`Let ${user.name} post again`}
                  >
                    {busyUser === user.userId ? (
                      <ActivityIndicator size="small" color={Colors.primary} />
                    ) : (
                      <Text style={styles.unblockText}>Undo</Text>
                    )}
                  </Pressable>
                </View>
              ))
            )}

            <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>Recent activity</Text>
            {loading && log.length === 0 ? (
              <ActivityIndicator style={styles.spinner} color={Colors.text.tertiary} />
            ) : log.length === 0 ? (
              <Text style={styles.emptyText}>No moderation actions yet.</Text>
            ) : (
              log.map((entry) => (
                <View key={entry.id} style={styles.logRow}>
                  <View style={styles.logDot} />
                  <View style={styles.logText}>
                    <Text style={styles.logLine}>
                      <Text style={styles.logActor}>{entry.actorName ?? 'System'}</Text>{' '}
                      {ACTION_LABEL[entry.action]}
                      {entry.targetName ? (
                        <>
                          {' · '}
                          <Text style={styles.logActor}>{entry.targetName}</Text>
                        </>
                      ) : null}
                    </Text>
                    <Text style={styles.logMeta}>
                      {when(entry.createdAt)}
                      {entry.reason ? ` · ${entry.reason}` : ''}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: Colors.overlay.dark,
  },
  sheet: {
    maxHeight: '80%',
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.round,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accentLight,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: Typography.sizes.lg,
    lineHeight: 24,
    color: Colors.text.primary,
    fontFamily: Typography.displayFontFamilies.bold,
  },
  subtitle: {
    marginTop: 1,
    fontSize: Typography.sizes.xs,
    lineHeight: 16,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.regular,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.round,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background.secondary,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingBottom: Spacing.sm,
  },
  sectionTitle: {
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
    fontSize: Typography.sizes.xs,
    lineHeight: 14,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.text.tertiary,
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  sectionTitleSpaced: {
    marginTop: Spacing.lg,
  },
  spinner: {
    marginVertical: Spacing.md,
  },
  emptyText: {
    paddingVertical: Spacing.sm,
    fontSize: Typography.sizes.sm,
    lineHeight: 20,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.regular,
  },
  blockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  blockedText: {
    flex: 1,
    minWidth: 0,
  },
  blockedName: {
    fontSize: Typography.sizes.md,
    lineHeight: 20,
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.semibold,
  },
  blockedMeta: {
    marginTop: 1,
    fontSize: Typography.sizes.xs,
    lineHeight: 16,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.regular,
  },
  unblockButton: {
    minWidth: 64,
    height: 36,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.round,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  unblockText: {
    fontSize: Typography.sizes.sm,
    color: Colors.primary,
    fontFamily: Typography.fontFamilies.semibold,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingVertical: 6,
  },
  logDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
    backgroundColor: Colors.border.medium,
  },
  logText: {
    flex: 1,
    minWidth: 0,
  },
  logLine: {
    fontSize: Typography.sizes.sm,
    lineHeight: 20,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.regular,
  },
  logActor: {
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.semibold,
  },
  logMeta: {
    fontSize: Typography.sizes.xs,
    lineHeight: 16,
    color: Colors.text.tertiary,
    fontFamily: Typography.fontFamilies.regular,
  },
  pressed: {
    opacity: 0.6,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm + 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border.light,
  },
  controlRowLast: {
    borderBottomWidth: 0,
  },
  controlIcon: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.round,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background.secondary,
    marginTop: 2,
  },
  controlText: {
    flex: 1,
    minWidth: 0,
  },
  controlTitle: {
    fontSize: Typography.sizes.md,
    lineHeight: 20,
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.semibold,
  },
  controlDesc: {
    marginTop: 2,
    fontSize: Typography.sizes.xs,
    lineHeight: 16,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.regular,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  chip: {
    height: 36,
    paddingHorizontal: Spacing.md,
    justifyContent: 'center',
    borderRadius: BorderRadius.round,
    borderWidth: 1,
    borderColor: Colors.border.medium,
    backgroundColor: Colors.surface,
  },
  chipSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.accentLight,
  },
  chipText: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.medium,
  },
  chipTextSelected: {
    color: Colors.primary,
  },
  reportCard: {
    padding: Spacing.sm + 4,
    marginBottom: Spacing.sm,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.background.secondary,
  },
  reportMeta: {
    fontSize: Typography.sizes.xs,
    lineHeight: 16,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.regular,
  },
  reportBody: {
    marginTop: 4,
    fontSize: Typography.sizes.sm,
    lineHeight: 20,
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.regular,
  },
  reportBodyRemoved: {
    fontStyle: 'italic',
    color: Colors.text.tertiary,
  },
  reportActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  reportButton: {
    minWidth: 84,
    height: 36,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.round,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border.medium,
    backgroundColor: Colors.surface,
  },
  reportButtonText: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.semibold,
  },
  reportButtonDanger: {
    borderColor: Colors.error,
    backgroundColor: Colors.error,
  },
  reportButtonDangerText: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.inverse,
    fontFamily: Typography.fontFamilies.semibold,
  },
});
