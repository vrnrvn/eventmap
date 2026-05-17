import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, MessageCircle, SendHorizontal, Users } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { eventsService } from '@/services/events';
import { eventChatService } from '@/services/eventChat';
import { EventChatMessageWithSender, EventDetails } from '@/types/database';
import { Avatar } from '@/components/Avatar';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';

export default function EventChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const listRef = useRef<FlatList<EventChatMessageWithSender>>(null);
  const [details, setDetails] = useState<EventDetails | null>(null);
  const [messages, setMessages] = useState<EventChatMessageWithSender[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const canChat = details?.user_rsvp === 'going' && (details?.rsvp_count ?? 0) >= 2;

  const eventTitle = details?.event.title ?? 'Event chat';
  const subtitle = useMemo(() => {
    if (!details) return '';
    return `${details.rsvp_count} going`;
  }, [details]);

  const appendMessage = useCallback((message: EventChatMessageWithSender) => {
    setMessages((current) => {
      if (current.some((item) => item.id === message.id)) return current;
      return [...current, message];
    });
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const load = async () => {
      setLoading(true);
      try {
        const nextDetails = await eventsService.getEventDetails(id);
        if (cancelled) return;
        setDetails(nextDetails);

        const hasAccess = nextDetails?.user_rsvp === 'going' && nextDetails.rsvp_count >= 2;
        if (!hasAccess) {
          setMessages([]);
          return;
        }

        const initialMessages = await eventChatService.getMessages(id);
        if (cancelled) return;
        setMessages(initialMessages);
        requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));

        unsubscribe = eventChatService.subscribeToMessages(id, appendMessage);
      } catch {
        if (!cancelled) {
          setDetails(null);
          setMessages([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [id, appendMessage]);

  const handleSend = async () => {
    if (!id || sending) return;
    const body = draft.trim();
    if (!body) return;

    setDraft('');
    setSending(true);
    try {
      const message = await eventChatService.sendMessage(id, body);
      appendMessage(message);
    } catch (err) {
      setDraft(body);
      Alert.alert(
        'Message not sent',
        err instanceof Error ? err.message : 'Please try again in a moment.'
      );
    } finally {
      setSending(false);
    }
  };

  const renderMessage = ({ item }: { item: EventChatMessageWithSender }) => {
    const mine = item.sender_id === user?.id;
    const senderName = item.sender?.name ?? 'Someone';

    return (
      <View style={[styles.messageRow, mine && styles.messageRowMine]}>
        {!mine ? (
          <Avatar imageUrl={item.sender?.avatar_url ?? null} name={senderName} size={32} />
        ) : null}
        <View style={[styles.messageBubble, mine && styles.messageBubbleMine]}>
          {!mine ? (
            <Text style={styles.senderName} numberOfLines={1}>
              {senderName}
            </Text>
          ) : null}
          <Text style={[styles.messageText, mine && styles.messageTextMine]}>{item.body}</Text>
          <Text style={[styles.messageTime, mine && styles.messageTimeMine]}>
            {new Date(item.created_at).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </Text>
        </View>
      </View>
    );
  };

  const renderEmpty = () => {
    if (loading) {
      return (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.centerText}>Loading chat...</Text>
        </View>
      );
    }

    if (!details) {
      return (
        <View style={styles.centerState}>
          <MessageCircle size={44} color={Colors.text.tertiary} />
          <Text style={styles.centerTitle}>Chat unavailable</Text>
          <Text style={styles.centerText}>This event could not be loaded.</Text>
        </View>
      );
    }

    if (!canChat) {
      return (
        <View style={styles.centerState}>
          <Users size={44} color={Colors.text.tertiary} />
          <Text style={styles.centerTitle}>Chat unlocks with 2 attendees</Text>
          <Text style={styles.centerText}>
            RSVP as going, then this room opens once at least two people are going.
          </Text>
          <TouchableOpacity
            style={styles.backToEventButton}
            onPress={() => router.replace(`/event/${details.event.id}` as never)}
            activeOpacity={0.85}
          >
            <Text style={styles.backToEventText}>Back to event</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.centerState}>
        <MessageCircle size={44} color={Colors.text.tertiary} />
        <Text style={styles.centerTitle}>Start the conversation</Text>
        <Text style={styles.centerText}>Everyone here is going to this event.</Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.headerButton} onPress={() => router.back()}>
          <ArrowLeft size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {eventTitle}
          </Text>
          {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
        </View>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() => details && router.replace(`/event/${details.event.id}` as never)}
          disabled={!details}
        >
          <MessageCircle size={22} color={details ? Colors.primary : Colors.text.disabled} />
        </TouchableOpacity>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={[
          styles.listContent,
          messages.length === 0 && styles.listContentEmpty,
        ]}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
      />

      {canChat ? (
        <View style={[styles.composerWrap, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="Message the event chat"
              placeholderTextColor={Colors.text.tertiary}
              multiline
              maxLength={1000}
            />
            <TouchableOpacity
              style={[styles.sendButton, (!draft.trim() || sending) && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={!draft.trim() || sending}
              activeOpacity={0.85}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <SendHorizontal size={20} color="#FFFFFF" />
              )}
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.light,
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.round,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background.secondary,
  },
  headerTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: Typography.sizes.lg,
    color: Colors.text.primary,
    fontFamily: Typography.displayFontFamilies.extrabold,
    fontWeight: '800',
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: Typography.sizes.xs,
    color: Colors.text.secondary,
    fontFamily: Typography.labelFontFamilies.medium,
  },
  listContent: {
    padding: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  listContentEmpty: {
    flexGrow: 1,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  centerTitle: {
    marginTop: Spacing.md,
    fontSize: Typography.sizes.lg,
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    textAlign: 'center',
  },
  centerText: {
    marginTop: Spacing.sm,
    fontSize: Typography.sizes.sm,
    lineHeight: 20,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.medium,
    textAlign: 'center',
  },
  backToEventButton: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.primary,
  },
  backToEventText: {
    color: Colors.text.inverse,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  messageRowMine: {
    justifyContent: 'flex-end',
  },
  messageBubble: {
    maxWidth: '78%',
    borderRadius: BorderRadius.lg,
    borderBottomLeftRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: '#FFFFFF',
    ...Shadows.sm,
  },
  messageBubbleMine: {
    borderBottomLeftRadius: BorderRadius.lg,
    borderBottomRightRadius: BorderRadius.sm,
    backgroundColor: Colors.primary,
  },
  senderName: {
    marginBottom: 2,
    fontSize: Typography.sizes.xs,
    color: Colors.primary,
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  messageText: {
    fontSize: Typography.sizes.md,
    lineHeight: 22,
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.medium,
  },
  messageTextMine: {
    color: '#FFFFFF',
  },
  messageTime: {
    marginTop: 4,
    alignSelf: 'flex-end',
    fontSize: 10,
    color: Colors.text.tertiary,
    fontFamily: Typography.labelFontFamilies.medium,
  },
  messageTimeMine: {
    color: 'rgba(255,255,255,0.72)',
  },
  composerWrap: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: Colors.border.light,
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
    borderRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.md,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    backgroundColor: Colors.background.secondary,
    color: Colors.text.primary,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.medium,
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
