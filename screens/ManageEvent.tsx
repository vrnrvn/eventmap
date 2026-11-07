import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  CalendarX,
  Clock,
  ExternalLink,
  Lock,
  MapPin,
  Megaphone,
  MessageCircle,
  Pencil,
  ListOrdered,
  Copy,
  EyeOff,
  PauseCircle,
  CalendarClock,
  Check,
  Upload,
  Minus,
  Plus,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  Ticket,
  Timer,
  UserMinus,
  UserPlus,
  Users,
  X,
} from '@/components/icons.generated';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { eventsService } from '@/services/events';
import { businessesService } from '@/services/businesses';
import {
  eventChatService,
  CHAT_SLOW_MODE_OPTIONS,
  type ChatMode,
  type ChatSlowModeSeconds,
} from '@/services/eventChat';
import {
  hostToolsService,
  HostToolsUnavailableError,
  isCapacityBelowAttendanceError,
  type HostAttendee,
  type HostAttendeeStatus,
} from '@/services/hostTools';
import type { WaitlistMode } from '@/types/database';
import { queryKeys } from '@/hooks/queryKeys';
import { useRefetchOnFocus } from '@/hooks/useRefetchOnFocus';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { SettingsSection } from '@/components/ui/SettingsSection';
import { SettingsRow } from '@/components/ui/SettingsRow';
import { ErrorState } from '@/components/ui/ErrorState';
import { Avatar } from '@/components/Avatar';
import { ChatModerationSheet } from '@/components/ChatModerationSheet';
import { confirmAction } from '@/utils/confirm';
import { notify } from '@/utils/notify';
import { classifyRsvpError } from '@/utils/rsvpErrors';
import { formatEventDate, formatEventWhen } from '@/utils/formatEventWhen';
import { describeEventTime, formatInZone, getDeviceTimeZone, isValidTimeZone } from '@/utils/timezone';
import { getNextOccurrences } from '@/utils/recurrence';
import {
  formatSecondaryCounts,
  getHostActions,
  getHostEventPhase,
  HOST_PHASE_BADGE,
  summarizeCapacity,
} from '@/utils/hostEvent';
import { alpha, BorderRadius, Colors, Spacing, Typography } from '@/constants/theme';

type Tab = 'overview' | 'attendees' | 'settings' | 'chat';
const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'attendees', label: 'Attendees' },
  { value: 'settings', label: 'Settings' },
  { value: 'chat', label: 'Chat' },
] as const satisfies readonly { value: Tab; label: string }[];

const ANNOUNCEMENT_DAILY_LIMIT = 3;
const ANNOUNCEMENT_MAX_CHARS = 500;

const WAITLIST_MODES: { value: WaitlistMode; label: string; hint: string }[] = [
  { value: 'off', label: 'Off', hint: 'Full means full' },
  { value: 'notify', label: 'Notify', hint: 'Tell the next in line when a seat frees' },
  { value: 'auto', label: 'Auto', hint: 'Move the next in line straight to going' },
];

const ATTENDEE_PAGE = 30;

const badgeTones = {
  danger: { bg: Colors.errorSoft, fg: Colors.error },
  success: { bg: Colors.successSoft, fg: Colors.successText },
  primary: { bg: Colors.primarySoft, fg: Colors.primary },
  neutral: { bg: Colors.neutralSoft, fg: Colors.text.secondary },
} as const;

function slowModeLabel(seconds: number): string {
  if (seconds === 0) return 'Off';
  if (seconds < 60) return `${seconds}s`;
  return `${seconds / 60}m`;
}

type AttendeeAction = 'approve' | 'decline' | 'promote' | 'unban' | 'remove';

/**
 * One attendee row, memoized: any screen state change (a form field, the
 * busy id, a refetch) used to re-render every visible row. Props are plain
 * values plus one stable `onAction` dispatcher.
 */
const AttendeeRow = memo(function AttendeeRow({
  item,
  index,
  busy,
  canManageAttendees,
  showLinePosition,
  onAction,
}: {
  item: HostAttendee;
  index: number;
  busy: boolean;
  canManageAttendees: boolean;
  showLinePosition: boolean;
  onAction: (action: AttendeeAction, item: HostAttendee) => void;
}) {
    const manageable = item.can_manage && canManageAttendees;
    const removable = manageable && (item.status === 'going' || item.status === 'interested');
    const promotable = manageable && item.status === 'waitlist';
    const restorable = manageable && item.status === 'removed';
    const reviewable = manageable && item.status === 'requested';
    const metaParts: string[] = [];
    // Position only makes sense against the full, unfiltered line.
    if (item.status === 'waitlist' && showLinePosition) metaParts.push(`#${index + 1} in line`);
    if (item.status === 'requested') metaParts.push('Wants to join');
    if (item.status === 'removed') {
      metaParts.push(item.joined_at ? `Removed ${formatEventWhen(item.joined_at)}` : 'Removed');
      if (item.reason) metaParts.push(item.reason);
    } else if (item.joined_at) {
      metaParts.push(`Joined ${formatEventWhen(item.joined_at)}`);
    }
    if (item.chat_blocked) metaParts.push('Blocked from chat');
    // Private profiles: the server already reduced the name to "First L." and
    // dropped avatar/bio; their public profile page is private too, so don't
    // offer a tap that only leads to a "Private Profile" placeholder.
    const canOpenProfile = item.can_manage && !item.is_private;
    return (
      <View style={styles.attendeeRow}>
        <TouchableOpacity
          style={styles.attendeeMain}
          disabled={!canOpenProfile}
          onPress={() => router.push(`/user/${item.user_id}` as never)}
          activeOpacity={0.7}
          accessibilityRole={canOpenProfile ? 'button' : 'text'}
          accessibilityLabel={
            canOpenProfile ? `View ${item.name}'s profile` : `${item.name}, private profile`
          }
        >
          <Avatar imageUrl={item.avatar_url} name={item.name} size={40} />
          <View style={styles.attendeeText}>
            <View style={styles.attendeeNameRow}>
              <Text style={styles.attendeeName} numberOfLines={1}>
                {item.name}
              </Text>
              {item.is_private ? (
                <View style={styles.privateTag}>
                  <Text style={styles.privateTagText}>Private</Text>
                </View>
              ) : null}
            </View>
            {metaParts.length ? (
              <Text style={styles.attendeeMeta} numberOfLines={1}>
                {metaParts.join(' · ')}
              </Text>
            ) : null}
          </View>
        </TouchableOpacity>
        {reviewable ? (
          <>
            <TouchableOpacity
              style={[styles.rowActionBtn, styles.promoteBtn]}
              onPress={() => onAction('approve', item)}
              disabled={busy}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Approve ${item.name}'s request`}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              {busy ? (
                <ActivityIndicator size="small" color={Colors.successText} />
              ) : (
                <Check size={18} color={Colors.successText} />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.rowActionBtn, styles.removeBtn]}
              onPress={() => onAction('decline', item)}
              disabled={busy}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Decline ${item.name}'s request`}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <X size={18} color={Colors.error} />
            </TouchableOpacity>
          </>
        ) : null}
        {promotable ? (
          <TouchableOpacity
            style={[styles.rowActionBtn, styles.promoteBtn]}
            onPress={() => onAction('promote', item)}
            disabled={busy}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Move ${item.name} to going`}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            {busy ? (
              <ActivityIndicator size="small" color={Colors.successText} />
            ) : (
              <UserPlus size={18} color={Colors.successText} />
            )}
          </TouchableOpacity>
        ) : null}
        {restorable ? (
          <TouchableOpacity
            style={[styles.rowActionBtn, styles.restoreBtn]}
            onPress={() => onAction('unban', item)}
            disabled={busy}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Allow ${item.name} back into the event`}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            {busy ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <RotateCcw size={18} color={Colors.primary} />
            )}
          </TouchableOpacity>
        ) : null}
        {removable ? (
          <TouchableOpacity
            style={[styles.rowActionBtn, styles.removeBtn]}
            onPress={() => onAction('remove', item)}
            disabled={busy}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.name} from the event`}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            {busy ? (
              <ActivityIndicator size="small" color={Colors.error} />
            ) : (
              <UserMinus size={18} color={Colors.error} />
            )}
          </TouchableOpacity>
        ) : null}
      </View>
    );
  });

const attendeeKey = (item: HostAttendee) => item.user_id;

/**
 * Host-only hub for one event: counts and quick actions, the attendee list
 * with host actions, and chat controls. Replaces the actions scattered across
 * My Events, Event Detail and the chat screen (docs/HOST_TOOLS_PLAN.md §4A).
 */
export default function ManageEvent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userBusiness } = useApp();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');

  // ── Event + counts ────────────────────────────────────────────────────────
  const detailsQuery = useQuery({
    // Same RPC and key as EventDetail: one fetch serves both screens, and the
    // copy stays on the device for offline opening (persisted prefix).
    queryKey: queryKeys.eventDetails(id ?? ''),
    queryFn: () => eventsService.getEventDetails(id!),
    enabled: !!id,
  });
  const details = detailsQuery.data ?? null;
  const event = details?.event ?? null;

  const isOwner = !!(event && userBusiness && event.business_id === userBusiness.id);
  const isAdmin = !!profile?.is_admin;
  const canManage = isOwner || isAdmin;

  const overviewQuery = useQuery({
    queryKey: ['host', 'event', id, 'overview'],
    queryFn: () => hostToolsService.getOverview(id!, details),
    enabled: !!id && canManage,
  });
  const overview = overviewQuery.data ?? null;

  const chatStatusQuery = useQuery({
    queryKey: ['host', 'event', id, 'chat-status'],
    queryFn: () => eventChatService.getPostStatus(id!),
    enabled: !!id && canManage,
  });
  const chatStatus = chatStatusQuery.data ?? null;

  // Depend on the stable `refetch` functions, not the query result objects:
  // `useQuery` returns a new object every render, which would give this
  // callback a new identity each render (and previously re-triggered the
  // focus refetch in a loop).
  const refetchDetails = detailsQuery.refetch;
  const refetchOverview = overviewQuery.refetch;
  const refetchChatStatus = chatStatusQuery.refetch;
  const refetchAll = useCallback(() => {
    void refetchDetails({ cancelRefetch: false });
    // `refetch()` bypasses `enabled`, so keep the host-only queries gated here
    // too (a non-owner on this screen must not hit the host RPCs).
    if (!canManage) return;
    void refetchOverview({ cancelRefetch: false });
    void refetchChatStatus({ cancelRefetch: false });
  }, [refetchDetails, refetchOverview, refetchChatStatus, canManage]);
  useRefetchOnFocus(refetchAll, !!id);

  const phase = event ? getHostEventPhase(event) : 'upcoming';
  const actions = getHostActions(phase);
  const badge = HOST_PHASE_BADGE[phase];
  const tone = badgeTones[badge.tone];

  const nextStart = useMemo(() => {
    if (!event) return null;
    if (event.is_recurring && phase !== 'ended' && phase !== 'cancelled') {
      return getNextOccurrences(event, 1)[0]?.toISOString() ?? event.start_datetime;
    }
    return event.start_datetime;
  }, [event, phase]);

  const going = overview?.going ?? details?.rsvp_count ?? 0;
  const capacity = summarizeCapacity(going, event?.max_attendees);

  // ── Attendees tab ─────────────────────────────────────────────────────────
  const [attendeeStatus, setAttendeeStatus] = useState<HostAttendeeStatus>('going');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [attendees, setAttendees] = useState<HostAttendee[]>([]);
  const [attendeeTotal, setAttendeeTotal] = useState(0);
  const [attendeeHasMore, setAttendeeHasMore] = useState(false);
  const [attendeeSource, setAttendeeSource] = useState<'host_rpc' | 'public_fallback' | null>(null);
  const [attendeesLoading, setAttendeesLoading] = useState(false);
  const [attendeesError, setAttendeesError] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  // Drop responses from a superseded load (segment/search switched mid-flight),
  // same pattern as MyEvents' requestSeq.
  const attendeeReqSeq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadAttendees = useCallback(
    async (offset: number) => {
      if (!id) return;
      const seq = ++attendeeReqSeq.current;
      setAttendeesLoading(true);
      setAttendeesError(false);
      try {
        const page = await hostToolsService.getAttendeesPage(id, {
          status: attendeeStatus,
          limit: ATTENDEE_PAGE,
          offset,
          search: debouncedSearch,
        });
        if (seq !== attendeeReqSeq.current) return;
        setAttendees((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
        setAttendeeTotal(page.total);
        setAttendeeHasMore(page.has_more);
        setAttendeeSource(page.source);
      } catch {
        if (seq !== attendeeReqSeq.current) return;
        setAttendeesError(true);
      } finally {
        if (seq === attendeeReqSeq.current) setAttendeesLoading(false);
      }
    },
    [id, attendeeStatus, debouncedSearch]
  );

  useEffect(() => {
    if (tab === 'attendees' && canManage) void loadAttendees(0);
  }, [tab, canManage, loadAttendees]);

  const handleRemoveAttendee = useCallback(
    async (attendee: HostAttendee) => {
      if (!id || removingId) return;
      const ok = await confirmAction({
        title: 'Remove attendee',
        message: `Remove ${attendee.name} from this event? Their RSVP is dropped, they're blocked from the chat and from rejoining, and they'll be notified. You can allow them back later from the Removed list.`,
        confirmLabel: 'Remove',
        destructive: true,
      });
      if (!ok) return;
      setRemovingId(attendee.user_id);
      try {
        await hostToolsService.removeAttendee(id, attendee.user_id);
        setAttendees((prev) => prev.filter((a) => a.user_id !== attendee.user_id));
        setAttendeeTotal((t) => Math.max(0, t - 1));
        notify.success(`${attendee.name} was removed.`);
        void overviewQuery.refetch();
        void detailsQuery.refetch();
        queryKeys.markAttendanceListsStale(queryClient);
      } catch (err) {
        notify.error(
          err instanceof HostToolsUnavailableError
            ? err.message
            : 'Could not remove this attendee. Please try again.'
        );
      } finally {
        setRemovingId(null);
      }
    },
    [id, removingId, overviewQuery, detailsQuery, queryClient]
  );

  const handleUnbanAttendee = useCallback(
    async (attendee: HostAttendee) => {
      if (!id || removingId) return;
      const ok = await confirmAction({
        title: 'Allow back',
        message: `Let ${attendee.name} join this event again? This also lifts their chat block. They will need to RSVP themselves.`,
        confirmLabel: 'Allow back',
      });
      if (!ok) return;
      setRemovingId(attendee.user_id);
      try {
        await hostToolsService.unbanAttendee(id, attendee.user_id);
        setAttendees((prev) => prev.filter((a) => a.user_id !== attendee.user_id));
        setAttendeeTotal((t) => Math.max(0, t - 1));
        notify.success(`${attendee.name} can join again.`);
        void overviewQuery.refetch();
      } catch (err) {
        notify.error(
          err instanceof HostToolsUnavailableError ? err.message : 'Could not lift the removal. Please try again.'
        );
      } finally {
        setRemovingId(null);
      }
    },
    [id, removingId, overviewQuery]
  );

  const handleReviewRequest = useCallback(
    async (attendee: HostAttendee, decision: 'approve' | 'decline') => {
      if (!id || removingId) return;
      const ok = await confirmAction({
        title: decision === 'approve' ? 'Approve request' : 'Decline request',
        message:
          decision === 'approve'
            ? `Let ${attendee.name} join? They take a spot and are told they're in.`
            : `Decline ${attendee.name}'s request? They're notified politely and can request again.`,
        confirmLabel: decision === 'approve' ? 'Approve' : 'Decline',
        destructive: decision === 'decline',
      });
      if (!ok) return;
      setRemovingId(attendee.user_id);
      try {
        await hostToolsService.reviewRsvp(id, attendee.user_id, decision);
        setAttendees((prev) => prev.filter((a) => a.user_id !== attendee.user_id));
        setAttendeeTotal((t) => Math.max(0, t - 1));
        notify.success(decision === 'approve' ? `${attendee.name} is in.` : 'Request declined.');
        void overviewQuery.refetch();
        void detailsQuery.refetch();
      } catch (err) {
        const code = classifyRsvpError(err);
        notify.error(
          err instanceof HostToolsUnavailableError
            ? err.message
            : code === 'EVENT_FULL'
              ? 'The event is full. Raise the capacity in Settings first.'
              : /not_requested/i.test(String((err as { message?: string })?.message ?? ''))
                ? `${attendee.name} already withdrew the request.`
                : 'Could not review this request. Please try again.'
        );
        void loadAttendees(0);
      } finally {
        setRemovingId(null);
      }
    },
    [id, removingId, overviewQuery, detailsQuery, loadAttendees]
  );

  const handlePromoteAttendee = useCallback(
    async (attendee: HostAttendee) => {
      if (!id || removingId) return;
      const ok = await confirmAction({
        title: 'Move to going',
        message: `Give ${attendee.name} a spot? They skip the rest of the waitlist and get a notification that they're in.`,
        confirmLabel: 'Move to going',
      });
      if (!ok) return;
      setRemovingId(attendee.user_id);
      try {
        await hostToolsService.promoteFromWaitlist(id, attendee.user_id);
        setAttendees((prev) => prev.filter((a) => a.user_id !== attendee.user_id));
        setAttendeeTotal((t) => Math.max(0, t - 1));
        notify.success(`${attendee.name} is now going.`);
        void overviewQuery.refetch();
        void detailsQuery.refetch();
        queryKeys.markAttendanceListsStale(queryClient);
      } catch (err) {
        if (err instanceof HostToolsUnavailableError) {
          notify.error(err.message);
          return;
        }
        const code = classifyRsvpError(err);
        notify.error(
          code === 'EVENT_FULL'
            ? 'The event is full. Raise the capacity in Edit details first.'
            : code === 'EVENT_CLOSED'
              ? 'This event is no longer accepting attendees.'
              : /not_on_waitlist/i.test(String((err as { message?: string })?.message ?? ''))
                ? `${attendee.name} already left the waitlist.`
                : 'Could not move this person to going. Please try again.'
        );
        void loadAttendees(0);
      } finally {
        setRemovingId(null);
      }
    },
    [id, removingId, overviewQuery, detailsQuery, queryClient, loadAttendees]
  );

  // ── Settings tab ──────────────────────────────────────────────────────────
  // Columns exist only once 20261103130000 is applied; get_event_details
  // returns the whole row, so their absence tells us the migration is missing.
  const settingsAvailable = event ? event.rsvp_closed !== undefined : false;
  const [savingSettings, setSavingSettings] = useState(false);
  const [capacityDraft, setCapacityDraft] = useState<string>('');
  const [capacityDirty, setCapacityDirty] = useState(false);

  useEffect(() => {
    if (!event || capacityDirty) return;
    setCapacityDraft(event.max_attendees != null ? String(event.max_attendees) : '');
  }, [event, capacityDirty]);

  const applySettings = useCallback(
    async (
      settings: { rsvpClosed?: boolean; waitlistMode?: WaitlistMode; rsvpMode?: 'open' | 'approval' },
      successText: string
    ) => {
      if (!id) return;
      setSavingSettings(true);
      try {
        await hostToolsService.setEventSettings(id, settings);
        notify.success(successText);
        await detailsQuery.refetch();
        void overviewQuery.refetch();
      } catch (err) {
        notify.error(
          err instanceof HostToolsUnavailableError ? err.message : 'Could not update the setting. Please try again.'
        );
      } finally {
        setSavingSettings(false);
      }
    },
    [id, detailsQuery, overviewQuery]
  );

  const handleSaveCapacity = useCallback(async () => {
    if (!id || !event) return;
    const trimmed = capacityDraft.trim();
    const next = trimmed === '' ? null : Number(trimmed);
    if (next !== null && (!Number.isInteger(next) || next <= 0)) {
      notify.error('Enter a whole number greater than 0, or leave it empty for unlimited.');
      return;
    }
    if (next !== null && next < going) {
      const ok = await confirmAction({
        title: 'Cap below current attendance',
        message: `${going} people are already going. Lowering the limit to ${next} keeps them in but blocks new joins. Continue?`,
        confirmLabel: 'Set limit',
        cancelLabel: 'Keep editing',
      });
      if (!ok) return;
    }
    setSavingSettings(true);
    try {
      await hostToolsService.setCapacity(id, next);
      setCapacityDirty(false);
      notify.success(next === null ? 'Capacity removed.' : `Capacity set to ${next}.`);
      await detailsQuery.refetch();
      void overviewQuery.refetch();
    } catch (err) {
      notify.error(
        isCapacityBelowAttendanceError(err)
          ? 'More people are going than the new limit allows. Reload and confirm again.'
          : 'Could not update the capacity. Please try again.'
      );
    } finally {
      setSavingSettings(false);
    }
  }, [id, event, capacityDraft, going, detailsQuery, overviewQuery]);

  const stepCapacity = (delta: number) => {
    const current = capacityDraft.trim() === '' ? Math.max(going, 0) : Number(capacityDraft);
    const next = Math.max(1, (Number.isFinite(current) ? current : 0) + delta);
    setCapacityDraft(String(next));
    setCapacityDirty(true);
  };

  // ── Announce ──────────────────────────────────────────────────────────────
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [announceBody, setAnnounceBody] = useState('');
  const [announceAudience, setAnnounceAudience] = useState<'going' | 'all'>('going');
  const [sendingAnnouncement, setSendingAnnouncement] = useState(false);
  const announcementsLeft =
    overview?.announcements_today === null || overview?.announcements_today === undefined
      ? null
      : Math.max(0, ANNOUNCEMENT_DAILY_LIMIT - overview.announcements_today);

  const handleSendAnnouncement = useCallback(async () => {
    if (!id) return;
    const body = announceBody.trim();
    if (!body) return;
    const audienceCount =
      announceAudience === 'going'
        ? going
        : going + (overview?.interested ?? 0) + (overview?.requested ?? 0);
    const ok = await confirmAction({
      title: 'Send announcement',
      message: `Send this to ${audienceCount} ${audienceCount === 1 ? 'person' : 'people'} as an in-app notification and post it in the chat?`,
      confirmLabel: 'Send',
    });
    if (!ok) return;
    setSendingAnnouncement(true);
    try {
      const result = await hostToolsService.sendAnnouncement(id, body, announceAudience);
      setAnnounceOpen(false);
      setAnnounceBody('');
      notify.success(
        result.recipients === 0
          ? 'Announcement posted in the chat. Nobody is subscribed to announcements yet.'
          : `Announcement sent to ${result.recipients} ${result.recipients === 1 ? 'person' : 'people'}.`
      );
      void overviewQuery.refetch();
    } catch (err) {
      const message = String((err as { message?: string })?.message ?? '');
      notify.error(
        err instanceof HostToolsUnavailableError
          ? err.message
          : /announcement_limit/i.test(message)
            ? `You can send ${ANNOUNCEMENT_DAILY_LIMIT} announcements per event per day.`
            : 'Could not send the announcement. Please try again.'
      );
    } finally {
      setSendingAnnouncement(false);
    }
  }, [id, announceBody, announceAudience, going, overview, overviewQuery]);

  // ── Chat tab ──────────────────────────────────────────────────────────────
  const [moderationOpen, setModerationOpen] = useState(false);
  const [savingChat, setSavingChat] = useState(false);

  const updateChatMode = useCallback(
    async (settings: { mode?: ChatMode; openPolicy?: 'two_going' | 'any_going' }) => {
      if (!id) return;
      setSavingChat(true);
      try {
        await eventChatService.setMode(id, settings);
        await chatStatusQuery.refetch();
        void overviewQuery.refetch();
      } catch (err) {
        notify.error(err instanceof Error ? err.message : 'Could not update chat settings.');
      } finally {
        setSavingChat(false);
      }
    },
    [id, chatStatusQuery, overviewQuery]
  );

  const updateChatSettings = useCallback(
    async (settings: { locked?: boolean; slowModeSeconds?: ChatSlowModeSeconds }) => {
      if (!id) return;
      setSavingChat(true);
      try {
        await eventChatService.setSettings(id, settings);
        await chatStatusQuery.refetch();
        void overviewQuery.refetch();
      } catch {
        notify.error('Could not update chat settings.');
        throw new Error('chat settings failed');
      } finally {
        setSavingChat(false);
      }
    },
    [id, chatStatusQuery, overviewQuery]
  );

  // ── Lifecycle actions ─────────────────────────────────────────────────────
  const handleCancelEvent = useCallback(async () => {
    if (!id || !event) return;
    const ok = await confirmAction({
      title: 'Cancel event',
      message:
        'Cancel this event? Attendees will be notified and the event will no longer be visible to the public. This cannot be undone.',
      cancelLabel: 'Keep event',
      confirmLabel: 'Cancel event',
      destructive: true,
    });
    if (!ok) return;
    try {
      await eventsService.cancelEvent(id);
      notify.success('Event cancelled. Attendees have been notified.');
      refetchAll();
    } catch {
      notify.error('Failed to cancel event');
    }
  }, [id, event, refetchAll]);

  const handleNotifyFollowers = useCallback(async () => {
    if (!id || !event) return;
    const ok = await confirmAction({
      title: 'Notify followers',
      message: `Send your followers an in-app notification about "${event.title}"? Followers who were already notified won't get a duplicate.`,
      confirmLabel: 'Notify',
    });
    if (!ok) return;
    try {
      await businessesService.notifyFollowersAboutEvent(id);
      notify.success('Followers notified.');
    } catch {
      notify.error('Failed to notify followers');
    }
  }, [id, event]);

  const handlePublish = useCallback(async () => {
    if (!id || !event) return;
    const ok = await confirmAction({
      title: 'Publish event',
      message:
        'Publish this draft? It becomes visible, counts toward your monthly events, and your followers are notified.',
      confirmLabel: 'Publish',
    });
    if (!ok) return;
    try {
      const result = await hostToolsService.publishEvent(id);
      notify.success(
        result.notified > 0 ? `Published. ${result.notified} followers notified.` : 'Published.'
      );
      refetchAll();
      queryKeys.markAttendanceListsStale(queryClient);
    } catch (err) {
      const msg = String((err as { message?: string })?.message ?? '');
      notify.error(
        err instanceof HostToolsUnavailableError
          ? err.message
          : /limit reached/i.test(msg)
            ? 'You have reached this month’s event limit. Upgrade to publish more.'
            : /already over/i.test(msg)
              ? 'This draft’s date is in the past. Edit the date first.'
              : 'Could not publish. Please try again.'
      );
    }
  }, [id, event, refetchAll, queryClient]);

  const handlePostpone = useCallback(async () => {
    if (!id || !event) return;
    const ok = await confirmAction({
      title: 'Postpone event',
      message:
        'Mark this event as postponed? Everyone keeps their RSVP, nobody new can join, and attendees, interested users, savers and the waitlist are told a new date is coming. Set the new date later from Edit details.',
      confirmLabel: 'Postpone',
      destructive: true,
    });
    if (!ok) return;
    try {
      const result = await hostToolsService.postponeEvent(id);
      notify.success(result.notified > 0 ? `Postponed. ${result.notified} people notified.` : 'Postponed.');
      refetchAll();
    } catch (err) {
      notify.error(err instanceof HostToolsUnavailableError ? err.message : 'Could not postpone. Please try again.');
    }
  }, [id, event, refetchAll]);

  const handleDuplicate = useCallback(async () => {
    if (!id || !event) return;
    const ok = await confirmAction({
      title: 'Duplicate event',
      message: 'Create a draft copy with the same details, links and photos, dated a week later? You can edit it before publishing.',
      confirmLabel: 'Duplicate',
    });
    if (!ok) return;
    try {
      const newId = await hostToolsService.duplicateEvent(id);
      notify.success('Draft created.');
      router.push(`/business/edit-event/${newId}` as never);
    } catch (err) {
      notify.error(err instanceof HostToolsUnavailableError ? err.message : 'Could not duplicate. Please try again.');
    }
  }, [id, event]);

  const handleToggleUnlisted = useCallback(
    async (unlisted: boolean) => {
      if (!id) return;
      setSavingSettings(true);
      try {
        await eventsService.updateEvent(id, { visibility: unlisted ? 'unlisted' : 'public' });
        notify.success(unlisted ? 'Now unlisted: only people with the link can find it.' : 'Now listed in Discover and search.');
        await detailsQuery.refetch();
      } catch {
        notify.error('Could not change visibility. This may need a database update.');
      } finally {
        setSavingSettings(false);
      }
    },
    [id, detailsQuery]
  );

  // ── Render helpers ────────────────────────────────────────────────────────
  const renderOverview = () => {
    if (!event) return null;
    const counts = {
      going,
      interested: overview?.interested ?? null,
      waitlist: overview?.waitlist ?? details?.waitlist?.count ?? null,
      saves: overview?.saves ?? details?.save_count ?? 0,
    };
    const limited = overview?.source === 'details_fallback';
    return (
      <View style={styles.tabBody}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroTitleRow}>
            <Text style={styles.heroTitle} numberOfLines={2}>
              {event.title}
            </Text>
            <View style={[styles.badge, { backgroundColor: tone.bg }]}>
              <Text style={[styles.badgeText, { color: tone.fg }]}>{badge.label}</Text>
            </View>
          </View>
          {nextStart ? (
            <View style={styles.heroMetaRow}>
              <Clock size={14} color={Colors.text.tertiary} />
              <Text style={styles.heroMeta}>
                {(() => {
                  // Hosts think in the event's own zone; add the viewer reading
                  // only when it differs (a host travelling).
                  const tz = event.timezone && isValidTimeZone(event.timezone) ? event.timezone : null;
                  if (!tz) return event.is_recurring ? `Next: ${formatEventWhen(nextStart)}` : formatEventDate(nextStart);
                  const when = describeEventTime(nextStart, tz, getDeviceTimeZone());
                  const day = formatInZone(new Date(nextStart), tz, { weekday: 'short', month: 'short', day: 'numeric' });
                  return `${event.is_recurring ? 'Next: ' : ''}${day} · ${when.primary}${when.secondary ? ` (${when.secondary})` : ''}`;
                })()}
              </Text>
            </View>
          ) : null}
          <View style={styles.heroMetaRow}>
            <MapPin size={14} color={Colors.text.tertiary} />
            <Text style={styles.heroMeta} numberOfLines={1}>
              {event.address}
            </Text>
          </View>
        </View>

        {/* Attendance */}
        <SettingsSection title="Attendance" separators={false}>
          <View style={styles.capacityCard}>
            <View style={styles.capacityRow}>
              <Text style={styles.capacityLabel}>{capacity.label}</Text>
              {capacity.spotsLeft !== null ? (
                <Text style={[styles.capacityHint, capacity.isFull && styles.capacityFull]}>
                  {capacity.isFull ? 'Full' : `${capacity.spotsLeft} left`}
                </Text>
              ) : (
                <Text style={styles.capacityHint}>Unlimited</Text>
              )}
            </View>
            {capacity.ratio !== null ? (
              <View style={styles.progressTrack} accessibilityRole="progressbar">
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.round(capacity.ratio * 100)}%` },
                    capacity.isFull && styles.progressFull,
                  ]}
                />
              </View>
            ) : null}
            <Text style={styles.secondaryCounts}>{formatSecondaryCounts(counts)}</Text>
            {overview?.views_total !== null && overview?.views_total !== undefined ? (
              <Text style={styles.secondaryCounts}>
                {overview.views_total} views · {overview.views_7d ?? 0} this week
              </Text>
            ) : null}
            {limited ? (
              <Text style={styles.limitedNote}>
                Interested and view counts need a database update that has not been applied yet.
              </Text>
            ) : null}
          </View>
        </SettingsSection>

        {actions.canPublish ? (
          <SettingsSection
            title="Draft"
            footer="Drafts are visible only to you and do not count toward your monthly events until published."
          >
            <SettingsRow
              icon={<Upload size={16} color={Colors.primary} />}
              title="Publish"
              description="Make it visible and notify your followers"
              onPress={() => void handlePublish()}
            />
          </SettingsSection>
        ) : null}

        {/* Quick actions */}
        <SettingsSection title="Manage">
          {actions.canEdit ? (
            <SettingsRow
              icon={<Pencil size={16} color={Colors.primary} />}
              title="Edit details"
              description="Title, time, place, capacity, photos and links"
              onPress={() => router.push(`/business/edit-event/${event.id}` as never)}
            />
          ) : null}
          {actions.canEdit ? (
            <SettingsRow
              icon={<Send size={16} color={Colors.primary} />}
              title="Announce to attendees"
              description="In-app notification plus a post in the chat"
              value={announcementsLeft !== null ? `${announcementsLeft} left today` : undefined}
              onPress={() => setAnnounceOpen(true)}
              disabled={announcementsLeft === 0}
            />
          ) : null}
          {actions.canNotifyFollowers ? (
            <SettingsRow
              icon={<Megaphone size={16} color={Colors.primary} />}
              title="Notify followers"
              description="One in-app notification per follower, never duplicated"
              onPress={handleNotifyFollowers}
            />
          ) : null}
          <SettingsRow
            icon={<BarChart3 size={16} color={Colors.primary} />}
            title="Insights"
            description="Reach, saves and RSVPs"
            onPress={() => router.push(`/business/event-insights/${event.id}` as never)}
          />
          <SettingsRow
            icon={<ExternalLink size={16} color={Colors.primary} />}
            title={phase === 'draft' ? 'Preview page' : 'View public page'}
            description="See the event the way attendees do"
            onPress={() => router.push(`/event/${event.id}` as never)}
          />
          {actions.canDuplicate ? (
            <SettingsRow
              icon={<Copy size={16} color={Colors.primary} />}
              title="Duplicate"
              description="New draft with the same details, a week later"
              onPress={() => void handleDuplicate()}
            />
          ) : null}
        </SettingsSection>

        {actions.canReschedule || actions.canPostpone ? (
          <SettingsSection
            title="Schedule"
            footer={
              phase === 'postponed'
                ? 'Setting a new date reopens joining and tells everyone the event is back on.'
                : 'Changing the time or place once people are going sends them one "rescheduled" notice. Postponing pauses the event without a date.'
            }
          >
            {actions.canReschedule ? (
              <SettingsRow
                icon={<CalendarClock size={16} color={Colors.primary} />}
                title={phase === 'postponed' ? 'Set the new date' : 'Reschedule'}
                description={phase === 'postponed' ? 'Resume with a new time or place' : 'Move to a new time or place'}
                onPress={() => router.push(`/business/edit-event/${event.id}` as never)}
              />
            ) : null}
            {actions.canPostpone ? (
              <SettingsRow
                icon={<PauseCircle size={16} color={Colors.warningText} />}
                iconBackground={Colors.warningSoft}
                title="Postpone"
                description="Pause without a date; RSVPs are kept"
                onPress={() => void handlePostpone()}
              />
            ) : null}
          </SettingsSection>
        ) : null}

        {actions.canCancel ? (
          <SettingsSection footer="Cancelling keeps the event and its chat history but hides it from everyone except you. Attendees, interested users and savers are notified.">
            <SettingsRow
              icon={<CalendarX size={16} color={Colors.error} />}
              iconBackground={Colors.errorSoft}
              title="Cancel event"
              onPress={handleCancelEvent}
              destructive
            />
          </SettingsSection>
        ) : null}
      </View>
    );
  };

  const renderAttendeesHeader = () => {
    const fallback = attendeeSource === 'public_fallback';
    return (
      <View style={styles.tabBody}>
        <SegmentedControl<HostAttendeeStatus>
          options={[
            { value: 'going', label: 'Going', count: overview?.going ?? details?.rsvp_count ?? null },
            // Requests only earn a segment under approval mode (or while viewing).
            ...(event?.rsvp_mode === 'approval' || (overview?.requested ?? 0) > 0 || attendeeStatus === 'requested'
              ? [{ value: 'requested' as const, label: 'Requests', count: overview?.requested ?? null }]
              : []),
            { value: 'interested', label: 'Interested', count: overview?.interested ?? null },
            { value: 'waitlist', label: 'Waitlist', count: overview?.waitlist ?? details?.waitlist?.count ?? null },
            // Only worth a segment once someone has been removed (or while viewing it).
            ...((overview?.removed ?? 0) > 0 || attendeeStatus === 'removed'
              ? [{ value: 'removed' as const, label: 'Removed', count: overview?.removed ?? null }]
              : []),
          ]}
          value={attendeeStatus}
          onChange={(next) => {
            setAttendeeStatus(next);
            setAttendees([]);
            setAttendeeTotal(0);
            setAttendeeHasMore(false);
            setAttendeeSource(null);
          }}
          style={styles.subTabs}
        />
        <View style={styles.searchRow}>
          <Search size={16} color={Colors.text.tertiary} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name"
            placeholderTextColor={Colors.text.disabled}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search attendees by name"
          />
        </View>
        {fallback && attendeeStatus !== 'going' ? (
          <Text style={styles.limitedNote}>
            The {attendeeStatus} list needs a database update that has not been applied yet.
          </Text>
        ) : fallback ? (
          <Text style={styles.limitedNote}>
            Attendees with private profiles appear as Anonymous and cannot be removed until a
            pending database update is applied. Once applied, they show as first name and last
            initial.
          </Text>
        ) : null}
        {!attendeesLoading && !attendeesError && attendeeSource !== null && attendees.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Users size={28} color={Colors.text.disabled} />
            <Text style={styles.emptyText}>
              {debouncedSearch
                ? 'No one matches that name.'
                : attendeeStatus === 'going'
                  ? 'No one is going yet.'
                  : attendeeStatus === 'interested'
                    ? 'No one has marked interest yet.'
                    : attendeeStatus === 'requested'
                    ? 'No pending requests.'
                    : attendeeStatus === 'waitlist'
                      ? 'The waitlist is empty.'
                      : 'No one has been removed.'}
            </Text>
          </View>
        ) : null}
        {attendeesError ? (
          <ErrorState title="Couldn't load attendees" onRetry={() => void loadAttendees(0)} />
        ) : null}
      </View>
    );
  };

  // Stable dispatcher: the handlers above close over query objects (new each
  // render), so rows get one fixed callback that reads the latest via a ref.
  const attendeeHandlersRef = useRef({
    handleReviewRequest,
    handlePromoteAttendee,
    handleUnbanAttendee,
    handleRemoveAttendee,
  });
  attendeeHandlersRef.current = {
    handleReviewRequest,
    handlePromoteAttendee,
    handleUnbanAttendee,
    handleRemoveAttendee,
  };
  const onAttendeeAction = useCallback((action: AttendeeAction, item: HostAttendee) => {
    const h = attendeeHandlersRef.current;
    if (action === 'approve' || action === 'decline') void h.handleReviewRequest(item, action);
    else if (action === 'promote') void h.handlePromoteAttendee(item);
    else if (action === 'unban') void h.handleUnbanAttendee(item);
    else void h.handleRemoveAttendee(item);
  }, []);
  const renderAttendee = useCallback(
    ({ item, index }: { item: HostAttendee; index: number }) => (
      <AttendeeRow
        item={item}
        index={index}
        busy={removingId === item.user_id}
        canManageAttendees={actions.canManageAttendees}
        showLinePosition={!debouncedSearch}
        onAction={onAttendeeAction}
      />
    ),
    [removingId, actions.canManageAttendees, debouncedSearch, onAttendeeAction]
  );

  const renderSettings = () => {
    if (!event) return null;
    const rsvpOpen = !(event.rsvp_closed ?? false);
    const waitlistMode: WaitlistMode = event.waitlist_mode ?? 'notify';
    const hasCap = event.max_attendees != null;
    const disabled = savingSettings || !actions.canEdit;
    return (
      <View style={styles.tabBody}>
        {!settingsAvailable ? (
          <Text style={styles.limitedNote}>
            Accepting RSVPs and the waitlist mode need a database update that has not been applied
            yet. Capacity can still be changed.
          </Text>
        ) : null}

        <SettingsSection
          title="Capacity"
          separators={false}
          footer="Lowering the limit below the current going count keeps those people in and blocks new joins. Raising it tells the waitlist."
        >
          <View style={styles.capacityEditor}>
            <View style={[styles.iconWell, { backgroundColor: Colors.primarySoft }]}>
              <Ticket size={16} color={Colors.primary} />
            </View>
            <View style={styles.capacityEditorBody}>
              <Text style={styles.slowModeTitle}>Max attendees</Text>
              <Text style={styles.slowModeDesc}>
                {going} going now{hasCap ? ` · ${event.max_attendees} seats` : ' · unlimited'}
              </Text>
              <View style={styles.stepperRow}>
                <TouchableOpacity
                  style={styles.stepperBtn}
                  onPress={() => stepCapacity(-1)}
                  disabled={disabled || capacityDraft.trim() === '' || Number(capacityDraft) <= 1}
                  accessibilityRole="button"
                  accessibilityLabel="Decrease capacity"
                >
                  <Minus size={18} color={Colors.text.primary} />
                </TouchableOpacity>
                <TextInput
                  style={styles.stepperInput}
                  value={capacityDraft}
                  onChangeText={(t) => {
                    setCapacityDraft(t.replace(/[^0-9]/g, ''));
                    setCapacityDirty(true);
                  }}
                  placeholder="Unlimited"
                  placeholderTextColor={Colors.text.disabled}
                  keyboardType="number-pad"
                  editable={!disabled}
                  accessibilityLabel="Maximum attendees, empty for unlimited"
                />
                <TouchableOpacity
                  style={styles.stepperBtn}
                  onPress={() => stepCapacity(1)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel="Increase capacity"
                >
                  <Plus size={18} color={Colors.text.primary} />
                </TouchableOpacity>
              </View>
              {capacityDirty ? (
                <View style={styles.capacityActions}>
                  <TouchableOpacity
                    style={styles.capacitySecondary}
                    onPress={() => {
                      setCapacityDirty(false);
                      setCapacityDraft(event.max_attendees != null ? String(event.max_attendees) : '');
                    }}
                    disabled={savingSettings}
                    accessibilityRole="button"
                    accessibilityLabel="Discard capacity change"
                  >
                    <Text style={styles.capacitySecondaryText}>Discard</Text>
                  </TouchableOpacity>
                  {hasCap && capacityDraft.trim() !== '' ? (
                    <TouchableOpacity
                      style={styles.capacitySecondary}
                      onPress={() => {
                        setCapacityDraft('');
                        setCapacityDirty(true);
                      }}
                      disabled={savingSettings}
                      accessibilityRole="button"
                      accessibilityLabel="Remove the attendee limit"
                    >
                      <Text style={styles.capacitySecondaryText}>No limit</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    style={styles.capacityPrimary}
                    onPress={() => void handleSaveCapacity()}
                    disabled={savingSettings}
                    accessibilityRole="button"
                    accessibilityLabel="Save capacity"
                  >
                    {savingSettings ? (
                      <ActivityIndicator size="small" color={Colors.white} />
                    ) : (
                      <Text style={styles.capacityPrimaryText}>Save</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          </View>
        </SettingsSection>

        {event.visibility !== undefined ? (
          <SettingsSection
            title="Visibility"
            footer="Unlisted events are hidden from Discover and search; anyone with the link can still open and join them."
          >
            <SettingsRow
              kind="switch"
              icon={<EyeOff size={16} color={Colors.primary} />}
              title="Unlisted"
              description={event.visibility === 'unlisted' ? 'Link only' : 'Listed in Discover and search'}
              checked={event.visibility === 'unlisted'}
              disabled={disabled}
              onChange={(next) => void handleToggleUnlisted(next)}
            />
          </SettingsSection>
        ) : null}

        <SettingsSection
          title="Joining"
          footer="Closing RSVPs keeps everyone who already joined. New people see “RSVPs closed” until you reopen."
        >
          <SettingsRow
            kind="switch"
            icon={<Check size={16} color={Colors.primary} />}
            title="Approve new attendees"
            description={
              (event.rsvp_mode ?? 'open') === 'approval'
                ? 'Join taps become requests you review'
                : 'Anyone can take a spot directly'
            }
            checked={(event.rsvp_mode ?? 'open') === 'approval'}
            disabled={disabled || event.rsvp_mode === undefined}
            onChange={(next) =>
              void applySettings(
                { rsvpMode: next ? 'approval' : 'open' },
                next
                  ? 'New attendees now need your approval. Pending requests appear under Attendees.'
                  : 'Anyone can join directly again.'
              )
            }
          />
          <SettingsRow
            kind="switch"
            icon={<Users size={16} color={Colors.primary} />}
            title="Accepting RSVPs"
            description={rsvpOpen ? 'Anyone can join' : 'Closed to new attendees'}
            checked={rsvpOpen}
            disabled={disabled || !settingsAvailable}
            onChange={(next) =>
              void applySettings(
                { rsvpClosed: !next },
                next ? 'RSVPs are open again.' : 'RSVPs closed. Current attendees keep their seats.'
              )
            }
          />
          <View style={styles.slowModeRow}>
            <View style={[styles.iconWell, { backgroundColor: Colors.primarySoft }]}>
              <ListOrdered size={16} color={Colors.primary} />
            </View>
            <View style={styles.slowModeText}>
              <Text style={[styles.slowModeTitle, !hasCap && styles.titleMuted]}>Waitlist</Text>
              <Text style={styles.slowModeDesc}>
                {hasCap
                  ? WAITLIST_MODES.find((m) => m.value === waitlistMode)?.hint
                  : 'Set a capacity to use the waitlist'}
              </Text>
              <View style={styles.chipRow} accessibilityRole="radiogroup">
                {WAITLIST_MODES.map((mode) => {
                  const selected = mode.value === waitlistMode;
                  return (
                    <TouchableOpacity
                      key={mode.value}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() =>
                        void applySettings({ waitlistMode: mode.value }, `Waitlist: ${mode.label.toLowerCase()}.`)
                      }
                      disabled={disabled || !settingsAvailable || !hasCap}
                      accessibilityRole="radio"
                      accessibilityState={{ selected, disabled: disabled || !hasCap }}
                      accessibilityLabel={`Waitlist ${mode.label}: ${mode.hint}`}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{mode.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>
        </SettingsSection>
      </View>
    );
  };

  const renderChat = () => {
    if (!event) return null;
    const locked = chatStatus?.locked ?? false;
    const slow = (chatStatus?.slow_mode_seconds ?? 0) as ChatSlowModeSeconds;
    const chatCounts = overview?.chat;
    return (
      <View style={styles.tabBody}>
        {!actions.canModerateChat ? (
          <Text style={styles.limitedNote}>This event is cancelled; its chat is read-only.</Text>
        ) : null}
        <SettingsSection
          title="Posting"
          footer={
            chatStatus?.chat_mode !== undefined
              ? 'Announcements keeps the room readable while only you post. Off hides the chat entirely; history is kept.'
              : 'Attendees can read and post once at least two people are going. Locking keeps the chat open for reading while only you can post.'
          }
        >
          {chatStatus?.chat_mode !== undefined ? (
            <>
              <View style={styles.slowModeRow}>
                <View style={[styles.iconWell, { backgroundColor: Colors.primarySoft }]}>
                  <MessageCircle size={16} color={Colors.primary} />
                </View>
                <View style={styles.slowModeText}>
                  <Text style={styles.slowModeTitle}>Chat mode</Text>
                  <View style={styles.chipRow} accessibilityRole="radiogroup">
                    {(
                      [
                        { value: 'open', label: 'Open', hint: 'Attendees post' },
                        { value: 'announcements', label: 'Announcements', hint: 'Only you post' },
                        { value: 'off', label: 'Off', hint: 'No chat' },
                      ] as const
                    ).map((mode) => {
                      const selected = (chatStatus?.chat_mode ?? 'open') === mode.value;
                      return (
                        <TouchableOpacity
                          key={mode.value}
                          style={[styles.chip, selected && styles.chipSelected]}
                          onPress={() => void updateChatMode({ mode: mode.value })}
                          disabled={savingChat || !actions.canModerateChat}
                          accessibilityRole="radio"
                          accessibilityState={{ selected, disabled: savingChat }}
                          accessibilityLabel={`Chat ${mode.label}: ${mode.hint}`}
                        >
                          <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                            {mode.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </View>
              <SettingsRow
                kind="switch"
                icon={<Users size={16} color={Colors.primary} />}
                title="Open from the first attendee"
                description="Off: the room opens once at least two people are going"
                checked={(chatStatus?.open_policy ?? 'two_going') === 'any_going'}
                disabled={savingChat || !actions.canModerateChat || (chatStatus?.chat_mode ?? 'open') === 'off'}
                onChange={(next) =>
                  void updateChatMode({ openPolicy: next ? 'any_going' : 'two_going' })
                }
              />
            </>
          ) : (
            <SettingsRow
              kind="switch"
              icon={<Lock size={16} color={Colors.primary} />}
              title="Lock chat"
              description="Only you can post"
              checked={locked}
              disabled={savingChat || !actions.canModerateChat}
              onChange={(next) => void updateChatSettings({ locked: next }).catch(() => undefined)}
            />
          )}
          <View style={styles.slowModeRow}>
            <View style={[styles.iconWell, { backgroundColor: Colors.primarySoft }]}>
              <Timer size={16} color={Colors.primary} />
            </View>
            <View style={styles.slowModeText}>
              <Text style={styles.slowModeTitle}>Slow mode</Text>
              <Text style={styles.slowModeDesc}>One message per person every…</Text>
              <View style={styles.chipRow} accessibilityRole="radiogroup">
                {CHAT_SLOW_MODE_OPTIONS.map((option) => {
                  const selected = option === slow;
                  return (
                    <TouchableOpacity
                      key={option}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() =>
                        void updateChatSettings({ slowModeSeconds: option }).catch(() => undefined)
                      }
                      disabled={savingChat || !actions.canModerateChat}
                      accessibilityRole="radio"
                      accessibilityState={{ selected, disabled: savingChat }}
                      accessibilityLabel={`Slow mode ${slowModeLabel(option)}`}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                        {slowModeLabel(option)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>
        </SettingsSection>

        <SettingsSection title="Moderation">
          <SettingsRow
            icon={<ShieldAlert size={16} color={Colors.primary} />}
            title="Reports and blocked users"
            description="Review reported messages, lift blocks, see the log"
            value={
              chatCounts
                ? `${chatCounts.open_reports ?? 0} open · ${chatCounts.blocked_count ?? 0} blocked`
                : undefined
            }
            onPress={() => setModerationOpen(true)}
          />
          <SettingsRow
            icon={<MessageCircle size={16} color={Colors.primary} />}
            title="Open chat"
            description={
              chatCounts?.message_count !== null && chatCounts?.message_count !== undefined
                ? `${chatCounts.message_count} messages`
                : 'Read and post as the host'
            }
            onPress={() => router.push(`/event-chat/${event.id}` as never)}
          />
        </SettingsSection>
      </View>
    );
  };

  // ── Screen states ─────────────────────────────────────────────────────────
  if (detailsQuery.isLoading) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Manage event" />
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      </View>
    );
  }

  // A failed refetch keeps the cached event on screen; only a missing event
  // replaces the screen.
  if (!event) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Manage event" />
        {detailsQuery.isError ? (
          <ErrorState title="Couldn't load this event" onRetry={() => void detailsQuery.refetch()} />
        ) : (
          <ErrorState
            title="Event not found"
            message="It may have been deleted."
            onRetry={() => void detailsQuery.refetch()}
          />
        )}
      </View>
    );
  }

  if (!canManage) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Manage event" />
        <View style={styles.center}>
          <Text style={styles.notAllowed}>Only the host can manage this event.</Text>
        </View>
      </View>
    );
  }

  const listData = tab === 'attendees' ? attendees : [];

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Manage event" />
      <SegmentedControl<Tab> options={TABS} value={tab} onChange={setTab} style={styles.tabs} />
      <FlatList
        data={listData}
        keyExtractor={attendeeKey}
        renderItem={renderAttendee}
        ListHeaderComponent={
          tab === 'overview'
            ? renderOverview()
            : tab === 'attendees'
              ? renderAttendeesHeader()
              : tab === 'settings'
                ? renderSettings()
                : renderChat()
        }
        ListFooterComponent={
          tab === 'attendees' ? (
            <View style={styles.listFooter}>
              {attendeesLoading ? <ActivityIndicator color={Colors.primary} /> : null}
              {!attendeesLoading && attendeeHasMore ? (
                <TouchableOpacity
                  style={styles.showMore}
                  onPress={() => void loadAttendees(attendees.length)}
                  accessibilityRole="button"
                  accessibilityLabel="Show more attendees"
                >
                  <Text style={styles.showMoreText}>
                    Show more ({attendeeTotal - attendees.length} remaining)
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null
        }
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={detailsQuery.isRefetching && !detailsQuery.isLoading}
            onRefresh={() => {
              refetchAll();
              if (tab === 'attendees') void loadAttendees(0);
            }}
            tintColor={Colors.primary}
          />
        }
        keyboardShouldPersistTaps="handled"
      />

      <ChatModerationSheet
        eventId={event.id}
        visible={moderationOpen}
        locked={chatStatus?.locked ?? false}
        slowModeSeconds={chatStatus?.slow_mode_seconds ?? 0}
        onClose={() => {
          setModerationOpen(false);
          void overviewQuery.refetch();
        }}
        onNotice={(text) => notify.success(text)}
        onUpdateSettings={updateChatSettings}
      />

      <Modal
        visible={announceOpen}
        transparent
        animationType="slide"
        onRequestClose={() => (sendingAnnouncement ? null : setAnnounceOpen(false))}
      >
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => (sendingAnnouncement ? null : setAnnounceOpen(false))}
          accessibilityLabel="Close announcement"
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrap}
          pointerEvents="box-none"
        >
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Announce to attendees</Text>
              <TouchableOpacity
                onPress={() => setAnnounceOpen(false)}
                disabled={sendingAnnouncement}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <X size={22} color={Colors.text.secondary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.sheetHint}>
              Sent as an in-app notification and posted in the event chat. Attendees can turn
              announcements off in their settings.
              {announcementsLeft !== null ? ` ${announcementsLeft} of ${ANNOUNCEMENT_DAILY_LIMIT} left today.` : ''}
            </Text>
            <TextInput
              style={styles.sheetInput}
              value={announceBody}
              onChangeText={(t) => setAnnounceBody(t.slice(0, ANNOUNCEMENT_MAX_CHARS))}
              placeholder="e.g. Doors open at 7, bring ID. Parking is behind the venue."
              placeholderTextColor={Colors.text.disabled}
              multiline
              maxLength={ANNOUNCEMENT_MAX_CHARS}
              editable={!sendingAnnouncement}
              accessibilityLabel="Announcement text"
            />
            <Text style={styles.sheetCounter}>
              {announceBody.length} / {ANNOUNCEMENT_MAX_CHARS}
            </Text>
            <View style={styles.chipRow} accessibilityRole="radiogroup">
              {(
                [
                  { value: 'going', label: `Going (${going})` },
                  { value: 'all', label: `Everyone (${going + (overview?.interested ?? 0) + (overview?.requested ?? 0)})` },
                ] as const
              ).map((opt) => {
                const selected = announceAudience === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => setAnnounceAudience(opt.value)}
                    disabled={sendingAnnouncement}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Audience: ${opt.label}`}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity
              style={[
                styles.sheetSend,
                (!announceBody.trim() || sendingAnnouncement) && styles.sheetSendDisabled,
              ]}
              onPress={() => void handleSendAnnouncement()}
              disabled={!announceBody.trim() || sendingAnnouncement}
              accessibilityRole="button"
              accessibilityLabel="Send announcement"
            >
              {sendingAnnouncement ? (
                <ActivityIndicator color={Colors.white} />
              ) : (
                <>
                  <Send size={18} color={Colors.white} />
                  <Text style={styles.sheetSendText}>Send</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  notAllowed: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    textAlign: 'center',
  },
  tabs: {
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
  },
  subTabs: {
    marginBottom: Spacing.md,
  },
  listContent: {
    paddingBottom: Spacing.xxl,
  },
  tabBody: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
  },

  /* Hero */
  hero: {
    marginBottom: Spacing.lg,
  },
  heroTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  heroTitle: {
    flex: 1,
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.displayFontFamilies.bold,
    color: Colors.text.primary,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BorderRadius.round,
    marginTop: 4,
  },
  badgeText: {
    fontSize: Typography.sizes.xxs,
    fontFamily: Typography.labelFontFamilies.semibold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  heroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  heroMeta: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
  },

  /* Capacity */
  capacityCard: {
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  capacityRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  capacityLabel: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.displayFontFamilies.semibold,
    color: Colors.text.primary,
  },
  capacityHint: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    color: Colors.text.tertiary,
  },
  capacityFull: {
    color: Colors.warningText,
  },
  progressTrack: {
    height: 6,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.background.tertiary,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.primary,
  },
  progressFull: {
    backgroundColor: Colors.warning,
  },
  secondaryCounts: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
  },
  limitedNote: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.warningText,
    lineHeight: 16,
    marginBottom: Spacing.sm,
  },

  /* Attendees */
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    minHeight: 44,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border.light,
    marginBottom: Spacing.md,
  },
  searchInput: {
    flex: 1,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.primary,
    paddingVertical: 10,
  },
  attendeeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  attendeeMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 44,
  },
  attendeeText: {
    flex: 1,
  },
  attendeeNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  attendeeName: {
    flexShrink: 1,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.primary,
  },
  privateTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.neutralSoft,
  },
  privateTagText: {
    fontSize: Typography.sizes.xxs,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.text.secondary,
  },
  attendeeMeta: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    marginTop: 2,
  },
  rowActionBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BorderRadius.round,
  },
  removeBtn: {
    backgroundColor: Colors.errorSoft,
  },
  promoteBtn: {
    backgroundColor: Colors.successSoft,
  },
  restoreBtn: {
    backgroundColor: Colors.primarySoft,
  },
  emptyWrap: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xl,
  },
  emptyText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    textAlign: 'center',
  },
  listFooter: {
    alignItems: 'center',
    paddingVertical: Spacing.md,
  },
  showMore: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  showMoreText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.primary,
  },

  /* Chat */
  slowModeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
  },
  iconWell: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slowModeText: {
    flex: 1,
  },
  slowModeTitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.primary,
    marginBottom: 2,
  },
  slowModeDesc: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    marginBottom: Spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  chip: {
    minHeight: 32,
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderRadius: BorderRadius.round,
    borderWidth: 1,
    borderColor: Colors.border.light,
    backgroundColor: Colors.surface,
  },
  chipSelected: {
    borderColor: alpha(Colors.primary, 0.4),
    backgroundColor: Colors.primarySoft,
  },
  chipText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    color: Colors.text.secondary,
  },
  chipTextSelected: {
    color: Colors.primary,
  },
  titleMuted: {
    color: Colors.text.disabled,
  },

  /* Settings: capacity editor */
  capacityEditor: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
  },
  capacityEditorBody: {
    flex: 1,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  stepperBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.background.tertiary,
  },
  stepperInput: {
    flex: 1,
    minHeight: 44,
    textAlign: 'center',
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.displayFontFamilies.semibold,
    color: Colors.text.primary,
    borderWidth: 1,
    borderColor: Colors.border.light,
    borderRadius: BorderRadius.md,
    paddingVertical: 8,
  },
  capacityActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  capacitySecondary: {
    minHeight: 40,
    paddingHorizontal: Spacing.md,
    justifyContent: 'center',
    borderRadius: BorderRadius.round,
  },
  capacitySecondaryText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.secondary,
  },
  capacityPrimary: {
    minHeight: 40,
    minWidth: 88,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.primary,
  },
  capacityPrimaryText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.white,
  },

  /* Announce sheet */
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlay.dark,
  },
  sheetWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.sm,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.displayFontFamilies.bold,
    color: Colors.text.primary,
  },
  sheetHint: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    lineHeight: 18,
  },
  sheetInput: {
    minHeight: 110,
    maxHeight: 200,
    textAlignVertical: 'top',
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.primary,
    borderWidth: 1,
    borderColor: Colors.border.light,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    backgroundColor: Colors.background.primary,
  },
  sheetCounter: {
    alignSelf: 'flex-end',
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.labelFont,
    color: Colors.text.tertiary,
  },
  sheetSend: {
    marginTop: Spacing.sm,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.primary,
  },
  sheetSendDisabled: {
    opacity: 0.5,
  },
  sheetSendText: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.white,
  },
});
