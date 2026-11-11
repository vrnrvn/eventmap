import type { HostType } from '@/types/database';

/**
 * Getting-started checklist (HOST_ONBOARDING_PLAN.md §4 Stage 4, §13).
 *
 * Pure: takes what the server knows (`HostStatus`, from
 * get_host_onboarding_status or the client fallback) and what only this
 * device knows (`HostLocalSignals`), and returns the items to show.
 *
 * Unknown is not the same as "not done": a field that could not be loaded is
 * `null`, and its item is hidden rather than nagging a host who may well have
 * done it already (the fallback before the RPC exists can only see a few
 * fields).
 */

export type HostStatus = {
  hasLogo: boolean | null;
  hasDescription: boolean | null;
  publishedEvents: number | null;
  eventsWithCapacity: number | null;
  announcements: number | null;
  recurringEvents: number | null;
  /** businesses.notifications_enabled (RSVP / follower notifications). */
  notificationsEnabled: boolean | null;
};

export const UNKNOWN_STATUS: HostStatus = {
  hasLogo: null,
  hasDescription: null,
  publishedEvents: null,
  eventsWithCapacity: null,
  announcements: null,
  recurringEvents: null,
  notificationsEnabled: null,
};

/** Signals only this device can know; kept locally (utils/hostChecklistStore). */
export type HostLocalSignals = {
  sharedEvent: boolean;
  openedManage: boolean;
  /** OS push permission; null on platforms without push. */
  pushGranted: boolean | null;
};

export type ChecklistItemId =
  | 'profile'
  | 'publish'
  | 'share'
  | 'manage'
  | 'capacity'
  | 'announce'
  | 'series'
  | 'verify'
  | 'notifications';

export type ChecklistItem = {
  id: ChecklistItemId;
  title: string;
  description: string;
  done: boolean;
  /** Where tapping the item goes. */
  route: string;
  /** Shown instead of the route for a premium-only step on the free plan. */
  premiumRequired?: boolean;
};

export type HostChecklist = {
  items: ChecklistItem[];
  doneCount: number;
  total: number;
  complete: boolean;
  /** First item not done yet — the one the card highlights. */
  next: ChecklistItem | null;
};

const atLeastOne = (n: number | null): boolean | null => (n == null ? null : n > 0);

export function buildHostChecklist(input: {
  hostType: HostType;
  status: HostStatus;
  local: HostLocalSignals;
  premium: boolean;
  /**
   * 'verified' or 'requested' tick the step; 'none' shows it; null (unknown
   * or verification not available on this backend) hides it.
   */
  verification?: 'verified' | 'requested' | 'none' | null;
}): HostChecklist {
  const { hostType, status, local, premium, verification = null } = input;

  const profileDone =
    status.hasLogo == null || status.hasDescription == null ? null : status.hasLogo && status.hasDescription;
  // Push permission and the host switch both matter; either unknown → unknown
  // unless one is already known to be off.
  const notificationsDone =
    status.notificationsEnabled === false || local.pushGranted === false
      ? false
      : status.notificationsEnabled == null || local.pushGranted == null
        ? null
        : true;

  const candidates: (Omit<ChecklistItem, 'done'> & { done: boolean | null; forTypes?: HostType[] })[] = [
    {
      id: 'profile',
      title: hostType === 'individual' ? 'Add a photo and a short bio' : 'Add a logo and description',
      description: 'People decide whether to come partly on who is hosting.',
      done: profileDone,
      route: '/settings',
    },
    {
      id: 'publish',
      title: 'Publish your first event',
      description: 'Drafts are private; publishing puts it on the map.',
      done: atLeastOne(status.publishedEvents),
      route: '/(tabs)/create',
    },
    {
      id: 'share',
      title: 'Share an event',
      description: 'Most first attendees come from a link you send yourself.',
      done: local.sharedEvent,
      route: '/my-events',
    },
    {
      id: 'manage',
      title: 'Open Manage event',
      description: 'Attendees, capacity, announcements and chat live there.',
      done: local.openedManage,
      route: '/my-events',
    },
    {
      id: 'capacity',
      title: 'Set an attendee limit',
      description: 'A cap turns on the waitlist, so a full event keeps collecting names.',
      done: atLeastOne(status.eventsWithCapacity),
      route: '/my-events',
    },
    {
      id: 'announce',
      title: 'Post an announcement',
      description: 'Tell everyone going about a change or a reminder in one message.',
      done: atLeastOne(status.announcements),
      route: '/my-events',
    },
    {
      id: 'series',
      title: 'Set up a recurring series',
      description: 'Weekly or monthly events, managed as one.',
      done: atLeastOne(status.recurringEvents),
      route: premium ? '/(tabs)/create' : '/premium/plans',
      premiumRequired: !premium,
      // Individuals rarely run series; keep their list short.
      forTypes: ['venue', 'organiser'],
    },
    {
      id: 'verify',
      title: 'Request verification',
      description: 'A verified badge tells attendees you are who you say you are.',
      done: verification == null ? null : verification !== 'none',
      route: '/settings',
      // Individuals host now and then; verification matters most for venues
      // and organisers people return to.
      forTypes: ['venue', 'organiser'],
    },
    {
      id: 'notifications',
      title: 'Turn on host notifications',
      description: 'Hear about new RSVPs and followers as they happen.',
      done: notificationsDone,
      route: '/settings',
    },
  ];

  const items: ChecklistItem[] = candidates
    .filter((c) => !c.forTypes || c.forTypes.includes(hostType))
    // Unknown items are hidden, never shown as "to do".
    .filter((c): c is typeof c & { done: boolean } => c.done !== null)
    .map(({ forTypes: _forTypes, ...item }) => item);

  const doneCount = items.filter((i) => i.done).length;
  return {
    items,
    doneCount,
    total: items.length,
    complete: items.length > 0 && doneCount === items.length,
    next: items.find((i) => !i.done) ?? null,
  };
}

/**
 * The card shows until the list is complete or the host dismisses it.
 * Hosts who were already active before the checklist existed (≥1 published
 * event when first seen) start with it collapsed — recommended answer to plan
 * §9 Q4 — so long-time hosts are not greeted with "publish your first event".
 */
export type ChecklistVisibility = 'hidden' | 'collapsed' | 'expanded';

export function checklistVisibility(input: {
  checklist: HostChecklist;
  dismissed: boolean;
  /** Recorded the first time this device saw the host with published events. */
  preexistingHost: boolean;
}): ChecklistVisibility {
  if (input.dismissed || input.checklist.complete || input.checklist.total === 0) return 'hidden';
  return input.preexistingHost ? 'collapsed' : 'expanded';
}

/** Parses the RPC payload defensively; anything missing or malformed is unknown. */
export function parseHostStatus(raw: unknown): HostStatus {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bool = (v: unknown) => (typeof v === 'boolean' ? v : null);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  return {
    hasLogo: bool(o.has_logo),
    hasDescription: bool(o.has_description),
    publishedEvents: num(o.published_events),
    eventsWithCapacity: num(o.events_with_capacity),
    announcements: num(o.announcements),
    recurringEvents: num(o.recurring_events),
    notificationsEnabled: bool(o.notifications_enabled),
  };
}
