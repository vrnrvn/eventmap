import { memo, useMemo } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import type { EventChatMessageWithSender } from '@/types/database';
import { segmentBody, timeLabel, tombstoneLabel } from '@/utils/chatMessages';
import { alpha, Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';

export const CHAT_AVATAR_SIZE = 32;

export type ChatMessage = EventChatMessageWithSender & {
  localStatus?: 'sending' | 'failed';
  /** Failed for lack of a connection: re-sent automatically when it returns. */
  autoRetry?: boolean;
};

export type ChatListRowData =
  | { kind: 'day'; id: string; label: string }
  | { kind: 'divider'; id: string; label: string }
  | {
      kind: 'message';
      id: string;
      message: ChatMessage;
      mine: boolean;
      firstOfGroup: boolean;
      lastOfGroup: boolean;
    };

type Props = {
  row: ChatListRowData;
  viewerId: string | undefined;
  isModerator: boolean;
  /** Deep-link target flash; passed as a boolean so other rows don't re-render. */
  highlighted: boolean;
  onOpenActions: (message: ChatMessage, mine: boolean) => void;
  onViewProfile: (userId: string) => void;
};

// Caps the action list so a message pasted full of URLs stays navigable.
const MAX_LINK_ACTIONS = 5;

function messageLinks(body: string, mentionNames: string[]) {
  const out: { text: string; href: string }[] = [];
  for (const segment of segmentBody(body, mentionNames)) {
    if (segment.kind === 'link') out.push({ text: segment.text, href: segment.href });
    if (out.length >= MAX_LINK_ACTIONS) break;
  }
  return out;
}

/** Message body with tappable URLs and highlighted @mentions. */
const LinkifiedText = memo(function LinkifiedText({
  body,
  mine,
  mentionNames,
}: {
  body: string;
  mine: boolean;
  mentionNames: string[];
}) {
  // segmentBody compiles a RegExp from the mention names; cache per message
  // so a keystroke in the composer doesn't rebuild every bubble's pattern.
  const segments = useMemo(() => segmentBody(body, mentionNames), [body, mentionNames]);
  return (
    <Text style={[styles.messageText, mine && styles.messageTextMine]} selectable>
      {segments.map((segment, index) => {
        if (segment.kind === 'text') return segment.text;
        if (segment.kind === 'mention') {
          return (
            <Text key={`m-${index}`} style={[styles.mention, mine && styles.mentionMine]}>
              {segment.text}
            </Text>
          );
        }
        return (
          <Text
            key={`l-${index}`}
            style={[styles.messageLink, mine && styles.messageLinkMine]}
            onPress={() => void Linking.openURL(segment.href)}
            accessibilityRole="link"
          >
            {segment.text}
          </Text>
        );
      })}
    </Text>
  );
});

/**
 * One row of the inverted chat list. Memoised so that composer keystrokes,
 * typing indicators and the slow-mode countdown — all state on the screen —
 * don't re-render hundreds of bubbles.
 */
export const ChatListRow = memo(function ChatListRow({
  row,
  viewerId,
  isModerator,
  highlighted,
  onOpenActions,
  onViewProfile,
}: Props) {
  if (row.kind === 'day') {
    return (
      <View style={styles.dayRow}>
        <Text style={styles.dayLabel}>{row.label}</Text>
      </View>
    );
  }
  if (row.kind === 'divider') {
    return (
      <View style={styles.dividerRow} accessibilityRole="header">
        <View style={styles.dividerLine} />
        <Text style={styles.dividerLabel}>{row.label}</Text>
        <View style={styles.dividerLine} />
      </View>
    );
  }

  const { message, mine, firstOfGroup, lastOfGroup } = row;
  const senderName = message.sender?.name ?? 'Someone';
  const failed = message.localStatus === 'failed';
  const sending = message.localStatus === 'sending';
  const mentionsMe = !mine && !!viewerId && message.mentions.includes(viewerId);

  if (message.deleted_at) {
    const tombstone = (
      <View style={[styles.tombstone, mine && styles.tombstoneMine]} accessibilityRole="text">
        <Text style={styles.tombstoneText}>
          {tombstoneLabel(message, viewerId, isModerator)}
          {!mine ? ` · ${senderName}` : ''}
          {isModerator ? ' · hold for options' : ''}
        </Text>
      </View>
    );
    return (
      <View style={[styles.messageRow, mine && styles.messageRowMine, styles.messageRowGroupEnd]}>
        {!mine ? <View style={styles.avatarSpacer} /> : null}
        {isModerator ? (
          <Pressable
            onLongPress={() => onOpenActions(message, mine)}
            delayLongPress={300}
            accessibilityRole="button"
            accessibilityLabel="Removed message, long press for moderator options"
          >
            {tombstone}
          </Pressable>
        ) : (
          tombstone
        )}
      </View>
    );
  }

  const mentionNames = Object.values(message.mention_names);
  // Links inside the bubble are part of one VoiceOver element, so each is
  // offered as a custom action, alongside the long-press options menu.
  const links = messageLinks(message.body, mentionNames);
  const a11yActions = [
    { name: 'options', label: 'Message options' },
    ...links.map((link, i) => ({ name: `link:${i}`, label: `Open link ${link.text}` })),
  ];

  return (
    <View
      style={[
        styles.messageRow,
        mine && styles.messageRowMine,
        // Inverted list: cells are flipped twice, so a row's bottom margin
        // still renders below it — the gap to the next (newer) message.
        lastOfGroup ? styles.messageRowGroupEnd : styles.messageRowGrouped,
      ]}
    >
      {!mine ? (
        lastOfGroup ? (
          <Pressable
            onPress={() => onViewProfile(message.sender_id)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`View ${senderName}'s profile`}
          >
            <Avatar imageUrl={message.sender?.avatar_url ?? null} name={senderName} size={CHAT_AVATAR_SIZE} />
          </Pressable>
        ) : (
          <View style={styles.avatarSpacer} />
        )
      ) : null}
      <Pressable
        onLongPress={() => onOpenActions(message, mine)}
        onPress={failed ? () => onOpenActions(message, mine) : undefined}
        delayLongPress={300}
        style={({ pressed }) => [
          styles.messageBubble,
          mine && styles.messageBubbleMine,
          !lastOfGroup && styles.messageBubbleGrouped,
          mentionsMe && styles.messageBubbleMentioned,
          highlighted && styles.messageBubbleHighlighted,
          failed && styles.messageBubbleFailed,
          pressed && styles.messageBubblePressed,
        ]}
        accessibilityRole="button"
        // The body goes in the label (read immediately), not the hint (read
        // after a pause and often truncated).
        accessibilityLabel={
          failed
            ? `Message not sent: ${message.body}. Tap for options`
            : `${mine ? 'You' : senderName}: ${message.body}`
        }
        accessibilityHint="Long press for options"
        accessibilityActions={a11yActions}
        onAccessibilityAction={(e) => {
          const name = e.nativeEvent.actionName;
          if (name === 'options') onOpenActions(message, mine);
          else if (name.startsWith('link:')) {
            const link = links[Number(name.slice(5))];
            if (link) void Linking.openURL(link.href);
          }
        }}
      >
        {!mine && firstOfGroup ? (
          <Text style={styles.senderName} numberOfLines={1}>
            {senderName}
          </Text>
        ) : null}
        <LinkifiedText body={message.body} mine={mine} mentionNames={mentionNames} />
        {lastOfGroup || sending || failed ? (
          <Text
            style={[
              styles.messageMeta,
              mine && styles.messageMetaMine,
              failed && styles.messageMetaFailed,
            ]}
          >
            {failed
              ? message.autoRetry
                ? 'Waiting for connection · tap for options'
                : 'Not sent · tap to retry'
              : sending
                ? 'Sending…'
                : timeLabel(message.created_at)}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  dayRow: {
    alignItems: 'center',
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
  },
  dayLabel: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.background.tertiary,
    fontSize: Typography.sizes.xs,
    lineHeight: 14,
    letterSpacing: 0.2,
    color: Colors.text.secondary,
    fontFamily: Typography.labelFontFamilies.semibold,
    overflow: 'hidden',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
    marginBottom: Spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.primary,
    opacity: 0.5,
  },
  dividerLabel: {
    fontSize: Typography.sizes.xs,
    lineHeight: 14,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: Colors.primary,
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  messageRowMine: {
    justifyContent: 'flex-end',
  },
  messageRowGroupEnd: {
    marginBottom: 12,
  },
  messageRowGrouped: {
    marginBottom: Spacing.xs,
  },
  avatarSpacer: {
    width: CHAT_AVATAR_SIZE,
  },
  messageBubble: {
    maxWidth: '80%',
    borderRadius: BorderRadius.lg,
    borderBottomLeftRadius: BorderRadius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.surface,
    ...Shadows.sm,
  },
  messageBubbleMine: {
    borderBottomLeftRadius: BorderRadius.lg,
    borderBottomRightRadius: BorderRadius.sm,
    backgroundColor: Colors.primary,
  },
  messageBubbleGrouped: {
    borderBottomLeftRadius: BorderRadius.lg,
    borderBottomRightRadius: BorderRadius.lg,
  },
  messageBubbleFailed: {
    opacity: 0.7,
  },
  messageBubbleHighlighted: {
    borderWidth: 2,
    borderColor: Colors.primary,
    transform: [{ scale: 1.02 }],
  },
  messageBubbleMentioned: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
    backgroundColor: Colors.accentLight,
  },
  messageBubblePressed: {
    opacity: 0.85,
  },
  tombstone: {
    maxWidth: '80%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.border.medium,
  },
  tombstoneMine: {
    alignSelf: 'flex-end',
  },
  tombstoneText: {
    fontSize: Typography.sizes.sm,
    lineHeight: 18,
    fontStyle: 'italic',
    color: Colors.text.tertiary,
    fontFamily: Typography.fontFamilies.regular,
  },
  mention: {
    color: Colors.primary,
    fontFamily: Typography.fontFamilies.semibold,
  },
  mentionMine: {
    color: Colors.text.inverse,
    textDecorationLine: 'underline',
  },
  senderName: {
    marginBottom: 2,
    fontSize: Typography.sizes.xs,
    lineHeight: 16,
    color: Colors.primary,
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  messageText: {
    fontSize: Typography.sizes.md,
    lineHeight: 22,
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.regular,
  },
  messageTextMine: {
    color: Colors.text.inverse,
  },
  messageLink: {
    color: Colors.primary,
    textDecorationLine: 'underline',
  },
  messageLinkMine: {
    color: Colors.text.inverse,
  },
  messageMeta: {
    marginTop: 4,
    alignSelf: 'flex-end',
    fontSize: Typography.sizes.xs,
    lineHeight: 14,
    color: Colors.text.tertiary,
    fontFamily: Typography.labelFontFamilies.medium,
  },
  messageMetaMine: {
    color: alpha(Colors.surface, 0.75),
  },
  messageMetaFailed: {
    color: Colors.error,
  },
});
