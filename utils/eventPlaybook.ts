/**
 * Per-event host playbook (docs/HOST_EVENT_PLAYBOOK_PLAN.md).
 *
 * Pure module — no React Native imports, unit-tested under node. It takes
 * what the event row says, what the host RPCs report (`PlaybookFacts`), what
 * only this device knows (`PlaybookLocalSignals`) and what the host ticked by
 * hand, and returns the items to show for the event's current stage.
 *
 * Two rules carried over from `utils/hostChecklist.ts`:
 *
 *  - **Unknown is not "not done".** A fact that could not be loaded is `null`
 *    and its item is hidden, rather than nagging a host who may well have
 *    done it already. Items the host can tick by hand are never hidden: a
 *    tick is always knowable.
 *  - **Advice, never a gate.** Nothing here blocks publishing or any other
 *    action; publish validation stays where it is.
 */
import { getHostEventPhase, type HostEventPhase, type HostEventSummaryInput } from '@/utils/hostEvent';
import type { EventPresetId, HostType, RsvpMode, WaitlistMode } from '@/types/database';

/** Which part of the journey the host is in; `none` shows no playbook. */
export type PlaybookStage = 'before' | 'leadup' | 'dayof' | 'after' | 'none';

export type PlaybookItemId =
  // before publishing
  | 'title'
  | 'cover'
  | 'description'
  | 'place'
  | 'when'
  | 'capacity'
  | 'links'
  | 'publish'
  // lead-up and day of
  | 'share'
  | 'notify_followers'
  | 'review_requests'
  | 'waitlist_mode'
  | 'reminder_announcement'
  | 'pin_details'
  | 'clear_reports'
  | 'venue_confirmed'
  // after
  | 'thank_you'
  | 'review_insights'
  | 'run_again'
  | 'reply_reviews'
  | 'lessons';

/**
 * Where tapping an item goes. Kept abstract (like `HostTipTarget`) so this
 * module stays route-free: the screen that renders the card maps a target to
 * a route, a hub tab or a form section.
 */
export type PlaybookTarget =
  | 'edit_basics'
  | 'edit_photo'
  | 'edit_when'
  | 'edit_where'
  | 'edit_extras'
  | 'publish'
  | 'share'
  | 'notify_followers'
  | 'attendees'
  | 'settings'
  | 'announce'
  | 'chat'
  | 'insights'
  | 'duplicate'
  | 'reviews'
  | 'none';

export type PlaybookItem = {
  id: PlaybookItemId;
  title: string;
  description: string;
  done: boolean;
  target: PlaybookTarget;
  /**
   * The host can tick this one by hand (either it is purely manual, or the
   * app cannot always see the evidence). Rendered with a checkbox; items
   * without it tick themselves and are read-only.
   */
  manual: boolean;
};

export type EventPlaybook = {
  phase: HostEventPhase;
  stage: PlaybookStage;
  items: PlaybookItem[];
  doneCount: number;
  total: number;
  /** First item not done yet — the one a collapsed card highlights. */
  next: PlaybookItem | null;
  complete: boolean;
};

/** The event fields the playbook reads. A partial row is fine; see the unknown rule. */
export type PlaybookEvent = HostEventSummaryInput & {
  title?: string | null;
  description?: string | null;
  category_id?: string | null;
  cover_image_url?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  timezone?: string | null;
  ticket_url?: string | null;
  rsvp_mode?: RsvpMode;
  /** `undefined` = pre-20261103130000, so unknown rather than "off". */
  waitlist_mode?: WaitlistMode;
  event_type?: EventPresetId | null;
  /** Next occurrence of a series; defaults to `start_datetime`. */
  next_start_datetime?: string | null;
};

/**
 * Server-side facts. Every field is `null` when it could not be loaded, and
 * a `null` hides its item.
 */
export type PlaybookFacts = {
  /** `get_event_host_overview.requested` — pending join requests. */
  requested: number | null;
  /** `get_event_host_overview.chat.open_reports`. */
  openReports: number | null;
  /** Event links rows (`get_event_links`), used with `ticket_url`. */
  eventLinks: number | null;
  /** Extra event photos beyond the cover. */
  photos: number | null;
  /** An announcement sent within REMINDER_WINDOW_HOURS of the start. */
  reminderAnnouncementSent: boolean | null;
  /** An announcement sent after the event ended. */
  thankYouSent: boolean | null;
  /** A pinned chat message exists (20261103160000). */
  pinnedMessage: boolean | null;
  /** This event was copied into a new draft, or made recurring. */
  ranAgain: boolean | null;
  /** Reviews on the host profile with no host response. */
  unansweredReviews: number | null;
  /** Followers were notified about this event. */
  notifiedFollowers: boolean | null;
};

export const UNKNOWN_FACTS: PlaybookFacts = {
  requested: null,
  openReports: null,
  eventLinks: null,
  photos: null,
  reminderAnnouncementSent: null,
  thankYouSent: null,
  pinnedMessage: null,
  ranAgain: null,
  unansweredReviews: null,
  notifiedFollowers: null,
};

/** Signals only this device can know (utils/eventPlaybookStore). */
export type PlaybookLocalSignals = {
  shared: boolean;
  notifiedFollowers: boolean;
  openedInsights: boolean;
  duplicated: boolean;
};

export const NO_LOCAL_SIGNALS: PlaybookLocalSignals = {
  shared: false,
  notifiedFollowers: false,
  openedInsights: false,
  duplicated: false,
};

/** A title shorter than this is almost always a placeholder. */
export const MIN_TITLE_LENGTH = 5;
/** Roughly one informative sentence. */
export const MIN_DESCRIPTION_LENGTH = 80;
/** Inside this window the lead-up list becomes the day-of list. */
export const DAY_OF_HOURS = 24;
/** A reminder announcement is only suggested this close to the start. */
export const REMINDER_WINDOW_HOURS = 72;
/** From this many events on, a host gets the card collapsed by default. */
export const EXPERIENCED_HOST_EVENTS = 3;

const HOUR_MS = 3_600_000;

/** Hours until the event starts; negative once it has started. Null if unparseable. */
export function hoursUntilStart(event: PlaybookEvent, now: Date = new Date()): number | null {
  const raw = event.next_start_datetime || event.start_datetime;
  const start = new Date(raw).getTime();
  if (Number.isNaN(start)) return null;
  return (start - now.getTime()) / HOUR_MS;
}

/**
 * Which list to show. A cancelled event gets none: the host's only job there
 * is already covered by the cancellation flow. A postponed event stays in the
 * lead-up list, where "set the new date" lives.
 */
export function playbookStage(event: PlaybookEvent, now: Date = new Date()): PlaybookStage {
  const phase = getHostEventPhase(event, now);
  if (phase === 'cancelled') return 'none';
  if (phase === 'draft') return 'before';
  if (phase === 'ended') return 'after';
  if (phase === 'live') return 'dayof';
  const hours = hoursUntilStart(event, now);
  if (phase === 'upcoming' && hours !== null && hours <= DAY_OF_HOURS) return 'dayof';
  return 'leadup';
}

const text = (v: string | null | undefined): string => (v ?? '').trim();

type Candidate = Omit<PlaybookItem, 'done' | 'manual'> & {
  /** Evidence the app can see; null = unknown. */
  derived: boolean | null;
  /** The host can tick it; a tick always counts as done. */
  manual?: boolean;
  stages: PlaybookStage[];
  forTypes?: HostType[];
  /** Presets this item is noise for (a 6-person picnic needs no waitlist mode). */
  skipPresets?: EventPresetId[];
  /** Extra condition; false drops the item entirely. */
  when?: boolean;
};

export function buildEventPlaybook(input: {
  event: PlaybookEvent;
  hostType?: HostType;
  facts?: Partial<PlaybookFacts>;
  local?: Partial<PlaybookLocalSignals>;
  /** Item ids the host ticked by hand. */
  manual?: readonly string[];
  now?: Date;
}): EventPlaybook {
  const now = input.now ?? new Date();
  const event = input.event;
  const facts: PlaybookFacts = { ...UNKNOWN_FACTS, ...input.facts };
  const local: PlaybookLocalSignals = { ...NO_LOCAL_SIGNALS, ...input.local };
  const ticked = new Set(input.manual ?? []);
  const hostType = input.hostType ?? 'individual';
  const preset = event.event_type ?? null;

  const phase = getHostEventPhase(event, now);
  const stage = playbookStage(event, now);
  const hours = hoursUntilStart(event, now);
  const hasCap = (event.max_attendees ?? 0) > 0;
  const linkCount = facts.eventLinks;
  const hasLink =
    text(event.ticket_url).length > 0 ? true : linkCount == null ? null : linkCount > 0;
  const coverSet = text(event.cover_image_url).length > 0;

  const candidates: Candidate[] = [
    // ---- Before publishing -------------------------------------------------
    {
      id: 'title',
      title: 'A clear title and the right type',
      description: 'These are what people search and filter by.',
      derived: text(event.title).length >= MIN_TITLE_LENGTH && text(event.category_id).length > 0,
      target: 'edit_basics',
      stages: ['before'],
    },
    {
      id: 'cover',
      title: 'Add a cover photo',
      description: 'A photo is the first thing people see in the list and on the map.',
      derived: coverSet || (facts.photos == null ? false : facts.photos > 0),
      target: 'edit_photo',
      stages: ['before'],
    },
    {
      id: 'description',
      title: 'Say what actually happens',
      description: 'A couple of sentences on what to expect, who it is for, and what to bring.',
      derived: text(event.description).length >= MIN_DESCRIPTION_LENGTH,
      target: 'edit_basics',
      stages: ['before'],
    },
    {
      id: 'place',
      title: 'Set the exact place',
      description: 'Attendees navigate to this pin, so check it is the door they should use.',
      derived:
        text(event.address).length > 0 &&
        Number.isFinite(event.lat ?? NaN) &&
        Number.isFinite(event.lng ?? NaN),
      target: 'edit_where',
      stages: ['before'],
    },
    {
      id: 'when',
      title: 'Check the date, time and zone',
      description: 'Attendees see times in the event zone, so set the zone you are hosting in.',
      derived: hours == null ? null : hours > 0 && new Date(event.end_datetime) > new Date(event.start_datetime),
      target: 'edit_when',
      stages: ['before'],
    },
    {
      id: 'capacity',
      title: 'Decide on a limit',
      description: 'A cap turns on the waitlist, so a full event keeps collecting names.',
      derived: hasCap,
      manual: true, // "no limit, on purpose" is a valid answer
      target: 'settings',
      stages: ['before'],
    },
    {
      id: 'links',
      title: 'Add a ticket or info link',
      description: 'Anything people need before they arrive: tickets, a menu, a route.',
      derived: hasLink,
      manual: true, // "nothing to link" is a valid answer
      target: 'edit_extras',
      stages: ['before'],
    },
    {
      id: 'publish',
      title: 'Publish it',
      description: 'Drafts are private. Publishing puts it on the map.',
      derived: event.publish_state === 'published',
      target: 'publish',
      stages: ['before'],
    },

    // ---- Lead-up and day of ------------------------------------------------
    {
      id: 'share',
      title: 'Share the link',
      description: 'Most first attendees come from a link the host sends themselves.',
      derived: local.shared,
      target: 'share',
      stages: ['leadup', 'dayof'],
    },
    {
      id: 'notify_followers',
      title: 'Notify your followers',
      description: 'One tap tells everyone who follows you that this is on.',
      derived: facts.notifiedFollowers ?? local.notifiedFollowers,
      target: 'notify_followers',
      stages: ['leadup'],
      when: phase === 'upcoming',
    },
    {
      id: 'review_requests',
      title: 'Review join requests',
      description: 'People are waiting on your approval to come.',
      derived: facts.requested == null ? null : facts.requested === 0,
      target: 'attendees',
      stages: ['leadup', 'dayof'],
      when: event.rsvp_mode === 'approval',
    },
    {
      id: 'waitlist_mode',
      title: 'Pick what happens when it fills',
      description: 'Move people up automatically, just notify them, or turn the waitlist off.',
      derived: event.waitlist_mode == null ? null : true,
      target: 'settings',
      stages: ['leadup'],
      when: hasCap,
      skipPresets: ['casual'],
    },
    {
      id: 'reminder_announcement',
      title: 'Send a reminder',
      description: 'One message to everyone going: timing, where to meet, what to bring.',
      derived: facts.reminderAnnouncementSent,
      manual: true,
      target: 'announce',
      stages: ['leadup', 'dayof'],
      when: hours != null && hours <= REMINDER_WINDOW_HOURS,
    },
    {
      id: 'pin_details',
      title: 'Pin the arrival details',
      description: 'A pinned message is the first thing people see in the chat.',
      derived: facts.pinnedMessage,
      manual: true,
      target: 'chat',
      stages: ['dayof'],
    },
    {
      id: 'clear_reports',
      title: 'Review reported messages',
      description: 'Reports on your event come to you first.',
      derived: false,
      target: 'chat',
      stages: ['leadup', 'dayof'],
      // Only while there is something to do; a ticked "no reports" is noise.
      when: (facts.openReports ?? 0) > 0,
    },
    {
      id: 'venue_confirmed',
      title: 'Confirm the space',
      description: 'Access, keys, power, tables — whatever this event needs to physically happen.',
      derived: null,
      manual: true,
      target: 'none',
      stages: ['leadup', 'dayof'],
    },

    // ---- After -------------------------------------------------------------
    {
      id: 'thank_you',
      title: 'Thank everyone who came',
      description: 'A short message after the event is what brings people back to the next one.',
      derived: facts.thankYouSent,
      manual: true,
      target: 'announce',
      stages: ['after'],
    },
    {
      id: 'review_insights',
      title: 'See how it went',
      description: 'Views, RSVPs and no-shows for this event.',
      derived: local.openedInsights,
      target: 'insights',
      stages: ['after'],
    },
    {
      id: 'run_again',
      title: 'Run it again',
      description: 'Copy this event into a new draft, or turn it into a repeating series.',
      derived: facts.ranAgain ?? local.duplicated,
      target: 'duplicate',
      stages: ['after'],
    },
    {
      id: 'reply_reviews',
      title: 'Reply to your reviews',
      description: 'A reply is public, and it is the cheapest trust you can build.',
      derived: facts.unansweredReviews == null ? null : facts.unansweredReviews === 0,
      target: 'reviews',
      stages: ['after'],
      forTypes: ['venue', 'organiser'],
    },
    {
      id: 'lessons',
      title: 'Note what to change next time',
      description: 'Timing, size, price, the space — while it is still fresh.',
      derived: null,
      manual: true,
      target: 'none',
      stages: ['after'],
    },
  ];

  const items: PlaybookItem[] = [];
  if (stage !== 'none') {
    for (const c of candidates) {
      if (!c.stages.includes(stage)) continue;
      if (c.when === false) continue;
      if (c.forTypes && !c.forTypes.includes(hostType)) continue;
      if (preset && c.skipPresets?.includes(preset)) continue;
      const manual = c.manual === true;
      // Unknown and not tickable → hide rather than show as "to do".
      if (c.derived === null && !manual) continue;
      items.push({
        id: c.id,
        title: c.title,
        description: c.description,
        target: c.target,
        manual,
        done: c.derived === true || (manual && ticked.has(c.id)),
      });
    }
  }

  const doneCount = items.filter((i) => i.done).length;
  return {
    phase,
    stage,
    items,
    doneCount,
    total: items.length,
    next: items.find((i) => !i.done) ?? null,
    complete: items.length > 0 && doneCount === items.length,
  };
}

export type PlaybookVisibility = 'hidden' | 'collapsed' | 'expanded';

/**
 * Whether and how the card shows. Dismissal is per stage, so dismissing the
 * lead-up list does not also hide the "after" list two days later.
 *
 * `hostEventCount` is how many events this host has ever published; from
 * EXPERIENCED_HOST_EVENTS on, the card starts collapsed so an experienced
 * host is not handed a list of things they already do. Unknown counts as
 * experienced — collapsed is the quieter wrong answer.
 */
export function playbookVisibility(input: {
  playbook: EventPlaybook;
  dismissedStages: readonly string[];
  hostEventCount: number | null;
}): PlaybookVisibility {
  const { playbook } = input;
  if (playbook.stage === 'none' || playbook.total === 0 || playbook.complete) return 'hidden';
  if (input.dismissedStages.includes(playbook.stage)) return 'hidden';
  const count = input.hostEventCount;
  return count == null || count >= EXPERIENCED_HOST_EVENTS ? 'collapsed' : 'expanded';
}

export const STAGE_TITLE: Record<Exclude<PlaybookStage, 'none'>, string> = {
  before: 'Before you publish',
  leadup: 'Before the day',
  dayof: 'Today',
  after: 'After the event',
};

/** Compact label for the My Events pill: "2 to do", or null when there is nothing. */
export function playbookPillLabel(playbook: EventPlaybook): string | null {
  const left = playbook.total - playbook.doneCount;
  if (playbook.stage === 'none' || left <= 0) return null;
  return `${left} to do`;
}

/**
 * Turns what the Manage hub already loads into `PlaybookFacts`. Pure, so the
 * inference rules are tested, and conservative: it only ever says `true` or
 * stays unknown, never `false`, because the hub's counts are coarse
 * (announcements per day, not per purpose) and a wrong "not done" nags.
 *
 * - `announcementsToday > 0` inside the final DAY_OF_HOURS means the
 *   reminder went out; the same count on the day the event ended means the
 *   thank-you did. Outside those windows the count proves nothing.
 * - Links and photos come straight from `get_event_details`.
 */
export function playbookFactsFromHub(input: {
  event: PlaybookEvent;
  now?: Date;
  requested?: number | null;
  openReports?: number | null;
  announcementsToday?: number | null;
  links?: number | null;
  photos?: number | null;
  /** `pinned_message_id` from the chat status; undefined = status not loaded. */
  pinnedMessageId?: string | null;
}): Partial<PlaybookFacts> {
  const now = input.now ?? new Date();
  const hours = hoursUntilStart(input.event, now);
  const end = new Date(input.event.end_datetime).getTime();
  const hoursSinceEnd = Number.isNaN(end) ? null : (now.getTime() - end) / HOUR_MS;
  const announced = (input.announcementsToday ?? 0) > 0;

  const facts: Partial<PlaybookFacts> = {
    requested: input.requested ?? null,
    openReports: input.openReports ?? null,
    eventLinks: input.links ?? null,
    photos: input.photos ?? null,
    pinnedMessage: input.pinnedMessageId === undefined ? null : !!input.pinnedMessageId,
  };
  if (announced && hours != null && hours > 0 && hours <= DAY_OF_HOURS) {
    facts.reminderAnnouncementSent = true;
  }
  if (announced && hoursSinceEnd != null && hoursSinceEnd >= 0 && hoursSinceEnd <= DAY_OF_HOURS) {
    facts.thankYouSent = true;
  }
  return facts;
}

/**
 * The same playbook without certain items, counts recomputed.
 *
 * Used by the publish preview, which drops `publish`: the sheet's own
 * primary button is the publish action, and listing it as a step inside the
 * sheet reads as a second, different button.
 */
export function omitPlaybookItems(playbook: EventPlaybook, ids: readonly PlaybookItemId[]): EventPlaybook {
  const drop = new Set(ids);
  const items = playbook.items.filter((i) => !drop.has(i.id));
  if (items.length === playbook.items.length) return playbook;
  const doneCount = items.filter((i) => i.done).length;
  return {
    ...playbook,
    items,
    doneCount,
    total: items.length,
    next: items.find((i) => !i.done) ?? null,
    complete: items.length > 0 && doneCount === items.length,
  };
}

/**
 * Which checklist item an announcement just sent satisfies, if any.
 *
 * The host hub can only see how many announcements went out today, not what
 * they were for (`playbookFactsFromHub`). When the host sends one from the
 * hub we know the stage they are in, so the right item can be ticked exactly
 * instead of inferred: a message during the run-up is the reminder, one
 * after the event is the thank-you.
 */
export function announcementItemForStage(stage: PlaybookStage): PlaybookItemId | null {
  if (stage === 'leadup' || stage === 'dayof') return 'reminder_announcement';
  if (stage === 'after') return 'thank_you';
  return null;
}

/** Stored checklist state, from either the device or the server. */
export type PlaybookStoredState = {
  ticked: readonly string[];
  dismissedStages: readonly string[];
};

/**
 * Which copy of the host's ticks to trust (P5).
 *
 * The device store came first (P1–P4) and keeps working when the backend has
 * no checklist table. Once it does, the server is authoritative — it is the
 * copy that follows a host to a second device.
 *
 * The one exception is the hand-over: a host who ticked things before the
 * migration landed has a local copy and an empty server row. Taking the
 * server's word there would silently throw their work away, so the local
 * copy wins once and is uploaded (`uploadFromLocal`).
 */
export function resolvePlaybookState(
  local: PlaybookStoredState,
  /** null = this backend has no checklist table yet. */
  server: PlaybookStoredState | null
): PlaybookStoredState & { uploadFromLocal: boolean } {
  if (server === null) return { ...local, uploadFromLocal: false };
  const serverEmpty = server.ticked.length === 0 && server.dismissedStages.length === 0;
  const localHasSomething = local.ticked.length > 0 || local.dismissedStages.length > 0;
  if (serverEmpty && localHasSomething) return { ...local, uploadFromLocal: true };
  return { ...server, uploadFromLocal: false };
}
