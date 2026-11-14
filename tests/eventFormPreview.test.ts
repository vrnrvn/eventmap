import { describe, expect, it } from 'vitest';
import {
  PREVIEW_EVENT_ID,
  formToPreviewEvent,
  parseCapacity,
  previewCoverImage,
  type PreviewFormInput,
} from '@/utils/eventFormPreview';
import { EMPTY_EXTRAS } from '@/utils/eventExtras';

const form = (over: Partial<PreviewFormInput> = {}): PreviewFormInput => ({
  title: '  Jazz Night  ',
  description: ' Live trio ',
  categoryId: 'cat-1',
  // Wall-clock 19:00 in the event zone.
  startDatetime: new Date(2026, 10, 20, 19, 0, 0),
  endDatetime: new Date(2026, 10, 20, 22, 0, 0),
  address: ' 1 Main St ',
  lat: 37.77,
  lng: -122.41,
  maxAttendees: '80',
  timezone: 'America/New_York',
  recurrence: null,
  extras: { ...EMPTY_EXTRAS },
  images: [],
  ...over,
});

const ctx = {
  business: { id: 'biz-1', name: 'The Blue Door', logo_url: 'http://logo' },
  category: { id: 'cat-1', label: 'Live Music', slug: 'live-music' },
};

describe('parseCapacity', () => {
  it('accepts positive integers only', () => {
    expect(parseCapacity('80')).toBe(80);
    expect(parseCapacity(' 12 ')).toBe(12);
    expect(parseCapacity('')).toBeNull();
    expect(parseCapacity('0')).toBeNull();
    expect(parseCapacity('-5')).toBeNull();
    expect(parseCapacity('abc')).toBeNull();
  });
});

describe('previewCoverImage', () => {
  it('prefers an already-uploaded photo over a local pick', () => {
    expect(previewCoverImage([{ uri: 'file://a', remoteUrl: 'http://a' }])).toBe('http://a');
    expect(previewCoverImage([{ uri: 'file://a' }])).toBe('file://a');
    expect(previewCoverImage([])).toBeNull();
  });
});

describe('formToPreviewEvent', () => {
  it('trims text and maps the business and category', () => {
    const e = formToPreviewEvent(form(), ctx);
    expect(e.id).toBe(PREVIEW_EVENT_ID);
    expect(e.title).toBe('Jazz Night');
    expect(e.description).toBe('Live trio');
    expect(e.address).toBe('1 Main St');
    expect(e.business_name).toBe('The Blue Door');
    expect(e.category_label).toBe('Live Music');
    expect(e.max_attendees).toBe(80);
  });

  it('converts picker wall-clock values using the event zone', () => {
    // 19:00 in New York on 2026-11-20 is 00:00 UTC the next day (EST, UTC-5).
    const e = formToPreviewEvent(form(), ctx);
    expect(e.start_datetime).toBe('2026-11-21T00:00:00.000Z');
    expect(e.end_datetime).toBe('2026-11-21T03:00:00.000Z');
    // The same wall clock in another zone is a different instant.
    const utc = formToPreviewEvent(form({ timezone: 'UTC' }), ctx);
    expect(utc.start_datetime).toBe('2026-11-20T19:00:00.000Z');
  });

  it('shows a placeholder title but never invents other content', () => {
    const e = formToPreviewEvent(form({ title: '   ', description: '' }), ctx);
    expect(e.title).toBe('Untitled event');
    expect(e.description).toBe('');
  });

  it('starts with no engagement and no viewer state', () => {
    const e = formToPreviewEvent(form(), ctx);
    expect(e.rsvp_count).toBe(0);
    expect(e.save_count).toBe(0);
    expect(e.user_rsvp).toBeNull();
    expect(e.user_saved).toBe(false);
    expect(e.is_premium).toBe(false);
  });

  it('carries the extras through', () => {
    const e = formToPreviewEvent(
      form({
        extras: {
          ...EMPTY_EXTRAS,
          visibility: 'unlisted',
          ticketUrl: ' https://tickets.example ',
          priceLabel: ' €12 ',
          ageRestriction: '18+',
        },
      }),
      ctx
    );
    expect(e.visibility).toBe('unlisted');
    expect(e.ticket_url).toBe('https://tickets.example');
    expect(e.price_label).toBe('€12');
    expect(e.age_restriction).toBe('18+');
    expect(e.accessibility_notes).toBeNull();
  });

  it('marks recurring events and keeps the pattern', () => {
    const pattern = { frequency: 'weekly', interval: 1 } as never;
    const e = formToPreviewEvent(form({ recurrence: pattern }), ctx);
    expect(e.is_recurring).toBe(true);
    expect(e.recurrence_pattern).toBe(pattern);
    expect(formToPreviewEvent(form(), ctx).is_recurring).toBe(false);
  });

  it('survives a missing business or category', () => {
    const e = formToPreviewEvent(form({ categoryId: '' }), { business: null, category: null });
    expect(e.business_name).toBe('Your events');
    expect(e.business_logo_url).toBeNull();
    expect(e.category_label).toBe('');
    expect(e.max_attendees).toBe(80);
  });
});

describe('an unsaved preview is a draft', () => {
  it('never claims to be published, so the pre-publish checklist sees the truth', () => {
    expect(formToPreviewEvent(form(), ctx).publish_state).toBe('draft');
  });
});
