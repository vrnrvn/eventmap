/**
 * Host dashboard agenda (docs/HOST_DASHBOARD_PLAN.md, phase C1).
 *
 * Pure: takes the host's upcoming event rows, their going counts and the
 * per-date exceptions of their series, and returns "today and the next
 * days" as occurrences grouped by the host's own calendar day. No React, no
 * network — unit-tested in tests/hostDashboard.test.ts.
 *
 * Decisions applied (plan §6): DC3 a fixed 7-day window; DC4 skipped dates
 * stay in the agenda, marked cancelled, so the host sees the gap they made.
 */
import type { Event } from '@/types/database';
import { hasEventEnded } from '@/utils/eventStatus';
import { listOccurrences, type OccurrenceException } from '@/utils/occurrences';

/** DC3: today plus the following six days. */
export const AGENDA_DAYS = 7;

/** Series whose per-date going counts the dashboard fetches, at most. */
export const MAX_SERIES_DATE_COUNTS = 10;

/** Upcoming rows the dashboard asks for; more means the agenda may be incomplete. */
export const AGENDA_EVENT_LIMIT = 50;

/** Going / waitlist for one event, as `get_host_events_counts` returns it. */
export type AgendaCounts = { going: number; waitlist: number | null };

export type AgendaEntryStatus = 'scheduled' | 'moved' | 'cancelled' | 'live';

export type AgendaEntry = {
  /** Stable React key: event id, plus the date key for a series. */
  key: string;
  eventId: string;
  title: string;
  /** Start in effect (the new time for a moved date). */
  start: Date;
  /** The date's scheduled start before any move (equals `start` otherwise). */
  originalStart: Date;
  end: Date;
  /** Occurrence key ('YYYY-MM-DD' in the event zone) for series; null for one-offs. */
  dateKey: string | null;
  isSeries: boolean;
  /** 'live' = happening right now. 'cancelled' = a skipped series date (DC4). */
  status: AgendaEntryStatus;
  /** Host's note on a skipped or moved date. */
  note: string | null;
  going: number | null;
  /**
   * What `going` counts: this one date of a series, the whole series (the
   * per-date count was not available), or a one-off event.
   */
  goingScope: 'date' | 'series' | 'event' | null;
  capacity: number | null;
  waitlist: number | null;
  timezone: string | null;
  /** Series only: `recurrence_pattern.endDate`, for the move picker (EJ-14). */
  seriesEndDate?: string | null;
};

export type AgendaDay = {
  /** Device-local 'YYYY-MM-DD'. */
  key: string;
  /** Local midnight of the day. */
  date: Date;
  relative: 'today' | 'tomorrow' | null;
  entries: AgendaEntry[];
};

export type AgendaInput = {
  events: readonly Event[];
  /** Keyed by event id. Missing = counts unknown (the agenda still renders). */
  counts: Readonly<Record<string, AgendaCounts>>;
  exceptions: readonly OccurrenceException[];
  /** seriesId → dateKey → going, from get_occurrence_going_counts. */
  dateGoing?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  now: Date;
  days?: number;
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Device-local 'YYYY-MM-DD' of an instant. */
export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** [start of today, start of the day after the window) on the device calendar. */
export function agendaWindow(now: Date, days: number = AGENDA_DAYS): { from: Date; to: Date } {
  const from = startOfLocalDay(now);
  // Built from components, so a DST change inside the window can't shift it.
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + Math.max(1, Math.floor(days)));
  return { from, to };
}

/**
 * Events that can appear on the agenda: published-and-upcoming rows the
 * service returns, minus anything cancelled, postponed (it has no date to
 * show — the attention queue handles it) or already over.
 */
function isAgendaCandidate(e: Event, now: Date): boolean {
  if (e.status === 'cancelled' || e.status === 'postponed') return false;
  if (e.publish_state === 'draft') return false;
  return !hasEventEnded(e, now);
}

export function buildAgenda(input: AgendaInput): AgendaDay[] {
  const { events, counts, exceptions, dateGoing, now } = input;
  const { from, to } = agendaWindow(now, input.days);
  const days = Math.max(1, Math.floor(input.days ?? AGENDA_DAYS));

  const exceptionsByEvent = new Map<string, OccurrenceException[]>();
  for (const x of exceptions) {
    const list = exceptionsByEvent.get(x.event_id);
    if (list) list.push(x);
    else exceptionsByEvent.set(x.event_id, [x]);
  }

  const entries: AgendaEntry[] = [];
  for (const e of events) {
    if (!isAgendaCandidate(e, now)) continue;
    const c = counts[e.id];
    const capacity = e.max_attendees ?? null;
    const waitlist = c?.waitlist ?? null;
    const timezone = e.timezone ?? null;

    if (!e.is_recurring || !e.recurrence_pattern) {
      const start = new Date(e.start_datetime);
      const end = new Date(e.end_datetime);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
      if (end <= now || start >= to) continue;
      entries.push({
        key: e.id,
        eventId: e.id,
        title: e.title,
        start,
        originalStart: start,
        end,
        dateKey: null,
        isSeries: false,
        status: start <= now ? 'live' : 'scheduled',
        note: null,
        going: c ? c.going : null,
        goingScope: c ? 'event' : null,
        capacity,
        waitlist,
        timezone,
      });
      continue;
    }

    // A series: at most one occurrence per day, so `days + 1` live dates
    // always cover the window; cancelled dates come on top (listOccurrences
    // over-fetches by the number of exceptions).
    const occurrences = listOccurrences(e, exceptionsByEvent.get(e.id) ?? [], {
      count: days + 1,
      now: from,
      includeCancelled: true,
    });
    for (const o of occurrences) {
      if (o.end <= now || o.start >= to) continue;
      const perDate = dateGoing?.[e.id]?.[o.dateKey];
      const status: AgendaEntryStatus =
        o.status === 'cancelled' ? 'cancelled' : o.status === 'moved' ? 'moved' : o.start <= now ? 'live' : 'scheduled';
      entries.push({
        key: `${e.id}:${o.dateKey}`,
        eventId: e.id,
        title: e.title,
        start: o.start,
        originalStart: o.originalStart,
        end: o.end,
        dateKey: o.dateKey,
        isSeries: true,
        status,
        note: o.note,
        // A skipped date has nobody going to it, whatever the series says.
        going: status === 'cancelled' ? null : perDate ?? (c ? c.going : null),
        goingScope: status === 'cancelled' ? null : perDate !== undefined ? 'date' : c ? 'series' : null,
        capacity,
        waitlist: status === 'cancelled' ? null : waitlist,
        timezone,
        seriesEndDate: e.recurrence_pattern?.endDate ?? null,
      });
    }
  }

  entries.sort((a, b) => a.start.getTime() - b.start.getTime() || a.title.localeCompare(b.title));

  const todayKey = localDayKey(from);
  const tomorrowKey = localDayKey(new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1));
  const byDay = new Map<string, AgendaDay>();
  for (const entry of entries) {
    // A live event that started yesterday still belongs to today.
    const anchor = entry.start < from ? from : entry.start;
    const key = localDayKey(anchor);
    let day = byDay.get(key);
    if (!day) {
      day = {
        key,
        date: startOfLocalDay(anchor),
        relative: key === todayKey ? 'today' : key === tomorrowKey ? 'tomorrow' : null,
        entries: [],
      };
      byDay.set(key, day);
    }
    day.entries.push(entry);
  }
  return [...byDay.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

export type AgendaSummary = {
  /** Occurrences happening today (skipped dates excluded). */
  today: number;
  /** Occurrences in the whole window (skipped dates excluded). */
  week: number;
  /** Going across today's occurrences whose count is known. */
  goingToday: number;
  /** The next thing that starts (or is live), if any. */
  next: AgendaEntry | null;
  /** The agenda day `next` sits under (so copy can say "Tomorrow" / "Thu"). */
  nextDay: Pick<AgendaDay, 'relative' | 'date'> | null;
};

export function summarizeAgenda(days: readonly AgendaDay[]): AgendaSummary {
  let today = 0;
  let week = 0;
  let goingToday = 0;
  let next: AgendaEntry | null = null;
  let nextDay: AgendaSummary['nextDay'] = null;
  for (const day of days) {
    for (const entry of day.entries) {
      if (entry.status === 'cancelled') continue;
      week += 1;
      if (!next) {
        next = entry;
        nextDay = { relative: day.relative, date: day.date };
      }
      if (day.relative === 'today') {
        today += 1;
        goingToday += entry.going ?? 0;
      }
    }
  }
  return { today, week, goingToday, next, nextDay };
}

/**
 * Series dates that need a per-date going count: seriesId → date keys in the
 * window, for at most `MAX_SERIES_DATE_COUNTS` series (soonest first). Skipped
 * dates are left out — nobody is going to them.
 */
export function seriesDatesInAgenda(
  days: readonly AgendaDay[],
  max: number = MAX_SERIES_DATE_COUNTS
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let series = 0;
  for (const day of days) {
    for (const entry of day.entries) {
      if (!entry.isSeries || !entry.dateKey || entry.status === 'cancelled') continue;
      if (!out[entry.eventId]) {
        if (series >= max) continue;
        out[entry.eventId] = [];
        series += 1;
      }
      out[entry.eventId].push(entry.dateKey);
    }
  }
  return out;
}

/**
 * "28 going", "112 / 150 going", "12 going · 4 waiting" — or null when
 * unknown. A series date that only has the whole-series count says so ("40
 * going to the series"): attendees can opt out of single dates, so that
 * number is not a head count for this date.
 */
export function describeAttendance(entry: AgendaEntry): string | null {
  if (entry.status === 'cancelled') return 'Skipped';
  if (entry.going === null) return null;
  const going = entry.capacity ? `${entry.going} / ${entry.capacity} going` : `${entry.going} going`;
  const scope = entry.goingScope === 'series' ? ' to the series' : '';
  const waiting = entry.waitlist ? ` · ${entry.waitlist} waiting` : '';
  return `${going}${scope}${waiting}`;
}

/**
 * Wording of the Profile "Today" card for a cached summary (null = the
 * dashboard has never loaded on this device). `formatTime` is injected so
 * this stays free of locale/zone formatting.
 */
export function todayCardCopy(
  summary: AgendaSummary | null,
  formatTime: (entry: AgendaEntry) => string,
  formatWeekday: (day: Date) => string = (d) => d.toLocaleDateString(undefined, { weekday: 'short' })
): { title: string; detail: string } {
  if (!summary) {
    return { title: 'Your hosting week', detail: `See today and the next ${AGENDA_DAYS - 1} days across all your events` };
  }
  if (summary.week === 0) return { title: 'Nothing on this week', detail: `Your schedule for the next ${AGENDA_DAYS} days` };
  const title = summary.today > 0 ? `${summary.today} today · ${summary.week} this week` : `${summary.week} this week`;
  const next = summary.next;
  if (!next) return { title, detail: 'Open your schedule' };
  // Name the day unless it is today, so "Next: 12:00 PM" never reads as
  // tonight when it is tomorrow.
  const day = summary.nextDay;
  const dayWord = !day || day.relative === 'today' ? '' : day.relative === 'tomorrow' ? 'Tomorrow ' : `${formatWeekday(day.date)} `;
  const when = next.status === 'live' ? 'Happening now' : `Next: ${dayWord}${formatTime(next)}`;
  return { title, detail: `${when} · ${next.title}` };
}

/* ──────────────────────── Needs attention (C2) ──────────────────────── */

/**
 * The parts of `HostOverview` (services/hostTools) this module needs.
 * Structural on purpose: utils stay free of service imports, and
 * `HostOverview` satisfies it.
 */
export type AttentionOverview = {
  requested: number | null;
  waitlist: number | null;
  chat: { open_reports: number | null } | null;
};

export type AttentionKind =
  | 'chat_reports'
  | 'requests'
  | 'postponed'
  | 'waitlist'
  | 'stale_draft'
  | 'closed_soon'
  | 'just_filled';

/** Where a queue row sends the host. `tab` matches Manage event's tabs. */
export type AttentionTarget = {
  screen: 'manage' | 'edit';
  tab?: 'overview' | 'attendees' | 'settings' | 'chat';
  /** Attendee segment to open on (`tab: 'attendees'`). */
  seg?: 'requested' | 'waitlist';
};

export type AttentionItem = {
  key: string;
  kind: AttentionKind;
  eventId: string;
  title: string;
  /** The number the row leads with, when the rule has one. */
  count: number | null;
  /** 'action' = someone is waiting on the host; 'suggestion' = worth a look. */
  severity: 'action' | 'suggestion';
  target: AttentionTarget;
};

/** How soon an event counts as "starting soon" for the RSVPs-off rule. */
export const CLOSED_SOON_HOURS = 48;
/** How long an unpublished draft sits before the dashboard mentions it. */
export const STALE_DRAFT_DAYS = 3;
/** DC5: events inspected with the per-event overview RPC before C3 exists. */
export const MAX_OVERVIEW_TARGETS = 10;

export type AttentionInput = {
  /** Upcoming rows, as the agenda uses (cancelled rows are ignored). */
  events: readonly Event[];
  /** Draft rows (`getBusinessEvents({ scope: 'drafts' })`). */
  drafts?: readonly Event[];
  counts: Readonly<Record<string, AgendaCounts>>;
  /** Overviews actually fetched, keyed by event id (see overviewTargets). */
  overviews?: Readonly<Record<string, AttentionOverview>>;
  now: Date;
};

/** Rule order = display order (docs/HOST_DASHBOARD_PLAN.md §5). */
const KIND_ORDER: AttentionKind[] = [
  'chat_reports',
  'requests',
  'postponed',
  'waitlist',
  'stale_draft',
  'closed_soon',
  'just_filled',
];

function startMs(e: Event): number {
  const t = new Date(e.start_datetime).getTime();
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}

/**
 * What needs the host's attention now, most urgent first. Rules that read
 * `overviews` only fire for events that were actually inspected; everything
 * else is derived from rows the dashboard already has.
 */
export function buildAttentionQueue(input: AttentionInput): AttentionItem[] {
  const { events, drafts = [], counts, overviews = {}, now } = input;
  const items: AttentionItem[] = [];
  const add = (
    kind: AttentionKind,
    e: Event,
    count: number | null,
    severity: AttentionItem['severity'],
    target: AttentionTarget
  ) => items.push({ key: `${kind}:${e.id}`, kind, eventId: e.id, title: e.title, count, severity, target });

  for (const e of events) {
    if (e.status === 'cancelled' || e.publish_state === 'draft') continue;
    if (hasEventEnded(e, now)) continue;

    const overview = overviews[e.id];
    const reports = overview?.chat?.open_reports ?? 0;
    if (reports > 0) add('chat_reports', e, reports, 'action', { screen: 'manage', tab: 'chat' });

    const requested = overview?.requested ?? 0;
    if (e.rsvp_mode === 'approval' && requested > 0) {
      add('requests', e, requested, 'action', { screen: 'manage', tab: 'attendees', seg: 'requested' });
    }

    if (e.status === 'postponed') {
      add('postponed', e, null, 'action', { screen: 'manage', tab: 'settings' });
      // A postponed event has no date to act on; the rules below would be noise.
      continue;
    }

    const c = counts[e.id];
    const going = c?.going ?? null;
    const waitlist = c?.waitlist ?? overview?.waitlist ?? null;
    const capacity = e.max_attendees ?? null;
    // `waitlist_mode` undefined means 'notify' (types/database.ts).
    const waitlistMode = e.waitlist_mode ?? 'notify';
    const room = capacity === null || going === null || going < capacity;
    if (waitlist !== null && waitlist > 0 && room && waitlistMode !== 'auto') {
      add('waitlist', e, waitlist, 'action', { screen: 'manage', tab: 'attendees', seg: 'waitlist' });
    }

    const hoursAway = (startMs(e) - now.getTime()) / 3600_000;
    if (e.rsvp_closed && hoursAway > 0 && hoursAway < CLOSED_SOON_HOURS && (going ?? 0) === 0) {
      add('closed_soon', e, null, 'suggestion', { screen: 'manage', tab: 'settings' });
    }

    if (capacity !== null && going !== null && going >= capacity && waitlistMode === 'off') {
      add('just_filled', e, going, 'suggestion', { screen: 'manage', tab: 'settings' });
    }
  }

  const staleBefore = now.getTime() - STALE_DRAFT_DAYS * 24 * 3600_000;
  for (const d of drafts) {
    if (d.status === 'cancelled') continue;
    const updated = new Date(d.updated_at ?? d.created_at ?? '').getTime();
    if (!Number.isFinite(updated) || updated > staleBefore) continue;
    if (startMs(d) <= now.getTime()) continue; // a draft whose date has passed needs new dates, not a nudge
    add('stale_draft', d, null, 'action', { screen: 'edit' });
  }

  return items.sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      (b.count ?? 0) - (a.count ?? 0) ||
      a.title.localeCompare(b.title)
  );
}

/**
 * Which events to spend an overview call on (DC5). Approval-mode events
 * first — they are the only ones that can have join requests — then the rest
 * by how soon they start, capped at `max`. Cancelled, ended and draft rows
 * never qualify.
 */
export function overviewTargets(
  events: readonly Event[],
  now: Date,
  max: number = MAX_OVERVIEW_TARGETS
): string[] {
  const eligible = events.filter(
    (e) => e.status !== 'cancelled' && e.publish_state !== 'draft' && !hasEventEnded(e, now)
  );
  const rank = (e: Event) => (e.rsvp_mode === 'approval' ? 0 : 1);
  return [...eligible]
    .sort((a, b) => rank(a) - rank(b) || startMs(a) - startMs(b))
    .slice(0, Math.max(0, Math.floor(max)))
    .map((e) => e.id);
}

/** Row wording: ("4 requests waiting", "Board game night"). */
export function describeAttention(item: AttentionItem): string {
  const n = item.count ?? 0;
  switch (item.kind) {
    case 'chat_reports':
      return n === 1 ? '1 chat report' : `${n} chat reports`;
    case 'requests':
      return n === 1 ? '1 request waiting' : `${n} requests waiting`;
    case 'postponed':
      return 'Postponed · needs a new date';
    case 'waitlist':
      return n === 1 ? '1 person on the waitlist' : `${n} people on the waitlist`;
    case 'stale_draft':
      return 'Draft not published yet';
    case 'closed_soon':
      return 'Starting soon with RSVPs switched off';
    case 'just_filled':
      return 'Full · no waitlist';
    default:
      return '';
  }
}

/* ─────────────────────── Per-date operations (C5) ─────────────────────── */

export type DateAction = 'move' | 'skip' | 'restore';

/**
 * Which per-date operations a schedule row offers (C5). Mirrors what the
 * occurrence RPCs accept (20261109140000: host/admin, real future dates only)
 * and what Manage event's "Upcoming dates" list offers:
 *  - one-off events: none (Manage event's reschedule covers them);
 *  - a scheduled date still ahead: change its time, or skip it;
 *  - a skipped or moved date whose original time is still ahead: restore it;
 *  - anything already started (live) or past: none.
 */
export function dateActionsFor(entry: AgendaEntry, now: Date): DateAction[] {
  if (!entry.isSeries || !entry.dateKey) return [];
  if (entry.status === 'live') return [];
  if (entry.status === 'cancelled' || entry.status === 'moved') {
    return entry.originalStart.getTime() > now.getTime() ? ['restore'] : [];
  }
  return entry.start.getTime() > now.getTime() ? ['move', 'skip'] : [];
}
