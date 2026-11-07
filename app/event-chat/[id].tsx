import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  AppState,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import {
  ArrowLeft,
  Bell,
  BellOff,
  ChevronDown,
  CloudOff,
  Info,
  Lock,
  MessageCircle,
  ShieldAlert,
  ShieldCheck,
  Users,
  Pin,
  X,
} from '@/components/icons.generated';
import { socialService, BlockingUnavailableError } from '@/services/social';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsRestoring, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/hooks/queryKeys';
import { getConnectivity, subscribeConnectivity } from '@/utils/connectivity';
import { isConnectionError } from '@/utils/networkErrors';
import {
  CACHED_ROOM_MESSAGES,
  buildOutbox,
  mergePending,
  messagesToAutoRetry,
  outboxKey,
  parseOutbox,
} from '@/utils/chatOutbox';
import { complaintsService } from '@/services/complaints';
import { ReportReasonSheet } from '@/components/ReportReasonSheet';
import { ChatModerationSheet } from '@/components/ChatModerationSheet';
import { ChatComposer, type ChatComposerHandle } from '@/components/ChatComposer';
import { useAuth } from '@/contexts/AuthContext';
import { eventsService } from '@/services/events';
import {
  eventChatService,
  isChatAccessError,
  isChatDuplicateReportError,
  isChatRateLimitError,
  isChatSlowModeError,
  ChatConnectionStatus,
  ChatPostStatus,
  ChatReportReason,
  CHAT_REPORT_REASONS,
  ChatSlowModeSeconds,
  ChatSubscription,
  CHAT_MESSAGE_PAGE_SIZE,
} from '@/services/eventChat';
import { EventChatMessageWithSender, EventDetails, PublicAttendee } from '@/types/database';
import { Avatar } from '@/components/Avatar';
import {
  ChatMessageActionsSheet,
  ChatMessageActionsTarget,
} from '@/components/ChatMessageActionsSheet';
import { uuidv4 } from '@/utils/uuid';
import {
  MENTION_TRIGGER,
  dayKey,
  dayLabel,
  isGrouped,
  resolveMentions,
  sortMessages,
  typingLabel,
} from '@/utils/chatMessages';
import { alpha, Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import {
  ChatListRow,
  type ChatListRowData,
  type ChatMessage,
} from '@/components/chat/ChatMessageRow';

/** A room as kept on the device for offline reading (queryKeys.chatRoom). */
type CachedChatRoom = {
  details: EventDetails;
  postStatus: ChatPostStatus | null;
  messages: ChatMessage[];
};

const NEAR_BOTTOM_THRESHOLD = 80;
const MAX_MESSAGE_LENGTH = 1000;
const COUNTER_VISIBLE_FROM = MAX_MESSAGE_LENGTH - 100;
const TYPING_IDLE_MS = 2500;
const TYPING_EXPIRE_MS = 4000;
const MARK_READ_DEBOUNCE_MS = 800;
/** Most often the room is mirrored into the persisted device cache. */
const ROOM_MIRROR_INTERVAL_MS = 5000;
/** An @mention reloads the attendee list when it is older than this. */
const MENTION_LIST_STALE_MS = 60_000;
// The notification trigger skips recipients who read within the last minute;
// heartbeat well inside that window while the user is watching the chat.
const READ_HEARTBEAT_MS = 30000;
const TYPING_REBROADCAST_MS = 2000;
const NOTICE_MS = 3500;
const MAX_MENTION_SUGGESTIONS = 6;
const HIGHLIGHT_MS = 2500;
const DEEP_LINK_MAX_PAGES = 5;
const UNREAD_JUMP_MIN_DISTANCE = 6;

type ListRow = ChatListRowData;

function haptic(kind: 'send' | 'press' | 'error') {
  if (Platform.OS === 'web') return;
  if (kind === 'send') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  else if (kind === 'press') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  else void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
}

export default function EventChatScreen() {
  const { id, messageId: targetMessageId } = useLocalSearchParams<{ id: string; messageId?: string }>();
  const insets = useSafeAreaInsets();
  const { user, profile, sessionStale } = useAuth();
  const sessionStaleRef = useRef(sessionStale);
  sessionStaleRef.current = sessionStale;
  const listRef = useRef<FlatList<ListRow>>(null);
  const [details, setDetails] = useState<EventDetails | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Draft text lives inside <ChatComposer> so keystrokes re-render only that
  // small component; this ref mirrors it for send/outbox/mention logic, and
  // the handle writes back (restore, mention insert, clear).
  const draftRef = useRef('');
  const composerRef = useRef<ChatComposerHandle>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [unseenCount, setUnseenCount] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<ChatConnectionStatus>('connecting');
  const [reloadKey, setReloadKey] = useState(0);
  const [hereCount, setHereCount] = useState(0);
  const [typingUsers, setTypingUsers] = useState<Record<string, { name: string; expiresAt: number }>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [actionTarget, setActionTarget] = useState<ChatMessageActionsTarget | null>(null);
  const [postStatus, setPostStatus] = useState<ChatPostStatus | null>(null);
  const [pinnedMessage, setPinnedMessage] = useState<EventChatMessageWithSender | null>(null);
  /** Senders the viewer has globally blocked (user_blocks). */
  const [blockedSenders, setBlockedSenders] = useState<Set<string>>(new Set());
  const [reportUserTarget, setReportUserTarget] = useState<{ id: string; name: string } | null>(null);
  const [moderationOpen, setModerationOpen] = useState(false);
  const [mentionCandidates, setMentionCandidates] = useState<PublicAttendee[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const draftMentionsRef = useRef<{ name: string; id: string }[]>([]);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [slowRemaining, setSlowRemaining] = useState(0);
  const [unreadJump, setUnreadJump] = useState<{ count: number; dividerId: string } | null>(null);
  // Opened from the device cache because the room couldn't load (offline):
  // reloaded for real once the connection is back.
  const [offlineRoom, setOfflineRoom] = useState(false);
  // What's on screen came from the device cache (provisionally or offline):
  // not mirrored back, which would stamp it as fresh.
  const roomFromCacheRef = useRef(false);
  // Room state waiting to be mirrored into the device cache (see the mirror
  // effect below); newer than the cache while set.
  const pendingRoomMirrorRef = useRef<{ id: string; uid: string | undefined; room: CachedChatRoom } | null>(null);
  // Who is signed in right now (assigned during render, so a sign-out is
  // visible here before this screen unmounts or its mirror timer fires).
  const currentUidRef = useRef(user?.id);
  currentUidRef.current = user?.id;
  const roomMirrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryClient = useQueryClient();
  // The room's outbox (unsent messages + composer draft) has been read and
  // merged in; only then is it written back (utils/chatOutbox).
  const [outboxRestored, setOutboxRestored] = useState(false);
  const openedLastReadRef = useRef<string | null | undefined>(undefined);
  const lastSentAtRef = useRef<number>(0);
  const deepLinkHandledRef = useRef<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasLoadedRef = useRef(false);
  const nearBottomRef = useRef(true);
  const isFocusedRef = useRef(false);
  const latestCreatedAtRef = useRef<string | null>(null);
  const oldestCursorRef = useRef<{ createdAt: string; id: string } | null>(null);
  const messageIdsRef = useRef<Set<string>>(new Set());
  const messagesRef = useRef<ChatMessage[]>([]);
  const typingLastSentRef = useRef(0);
  const loadingOlderRef = useRef(false);
  const userIdRef = useRef(user?.id);
  const selfNameRef = useRef(profile?.name ?? 'Someone');
  const canChatRef = useRef(false);
  const subscriptionRef = useRef<ChatSubscription | null>(null);
  const supersededRef = useRef(false);
  const typingSentRef = useRef(false);
  const typingIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markReadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const attendeeAccess = details?.user_rsvp === 'going' && (details?.rsvp_count ?? 0) >= 2;
  // Reading: attendees, plus hosts/admins moderating. Posting: server-decided
  // (attendee access minus bans and per-chat blocks).
  const canChat = attendeeAccess || (postStatus?.can_read ?? false);
  const canPost = postStatus ? postStatus.can_post : attendeeAccess;
  const isModerator = Boolean(postStatus?.is_host || postStatus?.is_admin);
  const isMuted = postStatus?.muted ?? false;

  useEffect(() => {
    userIdRef.current = user?.id;
  }, [user?.id]);

  useEffect(() => {
    selfNameRef.current = profile?.name ?? 'Someone';
  }, [profile?.name]);

  useEffect(() => {
    canChatRef.current = canChat;
  }, [canChat]);

  useEffect(() => {
    // Pagination and gap recovery cursors come from server-confirmed messages
    // only; optimistic ones have client clocks.
    const server = messages.filter((item) => !item.localStatus);
    latestCreatedAtRef.current =
      server.length > 0 ? server[server.length - 1].created_at : null;
    oldestCursorRef.current =
      server.length > 0 ? { createdAt: server[0].created_at, id: server[0].id } : null;
    messageIdsRef.current = new Set(messages.map((item) => item.id));
    messagesRef.current = messages;
  }, [messages]);

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      if (typingIdleTimer.current) clearTimeout(typingIdleTimer.current);
      if (markReadTimer.current) clearTimeout(markReadTimer.current);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    },
    []
  );

  const eventTitle = details?.event.title ?? 'Event chat';
  const subtitle = useMemo(() => {
    if (!details) return '';
    const parts = [`${details.rsvp_count} going`];
    if (hereCount > 1) parts.push(`${hereCount} here now`);
    if (isModerator) parts.push(postStatus?.is_admin ? 'Admin' : 'Host');
    return parts.join(' · ');
  }, [details, hereCount, isModerator, postStatus?.is_admin]);

  // The list renders inverted (newest at offset 0), so rows are decorated in
  // chronological order, then reversed.
  const rows = useMemo<ListRow[]>(() => {
    const out: ListRow[] = [];
    // "New messages" divider sits before the first message from others that
    // arrived after the read marker captured when the screen opened.
    const openedLastRead = openedLastReadRef.current;
    const openedLastReadMs = openedLastRead ? new Date(openedLastRead).getTime() : null;
    let dividerPlaced = false;
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const prev = i > 0 ? messages[i - 1] : null;
      const next = i < messages.length - 1 ? messages[i + 1] : null;
      const day = dayKey(message.created_at);
      if (!prev || dayKey(prev.created_at) !== day) {
        out.push({ kind: 'day', id: `day-${day}`, label: dayLabel(message.created_at) });
      }
      if (
        !dividerPlaced &&
        openedLastReadMs !== null &&
        !message.localStatus &&
        message.sender_id !== user?.id &&
        new Date(message.created_at).getTime() > openedLastReadMs
      ) {
        dividerPlaced = true;
        out.push({ kind: 'divider', id: 'unread-divider', label: 'New messages' });
      }
      out.push({
        kind: 'message',
        id: message.id,
        message,
        mine: message.sender_id === user?.id,
        firstOfGroup: !prev || !isGrouped(prev, message),
        lastOfGroup: !next || !isGrouped(message, next),
      });
    }
    return out.reverse();
  }, [messages, user?.id]);

  const scrollToLatest = useCallback((animated: boolean) => {
    requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated }));
    setUnseenCount(0);
  }, []);

  const rowsRef = useRef<ListRow[]>([]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const scrollToRow = useCallback((rowId: string, animated = true) => {
    const index = rowsRef.current.findIndex((row) => row.id === rowId);
    if (index < 0) return false;
    requestAnimationFrame(() =>
      listRef.current?.scrollToIndex({ index, animated, viewPosition: 0.5 })
    );
    return true;
  }, []);

  const flashMessage = useCallback((messageId: string) => {
    setHighlightedId(messageId);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightedId(null), HIGHLIGHT_MS);
  }, []);

  // Server copies share ids with their optimistic originals, so a merge of a
  // known id simply clears the local status (realtime echo or REST response,
  // whichever lands first).
  const mergeMessages = useCallback(
    (incoming: EventChatMessageWithSender[], options?: { allowRestore?: boolean }) => {
    if (incoming.length === 0) return;
    setMessages((current) => {
      const byId = new Map(current.map((item) => [item.id, item]));
      let changed = false;
      for (const item of incoming) {
        const existing = byId.get(item.id);
        if (existing && !existing.localStatus && existing.deleted_at === item.deleted_at) continue;
        // A late INSERT echo must never resurrect a tombstone; only the
        // explicit restore path (UPDATE) may clear deleted_at.
        if (existing?.deleted_at && !item.deleted_at && !options?.allowRestore) continue;
        byId.set(item.id, item);
        changed = true;
      }
      return changed ? sortMessages(Array.from(byId.values())) : current;
    });
    },
    []
  );

  const removeMessage = useCallback((messageId: string) => {
    setMessages((current) => current.filter((item) => item.id !== messageId));
  }, []);

  // Removed messages stay in the timeline as tombstones so conversations
  // don't read as gaps; the body is dropped locally too.
  const markDeleted = useCallback((messageId: string, deletedBy: string | null) => {
    setMessages((current) =>
      current.map((item) =>
        item.id === messageId && !item.deleted_at
          ? { ...item, body: '', deleted_at: new Date().toISOString(), deleted_by: deletedBy }
          : item
      )
    );
  }, []);

  // Read receipts: debounce while messages stream in, only when the user is
  // actually looking at the latest messages.
  const scheduleMarkRead = useCallback(() => {
    if (!id || !canChatRef.current || !isFocusedRef.current || !nearBottomRef.current) return;
    if (markReadTimer.current) clearTimeout(markReadTimer.current);
    markReadTimer.current = setTimeout(() => {
      eventChatService.markRead(id).catch(() => {});
    }, MARK_READ_DEBOUNCE_MS);
  }, [id]);

  // Leaving/backgrounding records the read position only if the user was at
  // the latest messages; anything they scrolled past unseen stays unread.
  const markReadNow = useCallback(() => {
    if (!id || !canChatRef.current || !nearBottomRef.current) return;
    if (markReadTimer.current) clearTimeout(markReadTimer.current);
    eventChatService.markRead(id).catch(() => {});
  }, [id]);

  const handleIncoming = useCallback(
    (message: EventChatMessageWithSender) => {
      mergeMessages([message]);
      setTypingUsers((current) => {
        if (!current[message.sender_id]) return current;
        const next = { ...current };
        delete next[message.sender_id];
        return next;
      });
      if (nearBottomRef.current || message.sender_id === userIdRef.current) {
        scrollToLatest(true);
        scheduleMarkRead();
      } else {
        // Don't yank the user down while they're reading history; offer the
        // jump pill instead.
        setUnseenCount((count) => count + 1);
      }
    },
    [mergeMessages, scrollToLatest, scheduleMarkRead]
  );

  // Realtime doesn't replay messages missed while disconnected or backgrounded;
  // fetch everything since the newest message we have.
  const catchUp = useCallback(async () => {
    if (!id) return;
    try {
      const since = latestCreatedAtRef.current;
      if (!since) {
        mergeMessages(await eventChatService.getMessages(id));
        return;
      }
      const recent = await eventChatService.getMessagesSince(id, since);
      const freshLive = recent.filter(
        (item) => !item.deleted_at && !messageIdsRef.current.has(item.id)
      );

      if (recent.length >= CHAT_MESSAGE_PAGE_SIZE) {
        // The gap may exceed one page; rebuild from the latest page so the
        // visible timeline stays contiguous (older pages reload on scroll).
        const latest = await eventChatService.getMessages(id);
        setMessages((current) => {
          const byId = new Map<string, ChatMessage>(latest.map((item) => [item.id, item]));
          for (const item of current) {
            if (item.localStatus && !byId.has(item.id)) byId.set(item.id, item);
          }
          return sortMessages(Array.from(byId.values()));
        });
        setHasMoreHistory(latest.length >= CHAT_MESSAGE_PAGE_SIZE);
      } else {
        // Includes rows removed during the gap (as tombstones) and any
        // restored ones; the server is the source of truth here.
        mergeMessages(recent, { allowRestore: true });
      }

      // Recovered messages bypass the realtime handler, so surface them here:
      // follow them when the user is at the bottom, otherwise offer the pill.
      if (freshLive.length > 0) {
        if (nearBottomRef.current) {
          scrollToLatest(false);
          scheduleMarkRead();
        } else {
          const fromOthers = freshLive.filter(
            (item) => item.sender_id !== userIdRef.current
          ).length;
          if (fromOthers > 0) setUnseenCount((count) => count + fromOthers);
        }
      }
    } catch {
      // The reconnect loop fires onSubscribed again on the next recovery.
    }
  }, [id, mergeMessages, scrollToLatest, scheduleMarkRead]);

  const loadOlder = useCallback(async () => {
    const before = oldestCursorRef.current;
    if (!id || !before || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const older = await eventChatService.getMessages(id, { before });
      mergeMessages(older);
      if (older.length < CHAT_MESSAGE_PAGE_SIZE) setHasMoreHistory(false);
    } catch {
      // Scrolling up again retries.
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [id, mergeMessages]);

  const refreshDetails = useCallback(async () => {
    if (!id) return;
    try {
      const [next, status] = await Promise.all([
        eventsService.getEventDetails(id),
        eventChatService.getPostStatus(id).catch(() => null),
      ]);
      const hasAccess =
        (next?.user_rsvp === 'going' && (next?.rsvp_count ?? 0) >= 2) || Boolean(status?.can_read);
      const gainedAccess = hasAccess && !canChatRef.current;
      setDetails(next);
      if (status) setPostStatus(status);
      setLoadError(false);
      // Chat just unlocked: run the full load so messages and the realtime
      // subscription come up too. Mark the ref immediately so concurrent
      // refreshes (focus + foreground) don't double-trigger the reload.
      if (gainedAccess) {
        canChatRef.current = true;
        setReloadKey((key) => key + 1);
      }
    } catch {
      // Keep showing current details on a transient failure.
    }
  }, [id]);

  // The pinned message id travels in post status (and settings changes refresh
  // it); the body is fetched separately so the banner survives pagination.
  const pinnedId = postStatus?.pinned_message_id ?? null;
  const pinnedIdRef = useRef<string | null>(null);
  pinnedIdRef.current = pinnedId;
  useEffect(() => {
    let cancelled = false;
    if (!pinnedId) {
      setPinnedMessage(null);
      return;
    }
    eventChatService
      .getMessage(pinnedId)
      .then((message) => {
        if (!cancelled) setPinnedMessage(message);
      })
      .catch(() => {
        if (!cancelled) setPinnedMessage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pinnedId]);

  const handleTogglePin = useCallback(
    async (target: ChatMessageActionsTarget) => {
      if (!id) return;
      try {
        const next = pinnedId === target.id ? null : target.id;
        await eventChatService.setPin(id, next);
        showNotice(next ? 'Pinned.' : 'Unpinned.');
        const status = await eventChatService.getPostStatus(id).catch(() => null);
        if (status) setPostStatus(status);
      } catch (err) {
        showNotice(err instanceof Error ? err.message : 'Could not pin the message.');
      }
    },
    [id, pinnedId, showNotice]
  );

  const handlePresence = useCallback((members: { userId: string }[]) => {
    setHereCount(members.length);
  }, []);

  const handleTyping = useCallback((event: { userId: string; name: string; typing: boolean }) => {
    setTypingUsers((current) => {
      const next = { ...current };
      if (event.typing) next[event.userId] = { name: event.name, expiresAt: Date.now() + TYPING_EXPIRE_MS };
      else delete next[event.userId];
      return next;
    });
  }, []);

  // Slow mode countdown for the composer (server enforces too). The interval
  // stops at 0, so every write to lastSentAtRef goes through advanceSlowClock,
  // which also restarts it (a retry/resend doesn't change messages.length).
  const [slowClock, setSlowClock] = useState(0);
  const advanceSlowClock = useCallback((at: number) => {
    if (at > lastSentAtRef.current) {
      lastSentAtRef.current = at;
      setSlowClock((t) => t + 1);
    }
  }, []);
  const slowSeconds = postStatus?.slow_mode_seconds ?? 0;
  useEffect(() => {
    if (!slowSeconds || isModerator) {
      setSlowRemaining(0);
      return;
    }
    // The interval only needs to run while a countdown is showing; before
    // this it ticked once a second for the whole life of a slow-mode room.
    const tick = () => {
      const remaining = Math.ceil((lastSentAtRef.current + slowSeconds * 1000 - Date.now()) / 1000);
      setSlowRemaining(remaining > 0 ? remaining : 0);
      if (remaining <= 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    let timer: ReturnType<typeof setInterval> | null = setInterval(tick, 1000);
    tick();
    return () => {
      if (timer !== null) clearInterval(timer);
    };
  }, [slowSeconds, isModerator, messages.length, slowClock]);

  // Expire stale typing indicators (a client that lost connection never sends
  // its "stopped typing").
  useEffect(() => {
    const ids = Object.keys(typingUsers);
    if (ids.length === 0) return;
    const soonest = Math.min(...ids.map((key) => typingUsers[key].expiresAt));
    const timer = setTimeout(() => {
      const now = Date.now();
      setTypingUsers((current) => {
        const next: typeof current = {};
        for (const key of Object.keys(current)) {
          if (current[key].expiresAt > now) next[key] = current[key];
        }
        return next;
      });
    }, Math.max(50, soonest - Date.now()));
    return () => clearTimeout(timer);
  }, [typingUsers]);

  // The transcript and access state last mirrored for this room, with any
  // unsent messages, shown when the room can't load. Messages written
  // offline are queued and sent once the connection is back.
  // `provisional`: shown while the live load runs (it can take a while on
  // a bad connection), replaced when it succeeds; no offline banner yet.
  const openCachedRoom = useCallback(({ provisional = false } = {}) => {
    if (!id) return false;
    const pending = pendingRoomMirrorRef.current;
    const cached =
      pending?.id === id ? pending.room : queryClient.getQueryData<CachedChatRoom>(queryKeys.chatRoom(id));
    if (!cached?.details || !Array.isArray(cached.messages)) return false;
    roomFromCacheRef.current = true;
    setDetails(cached.details);
    if (cached.postStatus) setPostStatus(cached.postStatus);
    // Keep unsent messages already on screen (restored or just written).
    setMessages((current) => sortMessages(mergePending(cached.messages, current.filter((m) => m.localStatus))));
    if (!provisional) setOfflineRoom(true);
    setLoadError(false);
    canChatRef.current = true;
    return true;
  }, [id, queryClient]);

  // Opened before the device cache finished restoring (offline start): show
  // the saved room as soon as it's available if nothing has loaded yet.
  const isRestoring = useIsRestoring();
  useEffect(() => {
    if (isRestoring || !loading || messagesRef.current.some((m) => !m.localStatus)) return;
    if (openCachedRoom({ provisional: true })) setLoading(false);
  }, [isRestoring, loading, openCachedRoom]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setLoadError(false);
      if (getConnectivity() === 'offline' && openCachedRoom()) {
        setLoading(false);
        hasLoadedRef.current = true;
        return;
      }
      // Show the saved copy right away; the live load below replaces it.
      if (!hasLoadedRef.current && openCachedRoom({ provisional: true })) setLoading(false);
      try {
        const [nextDetails, status] = await Promise.all([
          eventsService.getEventDetails(id),
          eventChatService.getPostStatus(id).catch(() => null),
        ]);
        if (cancelled) return;
        setDetails(nextDetails);
        if (status) setPostStatus(status);

        const hasAccess =
          (nextDetails?.user_rsvp === 'going' && nextDetails.rsvp_count >= 2) ||
          Boolean(status?.can_read);
        if (!hasAccess) {
          roomFromCacheRef.current = false;
          setMessages([]);
          return;
        }

        // Read marker as of opening, so the divider doesn't move while the
        // user reads (markRead advances the server-side marker right away).
        if (openedLastReadRef.current === undefined) {
          openedLastReadRef.current = status?.last_read_at ?? null;
        }
        if (status?.last_post_at) {
          advanceSlowClock(new Date(status.last_post_at).getTime());
        }

        let initialMessages = await eventChatService.getMessages(id);
        if (cancelled) return;

        // Deep link: make sure the target message is loaded (bounded).
        if (targetMessageId && deepLinkHandledRef.current !== targetMessageId) {
          let pages = 0;
          while (
            !initialMessages.some((item) => item.id === targetMessageId) &&
            initialMessages.length > 0 &&
            pages < DEEP_LINK_MAX_PAGES
          ) {
            const oldest = initialMessages[0];
            const older = await eventChatService.getMessages(id, {
              before: { createdAt: oldest.created_at, id: oldest.id },
            });
            if (cancelled) return;
            if (older.length === 0) break;
            initialMessages = sortMessages([...older, ...initialMessages]);
            pages += 1;
          }
        }

        setMessages((current) =>
          sortMessages(mergePending(initialMessages, current.filter((m) => m.localStatus)))
        );
        roomFromCacheRef.current = false;
        setOfflineRoom(false);
        setHasMoreHistory(initialMessages.length >= CHAT_MESSAGE_PAGE_SIZE);
        nearBottomRef.current = true;
        setUnseenCount(0);
        canChatRef.current = true;

        const openedLastRead = openedLastReadRef.current;
        if (openedLastRead && !targetMessageId) {
          const lastReadMs = new Date(openedLastRead).getTime();
          const unread = initialMessages.filter(
            (item) => item.sender_id !== userIdRef.current && new Date(item.created_at).getTime() > lastReadMs
          );
          if (unread.length >= UNREAD_JUMP_MIN_DISTANCE) {
            setUnreadJump({ count: unread.length, dividerId: 'unread-divider' });
          }
        }

        if (targetMessageId && deepLinkHandledRef.current !== targetMessageId) {
          deepLinkHandledRef.current = targetMessageId;
          const found = initialMessages.some((item) => item.id === targetMessageId);
          setTimeout(() => {
            if (cancelled) return;
            if (found && scrollToRow(targetMessageId, false)) {
              nearBottomRef.current = false;
              flashMessage(targetMessageId);
            } else if (!found) {
              showNotice("Couldn't find that message — it may have been removed.");
            }
          }, 350);
        } else {
          scheduleMarkRead();
        }

        subscriptionRef.current = eventChatService.subscribeToMessages(
          id,
          {
            onMessage: handleIncoming,
            onMessageDeleted: markDeleted,
            onMessageUpdated: (message) => mergeMessages([message], { allowRestore: true }),
            onSettingsChanged: () => {
              if (!cancelled) void refreshDetails();
            },
            onSuperseded: () => {
              if (cancelled) return;
              supersededRef.current = true;
              // If this copy of the screen is the one on screen, take the
              // room back right away; otherwise wait until it regains focus.
              if (isFocusedRef.current) setReloadKey((key) => key + 1);
            },
            onStatusChange: (status) => {
              if (!cancelled) setConnectionStatus(status);
            },
            // Covers both the initial fetch→subscribe window and gaps from
            // reconnects; merge dedupes anything we already have.
            onSubscribed: () => {
              if (!cancelled) void catchUp();
            },
            onPresence: handlePresence,
            onTyping: handleTyping,
          },
          // Only posters join presence/typing; blocked or read-only viewers
          // shouldn't be able to show "is typing…".
          userIdRef.current
            ? {
                self: { userId: userIdRef.current, name: selfNameRef.current },
                participate: status ? status.can_post : hasAccess,
              }
            : {}
        );
        supersededRef.current = false;
      } catch {
        if (!cancelled && !openCachedRoom()) {
          setDetails(null);
          // Unsent messages stay (and stay stored) for the next attempt.
          setMessages((current) => current.filter((m) => m.localStatus));
          setLoadError(true);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          hasLoadedRef.current = true;
        }
      }
    };

    load();

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (cancelled || !hasLoadedRef.current) return;
      if (state === 'active') {
        void refreshDetails();
        void catchUp();
      } else {
        markReadNow();
      }
    });

    const readHeartbeat = setInterval(() => {
      if (!cancelled && hasLoadedRef.current && AppState.currentState === 'active') {
        scheduleMarkRead();
      }
    }, READ_HEARTBEAT_MS);

    return () => {
      cancelled = true;
      clearInterval(readHeartbeat);
      appStateSubscription.remove();
      subscriptionRef.current?.unsubscribe();
      subscriptionRef.current = null;
      setHereCount(0);
      setTypingUsers({});
    };
  }, [
    id,
    reloadKey,
    advanceSlowClock,
    openCachedRoom,
    handleIncoming,
    markDeleted,
    mergeMessages,
    catchUp,
    refreshDetails,
    handlePresence,
    handleTyping,
    scheduleMarkRead,
    markReadNow,
    targetMessageId,
    scrollToRow,
    flashMessage,
    showNotice,
  ]);

  // Restore the room's outbox once the signed-in user is known (after an
  // offline start that can be several seconds after the screen opened).
  useEffect(() => {
    const uid = user?.id;
    if (!id || !uid || outboxRestored) return;
    let cancelled = false;
    void AsyncStorage.getItem(outboxKey(uid, id))
      .then((raw) => parseOutbox<ChatMessage>(raw))
      .catch(() => null)
      .then((outbox) => {
        if (cancelled) return;
        if (outbox) {
          if (outbox.pending.length) setMessages((current) => sortMessages(mergePending(current, outbox.pending)));
          if (outbox.draft.trim()) {
            // The composer may not be mounted yet (access still resolving);
            // the ref seeds its initialText in that case.
            if (!draftRef.current.trim()) draftRef.current = outbox.draft;
            composerRef.current?.setTextIfEmpty(outbox.draft);
            draftMentionsRef.current = outbox.draftMentions;
          }
        }
        setOutboxRestored(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id, user?.id, outboxRestored]);

  // Keep the room's unsent messages and composer draft on the device
  // (debounced), so a dropped connection or a killed app loses neither.
  // Not before the stored outbox was read: that would overwrite it.
  // Scheduled from the messages effect below AND from every composer text
  // change (the draft is a ref, so keystrokes don't re-run effects).
  const outboxRestoredRef = useRef(false);
  outboxRestoredRef.current = outboxRestored;
  const outboxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleOutboxWrite = useCallback(() => {
    const uid = user?.id;
    if (!id || !uid || !outboxRestoredRef.current) return;
    if (outboxTimerRef.current) clearTimeout(outboxTimerRef.current);
    outboxTimerRef.current = setTimeout(() => {
      outboxTimerRef.current = null;
      const outbox = buildOutbox(messagesRef.current, draftRef.current, draftMentionsRef.current);
      const key = outboxKey(uid, id);
      (outbox ? AsyncStorage.setItem(key, JSON.stringify(outbox)) : AsyncStorage.removeItem(key)).catch(() => {});
    }, 600);
  }, [id, user?.id]);
  useEffect(() => {
    if (!outboxRestored) return;
    scheduleOutboxWrite();
  }, [messages, outboxRestored, scheduleOutboxWrite]);
  useEffect(
    () => () => {
      if (outboxTimerRef.current) clearTimeout(outboxTimerRef.current);
    },
    []
  );

  // Mirror the newest server messages and access state into the device cache
  // (5 most recent rooms), so the room opens offline. Not while showing that
  // cached copy: it would be re-stamped as fresh.
  //
  // Throttled: the chat room key is persisted, so every write schedules a
  // save of the whole device cache. Writing on each message (or send-status
  // change) kept a busy room re-serializing that cache every couple of
  // seconds. Changes collect in a ref and land at most every
  // ROOM_MIRROR_INTERVAL_MS, and immediately when the room is left.
  const flushRoomMirror = useCallback(() => {
    if (roomMirrorTimerRef.current) {
      clearTimeout(roomMirrorTimerRef.current);
      roomMirrorTimerRef.current = null;
    }
    const pending = pendingRoomMirrorRef.current;
    if (!pending) return;
    pendingRoomMirrorRef.current = null;
    // Signed out / switched account since: the cache was cleared for the
    // next user; writing this room back would leak it into their cache.
    if (!pending.uid || pending.uid !== currentUidRef.current) return;
    queryClient.setQueryData(queryKeys.chatRoom(pending.id), pending.room);
  }, [queryClient]);
  useEffect(() => {
    if (!id || !details || offlineRoom || roomFromCacheRef.current || loading || !canChat) return;
    // A different room is pending (the param changed): write it out first.
    if (pendingRoomMirrorRef.current && pendingRoomMirrorRef.current.id !== id) flushRoomMirror();
    pendingRoomMirrorRef.current = {
      id,
      uid: user?.id,
      room: {
        details,
        postStatus,
        messages: messages.filter((m) => !m.localStatus).slice(-CACHED_ROOM_MESSAGES),
      },
    };
    if (!roomMirrorTimerRef.current) {
      roomMirrorTimerRef.current = setTimeout(flushRoomMirror, ROOM_MIRROR_INTERVAL_MS);
    }
  }, [id, user?.id, details, postStatus, messages, offlineRoom, loading, canChat, flushRoomMirror]);
  // Leaving the screen (unmount) writes whatever is pending; so does the app
  // leaving the foreground (it may be killed before the timer fires).
  useEffect(() => flushRoomMirror, [flushRoomMirror]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') flushRoomMirror();
    });
    return () => sub.remove();
  }, [flushRoomMirror]);

  // Attendees for @mention autocomplete (public, non-anonymous, not self).
  // Loaded once per room; refreshed only when the user starts an @mention
  // and the list is over a minute old (it used to re-download the whole
  // attendee list on every RSVP count change while the room was open).
  const [mentionRefreshTick, setMentionRefreshTick] = useState(0);
  const mentionsLoadedAtRef = useRef(0);
  useEffect(() => {
    if (!id || !canPost) {
      setMentionCandidates([]);
      return;
    }
    let cancelled = false;
    socialService
      .getEventAttendees(id)
      .then((list) => {
        if (cancelled) return;
        mentionsLoadedAtRef.current = Date.now();
        setMentionCandidates(
          list.filter((attendee) => !attendee.is_anonymous && attendee.id !== userIdRef.current)
        );
      })
      .catch(() => {
        if (!cancelled) setMentionCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [id, canPost, mentionRefreshTick]);

  // Access can change while this screen is in the stack (RSVPs elsewhere);
  // re-check it and fill any message gap whenever the screen regains focus.
  // Leaving the screen records the read position.
  useFocusEffect(
    useCallback(() => {
      isFocusedRef.current = true;
      if (supersededRef.current) {
        // Another copy of this chat owned the realtime room; reclaim it.
        supersededRef.current = false;
        setReloadKey((key) => key + 1);
      } else if (hasLoadedRef.current) {
        void refreshDetails();
        void catchUp();
      }
      return () => {
        isFocusedRef.current = false;
        markReadNow();
        flushRoomMirror();
      };
    }, [refreshDetails, catchUp, markReadNow, flushRoomMirror])
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      // Inverted list: offset 0 is the newest message.
      const nearBottom = event.nativeEvent.contentOffset.y <= NEAR_BOTTOM_THRESHOLD;
      const wasNearBottom = nearBottomRef.current;
      nearBottomRef.current = nearBottom;
      if (nearBottom) {
        setUnseenCount((count) => (count === 0 ? count : 0));
        if (!wasNearBottom) scheduleMarkRead();
      }
    },
    [scheduleMarkRead]
  );

  const sendNow = useCallback(
    async (pending: ChatMessage) => {
      if (!id) return;
      setMessages((current) => {
        const exists = current.some((item) => item.id === pending.id);
        const next = exists
          ? current.map((item) =>
              item.id === pending.id ? { ...item, localStatus: 'sending' as const } : item
            )
          : sortMessages([...current, pending]);
        return next;
      });
      scrollToLatest(true);
      const waitForConnection = () =>
        setMessages((current) =>
          current.map((item) =>
            item.id === pending.id && item.localStatus === 'sending'
              ? { ...item, localStatus: 'failed' as const, autoRetry: true }
              : item
          )
        );
      // No connection, or the session isn't verified yet (the request would
      // wait on the token refresh, then be refused): keep it (on the device
      // too) and send once that changes.
      if (getConnectivity() === 'offline' || sessionStaleRef.current) {
        waitForConnection();
        return;
      }
      try {
        const sent = await eventChatService.sendMessage(id, pending.body, pending.id, pending.mentions);
        advanceSlowClock(new Date(sent.created_at).getTime());
        mergeMessages([sent]);
        scheduleMarkRead();
      } catch (err) {
        if (isConnectionError(err)) {
          waitForConnection();
          showNotice("No connection — it will send when you're back online.");
          return;
        }
        // If the insert committed and the realtime echo already replaced the
        // optimistic row, the server copy must not be stamped as failed.
        setMessages((current) =>
          current.map((item) =>
            item.id === pending.id && item.localStatus === 'sending'
              ? { ...item, localStatus: 'failed' as const, autoRetry: false }
              : item
          )
        );
        haptic('error');
        if (isChatSlowModeError(err)) {
          showNotice('Slow mode is on — wait a moment before posting again.');
          void refreshDetails();
        } else if (isChatRateLimitError(err)) {
          showNotice("You're sending messages too quickly — give it a moment.");
        } else if (isChatAccessError(err)) {
          // RLS refused the insert: the chat was locked, relocked below two
          // attendees, or this user was blocked/banned since the screen
          // loaded. Retrying can't succeed, so drop the optimistic bubble,
          // give the text back as the draft and explain. (Settings changes
          // don't reach us live — event_chat_settings is not in the
          // realtime publication until migration 20261102120000 — so this
          // is where attendees first learn the chat was locked.)
          setMessages((current) => current.filter((item) => item.id !== pending.id));
          // Never lose what they typed: if a new draft is already underway,
          // append the rejected text rather than replacing it, and restore
          // the mention ids so an @Name still resolves on re-send.
          composerRef.current?.appendLine(pending.body);
          const restored = Object.entries(pending.mention_names ?? {}).map(([mentionId, name]) => ({ id: mentionId, name }));
          if (restored.length) {
            const known = new Set(draftMentionsRef.current.map((m) => m.id));
            draftMentionsRef.current = [...draftMentionsRef.current, ...restored.filter((m) => !known.has(m.id))];
          }
          const status = await eventChatService.getPostStatus(id).catch(() => null);
          if (status) setPostStatus(status);
          showNotice(
            status?.locked && !status.is_host && !status.is_admin
              ? "The host locked the chat — your message wasn't sent."
              : status?.is_blocked
                ? "You've been removed from this chat — your message wasn't sent."
                : "You can no longer post in this chat — your message wasn't sent."
          );
          void refreshDetails();
        } else {
          showNotice("Message not sent — tap it to retry.");
        }
      }
    },
    [id, scrollToLatest, mergeMessages, scheduleMarkRead, refreshDetails, showNotice, advanceSlowClock]
  );

  // Messages waiting for a connection are re-sent once it's back (and right
  // after the room loads online). Their ids make a repeat harmless.
  const retryWaiting = useCallback(() => {
    if (getConnectivity() === 'offline' || offlineRoom || sessionStaleRef.current) return;
    for (const message of messagesToAutoRetry(messagesRef.current)) void sendNow(message);
  }, [offlineRoom, sendNow]);
  useEffect(() => {
    if (!loading && !offlineRoom && outboxRestored && !sessionStale) retryWaiting();
  }, [loading, offlineRoom, outboxRestored, sessionStale, retryWaiting]);
  useEffect(() => {
    let previous = getConnectivity();
    return subscribeConnectivity((status) => {
      const wasImpaired = previous !== 'online';
      previous = status;
      if (!wasImpaired || status !== 'online') return;
      // A cached room reloads for real (which then re-sends); a live room
      // just re-sends.
      if (offlineRoom) setReloadKey((key) => key + 1);
      else retryWaiting();
    });
  }, [offlineRoom, retryWaiting]);

  const stopTyping = useCallback(() => {
    if (typingIdleTimer.current) {
      clearTimeout(typingIdleTimer.current);
      typingIdleTimer.current = null;
    }
    if (typingSentRef.current) {
      typingSentRef.current = false;
      subscriptionRef.current?.sendTyping(false);
    }
  }, []);

  // Called for every composer text change; `typed` is false for programmatic
  // changes (mention insert, restore, clear), which must not broadcast typing.
  const handleDraftChange = (text: string, typed: boolean) => {
    draftRef.current = text;
    scheduleOutboxWrite();
    const trigger = MENTION_TRIGGER.exec(text);
    if (trigger && typed && Date.now() - mentionsLoadedAtRef.current > MENTION_LIST_STALE_MS) {
      // Mark fresh now so a burst of keystrokes triggers one reload.
      mentionsLoadedAtRef.current = Date.now();
      setMentionRefreshTick((t) => t + 1);
    }
    setMentionQuery(trigger && mentionCandidates.length > 0 ? trigger[2].toLowerCase() : null);
    if (!text.trim() || !typed) {
      if (!text.trim()) stopTyping();
      return;
    }
    // Receivers expire indicators after a few seconds; keep re-broadcasting
    // while the user is still composing.
    const now = Date.now();
    if (!typingSentRef.current || now - typingLastSentRef.current >= TYPING_REBROADCAST_MS) {
      typingSentRef.current = true;
      typingLastSentRef.current = now;
      subscriptionRef.current?.sendTyping(true);
    }
    if (typingIdleTimer.current) clearTimeout(typingIdleTimer.current);
    typingIdleTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  };

  const insertMention = (attendee: PublicAttendee) => {
    const next = draftRef.current.replace(
      MENTION_TRIGGER,
      (_match, lead: string) => `${lead}@${attendee.name} `
    );
    if (!draftMentionsRef.current.some((entry) => entry.id === attendee.id)) {
      draftMentionsRef.current.push({ name: attendee.name, id: attendee.id });
    }
    composerRef.current?.setText(next);
    setMentionQuery(null);
    haptic('send');
  };

  const mentionSuggestions =
    mentionQuery === null
      ? []
      : mentionCandidates
          .filter((attendee) => attendee.name.toLowerCase().includes(mentionQuery))
          .slice(0, MAX_MENTION_SUGGESTIONS);

  const handleSend = () => {
    if (!id || !user) return;
    const body = draftRef.current.trim();
    if (!body || body.length > MAX_MESSAGE_LENGTH) return;
    if (slowRemaining > 0) {
      showNotice(`Slow mode — you can post again in ${slowRemaining}s.`);
      return;
    }
    // Optimistically start the slow-mode clock; corrected from the server copy.
    if (slowSeconds && !isModerator) advanceSlowClock(Date.now());

    composerRef.current?.clear();
    setMentionQuery(null);
    stopTyping();
    haptic('send');
    // Clamp to just after the newest known server message so a lagging device
    // clock can't sort the optimistic bubble into the middle of history.
    const latestKnown = latestCreatedAtRef.current
      ? new Date(latestCreatedAtRef.current).getTime() + 1
      : 0;
    // Only names still present in the text count as mentions.
    const mentionNames = resolveMentions(body, draftMentionsRef.current);
    const mentions = Array.from(mentionNames.keys());
    const pending: ChatMessage = {
      // Client-generated id: the server row shares it, so retries are
      // idempotent and the realtime echo dedupes by id.
      id: uuidv4(),
      event_id: id,
      sender_id: user.id,
      body,
      created_at: new Date(Math.max(Date.now(), latestKnown)).toISOString(),
      deleted_at: null,
      deleted_by: null,
      mentions,
      mention_names: Object.fromEntries(
        mentions.map((userId) => [userId, mentionNames.get(userId) ?? ''])
      ),
      sender: profile
        ? { id: profile.id, name: profile.name, avatar_url: profile.avatar_url }
        : null,
      localStatus: 'sending',
    };
    draftMentionsRef.current = [];
    void sendNow(pending);
  };

  const toggleMute = useCallback(async () => {
    if (!id || !postStatus) return;
    const nextMuted = !postStatus.muted;
    haptic('send');
    setPostStatus({ ...postStatus, muted: nextMuted });
    try {
      await eventChatService.setMuted(id, nextMuted);
      showNotice(nextMuted ? 'Notifications muted for this chat' : 'Notifications on for this chat');
    } catch {
      setPostStatus(postStatus);
      showNotice("Couldn't update notifications. Please try again.");
    }
  }, [id, postStatus, showNotice]);

  const openActions = useCallback(
    (message: ChatMessage, mine: boolean) => {
      haptic('press');
      setActionTarget({
        id: message.id,
        body: message.body,
        senderId: message.sender_id,
        senderName: mine ? 'You' : (message.sender?.name ?? 'Someone'),
        mine,
        failed: message.localStatus === 'failed',
        sending: message.localStatus === 'sending',
        deleted: Boolean(message.deleted_at),
        deletedBySender: Boolean(message.deleted_at) && message.deleted_by === message.sender_id,
        canModerate: isModerator,
        senderBlocked: blockedSenders.has(message.sender_id),
      });
    },
    [isModerator, blockedSenders]
  );

  useEffect(() => {
    let cancelled = false;
    socialService
      .getBlockedUsers()
      .then((rows) => {
        if (!cancelled) setBlockedSenders(new Set(rows.map((row) => row.id)));
      })
      .catch(() => {
        // Blocking unavailable or transient failure: treat as none blocked.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleViewProfile = useCallback((target: ChatMessageActionsTarget) => {
    router.push(`/user/${target.senderId}` as never);
  }, []);

  /**
   * Account-level block (user_blocks), distinct from the host's per-chat
   * removal: it hides the person's messages from this viewer everywhere.
   */
  const handleToggleGlobalBlock = useCallback(
    async (target: ChatMessageActionsTarget) => {
      const wasBlocked = blockedSenders.has(target.senderId);
      try {
        if (wasBlocked) {
          await socialService.unblockUser(target.senderId);
          setBlockedSenders((prev) => {
            const next = new Set(prev);
            next.delete(target.senderId);
            return next;
          });
          showNotice(`${target.senderName} unblocked.`);
        } else {
          await socialService.blockUser(target.senderId);
          setBlockedSenders((prev) => new Set(prev).add(target.senderId));
          showNotice(`${target.senderName} blocked. You won't see their messages.`);
        }
        setReloadKey((key) => key + 1);
      } catch (err) {
        showNotice(
          err instanceof BlockingUnavailableError
            ? "Blocking isn't enabled on this server yet."
            : "Couldn't update the block. Please try again."
        );
      }
    },
    [blockedSenders, showNotice]
  );

  const handleReportUser = useCallback((target: ChatMessageActionsTarget) => {
    setReportUserTarget({ id: target.senderId, name: target.senderName });
  }, []);

  const submitUserReport = useCallback(
    async (reason: string) => {
      if (!reportUserTarget) return;
      try {
        await complaintsService.createComplaint('user', reportUserTarget.id, reason);
        showNotice('Report received. We review reports within about 48 hours.');
      } catch (err) {
        showNotice(
          (err as { code?: string })?.code === '23505'
            ? "You've already reported this person."
            : "Couldn't send the report. Please try again."
        );
      }
    },
    [reportUserTarget, showNotice]
  );

  const handleCopy = useCallback(
    (target: ChatMessageActionsTarget) => {
      void Clipboard.setStringAsync(target.body);
      showNotice('Copied to clipboard');
    },
    [showNotice]
  );

  const handleReport = useCallback(
    async (target: ChatMessageActionsTarget, reason: ChatReportReason) => {
      try {
        await eventChatService.reportMessage(target.id, reason);
        showNotice('Thanks — the message has been reported.');
      } catch (err) {
        if (isChatDuplicateReportError(err)) {
          showNotice("You've already reported this message.");
        } else {
          showNotice("Couldn't send the report. Please try again.");
        }
      }
    },
    [showNotice]
  );

  const handleBlockUser = useCallback(
    async (target: ChatMessageActionsTarget, durationMinutes: number | null) => {
      if (!id) return;
      try {
        await eventChatService.blockUser(id, target.senderId, 'Removed from chat by moderator', durationMinutes);
        showNotice(
          durationMinutes
            ? `${target.senderName} can't post for the next ${durationMinutes >= 60 ? `${durationMinutes / 60}h` : `${durationMinutes}m`}.`
            : `${target.senderName} can no longer post in this chat.`
        );
      } catch {
        showNotice("Couldn't remove this person. Please try again.");
      }
    },
    [id, showNotice]
  );

  const handleRestore = useCallback(
    async (target: ChatMessageActionsTarget) => {
      try {
        const restored = await eventChatService.restoreMessage(target.id);
        if (!restored) throw new Error('not restored');
        // The restored row is older than the gap cursor, so fetch it directly
        // rather than relying on the realtime UPDATE alone.
        const fresh = await eventChatService.getMessage(target.id);
        if (fresh) mergeMessages([fresh], { allowRestore: true });
        showNotice('Message restored.');
      } catch {
        showNotice("Couldn't restore the message. Please try again.");
      }
    },
    [showNotice, mergeMessages]
  );

  // A timed block lifting while the screen is open should re-enable the composer.
  useEffect(() => {
    const expires = postStatus?.is_blocked ? postStatus.block_expires_at : null;
    if (!expires) return;
    const delay = new Date(expires).getTime() - Date.now();
    if (delay <= 0) {
      void refreshDetails();
      return;
    }
    const timer = setTimeout(() => void refreshDetails(), Math.min(delay + 500, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [postStatus?.is_blocked, postStatus?.block_expires_at, refreshDetails]);

  const handleUpdateSettings = useCallback(
    async (settings: { locked?: boolean; slowModeSeconds?: ChatSlowModeSeconds }) => {
      if (!id) return;
      await eventChatService.setSettings(id, settings);
      setPostStatus((current) =>
        current
          ? {
              ...current,
              locked: settings.locked ?? current.locked,
              slow_mode_seconds: settings.slowModeSeconds ?? current.slow_mode_seconds,
            }
          : current
      );
      showNotice(
        settings.locked === true
          ? 'Chat locked. Attendees can read but not post until you unlock it.'
          : settings.locked === false
            ? 'Chat unlocked.'
            : settings.slowModeSeconds === 0
              ? 'Slow mode off.'
              : `Slow mode on: one message every ${settings.slowModeSeconds}s.`
      );
    },
    [id, showNotice]
  );

  const handleDelete = useCallback(
    async (target: ChatMessageActionsTarget) => {
      const original = messagesRef.current.find((item) => item.id === target.id);
      markDeleted(target.id, userIdRef.current ?? null);
      try {
        const deleted = await eventChatService.deleteMessage(target.id);
        if (!deleted) throw new Error('not deleted');
        // Deleting the pinned message unpins it server-side; drop the banner
        // immediately instead of showing moderated content until the next
        // status refresh.
        if (pinnedIdRef.current === target.id) {
          setPinnedMessage(null);
          if (id) {
            const status = await eventChatService.getPostStatus(id).catch(() => null);
            if (status) setPostStatus(status);
          }
        }
      } catch {
        showNotice("Couldn't delete the message. Please try again.");
        if (original) {
          setMessages((current) => current.map((item) => (item.id === original.id ? original : item)));
        }
      }
    },
    [markDeleted, showNotice, id]
  );

  const handleRetry = useCallback(
    (target: ChatMessageActionsTarget) => {
      const message = messages.find((item) => item.id === target.id);
      if (message) void sendNow(message);
    },
    [messages, sendNow]
  );

  const handleDiscard = useCallback(
    (target: ChatMessageActionsTarget) => removeMessage(target.id),
    [removeMessage]
  );

  const viewerId = user?.id;
  const viewProfile = useCallback((userId: string) => {
    router.push(`/user/${userId}` as never);
  }, []);

  // Rows are memoised components: only the highlighted flag, the viewer and
  // the moderator role vary per row, so composer keystrokes and typing
  // indicators no longer re-render the whole transcript.
  const renderRow = useCallback(
    ({ item }: { item: ListRow }) => (
      <ChatListRow
        row={item}
        viewerId={viewerId}
        isModerator={isModerator}
        highlighted={item.kind === 'message' && highlightedId === item.id}
        onOpenActions={openActions}
        onViewProfile={viewProfile}
      />
    ),
    [viewerId, isModerator, highlightedId, openActions, viewProfile]
  );

  const renderEmpty = () => {
    if (loading) {
      return (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.centerText}>Loading chat…</Text>
        </View>
      );
    }

    if (loadError) {
      return (
        <View style={styles.centerState}>
          <MessageCircle size={44} color={Colors.text.tertiary} />
          <Text style={styles.centerTitle}>Couldn&apos;t load the chat</Text>
          <Text style={styles.centerText}>Check your connection and try again.</Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => setReloadKey((key) => key + 1)}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>Try again</Text>
          </TouchableOpacity>
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
      // The viewer is still going, so the room relocked because attendance
      // dropped below 2 — explain why earlier messages disappeared instead of
      // asking them to RSVP again.
      const relocked = details.user_rsvp === 'going';
      return (
        <View style={styles.centerState}>
          {relocked ? (
            <Lock size={44} color={Colors.text.tertiary} />
          ) : (
            <Users size={44} color={Colors.text.tertiary} />
          )}
          <Text style={styles.centerTitle}>
            {relocked ? 'Chat is locked' : 'Chat unlocks with 2 attendees'}
          </Text>
          <Text style={styles.centerText}>
            {relocked
              ? 'It unlocks when at least 2 people are going. Messages are hidden until then.'
              : 'RSVP as going, then this room opens once at least two people are going.'}
          </Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => router.replace(`/event/${details.event.id}` as never)}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>Back to event</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!canPost) {
      return (
        <View style={styles.centerState}>
          <MessageCircle size={44} color={Colors.text.tertiary} />
          <Text style={styles.centerTitle}>No messages yet</Text>
          <Text style={styles.centerText}>Messages from attendees will show up here.</Text>
        </View>
      );
    }

    return (
      <View style={styles.centerState}>
        <MessageCircle size={44} color={Colors.text.tertiary} />
        <Text style={styles.centerTitle}>Start the conversation</Text>
        <Text style={styles.centerText}>Everyone here is going to this event. Say hi!</Text>
      </View>
    );
  };

  // In the inverted list the footer renders at the visual top, above the
  // oldest loaded message.
  const renderHistoryFooter = () => {
    if (loadingOlder) {
      return (
        <View style={styles.historyFooter}>
          <ActivityIndicator size="small" color={Colors.text.tertiary} />
        </View>
      );
    }
    if (!hasMoreHistory && messages.length >= CHAT_MESSAGE_PAGE_SIZE) {
      return (
        <View style={styles.historyFooter}>
          <Text style={styles.historyFooterText}>Beginning of the event chat</Text>
        </View>
      );
    }
    return null;
  };

  const showLockedNotice = !loading && !loadError && details && !canChat && messages.length > 0;
  const typingText = typingLabel(Object.values(typingUsers).map((entry) => entry.name));
  const slowText =
    slowRemaining > 0
      ? `Slow mode · you can post again in ${slowRemaining}s`
      : isModerator && postStatus?.locked
        ? 'Chat is locked — only you can post'
        : '';
  const statusLine = notice ?? (typingText || slowText);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.headerButton}
          hitSlop={4}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {eventTitle}
          </Text>
          {subtitle ? (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {isModerator && id ? (
          <TouchableOpacity
            style={styles.headerButton}
            hitSlop={4}
            onPress={() => setModerationOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Manage chat"
          >
            <ShieldCheck size={20} color={Colors.primary} />
          </TouchableOpacity>
        ) : null}
        {canChat && (attendeeAccess || isModerator) && postStatus ? (
          <TouchableOpacity
            style={styles.headerButton}
            hitSlop={4}
            onPress={() => void toggleMute()}
            accessibilityRole="button"
            accessibilityLabel={isMuted ? 'Unmute chat notifications' : 'Mute chat notifications'}
            accessibilityState={{ selected: isMuted }}
          >
            {isMuted ? (
              <BellOff size={20} color={Colors.text.secondary} />
            ) : (
              <Bell size={20} color={Colors.text.primary} />
            )}
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={styles.headerButton}
            hitSlop={4}
          onPress={() => details && router.replace(`/event/${details.event.id}` as never)}
          disabled={!details}
          accessibilityRole="button"
          accessibilityLabel="View event details"
        >
          <Info size={22} color={details ? Colors.primary : Colors.text.disabled} />
        </TouchableOpacity>
      </View>

      {canChat && !loading && offlineRoom ? (
        <View style={styles.connectionBanner}>
          <CloudOff size={16} color={Colors.text.secondary} />
          <Text style={styles.connectionBannerText}>
            Offline · Showing saved messages. New ones send when you reconnect.
          </Text>
        </View>
      ) : canChat && !loading && connectionStatus !== 'connected' ? (
        <View style={styles.connectionBanner}>
          <ActivityIndicator size="small" color={Colors.text.secondary} />
          <Text style={styles.connectionBannerText}>
            {connectionStatus === 'connecting' ? 'Connecting to chat…' : 'Reconnecting…'}
          </Text>
        </View>
      ) : null}

      {canChat && !loading && pinnedMessage ? (
        <View style={styles.pinnedBanner} accessibilityLabel="Pinned message">
          <Pin size={14} color={Colors.primary} />
          <View style={styles.pinnedBody}>
            <Text style={styles.pinnedLabel}>
              Pinned · {pinnedMessage.sender?.name ?? 'Host'}
            </Text>
            <Text style={styles.pinnedText} numberOfLines={2}>
              {pinnedMessage.body}
            </Text>
          </View>
          {isModerator ? (
            <TouchableOpacity
              onPress={() => {
                if (!id) return;
                void eventChatService
                  .setPin(id, null)
                  .then(async () => {
                    showNotice('Unpinned.');
                    const status = await eventChatService.getPostStatus(id).catch(() => null);
                    if (status) setPostStatus(status);
                  })
                  .catch(() => showNotice('Could not unpin.'));
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Unpin message"
            >
              <X size={16} color={Colors.text.tertiary} />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <View style={styles.listWrap}>
        <FlatList
          ref={listRef}
          data={rows}
          inverted={rows.length > 0}
          keyExtractor={(item) => item.id}
          renderItem={renderRow}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderHistoryFooter}
          contentContainerStyle={[
            styles.listContent,
            rows.length === 0 && styles.listContentEmpty,
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onScroll={handleScroll}
          scrollEventThrottle={100}
          onEndReached={hasMoreHistory ? loadOlder : undefined}
          onEndReachedThreshold={0.6}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: false });
            setTimeout(() => listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.5 }), 120);
          }}
        />
        {unseenCount === 0 && unreadJump ? (
          <TouchableOpacity
            style={[styles.unseenPill, styles.unreadJumpPill]}
            onPress={() => {
              if (scrollToRow(unreadJump.dividerId)) nearBottomRef.current = false;
              setUnreadJump(null);
            }}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`${unreadJump.count} unread messages, jump to first unread`}
          >
            <ChevronDown size={16} color={Colors.primary} style={styles.unreadJumpIcon} />
            <Text style={[styles.unseenPillText, styles.unreadJumpText]}>
              {unreadJump.count} unread · Jump to first
            </Text>
          </TouchableOpacity>
        ) : null}
        {unseenCount > 0 ? (
          <TouchableOpacity
            style={styles.unseenPill}
            onPress={() => {
              scrollToLatest(true);
              scheduleMarkRead();
            }}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`${unseenCount} new ${unseenCount === 1 ? 'message' : 'messages'}, jump to latest`}
          >
            <ChevronDown size={16} color={Colors.text.inverse} />
            <Text style={styles.unseenPillText}>
              {unseenCount} new {unseenCount === 1 ? 'message' : 'messages'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {!loading && details?.event.status === 'cancelled' ? (
        <View style={styles.lockedNotice} accessibilityRole="alert">
          <Info size={16} color={Colors.text.secondary} />
          <Text style={styles.lockedNoticeText}>
            This event was cancelled by the organizer. The chat stays open for everyone who was going.
          </Text>
        </View>
      ) : null}

      {showLockedNotice ? (
        <View style={[styles.lockedNotice, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Lock size={16} color={Colors.text.secondary} />
          <Text style={styles.lockedNoticeText}>
            Chat is locked — it reopens when at least 2 people are going.
          </Text>
        </View>
      ) : null}

      {canChat && !canPost && !loading ? (
        <View style={[styles.lockedNotice, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <ShieldAlert size={16} color={Colors.text.secondary} />
          <Text style={styles.lockedNoticeText}>
            {postStatus?.is_banned
              ? 'Your account is suspended, so you can read but not post.'
              : postStatus?.is_blocked
                ? postStatus.block_expires_at
                  ? `The host paused your posting until ${new Date(postStatus.block_expires_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}. You can still read along.`
                  : 'The host removed you from this chat. You can still read along.'
                : postStatus?.is_host
                  // Hosts get read + moderation (20261028130000/180000) but
                  // posting still requires a 'going' RSVP, per the INSERT policy.
                  ? "You're viewing as host — you can read and moderate, but only going attendees can post."
                  : postStatus?.locked
                  ? 'The host locked this chat. You can read, but new messages are paused.'
                  : details?.user_rsvp === 'going'
                  ? 'Waiting for one more attendee before the chat opens.'
                  : 'RSVP as going to join the conversation.'}
          </Text>
        </View>
      ) : null}

      {canChat && canPost ? (
        <View style={[styles.composerWrap, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {mentionSuggestions.length > 0 ? (
            <ScrollView
              horizontal
              keyboardShouldPersistTaps="always"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.mentionStrip}
            >
              {mentionSuggestions.map((attendee) => (
                <Pressable
                  key={attendee.id}
                  onPress={() => insertMention(attendee)}
                  hitSlop={2}
                  style={({ pressed }) => [styles.mentionChip, pressed && styles.pressedDim]}
                  accessibilityRole="button"
                  accessibilityLabel={`Mention ${attendee.name}`}
                >
                  <Avatar imageUrl={attendee.avatar_url} name={attendee.name} size={26} />
                  <Text style={styles.mentionChipText} numberOfLines={1}>
                    {attendee.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          <ChatComposer
            ref={composerRef}
            initialText={draftRef.current}
            maxLength={MAX_MESSAGE_LENGTH}
            counterVisibleAtRemaining={MAX_MESSAGE_LENGTH - COUNTER_VISIBLE_FROM}
            sendBlocked={slowRemaining > 0}
            statusLine={statusLine}
            statusIsNotice={!!notice}
            onChangeText={handleDraftChange}
            onBlur={stopTyping}
            onSend={handleSend}
          />
        </View>
      ) : null}

      {id ? (
        <ChatModerationSheet
          eventId={id}
          visible={moderationOpen}
          locked={postStatus?.locked ?? false}
          slowModeSeconds={postStatus?.slow_mode_seconds ?? 0}
          onClose={() => setModerationOpen(false)}
          onNotice={showNotice}
          onUpdateSettings={handleUpdateSettings}
        />
      ) : null}

      <ReportReasonSheet
        visible={reportUserTarget != null}
        title={reportUserTarget ? `Report ${reportUserTarget.name}` : 'Report'}
        description="Tell us what's wrong. A moderator will review it; they aren't told who reported."
        reasons={CHAT_REPORT_REASONS}
        onClose={() => setReportUserTarget(null)}
        onSubmit={(reason) => void submitUserReport(reason)}
      />
      <ChatMessageActionsSheet
        target={actionTarget}
        onClose={() => setActionTarget(null)}
        onCopy={handleCopy}
        onReport={(target, reason) => void handleReport(target, reason)}
        onDelete={(target) => void handleDelete(target)}
        onRestore={(target) => void handleRestore(target)}
        onBlockUser={(target, minutes) => void handleBlockUser(target, minutes)}
        onViewProfile={handleViewProfile}
        onToggleGlobalBlock={(target) => void handleToggleGlobalBlock(target)}
        onReportUser={handleReportUser}
        onRetry={handleRetry}
        onDiscard={handleDiscard}
        onTogglePin={(target) => void handleTogglePin(target)}
        pinnedMessageId={pinnedId}
      />
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
    paddingBottom: Spacing.sm + 4,
    backgroundColor: Colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border.light,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.round,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background.secondary,
  },
  headerTextWrap: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: Spacing.xs,
  },
  headerTitle: {
    fontSize: Typography.sizes.lg,
    lineHeight: 22,
    color: Colors.text.primary,
    fontFamily: Typography.displayFontFamilies.bold,
  },
  headerSubtitle: {
    marginTop: 1,
    fontSize: Typography.sizes.xs,
    lineHeight: 16,
    color: Colors.text.secondary,
    fontFamily: Typography.labelFontFamilies.medium,
  },
  pinnedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: alpha(Colors.primary, 0.2),
  },
  pinnedBody: {
    flex: 1,
  },
  pinnedLabel: {
    fontSize: Typography.sizes.xxs,
    fontFamily: Typography.labelFontFamilies.semibold,
    color: Colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  pinnedText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.primary,
    lineHeight: 18,
  },
  connectionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: 6,
    backgroundColor: Colors.background.secondary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border.light,
  },
  connectionBannerText: {
    fontSize: Typography.sizes.xs,
    color: Colors.text.secondary,
    fontFamily: Typography.labelFontFamilies.medium,
  },
  listWrap: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
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
    lineHeight: 24,
    color: Colors.text.primary,
    fontFamily: Typography.displayFontFamilies.semibold,
    textAlign: 'center',
  },
  centerText: {
    marginTop: Spacing.sm,
    fontSize: Typography.sizes.sm,
    lineHeight: 20,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.regular,
    textAlign: 'center',
  },
  primaryButton: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    height: 44,
    justifyContent: 'center',
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.primary,
  },
  primaryButtonText: {
    color: Colors.text.inverse,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
  },
  historyFooter: {
    alignItems: 'center',
    paddingVertical: Spacing.md,
  },
  historyFooterText: {
    fontSize: Typography.sizes.xs,
    color: Colors.text.tertiary,
    fontFamily: Typography.labelFontFamilies.medium,
  },
  unreadJumpPill: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  unreadJumpIcon: {
    transform: [{ rotate: '180deg' }],
  },
  unreadJumpText: {
    color: Colors.primary,
  },
  mentionStrip: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    paddingBottom: Spacing.xs,
  },
  mentionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingLeft: 5,
    paddingRight: 12,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.background.secondary,
  },
  pressedDim: {
    opacity: 0.85,
  },
  mentionChipText: {
    maxWidth: 140,
    fontSize: Typography.sizes.sm,
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.medium,
  },
  unseenPill: {
    position: 'absolute',
    bottom: Spacing.md,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: Spacing.sm,
    paddingRight: Spacing.md,
    height: 34,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.primary,
    ...Shadows.md,
  },
  unseenPillText: {
    color: Colors.text.inverse,
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  lockedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm + 4,
    backgroundColor: Colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border.light,
  },
  lockedNoticeText: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    lineHeight: 20,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.regular,
  },
  composerWrap: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xs,
    backgroundColor: Colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border.light,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
});
