/**
 * One-time host tips (HOST_ONBOARDING_PLAN.md §4 Stage 5).
 *
 * Each tip is shown the first time a host actually hits the situation it
 * explains — a first attendee, a full event, a change that notifies people —
 * and never again. Pure: `nextHostTip` decides from facts, the caller
 * records the dismissal.
 *
 * Tips are advice, never a blocker: nothing here gates an action, and every
 * tip is dismissible.
 */
export type HostTipId =
  | 'first_rsvp'
  | 'capacity_reached'
  | 'chat_opened'
  | 'reports_waiting'
  | 'reschedule_vs_edit'
  | 'last_free_event';

export type HostTip = {
  id: HostTipId;
  title: string;
  body: string;
  /** Optional action; omitted when the tip is purely explanatory. */
  action?: { label: string; target: HostTipTarget };
};

/**
 * Where a tip's action goes. The screen that renders the tip maps these to a
 * route or a local tab change, so this module stays route-free and testable.
 */
export type HostTipTarget = 'attendees' | 'settings' | 'chat' | 'premium' | 'reschedule';

const TIPS: Record<HostTipId, HostTip> = {
  first_rsvp: {
    id: 'first_rsvp',
    title: 'Your first attendee',
    body: 'Someone is coming. You can see who, message everyone at once, and check people in from the Attendees tab.',
    action: { label: 'See who’s coming', target: 'attendees' },
  },
  capacity_reached: {
    id: 'capacity_reached',
    title: 'Your event is full',
    body: 'New sign-ups now join the waitlist. Set it to move people up automatically when someone drops out, or raise the limit.',
    action: { label: 'Waitlist options', target: 'settings' },
  },
  chat_opened: {
    id: 'chat_opened',
    title: 'You run this chat',
    body: 'You can pin a message, slow it down, switch to announcements only, or remove messages and people. Reports come to you first.',
    action: { label: 'Chat options', target: 'settings' },
  },
  reports_waiting: {
    id: 'reports_waiting',
    title: 'Someone reported a message',
    body: 'Reports on your event come to you. Review them and remove the message or the person; anything you leave can be escalated to EventMap.',
    action: { label: 'Review reports', target: 'chat' },
  },
  reschedule_vs_edit: {
    id: 'reschedule_vs_edit',
    title: 'People are already going',
    body: 'Changing the date, time or place notifies everyone who is going. Use Reschedule so they get the reason, instead of editing quietly.',
    action: { label: 'Reschedule instead', target: 'reschedule' },
  },
  last_free_event: {
    id: 'last_free_event',
    title: 'One event left this month',
    body: 'Free hosts publish 2 events a month. Drafts are always free, and the count resets at the start of the month.',
    action: { label: 'See Premium', target: 'premium' },
  },
};

export function hostTip(id: HostTipId): HostTip {
  return TIPS[id];
}

/** Facts the caller knows; anything unknown is `null` and never triggers a tip. */
export type HostTipFacts = {
  /** Attendees going to this event. */
  going?: number | null;
  /** Capacity cap, null = unlimited. */
  maxAttendees?: number | null;
  /** Host opened the event chat. */
  chatOpened?: boolean;
  /** Reported messages waiting on this event. */
  reportsWaiting?: number | null;
  /** Host is editing time or place while people are going. */
  editingWithAttendees?: boolean;
  /** Published this month / the plan's allowance, for free hosts only. */
  eventsUsed?: number | null;
  eventsAllowed?: number | null;
  isPremium?: boolean;
};

/**
 * The tip to show now, or null. At most one at a time, in priority order:
 * something needing attention (reports, a full event) beats an introduction.
 */
export function nextHostTip(facts: HostTipFacts, seen: readonly string[]): HostTipId | null {
  const unseen = (id: HostTipId) => !seen.includes(id);

  if (facts.reportsWaiting != null && facts.reportsWaiting > 0 && unseen('reports_waiting')) {
    return 'reports_waiting';
  }
  if (
    facts.editingWithAttendees === true &&
    facts.going != null &&
    facts.going > 0 &&
    unseen('reschedule_vs_edit')
  ) {
    return 'reschedule_vs_edit';
  }
  if (
    facts.maxAttendees != null &&
    facts.going != null &&
    facts.maxAttendees > 0 &&
    facts.going >= facts.maxAttendees &&
    unseen('capacity_reached')
  ) {
    return 'capacity_reached';
  }
  if (facts.going != null && facts.going > 0 && unseen('first_rsvp')) {
    return 'first_rsvp';
  }
  if (facts.chatOpened === true && unseen('chat_opened')) {
    return 'chat_opened';
  }
  // Only while one slot is left: at zero the existing limit banner takes over.
  if (
    facts.isPremium === false &&
    facts.eventsUsed != null &&
    facts.eventsAllowed != null &&
    facts.eventsAllowed > 0 &&
    facts.eventsAllowed - facts.eventsUsed === 1 &&
    unseen('last_free_event')
  ) {
    return 'last_free_event';
  }
  return null;
}
