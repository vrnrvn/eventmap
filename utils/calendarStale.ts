/**
 * EJ-23: "Add to calendar" writes a static Google URL or .ics file, so a
 * calendar entry added before a reschedule keeps the old time forever. The
 * reschedule notice routes to the event page, and nothing there used to say
 * the time had moved.
 *
 * `events.rescheduled_at` (20261117120000) is set whenever reschedule_event
 * moves the start or end. If it is later than the viewer's own RSVP, whatever
 * they added to their calendar at that point is out of date.
 *
 * Deliberately conservative: with no RSVP (so no `rsvpAt`) nothing is shown —
 * the viewer has no calendar entry of ours to fix. Re-joining after the
 * reschedule writes a newer RSVP and clears the hint.
 */
export function calendarNeedsUpdate(
  rescheduledAt: string | null | undefined,
  rsvpAt: string | null | undefined
): boolean {
  if (!rescheduledAt || !rsvpAt) return false;
  const moved = Date.parse(rescheduledAt);
  const joined = Date.parse(rsvpAt);
  if (Number.isNaN(moved) || Number.isNaN(joined)) return false;
  return moved > joined;
}
