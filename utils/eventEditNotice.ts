/**
 * What Edit must confirm with the host before saving, because the save sends
 * a notification (EJ-15 / EJ-20 / EJ-21).
 *
 * The server decides the audience once, in `event_notice_audience`
 * (20261117120000): going, interested, waiting for approval, the waitlist,
 * savers, and date-only goers of a date still ahead — minus the host and
 * anyone who switched `event_update` off. The copy here names that same list;
 * before that migration the dialog promised savers who were never told, and
 * said nothing about date-only goers.
 *
 * Which saves notify:
 * - time or place: `reschedule_event` → "Event rescheduled" / "now ends at"
 *   / "Event location changed".
 * - the recurrence pattern, or one-off <-> series (EJ-20): a plain update now
 *   fires "Schedule changed". It used to be silent while it dropped dates and
 *   pruned per-date RSVPs.
 *
 * Silent, and so no prompt: drafts (no audience yet) and postponed events for
 * a schedule-only change — `notify_rsvp_users_on_event_update` only fires for
 * an active, published event.
 */
export type EditNoticePrompt = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
};

/** Everyone `event_notice_audience` reaches, in the host's words. */
const AUDIENCE =
  "everyone who's going, interested, waiting for your approval, on the waitlist, going to a single date, or who saved it";

export function editNoticePrompt(input: {
  /** start / end / address / lat / lng changed. */
  timePlaceChanged: boolean;
  /** recurrence_pattern or is_recurring changed. */
  scheduleChanged: boolean;
  isPostponed: boolean;
  isDraft: boolean;
  goingCount: number;
}): EditNoticePrompt | null {
  const { timePlaceChanged, scheduleChanged, isPostponed, isDraft, goingCount } = input;
  const going = goingCount > 0 ? ` (${goingCount} going)` : '';

  if (timePlaceChanged && (isPostponed || !isDraft)) {
    if (isPostponed) {
      return {
        title: 'Set the new date?',
        message: 'This reopens joining and tells everyone the event is back on at the new time.',
        confirmLabel: 'Set date',
        cancelLabel: 'Keep editing',
      };
    }
    return {
      title: 'Notify attendees?',
      message:
        `Changing the time or location sends a "rescheduled" notification to ${AUDIENCE}${going}.` +
        (scheduleChanged ? ' The new repeat schedule is announced as well.' : '') +
        ' Save anyway?',
      confirmLabel: 'Save and notify',
      cancelLabel: 'Keep editing',
    };
  }

  // EJ-20: a pattern change on its own. Postponed events notify no one.
  if (scheduleChanged && !isDraft && !isPostponed) {
    return {
      title: 'Notify attendees?',
      message:
        `Changing how this event repeats sends a "Schedule changed" notification to ${AUDIENCE}${going}. ` +
        'Dates that no longer happen are dropped, including anyone who signed up for just those dates. Save anyway?',
      confirmLabel: 'Save and notify',
      cancelLabel: 'Keep editing',
    };
  }

  return null;
}
