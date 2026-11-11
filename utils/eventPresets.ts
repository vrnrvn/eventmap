import type { EventPresetId, HostType, RsvpMode, WaitlistMode } from '@/types/database';
import type { ChatMode } from '@/services/eventChat';

// Canonical union lives in types/database.ts (events.event_type); re-exported
// here so preset code can import everything from one place.
export type { EventPresetId };

/**
 * Event size presets (HOST_ONBOARDING_PLAN.md §11.2, HOST_TOOLS_PLAN.md §3).
 *
 * A preset only *prefills*: it never enforces anything, and it never
 * overwrites a value the host typed themselves (see `applyPreset`). Capacity
 * goes into the create form; waitlist / RSVP / chat modes are applied after
 * the event exists, through the host-tools RPCs, and are non-fatal.
 *
 * Ids are stable strings so a later `events.event_type` column can store them
 * without a client change.
 */
/** Form fields a preset can prefill. Strings: the capacity input is text. */
export type PresetFormValues = {
  maxAttendees: string;
};

/** Settings applied after create, via hostTools / eventChat. */
export type PresetSettings = {
  waitlistMode: WaitlistMode;
  rsvpMode: RsvpMode;
  chatMode: ChatMode;
};

export type EventPreset = {
  id: EventPresetId;
  label: string;
  /** Short size hint for the chip row, e.g. "Under 20". */
  sizeHint: string;
  /** One line explaining what the preset sets up. */
  description: string;
  form: PresetFormValues;
  settings: PresetSettings;
  /** Open "More options" (ticket link / price matter at this size). */
  expandExtras: boolean;
};

/**
 * Server defaults (migrations 20261103130000 / 160000 / 170000). Settings
 * equal to these need no RPC after create.
 */
export const DEFAULT_EVENT_SETTINGS: PresetSettings = {
  waitlistMode: 'notify',
  rsvpMode: 'open',
  chatMode: 'open',
};

/** Form values a brand-new create form starts with. */
export const DEFAULT_PRESET_FORM: PresetFormValues = {
  maxAttendees: '',
};

export const EVENT_PRESETS: readonly EventPreset[] = [
  {
    id: 'casual',
    label: 'Casual meetup',
    sizeHint: 'Under 20',
    description: 'No cap, open RSVPs, chat on.',
    form: { maxAttendees: '' },
    settings: { waitlistMode: 'off', rsvpMode: 'open', chatMode: 'open' },
    expandExtras: false,
  },
  {
    id: 'class',
    label: 'Class or workshop',
    sizeHint: '10–50',
    description: 'A cap with a waitlist, so a full class keeps collecting names.',
    form: { maxAttendees: '20' },
    settings: { waitlistMode: 'notify', rsvpMode: 'open', chatMode: 'open' },
    expandExtras: false,
  },
  {
    id: 'venue_show',
    label: 'Venue show',
    sizeHint: '50–300',
    description: 'A cap, a waitlist and announcements-only chat. Ticket link suggested.',
    form: { maxAttendees: '100' },
    settings: { waitlistMode: 'notify', rsvpMode: 'open', chatMode: 'announcements' },
    expandExtras: true,
  },
  {
    id: 'large',
    label: 'Large event',
    sizeHint: '300+',
    description: 'A cap with auto-promotion from the waitlist and announcements-only chat.',
    form: { maxAttendees: '500' },
    settings: { waitlistMode: 'auto', rsvpMode: 'open', chatMode: 'announcements' },
    expandExtras: true,
  },
];

export function eventPreset(id: EventPresetId): EventPreset {
  return EVENT_PRESETS.find((p) => p.id === id) ?? EVENT_PRESETS[0];
}

/** Suggested preset for a host type; prefills the chip row, never locked in. */
export function defaultPresetForHostType(hostType: HostType | null | undefined): EventPresetId {
  return hostType === 'venue' ? 'venue_show' : 'casual';
}

/**
 * What a preset wrote into the form, kept so a later preset may replace its
 * own values while leaving the host's edits alone.
 */
export type PresetApplication = {
  presetId: EventPresetId;
  /** Only the fields this preset actually wrote; kept (host-owned) fields are absent. */
  wrote: Partial<PresetFormValues>;
};

/**
 * A field may be overwritten when it still holds the blank-form default or
 * exactly what the previously applied preset put there. Anything else is the
 * host's own input and is kept.
 */
function overwritable<K extends keyof PresetFormValues>(
  key: K,
  current: PresetFormValues,
  previous: PresetApplication | null
): boolean {
  return current[key] === DEFAULT_PRESET_FORM[key] || current[key] === previous?.wrote[key];
}

/**
 * Merge a preset into the current form values.
 *
 * Returns the new values, the application record to keep in state, and which
 * fields were left alone, so the UI can say "your capacity was kept".
 */
export function applyPreset(
  current: PresetFormValues,
  presetId: EventPresetId,
  previous: PresetApplication | null = null
): { values: PresetFormValues; application: PresetApplication; kept: (keyof PresetFormValues)[] } {
  const preset = eventPreset(presetId);
  const values = { ...current };
  const kept: (keyof PresetFormValues)[] = [];
  // Only what actually landed is recorded: a kept field belongs to the host,
  // so a later preset must not treat it as its own and overwrite it.
  const wrote: Partial<PresetFormValues> = {};
  const keys = Object.keys(DEFAULT_PRESET_FORM) as (keyof PresetFormValues)[];
  for (const key of keys) {
    if (overwritable(key, current, previous)) {
      values[key] = preset.form[key];
      wrote[key] = preset.form[key];
    } else {
      kept.push(key);
    }
  }
  return { values, application: { presetId, wrote }, kept };
}

/**
 * Settings that differ from the server defaults and therefore need an RPC
 * after the event is created. Returns null when nothing needs saving.
 */
export function presetSettingsToApply(presetId: EventPresetId): Partial<PresetSettings> | null {
  const { settings } = eventPreset(presetId);
  const diff: Partial<PresetSettings> = {};
  if (settings.waitlistMode !== DEFAULT_EVENT_SETTINGS.waitlistMode) diff.waitlistMode = settings.waitlistMode;
  if (settings.rsvpMode !== DEFAULT_EVENT_SETTINGS.rsvpMode) diff.rsvpMode = settings.rsvpMode;
  if (settings.chatMode !== DEFAULT_EVENT_SETTINGS.chatMode) diff.chatMode = settings.chatMode;
  return Object.keys(diff).length > 0 ? diff : null;
}

/** Human-readable summary of what a preset turns on, for the chip description. */
export function describePresetSettings(presetId: EventPresetId): string {
  const { settings, form } = eventPreset(presetId);
  const parts: string[] = [];
  parts.push(form.maxAttendees ? `Cap ${form.maxAttendees}` : 'No cap');
  parts.push(
    settings.waitlistMode === 'off'
      ? 'no waitlist'
      : settings.waitlistMode === 'auto'
        ? 'waitlist with auto-promote'
        : 'waitlist on'
  );
  if (settings.chatMode === 'announcements') parts.push('announcements-only chat');
  else if (settings.chatMode === 'off') parts.push('chat off');
  else parts.push('chat on');
  return parts.join(' · ');
}
