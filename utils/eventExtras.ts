import type { AgeRestriction, EventVisibility } from '@/types/database';

/**
 * Pure data and validation for the event "More options" fields, split out of
 * `components/EventExtrasFields.tsx` so logic that needs them (the create
 * preview, tests) does not pull in React Native. The component re-exports
 * every name here, so existing imports keep working.
 */
export type EventExtrasDraft = {
  visibility: EventVisibility;
  ticketUrl: string;
  priceLabel: string;
  ageRestriction: AgeRestriction;
  accessibilityNotes: string;
  whatToBring: string;
};

export const EMPTY_EXTRAS: EventExtrasDraft = {
  visibility: 'public',
  ticketUrl: '',
  priceLabel: '',
  ageRestriction: 'none',
  accessibilityNotes: '',
  whatToBring: '',
};

export const AGE_OPTIONS: { value: AgeRestriction; label: string }[] = [
  { value: 'none', label: 'All ages' },
  { value: '18+', label: '18+' },
  { value: '21+', label: '21+' },
];

/** Validation shared by create and edit. Returns field → message. */
export function validateExtras(e: EventExtrasDraft): Partial<Record<keyof EventExtrasDraft, string>> {
  const errors: Partial<Record<keyof EventExtrasDraft, string>> = {};
  const ticket = e.ticketUrl.trim();
  if (ticket && !/^https?:\/\/\S+$/i.test(ticket)) errors.ticketUrl = 'Enter a full link starting with http:// or https://';
  if (ticket.length > 500) errors.ticketUrl = 'Link is too long';
  if (e.priceLabel.trim().length > 60) errors.priceLabel = 'Keep the price under 60 characters';
  if (e.accessibilityNotes.trim().length > 500) errors.accessibilityNotes = 'Keep notes under 500 characters';
  if (e.whatToBring.trim().length > 500) errors.whatToBring = 'Keep this under 500 characters';
  return errors;
}
