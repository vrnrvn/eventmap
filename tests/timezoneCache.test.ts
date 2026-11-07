import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The formatter / validity / device-zone caches added to utils/timezone.ts
 * must return exactly what a fresh Intl.DateTimeFormat would.
 */

let tz: typeof import('../utils/timezone');
beforeEach(async () => {
  vi.resetModules(); // fresh module-level caches
  tz = await import('../utils/timezone');
});

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Swap Intl.DateTimeFormat for a counting proxy that can fake the device zone. */
function instrumentIntl() {
  const Orig = Intl.DateTimeFormat;
  const state = { constructed: 0, deviceZone: null as string | null };
  const Proxied = new Proxy(Orig, {
    construct(target, args) {
      state.constructed++;
      const f = Reflect.construct(target, args) as Intl.DateTimeFormat;
      if (state.deviceZone !== null && args.length === 0) {
        const real = f.resolvedOptions.bind(f);
        f.resolvedOptions = () => ({ ...real(), timeZone: state.deviceZone! });
      }
      return f;
    },
    apply(_target, _thisArg, args) {
      // Intl.DateTimeFormat() without `new` behaves like a construction.
      return Reflect.construct(Proxied, args);
    },
  });
  (Intl as { DateTimeFormat: unknown }).DateTimeFormat = Proxied;
  return {
    state,
    restore: () => {
      (Intl as { DateTimeFormat: unknown }).DateTimeFormat = Orig;
    },
  };
}

describe('getDeviceTimeZone — TTL cache', () => {
  let intl: ReturnType<typeof instrumentIntl>;
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
    intl = instrumentIntl();
  });
  afterEach(() => {
    intl.restore();
    vi.useRealTimers();
  });

  it('serves the cached zone for < 10 s, then picks up a changed device zone', () => {
    intl.state.deviceZone = 'Europe/Lisbon';
    expect(tz.getDeviceTimeZone()).toBe('Europe/Lisbon');
    const built = intl.state.constructed;
    intl.state.deviceZone = 'Asia/Tokyo'; // user travelled / changed settings
    for (let i = 0; i < 100; i++) expect(tz.getDeviceTimeZone()).toBe('Europe/Lisbon');
    expect(intl.state.constructed).toBe(built); // no formatter built while cached
    vi.advanceTimersByTime(9_999);
    expect(tz.getDeviceTimeZone()).toBe('Europe/Lisbon');
    vi.advanceTimersByTime(1);
    expect(tz.getDeviceTimeZone()).toBe('Asia/Tokyo');
  });

  it('empty resolved zone falls back to UTC (and is cached like any other)', () => {
    intl.state.deviceZone = '';
    expect(tz.getDeviceTimeZone()).toBe('UTC');
    intl.state.deviceZone = 'Europe/Paris';
    expect(tz.getDeviceTimeZone()).toBe('UTC');
    vi.advanceTimersByTime(10_000);
    expect(tz.getDeviceTimeZone()).toBe('Europe/Paris');
  });

  it('documented: if the device clock jumps BACK, the cached zone is kept until the clock passes the old stamp + TTL', () => {
    intl.state.deviceZone = 'Europe/Lisbon';
    tz.getDeviceTimeZone();
    intl.state.deviceZone = 'Asia/Tokyo';
    vi.setSystemTime(1_000_000 - 3_600_000); // one hour back
    expect(tz.getDeviceTimeZone()).toBe('Europe/Lisbon');
    vi.setSystemTime(1_000_000 + 10_000);
    expect(tz.getDeviceTimeZone()).toBe('Asia/Tokyo');
  });
});

describe('isValidTimeZone — cache agrees with an uncached check', () => {
  const PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)+$/;
  const uncached = (z: string | null | undefined) => {
    if (!z || typeof z !== 'string') return false;
    if (z !== 'UTC' && !PATTERN.test(z)) return false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: z }).format(0);
      return true;
    } catch {
      return false;
    }
  };

  function candidates(n: number): (string | null | undefined)[] {
    const r = mulberry32(99);
    const real = Intl.supportedValuesOf('timeZone');
    const junk = [
      '',
      null,
      undefined,
      'UTC',
      'utc',
      'Etc/UTC',
      'GMT',
      'Etc/GMT+5',
      'Etc/GMT-14',
      '+02:00',
      'Europe/Atlantis',
      'america/new_york',
      'AMERICA/NEW_YORK',
      'America/New York',
      'America//New_York',
      '/America/New_York',
      'America/New_York/',
      'America/Argentina/Buenos_Aires',
      'Asia/Katmandu',
      'Asia/Kathmandu',
      'US/Pacific',
      'Europe/Kiev',
      'Europe/Kyiv',
      '../etc/passwd',
      'A/B',
      'Europe/London\u0000',
      'Europe/Lоndon', // Cyrillic о
    ];
    const out: (string | null | undefined)[] = [...junk];
    while (out.length < n) {
      const k = r();
      if (k < 0.5) out.push(real[Math.floor(r() * real.length)]);
      else if (k < 0.75) {
        const z = real[Math.floor(r() * real.length)];
        out.push(r() < 0.5 ? z.toLowerCase() : z.slice(0, Math.max(1, Math.floor(r() * z.length))));
      } else {
        const chars = 'ABCxyz/_-+09 ';
        let s = '';
        for (let i = Math.floor(r() * 16); i > 0; i--) s += chars[Math.floor(r() * chars.length)];
        out.push(s);
      }
    }
    return out;
  }

  it('300 real / mangled / junk ids: first (uncached) and second (cached) calls equal the reference', () => {
    const list = candidates(300);
    expect(list.length).toBe(300);
    for (const z of list) {
      const expected = uncached(z);
      expect(tz.isValidTimeZone(z), `first ${String(z)}`).toBe(expected);
      expect(tz.isValidTimeZone(z), `cached ${String(z)}`).toBe(expected);
    }
  });

  it('past the 500-entry cache bound, answers stay correct (uncached path)', () => {
    const real = Intl.supportedValuesOf('timeZone');
    const all = [...real, ...real.map((z) => z.toLowerCase()), ...real.map((z) => `${z}X`)];
    expect(all.length).toBeGreaterThan(500);
    for (const z of all) expect(tz.isValidTimeZone(z), z).toBe(uncached(z));
    for (const z of all.slice().reverse()) expect(tz.isValidTimeZone(z), z).toBe(uncached(z));
  });
});

describe('formatInZone / zoneAbbreviation — cached equals fresh across DST boundaries', () => {
  const ZONES = ['America/New_York', 'Europe/London', 'Australia/Lord_Howe', 'Asia/Kathmandu', 'UTC'];
  // Instants around each zone's 2026 transitions (and fixed points).
  const INSTANTS = [
    '2026-03-08T06:59:59Z', '2026-03-08T07:00:00Z', // NY spring forward
    '2026-11-01T05:59:59Z', '2026-11-01T06:00:00Z', // NY fall back
    '2026-03-29T00:59:59Z', '2026-03-29T01:00:00Z', // London spring
    '2026-10-25T00:59:59Z', '2026-10-25T01:00:00Z', // London fall
    '2026-04-04T14:59:59Z', '2026-04-04T15:00:00Z', // Lord Howe (30-min DST) ends
    '2026-10-03T15:59:59Z', '2026-10-03T16:00:00Z', // Lord Howe starts
    '2026-01-01T00:00:00Z', '2026-07-01T12:34:56Z', '1999-12-31T23:59:59Z', '2038-01-19T03:14:08Z',
  ].map((s) => new Date(s));
  const OPTIONS: Intl.DateTimeFormatOptions[] = [
    { hour: 'numeric', minute: '2-digit' },
    { minute: '2-digit', hour: 'numeric' }, // same, other key order
    { month: 'short', day: 'numeric' },
    { day: 'numeric', month: 'short' },
    { weekday: 'short', month: 'short', day: 'numeric', year: undefined, hour: 'numeric', minute: '2-digit' },
    { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' },
    { year: 'numeric', hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short', weekday: 'short' },
    { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' },
    { timeZoneName: 'long', hour: 'numeric' },
    { dateStyle: 'full', timeStyle: 'long' },
  ];
  const LOCALES = [undefined, 'en-US', 'en-GB', 'pt-PT', 'ar-EG', 'ja-JP'];

  it('formatInZone: cached result === fresh Intl result for every zone × instant × options × locale (twice)', () => {
    let n = 0;
    for (let pass = 0; pass < 2; pass++)
      for (const zone of ZONES)
        for (const opts of OPTIONS)
          for (const locale of LOCALES)
            for (const d of INSTANTS) {
              const fresh = new Intl.DateTimeFormat(locale, { ...opts, timeZone: zone }).format(d);
              expect(tz.formatInZone(d, zone, opts, locale), `${zone} ${locale} ${JSON.stringify(opts)} ${d.toISOString()}`).toBe(
                fresh
              );
              n++;
            }
    expect(n).toBe(2 * ZONES.length * OPTIONS.length * LOCALES.length * INSTANTS.length);
  });

  it('interleaving zones/options never returns a formatter for the wrong key', () => {
    const r = mulberry32(5);
    for (let i = 0; i < 5_000; i++) {
      const zone = ZONES[Math.floor(r() * ZONES.length)];
      const opts = OPTIONS[Math.floor(r() * OPTIONS.length)];
      const locale = LOCALES[Math.floor(r() * LOCALES.length)];
      const d = INSTANTS[Math.floor(r() * INSTANTS.length)];
      expect(tz.formatInZone(d, zone, opts, locale)).toBe(
        new Intl.DateTimeFormat(locale, { ...opts, timeZone: zone }).format(d)
      );
    }
  });

  it('options carrying their own timeZone are overridden by tz, cached or not', () => {
    const d = INSTANTS[0];
    const fresh = new Intl.DateTimeFormat('en-US', { hour: 'numeric', timeZone: 'Asia/Tokyo' }).format(d);
    expect(tz.formatInZone(d, 'Asia/Tokyo', { hour: 'numeric', timeZone: 'UTC' }, 'en-US')).toBe(fresh);
    expect(tz.formatInZone(d, 'Asia/Tokyo', { hour: 'numeric', timeZone: 'UTC' }, 'en-US')).toBe(fresh);
  });

  it('invalid zone falls back to the device-zone formatter (not cached under the bad key)', () => {
    const d = INSTANTS[3];
    const opts = { hour: 'numeric', minute: '2-digit' } as const;
    const expected = new Intl.DateTimeFormat('en-US', opts).format(d);
    expect(tz.formatInZone(d, 'Not/AZone', opts, 'en-US')).toBe(expected);
    expect(tz.formatInZone(d, 'Not/AZone', opts, 'en-US')).toBe(expected);
  });

  it('zoneAbbreviation: cached === fresh across DST for each zone and locale; invalid zone → id', () => {
    for (let pass = 0; pass < 2; pass++)
      for (const zone of ZONES)
        for (const locale of LOCALES)
          for (const d of INSTANTS) {
            const fresh =
              new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' })
                .formatToParts(d)
                .find((p) => p.type === 'timeZoneName')?.value ?? zone;
            expect(tz.zoneAbbreviation(zone, d, locale), `${zone} ${locale} ${d.toISOString()}`).toBe(fresh);
          }
    expect(tz.zoneAbbreviation('Not/AZone', INSTANTS[0])).toBe('Not/AZone');
  });

  it('beyond the cache bounds (300 / 200 entries) results stay correct', () => {
    const zones = Intl.supportedValuesOf('timeZone').slice(0, 400);
    const d = INSTANTS[1];
    for (const z of zones) {
      expect(tz.formatInZone(d, z, { hour: 'numeric' }, 'en-US')).toBe(
        new Intl.DateTimeFormat('en-US', { hour: 'numeric', timeZone: z }).format(d)
      );
      expect(tz.zoneAbbreviation(z, d, 'en-US')).toBe(
        new Intl.DateTimeFormat('en-US', { timeZone: z, timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName')
          ?.value
      );
    }
  });

  it("documented: locale '' shares the cache key with undefined, so an invalid '' locale only throws when uncached", () => {
    const d = INSTANTS[0];
    // Uncached: '' is an invalid locale → the old behaviour (zone id) is kept.
    expect(tz.zoneAbbreviation('America/New_York', d, '')).toBe('America/New_York');
    // After a default-locale call fills the shared key, '' now gets the abbreviation.
    expect(tz.zoneAbbreviation('America/New_York', d)).not.toBe('America/New_York');
    expect(tz.zoneAbbreviation('America/New_York', d, '')).not.toBe('America/New_York');
  });
});
