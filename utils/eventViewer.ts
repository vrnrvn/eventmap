/**
 * Who is looking at an event page, and every state flag the page derives for
 * them — computed in ONE place (docs/EVENT_REHEARSAL_PLAN.md Phase 1).
 *
 * screens/EventDetail.tsx used to derive these ~16 flags inline, and decided
 * host-vs-attendee in a dozen scattered conditionals; the rehearsal feature
 * ("Preview as attendee", Phase 2) swaps the viewer the page renders for, so
 * the decision has to live behind one seam. Pure and node-tested
 * (tests/eventViewer.test.ts); the logic is moved, not changed.
 */
import type { AttendeeRsvpStatus, EventDetails } from '@/types/database';
import { hasEventEnded, isEventInProgress } from '@/utils/eventStatus';
import {
  nextEffectiveOccurrence,
  occurrenceInProgress,
  type Occurrence,
  type OccurrenceException,
} from '@/utils/occurrences';
import { getNextOccurrences } from '@/utils/recurrence';

/**
 * 'owner' hosts this event; 'attendee' is any other signed-in user (RSVP'd
 * or not); 'visitor' is signed out.
 */
export type ViewerRole = 'owner' | 'attendee' | 'visitor';

export type EventViewer = {
  role: ViewerRole;
  /** role === 'owner' (the name the page has always used). */
  isOwner: boolean;
  rsvp: AttendeeRsvpStatus | null;
  hasJoined: boolean;
  hasRequested: boolean;
  approvalMode: boolean;
  ended: boolean;
  cancelled: boolean;
  postponed: boolean;
  draft: boolean;
  unlisted: boolean;
  /**
   * Host switched "Accepting RSVPs" off (20261103130000). People already in
   * keep their seat and may still leave; nobody new can join.
   */
  rsvpsClosedByHost: boolean;
  /** "Closed" = no RSVP changes possible, for whichever reason. */
  closed: boolean;
  live: boolean;
  maxAttendees: number | null;
  full: boolean;
  /**
   * Waitlist exists only once migration 20261102160000 is applied (the RPC
   * then returns a `waitlist` key); before that the full state stays a plain
   * disabled button.
   */
  waitlist: EventDetails['waitlist'];
  onWaitlist: boolean;
  canWaitlist: boolean;
  /**
   * A series date that is running right now (EJ-2): the header shows THAT
   * date, not the next one — "Happening now" next to next week's date was
   * contradictory (caught by suiteAttendee A6).
   */
  liveOccurrence: Occurrence | null;
  /**
   * Recurring events that already started show their next occurrence in the
   * header; everything else shows the scheduled start.
   */
  displayStartIso: string;
};

export function deriveEventViewer({
  details,
  userId,
  userBusinessId,
  exceptions = [],
  now = new Date(),
}: {
  details: Pick<EventDetails, 'event' | 'rsvp_count' | 'user_rsvp' | 'waitlist'>;
  userId: string | null;
  userBusinessId: string | null;
  exceptions?: readonly OccurrenceException[];
  now?: Date;
}): EventViewer {
  const { event } = details;
  const signedIn = userId != null;
  const role: ViewerRole =
    userBusinessId != null && event.business_id === userBusinessId
      ? 'owner'
      : signedIn
        ? 'attendee'
        : 'visitor';

  const rsvp = details.user_rsvp ?? null;
  const hasJoined = rsvp === 'going';
  const hasRequested = rsvp === 'requested';
  const ended = hasEventEnded(event, now);
  const cancelled = event.status === 'cancelled';
  const postponed = event.status === 'postponed';
  const draft = event.publish_state === 'draft';
  const rsvpsClosedByHost = !!event.rsvp_closed && !hasJoined;
  const closed = ended || cancelled || postponed || draft || rsvpsClosedByHost;
  const live = !cancelled && isEventInProgress(event, now, exceptions);
  const maxAttendees = event.max_attendees ?? null;
  const full = maxAttendees != null && details.rsvp_count >= maxAttendees && !hasJoined;
  const waitlist = details.waitlist;
  const onWaitlist = !!waitlist && (waitlist.position ?? 0) > 0;
  // Joining the waitlist needs an open event AND an open waitlist: the
  // server refuses when the host switched it off (waitlist_off) or the event
  // takes requests instead (approval_required) — EJ-25, the page used to
  // offer "Join the waitlist" there and then show the refusal. LEAVING it
  // must survive the host closing RSVPs or postponing (the row is the user's
  // own). A pending request takes precedence over the waitlist CTA.
  const waitlistOpen = event.waitlist_mode !== 'off' && event.rsvp_mode !== 'approval';
  const canWaitlist =
    signedIn &&
    !!waitlist &&
    !hasRequested &&
    ((full && !closed && waitlistOpen) || (onWaitlist && !cancelled && !ended && !draft));
  const liveOccurrence =
    event.is_recurring && live ? occurrenceInProgress(event, exceptions, now) : null;
  const displayStartIso = (() => {
    if (!event.is_recurring || ended) return event.start_datetime;
    if (liveOccurrence) return liveOccurrence.start.toISOString();
    if (exceptions.length === 0 && new Date(event.start_datetime).getTime() > now.getTime()) {
      return event.start_datetime;
    }
    // Honour skipped dates and moved times; fall back to the plain walk.
    const next =
      nextEffectiveOccurrence(event, exceptions, now)?.start ?? getNextOccurrences(event, 1, now)[0];
    return next ? next.toISOString() : event.start_datetime;
  })();

  return {
    role,
    isOwner: role === 'owner',
    rsvp,
    hasJoined,
    hasRequested,
    approvalMode: event.rsvp_mode === 'approval',
    ended,
    cancelled,
    postponed,
    draft,
    unlisted: event.visibility === 'unlisted',
    rsvpsClosedByHost,
    closed,
    live,
    maxAttendees,
    full,
    waitlist,
    onWaitlist,
    canWaitlist,
    liveOccurrence,
    displayStartIso,
  };
}
