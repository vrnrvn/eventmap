/**
 * Maps RSVP failures (join_event_with_capacity RPC, rsvps RLS) to a small set
 * of codes with user-facing copy. Pure module — unit-tested under node.
 *
 * The RPC raises plain-text exceptions (SQLSTATE P0001), so classification is
 * by message. RLS rejections on the direct rsvps path arrive as 42501.
 */

export type RsvpErrorCode =
  | 'EVENT_FULL'
  | 'EVENT_CLOSED'
  | 'SUSPENDED'
  | 'NOT_FOUND'
  | 'NOT_AUTHENTICATED'
  /** Waitlist RPC: a seat is free right now, so the caller should just join. */
  | 'SPOT_AVAILABLE'
  /** Waitlist RPC: the caller already holds a going seat. */
  | 'ALREADY_GOING'
  /** Waitlist RPC: the event has no capacity limit. */
  | 'WAITLIST_NOT_NEEDED'
  | 'UNKNOWN';

export class RsvpError extends Error {
  readonly code: RsvpErrorCode;

  constructor(code: RsvpErrorCode, cause?: unknown) {
    super(rsvpErrorMessage(code));
    this.name = 'RsvpError';
    this.code = code;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

type ErrorLike = { message?: unknown; code?: unknown; details?: unknown };

export function classifyRsvpError(err: unknown): RsvpErrorCode {
  if (err instanceof RsvpError) return err.code;
  const e = (err ?? {}) as ErrorLike;
  const message = [e.message, e.details]
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase();
  const code = typeof e.code === 'string' ? e.code : '';

  if (message.includes('event_full')) return 'EVENT_FULL';
  if (message.includes('event_closed')) return 'EVENT_CLOSED';
  if (message.includes('spot_available')) return 'SPOT_AVAILABLE';
  if (message.includes('already_going')) return 'ALREADY_GOING';
  if (message.includes('waitlist_not_needed')) return 'WAITLIST_NOT_NEEDED';
  if (message.includes('event_not_found')) return 'NOT_FOUND';
  if (message.includes('account suspended')) return 'SUSPENDED';
  if (message.includes('not_authenticated') || message === 'not authenticated') {
    return 'NOT_AUTHENTICATED';
  }
  // Direct-table path: the rsvps INSERT/UPDATE policies only reject for a
  // ban or an event that is cancelled/ended. Either way the event can't be
  // joined right now, so treat the generic permission error as "closed".
  if (code === '42501') return 'EVENT_CLOSED';
  return 'UNKNOWN';
}

export function rsvpErrorMessage(code: RsvpErrorCode): string {
  switch (code) {
    case 'EVENT_FULL':
      return 'This event has reached its maximum number of attendees.';
    case 'EVENT_CLOSED':
      return 'This event is no longer accepting RSVPs.';
    case 'SUSPENDED':
      return 'Your account has been suspended. Please contact support.';
    case 'NOT_FOUND':
      return 'This event no longer exists.';
    case 'NOT_AUTHENTICATED':
      return 'Sign in to RSVP.';
    case 'SPOT_AVAILABLE':
      return 'A spot just opened up — you can join directly.';
    case 'ALREADY_GOING':
      return "You're already going to this event.";
    case 'WAITLIST_NOT_NEEDED':
      return 'This event has no attendee limit — just join.';
    default:
      return 'Failed to update RSVP. Please try again.';
  }
}

/** Codes after which the screen should re-fetch the event to show its real state. */
export function rsvpErrorNeedsRefresh(code: RsvpErrorCode): boolean {
  return (
    code === 'EVENT_FULL' ||
    code === 'EVENT_CLOSED' ||
    code === 'NOT_FOUND' ||
    code === 'SPOT_AVAILABLE' ||
    code === 'ALREADY_GOING' ||
    code === 'WAITLIST_NOT_NEEDED'
  );
}
