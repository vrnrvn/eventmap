/**
 * Which Plan B moments apply to the viewer of an event page right now
 * (docs/PLAN_B_PLAN.md §1, §3.1), from what the page already holds — no
 * request. Pure, so the screen stays thin and the rules are unit-tested.
 *
 *  - page (T1/T3): the whole event is cancelled, or it is full for a viewer
 *    who isn't going (waitlisted included — a backup beside the waitlist).
 *  - date (T2): a series date the viewer was going to is cancelled.
 *  - late (T5): the viewer is going to a session that is on now or starts
 *    within 30 minutes — the "Can't make it?" row.
 *
 * Never for the host or the rehearsal preview (the caller passes
 * `enabled: false`), never for a draft.
 */
import { deriveEventViewer } from '@/utils/eventViewer';
import {
  dateAttendance,
  nextEffectiveOccurrence,
  upcomingDateRows,
  type DateRsvpOverride,
  type OccurrenceException,
} from '@/utils/occurrences';
import { planBAnchor, type PlanBAnchor } from '@/utils/planB';
import type { EventDetails } from '@/types/database';

/** "Can't make it?" is offered from this long before the start. */
export const CANT_MAKE_IT_LEAD_MS = 30 * 60 * 1000;

export type PlanBMoments = {
  page: PlanBAnchor | null;
  date: { anchor: PlanBAnchor; start: Date } | null;
  late: { anchor: PlanBAnchor; seriesDateKey: string | null; start: Date } | null;
};

export const NO_PLAN_B: PlanBMoments = { page: null, date: null, late: null };

export function planBMoments(input: {
  details: Pick<EventDetails, 'event' | 'rsvp_count' | 'user_rsvp' | 'waitlist'> & {
    category?: { label?: string | null } | null;
  };
  userId: string | null;
  userBusinessId: string | null;
  exceptions: readonly OccurrenceException[];
  dateOverrides: readonly DateRsvpOverride[];
  now: Date;
  enabled: boolean;
}): PlanBMoments {
  const { details, exceptions, dateOverrides, now } = input;
  const event = details.event;
  if (!input.enabled || event.publish_state === 'draft') return NO_PLAN_B;
  const viewer = deriveEventViewer({
    details,
    userId: input.userId,
    userBusinessId: input.userBusinessId,
    exceptions,
    now,
  });
  if (viewer.isOwner) return NO_PLAN_B;
  const categoryLabel = details.category?.label ?? null;
  const anchorEvent = {
    id: event.id,
    business_id: event.business_id,
    category_id: event.category_id,
    lat: event.lat,
    lng: event.lng,
  };

  // The session in question for the whole event: a one-off's own times; for
  // a series, the one running now, else the next one actually happening.
  const seriesSession = () => {
    if (viewer.liveOccurrence) return viewer.liveOccurrence;
    return nextEffectiveOccurrence(event, exceptions, now);
  };
  const session: { start: Date; end: Date; dateKey?: string } | null = event.is_recurring
    ? (() => {
        const o = seriesSession();
        return o ? { start: o.start, end: o.end, dateKey: o.dateKey } : null;
      })()
    : { start: new Date(event.start_datetime), end: new Date(event.end_datetime) };

  // T1 / T3.
  let page: PlanBAnchor | null = null;
  if (session && viewer.cancelled) {
    page = planBAnchor({ reason: 'cancelled', event: anchorEvent, categoryLabel, session, now });
  } else if (session && viewer.full && !viewer.ended && !viewer.postponed && !viewer.hasJoined) {
    page = planBAnchor({ reason: 'full', event: anchorEvent, categoryLabel, session, now });
  }

  // T2: the first upcoming cancelled date the viewer was going to.
  let date: PlanBMoments['date'] = null;
  if (event.is_recurring && !viewer.cancelled && !viewer.ended && input.userId) {
    const hit = upcomingDateRows(event, exceptions, { count: 5, now }).find(
      (o) => o.status === 'cancelled' && dateAttendance(details.user_rsvp, dateOverrides, o.dateKey) === 'going'
    );
    if (hit) {
      const anchor = planBAnchor({
        reason: 'date_cancelled',
        event: anchorEvent,
        categoryLabel,
        session: { start: hit.start, end: hit.end, dateKey: hit.dateKey },
        now,
      });
      if (anchor) date = { anchor, start: hit.start };
    }
  }

  // T5: going to a session that is on now or about to start.
  let late: PlanBMoments['late'] = null;
  if (session && !viewer.cancelled && !viewer.ended && input.userId) {
    const startsIn = session.start.getTime() - now.getTime();
    const onNow = startsIn <= 0 && session.end.getTime() > now.getTime();
    const soon = startsIn > 0 && startsIn <= CANT_MAKE_IT_LEAD_MS;
    const going = event.is_recurring
      ? !!session.dateKey && dateAttendance(details.user_rsvp, dateOverrides, session.dateKey) === 'going'
      : viewer.hasJoined;
    if ((onNow || soon) && going) {
      const anchor = planBAnchor({ reason: 'late', event: anchorEvent, categoryLabel, session, now });
      if (anchor) late = { anchor, seriesDateKey: event.is_recurring ? session.dateKey ?? null : null, start: session.start };
    }
  }

  return { page, date, late };
}
