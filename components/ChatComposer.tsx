import { forwardRef, memo, useImperativeHandle, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SendHorizontal } from '@/components/icons.generated';
import { BorderRadius, Colors, Spacing, Typography } from '@/constants/theme';

export type ChatComposerHandle = {
  /** Replace the text (mention insertion). */
  setText: (text: string) => void;
  /** Set the text only if the composer is empty (outbox restore). */
  setTextIfEmpty: (text: string) => void;
  /** Append on a new line, or set when empty (failed send gives the text back). */
  appendLine: (text: string) => void;
  clear: () => void;
};

type Props = {
  /** Text present before mount (restored from the outbox). */
  initialText: string;
  maxLength: number;
  /** Show the remaining-characters counter once remaining ≤ this. */
  counterVisibleAtRemaining: number;
  /** Slow mode blocks sending regardless of text. */
  sendBlocked: boolean;
  /** Typing indicators / notices / slow-mode line, left of the counter. */
  statusLine: string;
  statusIsNotice: boolean;
  /** 'error' colours the notice as a failure (default info). */
  statusTone?: 'info' | 'error';
  /**
   * Every text change, user-typed or programmatic (setText/clear), so the
   * screen can mirror the draft into a ref, drive typing broadcasts and
   * mention detection, and schedule the outbox write. `typed` is true only
   * for keystrokes (programmatic changes must not broadcast "typing…").
   */
  onChangeText: (text: string, typed: boolean) => void;
  onBlur: () => void;
  onSend: () => void;
};

/**
 * The chat status row, text input and send button, owning the draft text so a
 * keystroke re-renders this small component instead of the whole 2,000-line
 * chat screen (which rebuilt every list prop and the pinned bar per
 * character). The screen reads the draft through a mirror ref it maintains in
 * `onChangeText` and writes through the imperative handle. Styles are copied
 * verbatim from the screen so the layout is unchanged.
 */
export const ChatComposer = memo(
  forwardRef<ChatComposerHandle, Props>(function ChatComposer(
    {
      initialText,
      maxLength,
      counterVisibleAtRemaining,
      sendBlocked,
      statusLine,
      statusIsNotice,
      statusTone = 'info',
      onChangeText,
      onBlur,
      onSend,
    },
    ref
  ) {
    const [text, setTextState] = useState(initialText);
    // Latest text for the imperative methods, so each change is computed
    // outside a state updater and the parent is notified exactly once (no
    // parent setState inside our updater; StrictMode-safe).
    const textRef = useRef(initialText);

    const apply = (next: string, typed: boolean) => {
      textRef.current = next;
      setTextState(next);
      onChangeText(next, typed);
    };

    useImperativeHandle(ref, () => ({
      setText: (next) => apply(next, false),
      setTextIfEmpty: (next) => {
        if (!textRef.current.trim()) apply(next, false);
      },
      appendLine: (line) => {
        const current = textRef.current;
        apply(current.trim() ? `${current}\n${line}` : line, false);
      },
      clear: () => apply('', false),
    }));

    const remaining = maxLength - text.length;
    const sendDisabled = !text.trim() || sendBlocked;

    return (
      <>
        <View style={styles.statusRow}>
          <Text
            style={[styles.statusText, statusIsNotice && styles.statusTextNotice, statusIsNotice && statusTone === 'error' && styles.statusTextError]}
            numberOfLines={1}
            accessibilityLiveRegion="polite"
          >
            {statusLine}
          </Text>
          {remaining <= counterVisibleAtRemaining ? (
            <Text style={[styles.charCounter, remaining <= 20 && styles.charCounterWarn]}>
              {remaining}
            </Text>
          ) : null}
        </View>
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={(next) => apply(next, true)}
            onBlur={onBlur}
            placeholder="Message the event chat"
            placeholderTextColor={Colors.text.tertiary}
            multiline
            maxLength={maxLength}
            accessibilityLabel="Message input"
          />
          <TouchableOpacity
            style={[styles.sendButton, sendDisabled && styles.sendButtonDisabled]}
            onPress={onSend}
            disabled={sendDisabled}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            <SendHorizontal size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </>
    );
  })
);

const styles = StyleSheet.create({
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 18,
    paddingHorizontal: Spacing.xs,
    marginBottom: 2,
  },
  statusText: {
    flex: 1,
    fontSize: Typography.sizes.xs,
    lineHeight: 16,
    color: Colors.text.tertiary,
    fontFamily: Typography.labelFontFamilies.medium,
  },
  statusTextNotice: {
    color: Colors.text.secondary,
  },
  statusTextError: {
    color: Colors.error,
  },
  charCounter: {
    marginLeft: Spacing.sm,
    fontSize: Typography.sizes.xs,
    lineHeight: 16,
    color: Colors.text.tertiary,
    fontFamily: Typography.labelFontFamilies.medium,
  },
  charCounterWarn: {
    color: Colors.error,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: 22,
    paddingHorizontal: Spacing.md,
    paddingTop: Platform.OS === 'ios' ? 12 : 10,
    paddingBottom: Platform.OS === 'ios' ? 12 : 10,
    backgroundColor: Colors.background.secondary,
    color: Colors.text.primary,
    fontSize: Typography.sizes.md,
    lineHeight: 20,
    fontFamily: Typography.fontFamilies.regular,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.round,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
  },
  sendButtonDisabled: {
    backgroundColor: Colors.border.medium,
  },
});
