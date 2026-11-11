import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Business, HostLocationKind } from '@/types/database';
import { businessPin } from '@/utils/hostSetup';

/**
 * Guided first event (HOST_ONBOARDING_PLAN.md §11.2 step 2): a short card and
 * three inline hints shown only while a host has never created an event.
 * Dismissal is local per host profile — it is a UI nudge, not state worth a
 * column.
 */
export const firstEventGuideKey = (businessId: string) => `eventmap.firstEventGuide.${businessId}`;

/**
 * `totalEvents` is every event the host has ever made (drafts and cancelled
 * included), so the guide never returns for someone who merely has nothing
 * upcoming. `null` = not loaded yet: show nothing rather than flashing the
 * card at a host who has 40 events.
 */
export function shouldShowFirstEventGuide(input: {
  totalEvents: number | null;
  dismissed: boolean;
}): boolean {
  return input.totalEvents === 0 && !input.dismissed;
}

export async function readFirstEventGuideDismissed(businessId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(firstEventGuideKey(businessId))) === '1';
  } catch {
    // Storage unavailable: showing the guide once more is harmless.
    return false;
  }
}

export async function dismissFirstEventGuide(businessId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(firstEventGuideKey(businessId), '1');
  } catch {
    // Best-effort.
  }
}

/**
 * The three things the guide points at, in form order.
 *
 * `short` goes in the header card (kept to one line so the card does not fill
 * a small screen before the first field); `hint` is the fuller sentence shown
 * inline next to the section it is about, where the host actually needs it.
 */
export const FIRST_EVENT_STEPS: readonly {
  key: 'basic' | 'datetime' | 'location';
  title: string;
  short: string;
  hint: string;
}[] = [
  {
    key: 'basic',
    title: 'Name it clearly',
    short: 'People search and filter by these.',
    hint: 'A plain title and the right category are what people search and filter by.',
  },
  {
    key: 'datetime',
    title: 'Check the date and zone',
    short: 'Attendees see times in the event zone.',
    hint: 'Times are shown to attendees in the event zone, so set the zone you are actually hosting in.',
  },
  {
    key: 'location',
    title: 'Set the exact place',
    short: 'Attendees navigate to this pin.',
    hint: 'Attendees navigate to this pin. Search the address or tap the map to move it.',
  },
];

/**
 * Where a new event form should start for this host.
 *
 * - `fixed` (a venue): prefill the street address and its pin.
 * - `area`: centre the map on the home area but leave the address empty — an
 *   approximate area is not an event address, and claiming it as one would
 *   send attendees to the wrong place.
 * - `none` / not migrated without a pin: nothing; the device location is used.
 */
export function initialEventLocation(business: Business | null | undefined): {
  address: string;
  lat: number | null;
  lng: number | null;
  /** True when the host still has to choose where the event happens. */
  needsPlace: boolean;
} {
  const kind: HostLocationKind = business?.location_kind ?? 'fixed';
  const pin = businessPin(business);
  if (!pin || kind === 'none') return { address: '', lat: null, lng: null, needsPlace: true };
  if (kind === 'area') return { address: '', lat: pin.lat, lng: pin.lng, needsPlace: true };
  return { address: pin.address, lat: pin.lat, lng: pin.lng, needsPlace: !pin.address };
}
