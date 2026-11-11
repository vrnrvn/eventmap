import type { Business, Category, RankedEvent } from '@/types/database';
import type { EventExtrasDraft } from '@/utils/eventExtras';
import type { RecurrenceOption } from '@/utils/recurrence';
import { pickerDateToInstant } from '@/utils/timezone';

/**
 * Turns the Create form into a `RankedEvent` so the real
 * `DiscoverEventCard` and the Event Detail header can render a preview of an
 * event that does not exist yet (HOST_ONBOARDING_PLAN.md §11.2 step 3).
 *
 * Pure and renderer-free so it can be unit-tested. Nothing here is written to
 * the server; ids are placeholders.
 */

export const PREVIEW_EVENT_ID = 'preview';

/** The subset of the create form the preview needs. */
export type PreviewFormInput = {
  title: string;
  description: string;
  categoryId: string;
  /** Wall-clock values from the pickers, in `timezone`. */
  startDatetime: Date;
  endDatetime: Date;
  address: string;
  lat: number;
  lng: number;
  maxAttendees: string;
  timezone: string;
  recurrence: RecurrenceOption;
  extras: EventExtrasDraft;
  /** First image is the cover; `remoteUrl` wins over a local `uri`. */
  images: readonly { uri: string; remoteUrl?: string }[];
};

export type PreviewContext = {
  business: Pick<Business, 'id' | 'name' | 'logo_url'> | null;
  category: Pick<Category, 'id' | 'label' | 'slug'> | null;
};

/** Capacity as the server would store it: a positive integer or null. */
export function parseCapacity(raw: string): number | null {
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function previewCoverImage(images: PreviewFormInput['images']): string | null {
  const first = images[0];
  return first ? first.remoteUrl ?? first.uri ?? null : null;
}

/**
 * Builds the preview event. `now` is injectable for tests; it only fills the
 * created/updated stamps, which the card does not show.
 */
export function formToPreviewEvent(
  form: PreviewFormInput,
  ctx: PreviewContext,
  now: Date = new Date()
): RankedEvent {
  const startIso = pickerDateToInstant(form.startDatetime, form.timezone).toISOString();
  const endIso = pickerDateToInstant(form.endDatetime, form.timezone).toISOString();
  const title = form.title.trim();
  const address = form.address.trim();
  return {
    id: PREVIEW_EVENT_ID,
    business_id: ctx.business?.id ?? PREVIEW_EVENT_ID,
    // Empty fields get a placeholder so the card never renders a blank line;
    // the sheet explains that these are still missing.
    title: title || 'Untitled event',
    description: form.description.trim(),
    category_id: form.categoryId || ctx.category?.id || '',
    start_datetime: startIso,
    end_datetime: endIso,
    lat: form.lat,
    lng: form.lng,
    address,
    cover_image_url: previewCoverImage(form.images),
    is_recurring: form.recurrence != null,
    recurrence_pattern: form.recurrence ?? null,
    status: 'active',
    max_attendees: parseCapacity(form.maxAttendees),
    rsvp_closed: false,
    waitlist_mode: 'notify',
    timezone: form.timezone,
    publish_state: 'published',
    visibility: form.extras.visibility,
    ticket_url: form.extras.ticketUrl.trim() || null,
    price_label: form.extras.priceLabel.trim() || null,
    age_restriction: form.extras.ageRestriction,
    accessibility_notes: form.extras.accessibilityNotes.trim() || null,
    what_to_bring: form.extras.whatToBring.trim() || null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    // Ranked-only fields: a brand-new event has no engagement yet.
    distance_km: 0,
    is_premium: false,
    rsvp_count: 0,
    save_count: 0,
    business_name: ctx.business?.name ?? 'Your events',
    business_logo_url: ctx.business?.logo_url ?? null,
    category_label: ctx.category?.label ?? '',
    category_slug: ctx.category?.slug ?? '',
    user_rsvp: null,
    user_saved: false,
  };
}

/**
 * Fields a host most often forgets before publishing. Shown in the preview
 * sheet as hints; they are not validation (Publish runs the real checks).
 */
export function previewGaps(form: PreviewFormInput): string[] {
  const gaps: string[] = [];
  if (!form.title.trim()) gaps.push('a title');
  if (!form.categoryId) gaps.push('a category');
  if (!form.description.trim()) gaps.push('a description');
  if (!form.address.trim()) gaps.push('a place');
  if (form.images.length === 0) gaps.push('a cover photo');
  return gaps;
}
