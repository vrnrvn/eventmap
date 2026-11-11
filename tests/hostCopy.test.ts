import { describe, expect, it } from 'vitest';
import { eventNeedsExplicitPlace, hostCopy } from '@/utils/hostCopy';

describe('hostCopy', () => {
  it('venues keep venue wording; legacy rows count as venues', () => {
    expect(hostCopy({ host_type: 'venue', location_kind: 'fixed' }).locationPlaceholder).toMatch(/venue/);
    expect(hostCopy({}).locationNote).toMatch(/venue address/);
  });
  it('venue wording covers the Settings labels too', () => {
    const c = hostCopy({ host_type: 'venue', location_kind: 'fixed' });
    expect(c.settingsTitle).toBe('Business Settings');
    expect(c.nameLabel).toBe('Business Name');
  });
  it('organisers and individuals never see venue or business wording', () => {
    for (const host_type of ['organiser', 'individual'] as const) {
      const c = hostCopy({ host_type, location_kind: 'area' });
      for (const text of Object.values(c)) expect(text).not.toMatch(/venue|business/i);
    }
  });
});

describe('eventNeedsExplicitPlace', () => {
  const venue = { host_type: 'venue' as const, location_kind: 'fixed' as const, address: '1 Main', lat: 1, lng: 2 };
  it('a venue with an address can fall back to it', () => {
    expect(eventNeedsExplicitPlace(venue, { address: '', placeChosen: false })).toBe(false);
  });
  it('area / none hosts must choose a place', () => {
    const area = { host_type: 'organiser' as const, location_kind: 'area' as const, address: 'Mission', lat: 1, lng: 2 };
    expect(eventNeedsExplicitPlace(area, { address: '', placeChosen: false })).toBe(true);
    expect(eventNeedsExplicitPlace(area, { address: '5 Park Rd', placeChosen: true })).toBe(false);
    const none = { host_type: 'individual' as const, location_kind: 'none' as const, address: null, lat: null, lng: null };
    expect(eventNeedsExplicitPlace(none, { address: '', placeChosen: false })).toBe(true);
    // A map tap with no reverse-geocoded address still counts as a place.
    expect(eventNeedsExplicitPlace(none, { address: '', placeChosen: true })).toBe(false);
  });
});
