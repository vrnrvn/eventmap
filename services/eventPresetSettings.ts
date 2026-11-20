import { eventsService } from './events';
import { hostToolsService } from './hostTools';
import { eventChatService } from './eventChat';
import { presetSettingsToApply, type EventPresetId } from '@/utils/eventPresets';

/**
 * Applies the non-default settings of an event size preset after the event
 * row exists (HOST_ONBOARDING_PLAN.md §11.2 step 1).
 *
 * Presets prefill; they must never block publishing. Every call here is
 * best-effort: the event stays published and the host is told which parts
 * need setting by hand in Manage event. Both RPCs are also missing until the
 * host-tools migrations are applied, which this treats the same way.
 */
export type PresetSettingsResult = {
  /** Nothing differed from the server defaults, so no call was made. */
  skipped: boolean;
  /** Settings that could not be saved, in host-readable words. */
  failed: string[];
};

export async function applyPresetSettings(
  eventId: string,
  presetId: EventPresetId
): Promise<PresetSettingsResult> {
  // Which preset was used, for analytics only (20261110120000). Silent on
  // failure: the column is missing until that migration is applied, and
  // nothing in the product depends on it.
  try {
    await eventsService.updateEvent(eventId, { event_type: presetId });
  } catch {
    // Ignored on purpose.
  }

  const wanted = presetSettingsToApply(presetId);
  if (!wanted) return { skipped: true, failed: [] };

  const failed: string[] = [];
  if (wanted.waitlistMode !== undefined || wanted.rsvpMode !== undefined) {
    try {
      await hostToolsService.setEventSettings(eventId, {
        waitlistMode: wanted.waitlistMode,
        rsvpMode: wanted.rsvpMode,
      });
    } catch {
      if (wanted.waitlistMode !== undefined) failed.push('the waitlist option');
      if (wanted.rsvpMode !== undefined) failed.push('the RSVP option');
    }
  }
  if (wanted.chatMode !== undefined) {
    try {
      await eventChatService.setMode(eventId, { mode: wanted.chatMode });
    } catch {
      failed.push('the chat option');
    }
  }
  return { skipped: false, failed };
}
