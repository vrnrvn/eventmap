/**
 * Pure helpers for the host "Manage event" hub. No React Native imports so
 * they can be unit-tested under node (see tests/hostEvent.test.ts).
 */
import { hasEventEnded, isEventInProgress, type EventTimingFields } from '@/utils/eventStatus';
import type { EventStatus } from '@/types/database';

export type HostEventPhase = 'draft' | 'cancelled' | 'postponed' | 'live' | 'ended' | 'upcoming';

export type HostEventSummaryInput = EventTimingFields & {
  status?: EventStatus;
  max_attendees?: number | null;
  publish_state?: 'draft' | 'published';
};

export type HostCounts = {
  going: number;
  /** null while the host overview RPC is unavailable (RLS hides it). */
  interested: number | null;
  waitlist: number | null;
  saves: number;
};

/**
 * Where the event is in its lifecycle. `live` only applies to one-off events
 * that are currently in progress; recurring series are `upcoming` until the
 * series end date passes.
 */
export function getHostEventPhase(event: HostEventSummaryInput, now: Date = new Date()): HostEventPhase {
  if (event.status === 'cancelled') return 'cancelled';
  if (event.publish_state === 'draft') return 'draft';
  if (event.status === 'postponed') return 'postponed';
  if (hasEventEnded(event, now)) return 'ended';
  if (isEventInProgress(event, now)) return 'live';
  return 'upcoming';
}

export const HOST_PHASE_BADGE: Record<
  HostEventPhase,
  { label: string; tone: 'danger' | 'success' | 'primary' | 'neutral' }
> = {
  draft: { label: 'Draft', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  postponed: { label: 'Postponed', tone: 'danger' },
  live: { label: 'LIVE', tone: 'success' },
  ended: { label: 'Past', tone: 'neutral' },
  upcoming: { label: 'Upcoming', tone: 'primary' },
};

export type CapacitySummary = {
  /** "12 going" or "12 / 40 going". */
  label: string;
  /** 0..1 fill ratio for a progress bar; null when unlimited. */
  ratio: number | null;
  /** Seats left; null when unlimited. Never negative. */
  spotsLeft: number | null;
  isFull: boolean;
};

export function summarizeCapacity(going: number, maxAttendees: number | null | undefined): CapacitySummary {
  if (!maxAttendees || maxAttendees <= 0) {
    return { label: `${going} going`, ratio: null, spotsLeft: null, isFull: false };
  }
  const spotsLeft = Math.max(0, maxAttendees - going);
  return {
    label: `${going} / ${maxAttendees} going`,
    ratio: Math.min(1, going / maxAttendees),
    spotsLeft,
    isFull: going >= maxAttendees,
  };
}

/**
 * Which hub actions make sense for an event in a given phase. Cancelled and
 * ended events are read-only apart from insights; recurring series stay
 * editable until their end date.
 */
export function getHostActions(phase: HostEventPhase) {
  const editable = phase === 'upcoming' || phase === 'live' || phase === 'draft' || phase === 'postponed';
  return {
    canEdit: editable,
    canCancel: phase === 'upcoming' || phase === 'live' || phase === 'postponed',
    canNotifyFollowers: phase === 'upcoming',
    canManageAttendees: phase === 'upcoming' || phase === 'live' || phase === 'postponed',
    canModerateChat: phase !== 'cancelled' && phase !== 'draft',
    canViewInsights: phase !== 'draft',
    /** Draft → published (publish_event). */
    canPublish: phase === 'draft',
    /** Pause with "new date coming" (postpone_event). */
    canPostpone: phase === 'upcoming',
    /** New date/place via reschedule_event; also how a postponed event resumes. */
    canReschedule: phase === 'upcoming' || phase === 'postponed',
    /** Copy into a new draft (duplicate_event). */
    canDuplicate: phase !== 'draft',
  };
}

/** Human line for the Overview card, e.g. "3 interested · 2 waiting · 9 saves". */
export function formatSecondaryCounts(counts: HostCounts): string {
  const parts: string[] = [];
  if (counts.interested !== null) parts.push(`${counts.interested} interested`);
  if (counts.waitlist !== null && counts.waitlist > 0) parts.push(`${counts.waitlist} waiting`);
  parts.push(`${counts.saves} ${counts.saves === 1 ? 'save' : 'saves'}`);
  return parts.join(' · ');
}

/**
 * How a host sees an attendee who keeps their profile private: first name plus
 * last initial ("Sam K."). Mirrors `host_display_name` in
 * 20261103100000_host_event_tools.sql so the fallback path and the RPC agree.
 */
export function abbreviateName(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return 'Attendee';
  const words = trimmed.split(/\s+/);
  if (words.length === 1) return words[0];
  return `${words[0]} ${words[words.length - 1][0]}.`;
}
