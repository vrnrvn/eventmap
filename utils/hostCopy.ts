import type { Business } from '@/types/database';
import { effectiveHostType } from '@/utils/hostSetup';

/**
 * Host-type wording for the Create / Edit forms (HOST_ONBOARDING_PLAN.md
 * §11.2 step 5). Venues keep the existing "business / venue" language;
 * organisers and individuals never see it, because they have no venue.
 */
export type HostCopy = {
  /** Under the Location heading. */
  locationNote: string;
  /** Address row placeholder before a place is chosen. */
  locationPlaceholder: string;
  /** Shown when the host has no profile loaded yet. */
  profileLoading: string;
  /** Recurring-events premium upsell. */
  recurringPremium: string;
  /** Settings screen title in hosting mode. */
  settingsTitle: string;
  /** Settings section label for the host's own details. */
  profileSectionLabel: string;
  /** Name field label. */
  nameLabel: string;
  /** Description placeholder. */
  descriptionPlaceholder: string;
  /** Photo-gallery hint. */
  photosHint: string;
};

export function hostCopy(business: Pick<Business, 'host_type' | 'location_kind'> | null | undefined): HostCopy {
  const type = effectiveHostType(business);
  const fixed = (business?.location_kind ?? 'fixed') === 'fixed';
  if (type === 'venue' && fixed) {
    return {
      locationNote: 'Defaults to your venue address if you do not set a different place',
      locationPlaceholder: 'Tap to set venue on map',
      profileLoading: 'Your host profile is still loading. Try again in a moment.',
      recurringPremium: 'Recurring events are a Premium feature. Upgrade to create recurring events.',
      settingsTitle: 'Business Settings',
      profileSectionLabel: 'Business Profile',
      nameLabel: 'Business Name',
      descriptionPlaceholder: 'Tell people about your business',
      photosHint: 'Add photos of your venue, gym, or place. Shown on your host page.',
    };
  }
  return {
    locationNote: 'Set where this event happens. Attendees navigate to this pin.',
    locationPlaceholder: 'Tap to set the place on the map',
    profileLoading: 'Your host profile is still loading. Try again in a moment.',
    recurringPremium: 'Recurring events are a Premium feature. Upgrade to create recurring events.',
    settingsTitle: 'Host Settings',
    profileSectionLabel: 'Host Profile',
    nameLabel: 'Host Name',
    descriptionPlaceholder: 'What should people know about you?',
    photosHint: 'Add photos from your events. Shown on your host page.',
  };
}

/**
 * Hosts without a street address have no fallback place, so an event with no
 * place set would be published at the map's default pin. They must choose one.
 */
export function eventNeedsExplicitPlace(
  business: Pick<Business, 'host_type' | 'location_kind' | 'address' | 'lat' | 'lng'> | null | undefined,
  form: { address: string; placeChosen: boolean }
): boolean {
  const kind = business?.location_kind ?? 'fixed';
  const venueHasAddress = kind === 'fixed' && !!business?.address?.trim() && business?.lat != null;
  if (venueHasAddress) return false;
  return !form.placeChosen && !form.address.trim();
}
