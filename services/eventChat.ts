import { supabase } from './supabase';
import { EventChatMessage, EventChatMessageWithSender, Profile } from '@/types/database';

const MESSAGE_LIMIT = 100;
const MAX_MESSAGE_LENGTH = 1000;

async function getCurrentUserId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

async function hydrateMessages(
  messages: EventChatMessage[]
): Promise<EventChatMessageWithSender[]> {
  if (messages.length === 0) return [];

  const senderIds = Array.from(new Set(messages.map((message) => message.sender_id)));
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id,name,avatar_url')
    .in('id', senderIds);

  if (error) throw error;

  const profilesById = new Map(
    ((profiles as Pick<Profile, 'id' | 'name' | 'avatar_url'>[]) || []).map((profile) => [
      profile.id,
      profile,
    ])
  );

  return messages.map((message) => ({
    ...message,
    sender: profilesById.get(message.sender_id) ?? null,
  }));
}

export const eventChatService = {
  async getMessages(eventId: string): Promise<EventChatMessageWithSender[]> {
    const { data, error } = await supabase
      .from('event_chat_messages')
      .select('*')
      .eq('event_id', eventId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(MESSAGE_LIMIT);

    if (error) throw error;
    const chronological = ((data as EventChatMessage[]) || []).reverse();
    return hydrateMessages(chronological);
  },

  async getMessage(messageId: string): Promise<EventChatMessageWithSender | null> {
    const { data, error } = await supabase
      .from('event_chat_messages')
      .select('*')
      .eq('id', messageId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    const [message] = await hydrateMessages([data as EventChatMessage]);
    return message ?? null;
  },

  async sendMessage(eventId: string, body: string): Promise<EventChatMessageWithSender> {
    const senderId = await getCurrentUserId();
    const trimmedBody = body.trim();

    if (!trimmedBody) throw new Error('Message is empty');
    if (trimmedBody.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer`);
    }

    const { data, error } = await supabase
      .from('event_chat_messages')
      .insert({
        event_id: eventId,
        sender_id: senderId,
        body: trimmedBody,
      })
      .select('*')
      .single();

    if (error) throw error;
    const [message] = await hydrateMessages([data as EventChatMessage]);
    if (!message) throw new Error('Message was sent but could not be loaded');
    return message;
  },

  subscribeToMessages(
    eventId: string,
    onMessage: (message: EventChatMessageWithSender) => void
  ): () => void {
    const channel = supabase
      .channel(`event-chat:${eventId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'event_chat_messages',
          filter: `event_id=eq.${eventId}`,
        },
        async (payload) => {
          try {
            const messageId = (payload.new as { id?: string }).id;
            if (!messageId) return;
            const message = await eventChatService.getMessage(messageId);
            if (message) onMessage(message);
          } catch {
            // Ignore transient realtime hydration failures; the next full load will recover.
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  },
};
