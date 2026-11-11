import type { Business, HostLocationKind, HostType } from '@/types/database';

/**
 * Pure rules for host setup (HOST_ONBOARDING_PLAN.md Stage 2). The server
 * enforces the same shapes (migration 20261110110000); this module explains
 * them to the user and builds the insert payload.
 */

/** Bump together with host_terms_current_version() in SQL. */
export const HOST_TERMS_VERSION = 1;

export const HOST_NAME_MAX = 60;

/** Shown in host setup and Settings → Host profile. Bump HOST_TERMS_VERSION when the meaning changes. */
export const HOST_GUIDELINES: readonly string[] = [
  'List events honestly: real time, place and price. Mark changes with Reschedule or Cancel so attendees are told.',
  "Look after your event chat. Act on reports, and use slow mode or announcements-only when it's busy.",
  'Respect attendee privacy. Use attendee details only to run the event.',
  'No misleading paid-ticket links, spam or events that break the law or local rules.',
  'Keep people safe. Share accessibility and age information and anything attendees should bring.',
];
export const HOST_DESCRIPTION_MAX = 500;

export type HostTypeOption = {
  value: HostType;
  label: string;
  description: string;
  /** Location kinds offered for this type, first = default. */
  locationKinds: readonly HostLocationKind[];
  /** Default business category label (constants/businessCategories). */
  defaultCategory: string | null;
  namePlaceholder: string;
};

export const HOST_TYPES: readonly HostTypeOption[] = [
  {
    value: 'venue',
    label: 'Venue',
    description: 'A bar, café, gallery or studio with a fixed address.',
    locationKinds: ['fixed'],
    defaultCategory: null,
    namePlaceholder: 'e.g. The Blue Door',
  },
  {
    value: 'organiser',
    label: 'Organiser',
    description: 'A club, collective or promoter hosting in different places.',
    locationKinds: ['area', 'none'],
    defaultCategory: 'Community',
    namePlaceholder: 'e.g. Sunday Run Club',
  },
  {
    value: 'individual',
    label: 'Individual',
    description: 'You, hosting now and then: picnics, game nights, walks.',
    locationKinds: ['area', 'none'],
    defaultCategory: 'Community',
    namePlaceholder: 'Your name or a host name',
  },
];

export function hostTypeOption(type: HostType): HostTypeOption {
  return HOST_TYPES.find((t) => t.value === type) ?? HOST_TYPES[0];
}

export const LOCATION_KIND_LABELS: Record<HostLocationKind, { label: string; description: string }> = {
  fixed: { label: 'Street address', description: 'Shown on your host page with a map.' },
  area: { label: 'Home area', description: 'An approximate area, like a neighbourhood. Used as the default when you create events.' },
  none: { label: 'No home location', description: 'You set the place on each event.' },
};

export type HostSetupForm = {
  hostType: HostType | null;
  name: string;
  description: string;
  category: string;
  logoUri: string | null;
  locationKind: HostLocationKind;
  address: string;
  lat: number | null;
  lng: number | null;
  /** True only when lat/lng came from a geocode pick or a map tap. */
  locationConfirmed: boolean;
  website: string;
  instagram: string;
  acceptedTerms: boolean;
};

export const EMPTY_HOST_SETUP: HostSetupForm = {
  hostType: null,
  name: '',
  description: '',
  category: '',
  logoUri: null,
  locationKind: 'fixed',
  address: '',
  lat: null,
  lng: null,
  locationConfirmed: false,
  website: '',
  instagram: '',
  acceptedTerms: false,
};

/** Switching type resets fields that no longer fit, keeps the rest. */
export function applyHostType(form: HostSetupForm, type: HostType): HostSetupForm {
  const opt = hostTypeOption(type);
  const locationKind = opt.locationKinds.includes(form.locationKind) ? form.locationKind : opt.locationKinds[0];
  return {
    ...form,
    hostType: type,
    locationKind,
    category: form.category || opt.defaultCategory || '',
  };
}

export type HostSetupStep = 'type' | 'identity' | 'location' | 'links' | 'guidelines';
export const HOST_SETUP_STEPS: readonly HostSetupStep[] = ['type', 'identity', 'location', 'links', 'guidelines'];

export type HostSetupErrors = Partial<Record<'hostType' | 'name' | 'category' | 'description' | 'address' | 'website' | 'instagram' | 'terms', string>>;

const URL_RE = /^(https?:\/\/)?[^\s/$.?#]+\.[^\s]{2,}$/i;
const HANDLE_RE = /^@?[A-Za-z0-9._]{1,30}$/;

export function validateHostStep(step: HostSetupStep, form: HostSetupForm): HostSetupErrors {
  const e: HostSetupErrors = {};
  switch (step) {
    case 'type':
      if (!form.hostType) e.hostType = 'Choose what kind of host you are';
      break;
    case 'identity':
      if (!form.name.trim()) e.name = 'Add a name people will see on your events';
      else if (form.name.trim().length > HOST_NAME_MAX) e.name = `Keep it under ${HOST_NAME_MAX} characters`;
      if (!form.category) e.category = 'Pick the category that fits best';
      if (form.description.trim().length > HOST_DESCRIPTION_MAX)
        e.description = `Keep it under ${HOST_DESCRIPTION_MAX} characters`;
      // Venues show a full host page, so a description is expected there.
      if (form.hostType === 'venue' && !form.description.trim())
        e.description = 'Tell people about your venue';
      break;
    case 'location':
      if (form.locationKind === 'fixed') {
        if (!form.address.trim()) e.address = 'Add your street address';
        else if (!form.locationConfirmed || form.lat == null || form.lng == null)
          e.address = 'Pick the address from suggestions or tap the map';
      } else if (form.locationKind === 'area') {
        if (!form.locationConfirmed || form.lat == null || form.lng == null)
          e.address = 'Search for your area or tap the map';
      }
      break;
    case 'links':
      if (form.website.trim() && !URL_RE.test(form.website.trim())) e.website = 'Enter a valid web address';
      if (form.instagram.trim() && !HANDLE_RE.test(form.instagram.trim())) e.instagram = 'Enter an Instagram handle like @name';
      break;
    case 'guidelines':
      if (!form.acceptedTerms) e.terms = 'Please accept the host guidelines to continue';
      break;
  }
  return e;
}

/** First step with an error, for jumping back on submit. */
export function firstInvalidStep(form: HostSetupForm): HostSetupStep | null {
  for (const step of HOST_SETUP_STEPS) {
    if (Object.keys(validateHostStep(step, form)).length > 0) return step;
  }
  return null;
}

export function normaliseWebsite(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

export function normaliseHandle(raw: string): string | undefined {
  const v = raw.trim().replace(/^@/, '');
  return v || undefined;
}

/** Insert payload for businesses (new schema). logo_url is filled in by the caller. */
export type HostInsert = {
  name: string;
  description: string;
  category: string;
  host_type: HostType;
  location_kind: HostLocationKind;
  address: string | null;
  lat: number | null;
  lng: number | null;
  host_terms_version: number;
  onboarding_completed_at: string;
  social_handles: { instagram?: string };
};

export function buildHostInsert(form: HostSetupForm, now: Date = new Date()): HostInsert {
  const hostType = form.hostType ?? 'venue';
  const kind = form.locationKind;
  const hasPin = kind !== 'none' && form.lat != null && form.lng != null;
  return {
    name: form.name.trim().slice(0, HOST_NAME_MAX),
    description: form.description.trim().slice(0, HOST_DESCRIPTION_MAX),
    category: form.category,
    host_type: hostType,
    location_kind: kind,
    address: kind === 'none' ? null : form.address.trim() || null,
    lat: hasPin ? form.lat : null,
    lng: hasPin ? form.lng : null,
    host_terms_version: HOST_TERMS_VERSION,
    // Server replaces this with its own clock; any non-null value marks completion.
    onboarding_completed_at: now.toISOString(),
    social_handles: { instagram: normaliseHandle(form.instagram) },
  };
}

/**
 * Payload for a backend without 20261110110000: only the original columns,
 * which require a street-ish address and a pin. Returns null when the host
 * has no location, which the old schema cannot store.
 */
export function legacyHostInsert(insert: HostInsert):
  | { name: string; description: string; category: string; address: string; lat: number; lng: number; social_handles: { instagram?: string } }
  | null {
  if (insert.lat == null || insert.lng == null) return null;
  return {
    name: insert.name,
    description: insert.description,
    category: insert.category,
    address: insert.address ?? 'Location on map',
    lat: insert.lat,
    lng: insert.lng,
    social_handles: insert.social_handles,
  };
}

/** Business location as a usable pin, or null (no location or not migrated). */
export function businessPin(
  b: Pick<Business, 'lat' | 'lng' | 'address'> | null | undefined
): { lat: number; lng: number; address: string } | null {
  if (!b || b.lat == null || b.lng == null || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return null;
  return { lat: b.lat, lng: b.lng, address: b.address ?? '' };
}

/** Effective host type for rows from a backend that predates host_type. */
export function effectiveHostType(b: Pick<Business, 'host_type'> | null | undefined): HostType {
  return b?.host_type ?? 'venue';
}

/** True when the backend has the host columns (migration 20261110110000 applied). */
export function hasHostColumns(b: Pick<Business, 'host_type'> | null | undefined): boolean {
  return !!b && typeof b.host_type === 'string';
}

export function hostTermsAccepted(b: Pick<Business, 'host_terms_version'> | null | undefined): boolean {
  return (b?.host_terms_version ?? 0) >= HOST_TERMS_VERSION;
}

export type HostShapeDraft = {
  hostType: HostType;
  locationKind: HostLocationKind;
  address: string;
  lat: number | null;
  lng: number | null;
  locationConfirmed: boolean;
};

export function hostShapeFromBusiness(b: Business): HostShapeDraft {
  return {
    hostType: effectiveHostType(b),
    locationKind: b.location_kind ?? 'fixed',
    address: b.address ?? '',
    lat: b.lat,
    lng: b.lng,
    locationConfirmed: b.lat != null && b.lng != null,
  };
}

/** Same rules as the setup location step; returns an error message or null. */
export function validateHostShape(d: HostShapeDraft): string | null {
  const opt = hostTypeOption(d.hostType);
  if (!opt.locationKinds.includes(d.locationKind)) {
    return d.hostType === 'venue' ? 'Venues need a street address' : 'Choose a location option';
  }
  const e = validateHostStep('location', { ...EMPTY_HOST_SETUP, ...d, hostType: d.hostType });
  return e.address ?? null;
}

/** Update patch for businesses; location columns follow location_kind. */
export function buildHostShapeUpdate(d: HostShapeDraft): Pick<Business, 'address' | 'lat' | 'lng'> & {
  host_type: HostType;
  location_kind: HostLocationKind;
} {
  const none = d.locationKind === 'none';
  return {
    host_type: d.hostType,
    location_kind: d.locationKind,
    address: none ? null : d.address.trim() || null,
    lat: none ? null : d.lat,
    lng: none ? null : d.lng,
  };
}

export function hostShapeDirty(a: HostShapeDraft, b: HostShapeDraft): boolean {
  return (
    a.hostType !== b.hostType ||
    a.locationKind !== b.locationKind ||
    a.address.trim() !== b.address.trim() ||
    a.lat !== b.lat ||
    a.lng !== b.lng
  );
}

/**
 * Apply a host type / location kind change in Settings. Going back to the
 * saved kind restores the saved location; moving to a street address from
 * anything else requires a fresh pick (an approximate home area must never
 * be saved as a venue address without the user confirming it).
 */
export function changeHostShape(
  draft: HostShapeDraft,
  saved: HostShapeDraft,
  change: { hostType?: HostType; locationKind?: HostLocationKind }
): HostShapeDraft {
  const hostType = change.hostType ?? draft.hostType;
  const kinds = hostTypeOption(hostType).locationKinds;
  let locationKind = change.locationKind ?? draft.locationKind;
  if (!kinds.includes(locationKind)) locationKind = kinds[0];
  const next: HostShapeDraft = { ...draft, hostType, locationKind };
  if (locationKind === draft.locationKind) return next;
  if (locationKind === saved.locationKind) {
    return { ...next, address: saved.address, lat: saved.lat, lng: saved.lng, locationConfirmed: saved.locationConfirmed };
  }
  if (locationKind === 'fixed') return { ...next, locationConfirmed: false };
  return next;
}
