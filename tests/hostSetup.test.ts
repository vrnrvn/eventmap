import { describe, expect, it } from 'vitest';
import {
  EMPTY_HOST_SETUP,
  HOST_TERMS_VERSION,
  applyHostType,
  buildHostShapeUpdate,
  changeHostShape,
  hasHostColumns,
  hostShapeDirty,
  hostShapeFromBusiness,
  hostTermsAccepted,
  validateHostShape,
  buildHostInsert,
  businessPin,
  effectiveHostType,
  firstInvalidStep,
  legacyHostInsert,
  normaliseHandle,
  normaliseWebsite,
  validateHostStep,
  type HostSetupForm,
} from '@/utils/hostSetup';
import type { Business } from '@/types/database';

const venue: HostSetupForm = {
  ...applyHostType(EMPTY_HOST_SETUP, 'venue'),
  name: ' The Blue Door ',
  description: 'Jazz bar',
  category: 'Bar & Nightlife',
  address: '1 Main St',
  lat: 1,
  lng: 2,
  locationConfirmed: true,
  acceptedTerms: true,
};

describe('applyHostType', () => {
  it('venue forces a fixed address; organiser defaults to area + Community', () => {
    expect(applyHostType(EMPTY_HOST_SETUP, 'venue').locationKind).toBe('fixed');
    const org = applyHostType(EMPTY_HOST_SETUP, 'organiser');
    expect(org.locationKind).toBe('area');
    expect(org.category).toBe('Community');
  });
  it('keeps a compatible location kind and a chosen category', () => {
    const org = { ...applyHostType(EMPTY_HOST_SETUP, 'organiser'), locationKind: 'none' as const, category: 'Education' };
    const indiv = applyHostType(org, 'individual');
    expect(indiv.locationKind).toBe('none');
    expect(indiv.category).toBe('Education');
    expect(applyHostType(indiv, 'venue').locationKind).toBe('fixed');
  });
});

describe('validateHostStep', () => {
  it('requires a type, name and category', () => {
    expect(validateHostStep('type', EMPTY_HOST_SETUP).hostType).toBeTruthy();
    const e = validateHostStep('identity', applyHostType(EMPTY_HOST_SETUP, 'venue'));
    expect(e.name).toBeTruthy();
    expect(e.category).toBeTruthy();
    expect(e.description).toBeTruthy();
  });
  it('description is optional for non-venues', () => {
    const org = { ...applyHostType(EMPTY_HOST_SETUP, 'organiser'), name: 'Run Club' };
    expect(validateHostStep('identity', org)).toEqual({});
  });
  it('fixed location needs a confirmed pin; area needs a pin; none needs nothing', () => {
    expect(validateHostStep('location', { ...venue, locationConfirmed: false }).address).toMatch(/suggestions/);
    expect(validateHostStep('location', { ...venue, address: '' }).address).toMatch(/street/);
    const area = { ...applyHostType(EMPTY_HOST_SETUP, 'organiser') };
    expect(validateHostStep('location', area).address).toBeTruthy();
    expect(validateHostStep('location', { ...area, locationKind: 'none' })).toEqual({});
  });
  it('validates optional links only when present', () => {
    expect(validateHostStep('links', venue)).toEqual({});
    expect(validateHostStep('links', { ...venue, website: 'not a url' }).website).toBeTruthy();
    expect(validateHostStep('links', { ...venue, website: 'blue.example' })).toEqual({});
    expect(validateHostStep('links', { ...venue, instagram: 'bad handle!' }).instagram).toBeTruthy();
  });
  it('guidelines must be accepted', () => {
    expect(validateHostStep('guidelines', { ...venue, acceptedTerms: false }).terms).toBeTruthy();
  });
  it('firstInvalidStep finds the earliest problem', () => {
    expect(firstInvalidStep(venue)).toBeNull();
    expect(firstInvalidStep({ ...venue, name: '' })).toBe('identity');
    expect(firstInvalidStep({ ...venue, acceptedTerms: false })).toBe('guidelines');
  });
});

describe('buildHostInsert', () => {
  it('trims and stamps the terms version', () => {
    const ins = buildHostInsert(venue);
    expect(ins.name).toBe('The Blue Door');
    expect(ins.host_type).toBe('venue');
    expect(ins.location_kind).toBe('fixed');
    expect(ins.host_terms_version).toBe(HOST_TERMS_VERSION);
    expect(ins.address).toBe('1 Main St');
  });
  it('drops all location for "none" even if stale coords exist', () => {
    const ins = buildHostInsert({ ...venue, hostType: 'organiser', locationKind: 'none' });
    expect(ins.address).toBeNull();
    expect(ins.lat).toBeNull();
    expect(ins.lng).toBeNull();
  });
  it('legacy payload needs a pin', () => {
    const none = buildHostInsert({ ...venue, hostType: 'individual', locationKind: 'none' });
    expect(legacyHostInsert(none)).toBeNull();
    const area = buildHostInsert({ ...venue, hostType: 'individual', locationKind: 'area', address: '' });
    expect(legacyHostInsert(area)).toMatchObject({ lat: 1, lng: 2, address: 'Location on map' });
    expect(legacyHostInsert(area)).not.toHaveProperty('host_type');
  });
});

describe('helpers', () => {
  it('normalises links', () => {
    expect(normaliseWebsite('blue.example')).toBe('https://blue.example');
    expect(normaliseWebsite('http://x.io')).toBe('http://x.io');
    expect(normaliseWebsite('  ')).toBeNull();
    expect(normaliseHandle('@blue')).toBe('blue');
    expect(normaliseHandle('')).toBeUndefined();
  });
  it('businessPin and effectiveHostType tolerate legacy and missing data', () => {
    expect(businessPin({ lat: null, lng: null, address: null })).toBeNull();
    expect(businessPin({ lat: 1, lng: 2, address: null })).toEqual({ lat: 1, lng: 2, address: '' });
    expect(businessPin(null)).toBeNull();
    expect(effectiveHostType({})).toBe('venue');
    expect(effectiveHostType({ host_type: 'individual' })).toBe('individual');
  });
});

describe('Settings host shape', () => {
  const area = {
    hostType: 'organiser' as const,
    locationKind: 'area' as const,
    address: 'Mission',
    lat: 1,
    lng: 2,
    locationConfirmed: true,
  };
  it('switching to venue needs a fresh street-address pick', () => {
    const next = changeHostShape(area, area, { hostType: 'venue' });
    expect(next.locationKind).toBe('fixed');
    expect(next.locationConfirmed).toBe(false);
    expect(validateHostShape(next)).toMatch(/suggestions/);
  });
  it('returning to the saved kind restores the saved location', () => {
    const none = changeHostShape(area, area, { locationKind: 'none' });
    const back = changeHostShape({ ...none, address: 'typed', locationConfirmed: false }, area, { locationKind: 'area' });
    expect(back).toMatchObject({ address: 'Mission', lat: 1, locationConfirmed: true });
  });
  it('none clears location in the update and dirty tracks changes', () => {
    const none = changeHostShape(area, area, { locationKind: 'none' });
    expect(buildHostShapeUpdate(none)).toMatchObject({ location_kind: 'none', address: null, lat: null, lng: null });
    expect(hostShapeDirty(none, area)).toBe(true);
    expect(hostShapeDirty(area, area)).toBe(false);
    expect(validateHostShape(none)).toBeNull();
  });
  it('reads legacy rows as venue/fixed and reports missing columns', () => {
    const legacy = { id: 'b', address: '1 Main', lat: 1, lng: 2 } as unknown as Business;
    expect(hostShapeFromBusiness(legacy)).toMatchObject({ hostType: 'venue', locationKind: 'fixed', locationConfirmed: true });
    expect(hasHostColumns(legacy)).toBe(false);
    expect(hostTermsAccepted({ host_terms_version: null })).toBe(false);
    expect(hostTermsAccepted({ host_terms_version: HOST_TERMS_VERSION })).toBe(true);
  });
});
