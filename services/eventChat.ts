import { RealtimeChannel } from '@supabase/supabase-js';
import { rpcArgs } from './rpcArgs';
import { supabase, getSessionUser } from './supabase';
import { signalEventWrites } from '@/utils/eventDataVersion';
import { isConnectionError } from '@/utils/networkErrors';
import { EventChatMessage, EventChatMessageWithSender, Profile } from '@/types/database';

export const CHAT_MESSAGE_PAGE_SIZE = 100;
const MESSAGE_LIMIT = CHAT_MESSAGE_PAGE_SIZE;
const MAX_MESSAGE_LENGTH = 1000;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const UNIQUE_VIOLATION = '23505';

export type ChatConnectionStatus = 'connecting' | 'connected' | 'reconnecting';

export type ChatPresenceMember = { userId: string; name: string };
export type ChatTypingEvent = { userId: string; name: string; typing: boolean };

export type ChatSubscriptionHandlers = {
  onMessage: (message: EventChatMessageWithSender) => void;
  onMessageDeleted?: (messageId: string, deletedBy: string | null) => void;
  /** A message changed without being removed (e.g. restored by an admin). */
  onMessageUpdated?: (message: EventChatMessageWithSender) => void;
  /**
   * Another subscription for the same chat (e.g. a second mounted copy of the
   * screen) took over the shared room; this one is now inactive and should
   * resubscribe when it becomes relevant again.
   */
  /** Host changed lock / slow mode; caller should refresh post status. */
  onSettingsChanged?: () => void;
  onSuperseded?: () => void;
  onStatusChange?: (status: ChatConnectionStatus) => void;
  /**
   * Fired on every successful (re)subscribe. Realtime does not replay rows
   * inserted before the channel went live — neither those sent between the
   * caller's initial fetch and the first SUBSCRIBED, nor those sent while
   * disconnected — so the caller should catch up (e.g. via getMessagesSince).
   */
  onSubscribed?: () => void;
  /** Who is currently in the room (presence), excluding nobody. */
  onPresence?: (members: ChatPresenceMember[]) => void;
  /** Another member started/stopped typing (own events are not echoed). */
  onTyping?: (event: ChatTypingEvent) => void;
};

export type ChatSubscriptionOptions = {
  /** Identifies this client for presence and typing broadcasts. */
  self?: ChatPresenceMember;
  /** Whether to announce presence / typing (readers-only can still observe). */
  participate?: boolean;
};

export type ChatSubscription = {
  unsubscribe: () => void;
  sendTyping: (typing: boolean) => void;
};

export type ChatMode = 'open' | 'announcements' | 'off';
export type ChatOpenPolicy = 'two_going' | 'any_going';

export type ChatPostStatus = {
  can_read: boolean;
  can_post: boolean;
  is_banned: boolean;
  is_blocked: boolean;
  is_host: boolean;
  is_admin: boolean;
  muted: boolean;
  locked: boolean;
  slow_mode_seconds: number;
  block_expires_at: string | null;
  last_read_at: string | null;
  last_post_at: string | null;
  /** Present once 20261103160000 is applied; undefined before. */
  chat_mode?: ChatMode | null;
  open_policy?: ChatOpenPolicy | null;
  pinned_message_id?: string | null;
};

/** 42883 = undefined_function, PGRST202 = not in the PostgREST schema cache. */
const isMissingRpc = (error: { code?: string } | null): boolean =>
  !!error && (error.code === '42883' || error.code === 'PGRST202');

export const CHAT_SLOW_MODE_OPTIONS = [0, 10, 30, 60, 300] as const;
export type ChatSlowModeSeconds = (typeof CHAT_SLOW_MODE_OPTIONS)[number];

export const CHAT_BLOCK_DURATIONS: { label: string; minutes: number | null }[] = [
  { label: '1 hour', minutes: 60 },
  { label: '24 hours', minutes: 24 * 60 },
  { label: 'Until undone', minutes: null },
];

export function isChatSlowModeError(error: unknown): boolean {
  return error instanceof Error && /chat_slow_mode/i.test(error.message);
}

export const CHAT_REPORT_REASONS = [
  'Spam or scam',
  'Harassment or hate',
  'Inappropriate content',
  'Other',
] as const;
export type ChatReportReason = (typeof CHAT_REPORT_REASONS)[number];

export function isChatDuplicateReportError(error: unknown): boolean {
  return Boolean(error) && (error as { code?: string }).code === UNIQUE_VIOLATION;
}

export type ChatBlockedUser = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  reason: string | null;
  createdAt: string;
  expiresAt: string | null;
};

export type ChatModerationEntry = {
  id: string;
  action:
    | 'delete'
    | 'block'
    | 'unblock'
    | 'dismiss_reports'
    | 'resolve_reports'
    | 'restore'
    | 'auto_hide'
    | 'lock'
    | 'unlock'
    | 'slow_mode';
  reason: string | null;
  createdAt: string;
  actorName: string | null;
  targetName: string | null;
  messageId: string | null;
};

export type ChatReportedMessage = {
  message_id: string;
  sender_id: string;
  sender_name: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
  report_count: number;
  reasons: string[];
  last_reported_at: string;
};

export type ChatUnreadCount = {
  event_id: string;
  unread_count: number;
  latest_message_at: string;
};

type ChatProfile = Pick<Profile, 'id' | 'name' | 'avatar_url'>;

// Senders repeat constantly within a chat session; cache profiles so realtime
// inserts don't cost a profiles query per message. Entries expire so profile
// edits (and senders that once failed to load) are retried; expired entries
// are still served if a refetch fails.
const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;
const profileCache = new Map<string, { profile: ChatProfile | null; expiresAt: number }>();

// Realtime payloads may serialize timestamptz without a UTC offset while
// PostgREST always includes one; pin offset-less values to UTC so Date parsing
// and ordering don't depend on the device timezone.
const TZ_SUFFIX = /(Z|[+-]\d{2}:?\d{2})$/i;
function normalizeTimestamp(value: string): string {
  return TZ_SUFFIX.test(value) ? value : `${value}Z`;
}

export function isChatRateLimitError(error: unknown): boolean {
  return error instanceof Error && /chat_rate_limited/i.test(error.message);
}

export function isChatAccessError(error: unknown): boolean {
  return error instanceof Error && /row-level security|violates.*policy/i.test(error.message);
}

async function getCurrentUserId(): Promise<string> {
  const user = await getSessionUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

async function hydrateMessages(
  messages: EventChatMessage[]
): Promise<EventChatMessageWithSender[]> {
  if (messages.length === 0) return [];

  const now = Date.now();
  const staleIds = Array.from(new Set(messages.map((message) => message.sender_id))).filter(
    (senderId) => {
      const entry = profileCache.get(senderId);
      return !entry || entry.expiresAt <= now;
    }
  );

  if (staleIds.length > 0) {
    try {
      // The profiles table is owner-read-only; display identities come from
      // the batch RPC instead.
      const { data: profiles, error } = await supabase.rpc('get_profiles_display', {
        user_ids: staleIds,
      });

      if (error) throw error;

      const expiresAt = now + PROFILE_CACHE_TTL_MS;
      const fetched = new Map(
        ((profiles as unknown as ChatProfile[]) || []).map((profile) => [profile.id, profile])
      );
      for (const senderId of staleIds) {
        profileCache.set(senderId, { profile: fetched.get(senderId) ?? null, expiresAt });
      }
    } catch {
      // Deliver messages with whatever cached (possibly stale) sender details
      // exist rather than dropping them; stale entries are retried next time.
    }
  }

  const mentionIds = Array.from(
    new Set(messages.flatMap((message) => message.mentions ?? []))
  ).filter((userId) => !profileCache.has(userId));
  if (mentionIds.length > 0) {
    await ensureProfiles(mentionIds);
  }

  return messages.map((message) => {
    const mention_names: Record<string, string> = {};
    for (const userId of message.mentions ?? []) {
      const name = profileCache.get(userId)?.profile?.name;
      if (name) mention_names[userId] = name;
    }
    return {
      ...message,
      mentions: message.mentions ?? [],
      created_at: normalizeTimestamp(message.created_at),
      sender: profileCache.get(message.sender_id)?.profile ?? null,
      mention_names,
    };
  });
}

async function ensureProfiles(ids: string[]): Promise<void> {
  try {
    const { data, error } = await supabase.rpc('get_profiles_display', {
      user_ids: ids,
    });
    if (error) throw error;
    const expiresAt = Date.now() + PROFILE_CACHE_TTL_MS;
    const fetched = new Map(
      ((data as unknown as ChatProfile[]) || []).map((profile) => [profile.id, profile])
    );
    for (const id of ids) {
      profileCache.set(id, { profile: fetched.get(id) ?? null, expiresAt });
    }
  } catch {
    // Names fall back to ids missing from mention_names; retried next time.
  }
}

export const eventChatService = {
  async getMessages(
    eventId: string,
    options?: { before?: { createdAt: string; id: string } }
  ): Promise<EventChatMessageWithSender[]> {
    // Server-side page with keyset cursor on (created_at, id); removed
    // messages come back as tombstones with an empty body.
    const { data, error } = await supabase.rpc('get_event_chat_messages', {
      event_uuid: eventId,
      p_limit: MESSAGE_LIMIT,
      p_before_created_at: options?.before?.createdAt ?? undefined,
      p_before_id: options?.before?.id ?? undefined,
    });

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

  // Newest visible message, e.g. for chat-entry previews. Returns null when
  // the chat is empty or the caller has no access (RLS filters the rows).
  async getLatestMessage(eventId: string): Promise<EventChatMessageWithSender | null> {
    const { data, error } = await supabase
      .from('event_chat_messages')
      .select('*')
      .eq('event_id', eventId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    const [message] = await hydrateMessages([data as EventChatMessage]);
    return message ?? null;
  },

  // Gap recovery after a realtime drop: everything at or after `sinceCreatedAt`
  // (inclusive, so the caller's newest known message dedupes rather than a
  // same-timestamp neighbor getting skipped). Soft-deleted rows are included
  // so the caller can also remove messages deleted during the gap.
  async getMessagesSince(
    eventId: string,
    sinceCreatedAt: string
  ): Promise<EventChatMessageWithSender[]> {
    const { data, error } = await supabase.rpc('get_event_chat_messages_since', {
      event_uuid: eventId,
      p_since: sinceCreatedAt,
      p_limit: MESSAGE_LIMIT,
    });

    if (error) throw error;
    return hydrateMessages((data as EventChatMessage[]) || []);
  },

  /**
   * Sends a message under a client-generated id so retries are idempotent: if
   * the insert already landed (response lost), the unique violation is treated
   * as success and the stored row is returned.
   */
  async sendMessage(
    eventId: string,
    body: string,
    messageId: string,
    mentions: string[] = []
  ): Promise<EventChatMessageWithSender> {
    const senderId = await getCurrentUserId();
    const trimmedBody = body.trim();

    if (!trimmedBody) throw new Error('Message is empty');
    if (trimmedBody.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer`);
    }

    const { data, error } = await supabase
      .from('event_chat_messages')
      .insert({
        id: messageId,
        event_id: eventId,
        sender_id: senderId,
        body: trimmedBody,
        mentions: Array.from(new Set(mentions)).slice(0, 20),
      })
      .select('*')
      .single();

    if (error) {
      // A retry of a message that already landed: normally a unique
      // violation, but the slow-mode / rate-limit triggers run before the
      // primary-key check and refuse it first (the stored copy counts as the
      // last post). Either way the message exists, which is success.
      // Connection failures can't tell us anything, so they're rethrown.
      if (error.code === UNIQUE_VIOLATION || !isConnectionError(error)) {
        const existing = await eventChatService.getMessage(messageId).catch(() => null);
        if (existing) return existing;
      }
      throw error;
    }

    const [message] = await hydrateMessages([data as EventChatMessage]);
    if (!message) throw new Error('Message was sent but could not be loaded');
    return message;
  },

  /** Soft-deletes one of the caller's own messages (admins may delete any). */
  async deleteMessage(messageId: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('delete_event_chat_message', {
      p_message_id: messageId,
    });
    if (error) throw error;
    return Boolean(data);
  },

  async markRead(eventId: string): Promise<void> {
    const { error } = await supabase.rpc('mark_event_chat_read', { p_event_id: eventId });
    if (error) throw error;
  },

  async getUnreadCounts(eventIds?: string[]): Promise<ChatUnreadCount[]> {
    const { data, error } = await supabase.rpc('get_event_chat_unread_counts', {
      p_event_ids: eventIds ?? undefined,
    });
    if (error) throw error;
    return (data as ChatUnreadCount[]) || [];
  },

  /** Read/post permissions and moderation role for the current user. */
  async getPostStatus(eventId: string): Promise<ChatPostStatus> {
    const { data, error } = await supabase.rpc('get_event_chat_post_status', {
      event_uuid: eventId,
    });
    if (error) throw error;
    const row = (data as ChatPostStatus[] | null)?.[0];
    return (
      row ?? {
        can_read: false,
        can_post: false,
        is_banned: false,
        is_blocked: false,
        is_host: false,
        is_admin: false,
        muted: false,
        locked: false,
        slow_mode_seconds: 0,
        block_expires_at: null,
        last_read_at: null,
        last_post_at: null,
      }
    );
  },

  async setMuted(eventId: string, muted: boolean): Promise<void> {
    const { error } = await supabase.rpc('set_event_chat_muted', {
      p_event_id: eventId,
      p_muted: muted,
    });
    if (error) throw error;
  },

  /** Host/admin: stop a user from posting in this event's chat (optionally for a limited time). */
  async blockUser(
    eventId: string,
    userId: string,
    reason?: string,
    durationMinutes?: number | null
  ): Promise<void> {
    const { error } = await supabase.rpc('block_event_chat_user', {
      p_event_id: eventId,
      p_user_id: userId,
      p_reason: reason ?? undefined,
      p_duration_minutes: durationMinutes ?? undefined,
    });
    if (error) throw error;
  },

  /** Host/admin: lock the chat and/or set slow mode. */
  async setSettings(
    eventId: string,
    settings: { locked?: boolean; slowModeSeconds?: ChatSlowModeSeconds }
  ): Promise<void> {
    const { error } = await supabase.rpc('set_event_chat_settings', {
      p_event_id: eventId,
      p_locked: settings.locked,
      p_slow_mode_seconds: settings.slowModeSeconds,
    });
    if (error) throw error;
  },

  /**
   * Host/admin: chat mode (open / announcements / off) and when the room
   * opens (`two_going` = today's rule, `any_going` = from the first attendee).
   * Pre-20261103160000 the mode falls back to the legacy lock (announcements =
   * locked); `off` and the open policy need the migration.
   */
  async setMode(
    eventId: string,
    settings: { mode?: ChatMode; openPolicy?: ChatOpenPolicy }
  ): Promise<void> {
    const { error } = await supabase.rpc('set_event_chat_mode', {
      p_event_id: eventId,
      p_chat_mode: settings.mode,
      p_open_policy: settings.openPolicy,
    });
    if (!error) return;
    if (!isMissingRpc(error)) throw error;
    if (settings.mode === 'open' || settings.mode === 'announcements') {
      await this.setSettings(eventId, { locked: settings.mode === 'announcements' });
      if (!settings.openPolicy) return;
    }
    throw new Error('This chat setting needs a database update that has not been applied yet.');
  },

  /** Host/admin: pin one message (null unpins). Needs 20261103160000. */
  async setPin(eventId: string, messageId: string | null): Promise<void> {
    const { error } = await supabase.rpc('set_event_chat_pin', rpcArgs('set_event_chat_pin', {
      p_event_id: eventId,
      p_message_id: messageId,
    }));
    if (!error) return;
    if (isMissingRpc(error)) {
      throw new Error('Pinned messages need a database update that has not been applied yet.');
    }
    throw error;
  },

  /** Host/admin: bring back a removed message. */
  async restoreMessage(messageId: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('restore_event_chat_message', {
      p_message_id: messageId,
    });
    if (error) throw error;
    return Boolean(data);
  },

  async unblockUser(eventId: string, userId: string): Promise<void> {
    const { error } = await supabase.rpc('unblock_event_chat_user', {
      p_event_id: eventId,
      p_user_id: userId,
    });
    if (error) throw error;
  },

  /** Host/admin: who is currently blocked from posting in this chat. */
  async getBlockedUsers(eventId: string): Promise<ChatBlockedUser[]> {
    const { data, error } = await supabase
      .from('event_chat_blocks')
      .select('user_id, reason, created_at, expires_at')
      .eq('event_id', eventId)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const rows =
      (data as { user_id: string; reason: string | null; created_at: string; expires_at: string | null }[]) ||
      [];
    const missing = rows.map((row) => row.user_id).filter((id) => !profileCache.has(id));
    if (missing.length > 0) await ensureProfiles(missing);
    return rows.map((row) => ({
      userId: row.user_id,
      name: profileCache.get(row.user_id)?.profile?.name ?? 'Someone',
      avatarUrl: profileCache.get(row.user_id)?.profile?.avatar_url ?? null,
      reason: row.reason,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }));
  },

  /** Host/admin: recent moderation actions for one event. */
  async getModerationLog(eventId: string, limit = 30): Promise<ChatModerationEntry[]> {
    const { data, error } = await supabase
      .from('event_chat_moderation_actions')
      .select('id, action, reason, created_at, actor_id, target_user_id, message_id')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    const rows =
      (data as {
        id: string;
        action: ChatModerationEntry['action'];
        reason: string | null;
        created_at: string;
        actor_id: string | null;
        target_user_id: string | null;
        message_id: string | null;
      }[]) || [];
    const ids = Array.from(
      new Set(rows.flatMap((row) => [row.actor_id, row.target_user_id]).filter((v): v is string => !!v))
    ).filter((id) => !profileCache.has(id));
    if (ids.length > 0) await ensureProfiles(ids);
    const nameOf = (id: string | null) => (id ? profileCache.get(id)?.profile?.name ?? 'Someone' : null);
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      reason: row.reason,
      createdAt: row.created_at,
      actorName: nameOf(row.actor_id),
      targetName: nameOf(row.target_user_id),
      messageId: row.message_id,
    }));
  },

  /** Host/admin: messages in this chat with pending reports. */
  async getReportedMessages(eventId: string): Promise<ChatReportedMessage[]> {
    const { data, error } = await supabase.rpc('get_event_chat_reported_messages', {
      event_uuid: eventId,
    });
    if (error) throw error;
    const rows =
      (data as (Omit<ChatReportedMessage, 'sender_name'> & { sender_name: string | null })[]) || [];
    return rows.map((row) => ({ ...row, sender_name: row.sender_name ?? 'Someone' }));
  },

  /** Host/admin: keep a reported message and clear its pending reports. */
  async dismissReports(messageId: string): Promise<number> {
    const { data, error } = await supabase.rpc('dismiss_event_chat_reports', {
      p_message_id: messageId,
    });
    if (error) throw error;
    return (data as number) ?? 0;
  },

  /** One report per user per message; duplicates surface as isChatDuplicateReportError. */
  async reportMessage(messageId: string, reason: ChatReportReason): Promise<void> {
    const reporterId = await getCurrentUserId();
    const { error } = await supabase.from('complaints').insert({
      reporter_id: reporterId,
      target_type: 'chat_message',
      target_id: messageId,
      reason,
    });
    if (error) throw error;
  },

  subscribeToMessages(
    eventId: string,
    handlers: ChatSubscriptionHandlers,
    options: ChatSubscriptionOptions = {}
  ): ChatSubscription {
    let disposed = false;
    let channel: RealtimeChannel | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let hasConnected = false;

    const setStatus = (status: ChatConnectionStatus) => {
      if (!disposed) handlers.onStatusChange?.(status);
    };

    const teardown = () => {
      if (!channel) return;
      const stale = channel;
      channel = null;
      void supabase.removeChannel(stale);
    };

    const scheduleReconnect = () => {
      if (disposed || retryTimer) return;
      setStatus(hasConnected ? 'reconnecting' : 'connecting');
      const backoff = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** attempts);
      // Jitter so clients that dropped together don't rejoin in lockstep.
      const delay = backoff * (0.75 + Math.random() * 0.5);
      attempts += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void connect();
      }, delay);
    };

    const handleInsert = async (row: EventChatMessage) => {
      if (!row?.id || row.deleted_at) return;
      const [message] = await hydrateMessages([row]);
      if (!disposed && message) handlers.onMessage(message);
    };

    const handleUpdate = (row: EventChatMessage) => {
      if (!row?.id || disposed) return;
      if (row.deleted_at) {
        handlers.onMessageDeleted?.(row.id, row.deleted_by ?? null);
      } else {
        // Restored by an admin (or any other edit): plain upsert, no
        // new-message side effects.
        void (async () => {
          const [message] = await hydrateMessages([row]);
          if (!disposed && message) handlers.onMessageUpdated?.(message);
        })();
      }
    };

    const emitPresence = (current: RealtimeChannel) => {
      if (disposed || !handlers.onPresence) return;
      const state = current.presenceState<{ name?: string }>();
      const members: ChatPresenceMember[] = Object.entries(state).map(([key, metas]) => ({
        userId: key,
        name: metas[0]?.name ?? 'Someone',
      }));
      handlers.onPresence(members);
    };

    // Presence and broadcast are scoped by topic, so every client of this chat
    // must join the same room.
    const topic = `event-chat:${eventId}`;
    const realtimeTopic = `realtime:${topic}`;

    const connect = async () => {
      if (disposed) return;
      teardown();
      setStatus(hasConnected ? 'reconnecting' : 'connecting');

      // supabase.channel(topic) hands back an existing instance for the same
      // topic, so a previous instance of this room (fast remount, our own
      // reconnect) must finish leaving before we create the next one.
      const lingering = supabase.getChannels().filter((c) => c.topic === realtimeTopic);
      if (lingering.length > 0) {
        await Promise.all(lingering.map((c) => supabase.removeChannel(c).catch(() => undefined)));
        const stillThere = supabase.getChannels().filter((c) => c.topic === realtimeTopic);
        const client = supabase.realtime as unknown as { _remove?: (c: RealtimeChannel) => void };
        for (const c of stillThere) client._remove?.(c);
      }
      if (disposed) return;

      const nextChannel = supabase
        .channel(topic, {
          config: options.self ? { presence: { key: options.self.userId } } : {},
        })
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'event_chat_messages',
            filter: `event_id=eq.${eventId}`,
          },
          (payload) => {
            if (disposed || nextChannel !== channel) return;
            void handleInsert(payload.new as EventChatMessage);
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'event_chat_messages',
            filter: `event_id=eq.${eventId}`,
          },
          (payload) => {
            if (disposed || nextChannel !== channel) return;
            handleUpdate(payload.new as EventChatMessage);
          }
        );

      nextChannel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'event_chat_settings', filter: `event_id=eq.${eventId}` },
        () => {
          if (disposed || nextChannel !== channel) return;
          handlers.onSettingsChanged?.();
        }
      );

      if (options.self) {
        nextChannel
          .on('presence', { event: 'sync' }, () => {
            if (nextChannel === channel) emitPresence(nextChannel);
          })
          .on('broadcast', { event: 'typing' }, ({ payload }) => {
            if (disposed || nextChannel !== channel || !handlers.onTyping) return;
            const event = payload as Partial<ChatTypingEvent>;
            if (!event?.userId || event.userId === options.self?.userId) return;
            handlers.onTyping({
              userId: event.userId,
              name: event.name ?? 'Someone',
              typing: Boolean(event.typing),
            });
          });
      }

      channel = nextChannel;

      nextChannel.subscribe((status) => {
        if (disposed || nextChannel !== channel) return;

        if (status === 'SUBSCRIBED') {
          // realtime-js also rejoins channels on its own after a socket blip;
          // if it won the race, cancel our pending reconnect so we don't tear
          // down a healthy channel.
          if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
          }
          attempts = 0;
          hasConnected = true;
          setStatus('connected');
          if (options.self && options.participate !== false) {
            void nextChannel.track({ name: options.self.name });
          }
          handlers.onSubscribed?.();
          return;
        }

        if (status === 'CLOSED' && !supabase.getChannels().includes(nextChannel)) {
          // Removed from the client by a newer subscription to this room
          // (second mounted copy of the chat). Don't fight it.
          channel = null;
          handlers.onSuperseded?.();
          return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          scheduleReconnect();
        }
      });
    };

    void connect();

    return {
      unsubscribe: () => {
        disposed = true;
        if (retryTimer) {
          clearTimeout(retryTimer);
          retryTimer = null;
        }
        teardown();
      },
      sendTyping: (typing: boolean) => {
        // Before the join completes, realtime-js would fall back to an HTTP
        // broadcast; typing hints aren't worth a request.
        if (disposed || !channel || !options.self || options.participate === false) return;
        if (channel.state !== 'joined') return;
        void channel.send({
          type: 'broadcast',
          event: 'typing',
          payload: { userId: options.self.userId, name: options.self.name, typing },
        });
      },
    };
  },
};

// Chat writes change the event page's chat preview / unread badge, so they
// bump the shared version (EventDetail refreshes them on its next focus).
signalEventWrites(eventChatService, [
  'sendMessage',
  'deleteMessage',
  'markRead',
  'restoreMessage',
  'setSettings',
  'setMode',
  'setPin',
  'blockUser',
  'unblockUser',
]);
