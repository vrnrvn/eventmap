import { describe, expect, it } from 'vitest';
import {
  dateKeyInZone,
  describeEventDateTime,
  describeEventTime,
  formatOffset,
  getZoneOffsetMinutes,
  instantToPickerDate,
  isValidTimeZone,
  listTimeZones,
  pickerDateToInstant,
  searchTimeZones,
  timeZoneOptions,
  utcToWallClock,
  wallClockToUtc,
  zoneCityName,
  zoneDisplayLabel,
} from '@/utils/timezone';

describe('isValidTimeZone', () => {
  it('accepts IANA ids and UTC, rejects junk and offsets', () => {
    expect(isValidTimeZone('Europe/Lisbon')).toBe(true);
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('+02:00')).toBe(false);
  });
});

describe('offsets and wall clocks', () => {
  it('reads the wall clock in a zone', () => {
    // 2026-07-01T18:00Z is 19:00 in Lisbon (WEST, +1) and 14:00 in New York (EDT, -4).
    const d = new Date('2026-07-01T18:00:00Z');
    expect(utcToWallClock(d, 'Europe/Lisbon')).toMatchObject({ year: 2026, month: 7, day: 1, hour: 19, minute: 0 });
    expect(utcToWallClock(d, 'America/New_York')).toMatchObject({ day: 1, hour: 14 });
    expect(getZoneOffsetMinutes(d, 'Europe/Lisbon')).toBe(60);
    expect(getZoneOffsetMinutes(d, 'America/New_York')).toBe(-240);
    expect(getZoneOffsetMinutes(d, 'Asia/Kolkata')).toBe(330);
  });

  it('converts a wall clock back to the instant, across DST', () => {
    // Winter: Lisbon is UTC+0.
    expect(wallClockToUtc({ year: 2026, month: 1, day: 15, hour: 19, minute: 0, second: 0 }, 'Europe/Lisbon').toISOString())
      .toBe('2026-01-15T19:00:00.000Z');
    // Summer: Lisbon is UTC+1.
    expect(wallClockToUtc({ year: 2026, month: 7, day: 15, hour: 19, minute: 0, second: 0 }, 'Europe/Lisbon').toISOString())
      .toBe('2026-07-15T18:00:00.000Z');
    // New York in summer is UTC-4.
    expect(wallClockToUtc({ year: 2026, month: 7, day: 15, hour: 19, minute: 0, second: 0 }, 'America/New_York').toISOString())
      .toBe('2026-07-15T23:00:00.000Z');
  });

  it('round-trips through the picker helpers regardless of the device zone', () => {
    const instant = new Date('2026-11-06T19:00:00Z'); // 19:00 Lisbon (WET), 14:00 New York (EST)
    const lisbonPicker = instantToPickerDate(instant, 'Europe/Lisbon');
    expect(lisbonPicker.getHours()).toBe(19);
    expect(pickerDateToInstant(lisbonPicker, 'Europe/Lisbon').toISOString()).toBe(instant.toISOString());

    const nyPicker = instantToPickerDate(instant, 'America/New_York');
    expect(nyPicker.getHours()).toBe(14);
    expect(pickerDateToInstant(nyPicker, 'America/New_York').toISOString()).toBe(instant.toISOString());
  });

  it('resolves a spring-forward gap forward, like calendars do', () => {
    // US DST 2026 starts Mar 8 at 02:00 local (New York): 02:30 does not exist.
    // 07:30Z is 03:30 EDT — the forward resolution; 06:30Z would be an hour early.
    const result = wallClockToUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 }, 'America/New_York');
    expect(result.toISOString()).toBe('2026-03-08T07:30:00.000Z');
  });

  it('gives the calendar date in the zone', () => {
    const d = new Date('2026-11-06T03:30:00Z'); // Nov 5 in Los Angeles, Nov 6 in Lisbon
    expect(dateKeyInZone(d, 'America/Los_Angeles')).toBe('2026-11-05');
    expect(dateKeyInZone(d, 'Europe/Lisbon')).toBe('2026-11-06');
  });
});

describe('labels and options', () => {
  it('formats offsets and city names', () => {
    expect(formatOffset(0)).toBe('GMT');
    expect(formatOffset(60)).toBe('GMT+1');
    expect(formatOffset(-240)).toBe('GMT-4');
    expect(formatOffset(330)).toBe('GMT+5:30');
    expect(zoneCityName('America/New_York')).toBe('New York');
    expect(zoneCityName('UTC')).toBe('UTC');
    expect(zoneDisplayLabel('Europe/Lisbon', new Date('2026-01-15T12:00:00Z'))).toBe('Lisbon (GMT)');
    expect(zoneDisplayLabel('Europe/Lisbon', new Date('2026-07-15T12:00:00Z'))).toBe('Lisbon (GMT+1)');
    expect(zoneDisplayLabel('UTC')).toBe('UTC');
  });

  it('builds sorted options and searches them', () => {
    const zones = listTimeZones();
    expect(zones).toContain('UTC');
    const options = timeZoneOptions(new Date('2026-07-01T12:00:00Z'), ['Europe/Lisbon', 'America/New_York', 'Asia/Tokyo', 'UTC']);
    expect(options.map((o) => o.id)).toEqual(['America/New_York', 'UTC', 'Europe/Lisbon', 'Asia/Tokyo']);
    expect(searchTimeZones(options, 'new york').map((o) => o.id)).toEqual(['America/New_York']);
    expect(searchTimeZones(options, 'GMT+9').map((o) => o.id)).toEqual(['Asia/Tokyo']);
    expect(searchTimeZones(options, 'europe').map((o) => o.id)).toEqual(['Europe/Lisbon']);
    expect(searchTimeZones(options, '')).toHaveLength(4);
  });
});

describe('describeEventTime', () => {
  const instant = '2026-11-06T19:00:00Z'; // 19:00 Lisbon, 14:00 New York, 04:00 next day Tokyo

  it('renders legacy events (no zone) in the viewer zone with no second line', () => {
    const r = describeEventTime(instant, null, 'America/New_York', 'en-US');
    expect(r).toEqual({ primary: '2:00 PM', secondary: null, differs: false });
  });

  it('shows only the event time when zones agree', () => {
    const r = describeEventTime(instant, 'Europe/Lisbon', 'Europe/Lisbon', 'en-US');
    expect(r.primary).toBe('7:00 PM');
    expect(r.secondary).toBeNull();
    expect(r.differs).toBe(false);
  });

  it('adds the zone and the viewer reading when they differ', () => {
    const r = describeEventTime(instant, 'Europe/Lisbon', 'America/New_York', 'en-US');
    expect(r.primary).toMatch(/^7:00 PM (WET|GMT)/);
    expect(r.secondary).toBe('2:00 PM your time');
    expect(r.differs).toBe(true);
  });

  it('notes the viewer date when the day rolls over', () => {
    const r = describeEventTime(instant, 'Europe/Lisbon', 'Asia/Tokyo', 'en-US');
    expect(r.secondary).toBe('4:00 AM your time (Nov 7)');
  });

  it('is empty for unparseable input', () => {
    expect(describeEventTime('nope', 'Europe/Lisbon', 'UTC')).toEqual({ primary: '', secondary: null, differs: false });
  });
});

describe('describeEventDateTime', () => {
  const now = new Date('2026-11-04T12:00:00Z');
  const instant = '2026-11-06T19:00:00Z'; // 7 pm Lisbon (WET), 2 pm New York

  it('shows the event-zone date and a your-time line when zones differ', () => {
    const r = describeEventDateTime(instant, 'Europe/Lisbon', 'America/New_York', 'en-US', now);
    expect(r.primary.startsWith('Fri, Nov 6, 7:00 PM ')).toBe(true);
    expect(r.secondary).toBe('2:00 PM your time');
  });

  it('has no second line when zones agree or the event has no zone', () => {
    expect(describeEventDateTime(instant, 'Europe/Lisbon', 'Europe/Lisbon', 'en-US', now)).toEqual({
      primary: 'Fri, Nov 6, 7:00 PM',
      secondary: null,
    });
    expect(describeEventDateTime(instant, null, 'America/New_York', 'en-US', now)).toEqual({
      primary: 'Fri, Nov 6, 2:00 PM',
      secondary: null,
    });
  });

  it('adds the year only when it differs', () => {
    expect(describeEventDateTime('2027-01-08T19:00:00Z', 'Europe/Lisbon', 'Europe/Lisbon', 'en-US', now).primary).toContain('2027');
  });
});
