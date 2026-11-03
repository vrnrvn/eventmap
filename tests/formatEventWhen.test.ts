import { describe, expect, it } from 'vitest';
import {
  formatDistance,
  formatEventDate,
  formatEventDayLabel,
  formatEventTime,
  formatEventWhen,
  timeZoneLabel,
  usesMiles,
} from '@/utils/formatEventWhen';

const now = new Date(2026, 4, 13, 10, 0); // Wed 13 May 2026

describe('formatEventDayLabel', () => {
  it('says Today / Tomorrow for the next two calendar days', () => {
    expect(formatEventDayLabel(new Date(2026, 4, 13, 23, 0), now)).toBe('Today');
    expect(formatEventDayLabel(new Date(2026, 4, 14, 0, 30), now)).toBe('Tomorrow');
  });

  it('otherwise gives weekday + date, adding the year only when it differs', () => {
    const sameYear = formatEventDayLabel(new Date(2026, 4, 20), now);
    expect(sameYear).toMatch(/20/);
    expect(sameYear).not.toMatch(/2026/);
    expect(formatEventDayLabel(new Date(2027, 0, 5), now)).toMatch(/2027/);
  });

  it('returns an empty string for an unparseable value', () => {
    expect(formatEventDayLabel('not a date', now)).toBe('');
  });
});

describe('formatEventDate / formatEventTime / formatEventWhen', () => {
  it('formatEventDate includes a time and omits the current year', () => {
    const s = formatEventDate(new Date(2026, 4, 20, 19, 30), now);
    expect(s).toMatch(/7:30|19:30/);
    expect(s).not.toMatch(/2026/);
  });

  it('formatEventTime is just the clock time', () => {
    expect(formatEventTime(new Date(2026, 4, 20, 19, 5))).toMatch(/7:05|19:05/);
  });

  it('formatEventWhen joins day label and time with a middle dot', () => {
    expect(formatEventWhen(new Date(2026, 4, 13, 19, 30), now)).toMatch(/^Today · (7:30|19:30)/);
  });
});

describe('usesMiles', () => {
  it('is true only for mile regions', () => {
    expect(usesMiles('en-US')).toBe(true);
    expect(usesMiles('en-GB')).toBe(true);
    expect(usesMiles('en-IE')).toBe(false);
    expect(usesMiles('es-MX')).toBe(false);
    expect(usesMiles('de-DE')).toBe(false);
  });

  it('defaults to km when the locale has no region', () => {
    expect(usesMiles('fr')).toBe(false);
  });
});

describe('formatDistance', () => {
  it('uses miles with one decimal under 10 and whole numbers above', () => {
    expect(formatDistance(1, 'en-US')).toBe('0.6 mi');
    expect(formatDistance(40, 'en-US')).toBe('25 mi');
  });

  it('calls very short distances nearby in mile regions', () => {
    expect(formatDistance(0.05, 'en-US')).toBe('nearby');
  });

  it('uses km / m elsewhere', () => {
    expect(formatDistance(2.34, 'de-DE')).toBe('2.3 km');
    expect(formatDistance(12.6, 'de-DE')).toBe('13 km');
    expect(formatDistance(0.37, 'de-DE')).toBe('350 m');
    expect(formatDistance(0.01, 'de-DE')).toBe('50 m');
  });

  it('returns an empty string for invalid input', () => {
    expect(formatDistance(NaN, 'en-US')).toBe('');
    expect(formatDistance(-1, 'en-US')).toBe('');
  });
});

describe('timeZoneLabel', () => {
  it('returns a short zone name for the runtime locale', () => {
    const label = timeZoneLabel(new Date(2026, 4, 13, 12, 0));
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
  });

  it('reflects the requested locale formatting', () => {
    // en-US renders a short name (e.g. "UTC", "PDT", "GMT+2").
    const label = timeZoneLabel(new Date(2026, 0, 15, 9, 0), 'en-US');
    expect(label).toMatch(/[A-Z]{2,5}|GMT[+-]\d{1,2}/);
  });
});
