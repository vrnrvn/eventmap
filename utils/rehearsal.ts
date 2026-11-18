/**
 * "Preview as attendee" — a host walks their own event page as a guest would
 * and tries joining, with nothing saved (docs/EVENT_REHEARSAL_PLAN.md
 * Phase 2). Pure: the simulated attendee's state, the page data as that
 * attendee would see it, and one transition per action. The transitions
 * mirror what the server would answer (join_event_with_capacity,
 * join_event_waitlist, set_occurrence_rsvp) and reuse the real screens' copy,
 * because rehearsing those words is the point; only the side effects differ —
 * there are none. Tested in tests/rehearsal.test.ts.
 *
 * Why simulate instead of really RSVPing as the host: a real host RSVP takes
 * a real seat, shows up in counts and attendee lists, can unlock the chat for
 * someone else, subscribes the host to attendee reminders, and is impossible
 * on a draft (plan §2).
 */
import type { AttendeeRsvpStatus, EventDetails } from '@/types/database';
import type { EventViewer } from '@/utils/eventViewer';
import {
  nextDateOverride,
  nextEffectiveOccurrence,
  occurrenceInProgress,
  type DateAttendance,
  type DateRsvpOverride,
  type OccurrenceException,
} from '@/utils/occurrences';
import { rsvpErrorMessage } from '@/utils/rsvpErrors';

/** The simulated attendee: starts as a first-time visitor who has done nothing. */
export type RehearsalSim = {
  rsvp: AttendeeRsvpStatus | null;
  onWaitlist: boolean;
  saved: boolean;
  following: boolean;
  /** Per-date answers for a series, same shape as rsvp_occurrences rows. */
  dateOverrides: DateRsvpOverride[];
};

export const REHEARSAL_START: RehearsalSim = {
  rsvp: null,
  onWaitlist: false,
  saved: false,
  following: false,
  dateOverrides: [],
};

/**
 * Phase 3 scenarios: WHEN the guest is looking, and how full the event is.
 * "When" moves a virtual clock (the page's time-based decisions — live,
 * ended, review eligibility, which series dates remain — are all computed
 * against it); the event's own dates never change.
 */
export type RehearsalWhen = 'real' | 'before' | 'dayof' | 'live' | 'ended';
export type RehearsalSpots = 'real' | 'open' | 'full';
export type RehearsalScenario = { when: RehearsalWhen; spots: RehearsalSpots };
export const REHEARSAL_REAL: RehearsalScenario = { when: 'real', spots: 'real' };

export const REHEARSAL_WHEN_LABEL: Record<RehearsalWhen, string> = {
  real: 'Right now',
  before: 'Days before',
  dayof: 'Day of',
  live: 'Happening now',
  ended: 'Ended',
};
export const REHEARSAL_SPOTS_LABEL: Record<RehearsalSpots, string> = {
  real: 'As it is',
  open: 'Spots left',
  full: 'Full',
};

type TimingEvent = EventDetails['event'];
const HOUR = 60 * 60 * 1000;

/** The date the scenario is about: the running or next date of a series, the event itself otherwise. */
function referenceDate(event: TimingEvent, exceptions: readonly OccurrenceException[], realNow: Date) {
  if (event.is_recurring && event.recurrence_pattern) {
    const o = occurrenceInProgress(event, exceptions, realNow) ?? nextEffectiveOccurrence(event, exceptions, realNow);
    if (o) return { start: o.start.getTime(), end: o.end.getTime() };
  }
  return { start: new Date(event.start_datetime).getTime(), end: new Date(event.end_datetime).getTime() };
}

/** The series' last day, when it has one ('YYYY-MM-DD'). */
const seriesEndDate = (event: TimingEvent): string | null => {
  const d = event.is_recurring ? event.recurrence_pattern?.endDate : null;
  return d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
};

/**
 * Which "when" scenarios make sense for this event. "Ended" needs a series
 * to have an end date (an open-ended series never ends — EJ-16); a
 * cancelled event has no "happening now".
 */
export function scenarioOptions(event: TimingEvent): RehearsalWhen[] {
  const all: RehearsalWhen[] = ['real', 'before', 'dayof', 'live', 'ended'];
  return all.filter((w) => {
    if (w === 'live' && event.status === 'cancelled') return false;
    if (w === 'ended' && event.is_recurring && !seriesEndDate(event)) return false;
    return true;
  });
}

/** The virtual "now" for a scenario. */
export function scenarioNow(
  event: TimingEvent,
  exceptions: readonly OccurrenceException[],
  when: RehearsalWhen,
  realNow: Date = new Date()
): Date {
  if (when === 'real') return realNow;
  const ref = referenceDate(event, exceptions, realNow);
  const duration = Math.max(ref.end - ref.start, HOUR);
  switch (when) {
    case 'before':
      return new Date(ref.start - 3 * 24 * HOUR);
    case 'dayof':
      return new Date(ref.start - 2 * HOUR);
    case 'live':
      return new Date(ref.start + duration / 2);
    case 'ended': {
      const last = seriesEndDate(event);
      // A series is over once its end DATE has passed (event_has_ended):
      // noon UTC the day after leaves a margin for any zone.
      if (last) return new Date(Date.parse(`${last}T12:00:00Z`) + 36 * HOUR);
      return new Date(ref.end + HOUR);
    }
  }
}

/** What the screen should do after a simulated action. */
export type RehearsalOutcome = {
  sim: RehearsalSim;
  /** Toast the real flow would show (same words). */
  message?: { tone: 'success' | 'error'; text: string };
  /** The real flow offers "Add to calendar?" after a join. */
  offerCalendar?: boolean;
  haptic?: 'success' | 'selection';
};

/**
 * The event page's data as the simulated attendee would see it. Counts move
 * with the simulated RSVP so "12 / 20 going" reads as it would for a guest;
 * a draft is shown as published, which is how attendees will first meet it.
 */
export function rehearsalDetails(
  real: EventDetails,
  sim: RehearsalSim,
  spots: RehearsalSpots = 'real'
): EventDetails {
  const going = sim.rsvp === 'going';
  let event = real.event.publish_state === 'draft' ? { ...real.event, publish_state: 'published' as const } : real.event;
  let rsvpCount = real.rsvp_count + (going ? 1 : 0);
  const cap = event.max_attendees ?? null;
  if (spots === 'full') {
    // Every seat taken (the guest, if going, holds one of them). An event
    // without a limit gets one at today's count, so the full state is visible.
    const max = cap ?? Math.max(rsvpCount, 1);
    event = { ...event, max_attendees: max };
    rsvpCount = max;
  } else if (spots === 'open' && cap != null && rsvpCount >= cap && !going) {
    rsvpCount = cap - 1;
  }
  return {
    ...real,
    event,
    user_rsvp: sim.rsvp,
    rsvp_count: rsvpCount,
    user_saved: sim.saved,
    save_count: real.save_count + (sim.saved ? 1 : 0),
    user_following_business: sim.following,
    waitlist: real.waitlist
      ? {
          count: real.waitlist.count + (sim.onWaitlist ? 1 : 0),
          position: sim.onWaitlist ? real.waitlist.count + 1 : null,
          notified_at: null,
        }
      : real.waitlist,
  };
}

const err = (sim: RehearsalSim, text: string): RehearsalOutcome => ({ sim, message: { tone: 'error', text } });

/** Why the simulated attendee can't RSVP right now, in the real screen's words; null = they can. */
function closedReason(view: EventViewer): string | null {
  if (view.cancelled) return 'This event was cancelled, so it can no longer be joined.';
  if (view.ended) return 'This event is over, so it can no longer be joined.';
  if (view.postponed) return rsvpErrorMessage('EVENT_CLOSED');
  if (view.rsvpsClosedByHost) return rsvpErrorMessage('RSVPS_CLOSED');
  return null;
}

/** Join ("going") or "interested", as join_event_with_capacity would answer. */
export function rehearseRsvp(sim: RehearsalSim, status: 'going' | 'interested', view: EventViewer): RehearsalOutcome {
  const closed = closedReason(view);
  if (closed) return err(sim, closed);
  if (status === 'interested') {
    return { sim: { ...sim, rsvp: 'interested' }, haptic: 'selection' };
  }
  if (sim.rsvp === 'going') return { sim };
  // Approval mode: a first "going" becomes a request (guard_rsvp_approval).
  if (view.approvalMode) {
    return {
      sim: { ...sim, rsvp: 'requested' },
      haptic: 'success',
      message: {
        tone: 'success',
        text: "Request sent. The host usually replies within a day — we'll let you know either way.",
      },
    };
  }
  if (view.full) return err(sim, rsvpErrorMessage('EVENT_FULL'));
  // Going takes the attendee off the waitlist (sync_event_waitlist_on_rsvp).
  return { sim: { ...sim, rsvp: 'going', onWaitlist: false }, haptic: 'success', offerCalendar: true };
}

/** Leave / cancel a request / un-star interest. */
export function rehearseLeave(sim: RehearsalSim): RehearsalOutcome {
  return { sim: { ...sim, rsvp: null }, haptic: 'selection' };
}

export function rehearseJoinWaitlist(sim: RehearsalSim, view: EventViewer): RehearsalOutcome {
  // A spot opened between render and tap: the real flow joins instead.
  if (!view.full) return rehearseRsvp(sim, 'going', view);
  if (!view.canWaitlist) return err(sim, rsvpErrorMessage('WAITLIST_OFF'));
  const position = (view.waitlist?.count ?? 0) + 1;
  return {
    sim: { ...sim, onWaitlist: true },
    haptic: 'success',
    message: { tone: 'success', text: `You're #${position} on the waitlist. We'll tell you when a spot opens.` },
  };
}

export function rehearseLeaveWaitlist(sim: RehearsalSim): RehearsalOutcome {
  return { sim: { ...sim, onWaitlist: false }, message: { tone: 'success', text: 'Removed from the waitlist.' } };
}

/** A series date's Go / Can't go chip (set_occurrence_rsvp, minus per-date capacity, which the client can't know). */
export function rehearseDate(sim: RehearsalSim, dateKey: string, current: DateAttendance): RehearsalOutcome {
  const next = nextDateOverride(sim.rsvp, current);
  const rest = sim.dateOverrides.filter((o) => o.occurrence_date !== dateKey);
  const dateOverrides = next ? [...rest, { occurrence_date: dateKey, status: next }] : rest;
  return {
    sim: { ...sim, dateOverrides },
    message: {
      tone: 'success',
      text:
        current === 'waitlist'
          ? 'You left the waitlist for that date.'
          : current === 'going'
            ? "Got it — you're not going that date."
            : "You're going that date.",
    },
  };
}

/**
 * What a guest's tap on a control the preview can't simulate would do — said
 * instead of doing it, so the host still learns the control is there.
 */
export const REHEARSAL_NOT_SAVED = {
  calendar: 'Preview: attendees add the event to their calendar here. Nothing was exported.',
  report: 'Preview: attendees can report an event here. Nothing was sent.',
  review: 'Preview: attendees who went can review you here. Nothing was posted.',
  collection: 'Preview: attendees can file saved events into collections here.',
  mute: 'Preview: attendees can mute this chat here. Nothing was changed.',
} as const;

/** The chat preview's bar, where an attendee's composer would be (Phase 4). */
export const REHEARSAL_CHAT_BAR =
  "Preview as attendee — this is the chat guests see. People who are going post here; nothing you do is sent.";
