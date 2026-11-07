import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { derivePremiumState } from '../utils/premiumState';
import type { Business } from '../types/database';

/**
 * Edge cases for derivePremiumState, and parity with the rules it replaced
 * (HEAD: businessesService.checkEventLimit for the month rollover,
 * premiumService.getSubscription/isExpired for expiry). Only a NEW divergence
 * from HEAD would be a regression of this refactor; the time-zone issue below
 * is pre-existing and documented separately.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const biz = (over: Partial<Record<keyof Business, unknown>> = {}): Business =>
  ({
    id: 'b1',
    owner_id: 'u1',
    name: 'Biz',
    subscription_tier: 'free',
    subscription_expires_at: null,
    events_created_this_month: 1,
    last_reset_date: null,
    ...over,
  }) as unknown as Business;

/** Verbatim logic of HEAD's checkEventLimit (count) + isExpired/getSubscription (tier). */
function headRule(b: Business, now: Date) {
  let currentCount = b.events_created_this_month as number | null;
  const lastReset = b.last_reset_date ? new Date(b.last_reset_date) : null;
  if (lastReset && (now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear())) {
    currentCount = 0;
  }
  const expired = !b.subscription_expires_at ? false : new Date(b.subscription_expires_at).getTime() <= now.getTime();
  const premium = b.subscription_tier === 'premium' && !expired;
  return { currentCount, premium, lapsed: b.subscription_tier === 'premium' && expired };
}

describe('derivePremiumState — month rollover (server UTC calendar, any host TZ)', () => {
  // Local-time timestamps on last_reset_date avoid the UTC-midnight issue,
  // so these hold in any TZ.
  // UTC instants and date-only reset values (a Postgres `date`): the month
  // rule follows the server's UTC calendar, so these hold in every TZ.
  const local = (y: number, m: number, d: number, h = 12) => new Date(Date.UTC(y, m - 1, d, h));
  const isoLocal = (y: number, m: number, d: number) =>
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  it('Dec → Jan resets at the UTC month boundary (server semantics); Dec 31 23:59 UTC keeps', () => {
    const b = biz({ last_reset_date: isoLocal(2026, 12, 15), events_created_this_month: 2 });
    expect(derivePremiumState(b, new Date(Date.UTC(2026, 11, 31, 23, 59, 59))).eventCount).toBe(2);
    expect(derivePremiumState(b, new Date(Date.UTC(2027, 0, 1, 0, 0, 1))).eventCount).toBe(0);
  });

  it('same month number, different year resets', () => {
    const b = biz({ last_reset_date: isoLocal(2025, 11, 10), events_created_this_month: 2 });
    expect(derivePremiumState(b, local(2026, 11, 10)).eventCount).toBe(0);
  });

  it('leap day: Feb 29 keeps within February, resets on Mar 1', () => {
    const b = biz({ last_reset_date: isoLocal(2028, 2, 29), events_created_this_month: 2 });
    expect(derivePremiumState(b, local(2028, 2, 29)).eventCount).toBe(2);
    expect(derivePremiumState(b, local(2028, 2, 1)).eventCount).toBe(2);
    expect(derivePremiumState(b, local(2028, 3, 1)).eventCount).toBe(0);
  });

  it('last_reset_date in the future (other month) zeroes the count — same as HEAD', () => {
    const b = biz({ last_reset_date: isoLocal(2027, 1, 5), events_created_this_month: 2 });
    const now = local(2026, 11, 6);
    expect(derivePremiumState(b, now).eventCount).toBe(0);
    expect(headRule(b, now).currentCount).toBe(0);
  });

  it("invalid date strings: '' keeps the count, 'garbage' zeroes it (Invalid Date) — both same as HEAD", () => {
    const now = local(2026, 11, 6);
    for (const last of ['', 'garbage', '2026-13-01', 'null']) {
      const b = biz({ last_reset_date: last, events_created_this_month: 2 });
      expect(derivePremiumState(b, now).eventCount, last).toBe(headRule(b, now).currentCount);
    }
    expect(derivePremiumState(biz({ last_reset_date: '', events_created_this_month: 2 }), now).eventCount).toBe(2);
    expect(derivePremiumState(biz({ last_reset_date: 'garbage', events_created_this_month: 2 }), now).eventCount).toBe(0);
  });

  it('events_created_this_month null/undefined → 0 (HEAD returned null here; 0 is the safe reading)', () => {
    const now = local(2026, 11, 6);
    expect(derivePremiumState(biz({ events_created_this_month: null }), now).eventCount).toBe(0);
    expect(derivePremiumState(biz({ events_created_this_month: undefined }), now).eventCount).toBe(0);
    expect(headRule(biz({ events_created_this_month: null }), now).currentCount).toBeNull();
  });
});

describe('derivePremiumState — expiry', () => {
  const NOW = new Date('2026-11-06T12:00:00.000Z');

  it('expiry exactly == now is expired (lapsed premium, free plan)', () => {
    const s = derivePremiumState(biz({ subscription_tier: 'premium', subscription_expires_at: NOW.toISOString() }), NOW);
    expect(s).toMatchObject({ planSlug: 'free', subscription: null, lapsed: true });
    const s2 = derivePremiumState(
      biz({ subscription_tier: 'premium', subscription_expires_at: new Date(NOW.getTime() + 1).toISOString() }),
      NOW
    );
    expect(s2).toMatchObject({ planSlug: 'pro', lapsed: false });
    expect(s2.subscription?.current_period_end).toBe(new Date(NOW.getTime() + 1).toISOString());
  });

  it('null / undefined / empty expiry never lapses; current_period_end is null', () => {
    for (const exp of [null, undefined, '']) {
      const s = derivePremiumState(biz({ subscription_tier: 'premium', subscription_expires_at: exp }), NOW);
      expect(s.planSlug, String(exp)).toBe('pro');
      expect(s.lapsed).toBe(false);
      expect(s.subscription?.current_period_end ?? null).toBe(exp === '' ? '' : null);
    }
  });

  it('an unparseable expiry is treated as not expired (same as HEAD isExpired)', () => {
    const b = biz({ subscription_tier: 'premium', subscription_expires_at: 'garbage' });
    expect(derivePremiumState(b, NOW)).toMatchObject({ planSlug: 'pro', lapsed: false });
    expect(headRule(b, NOW)).toMatchObject({ premium: true, lapsed: false });
  });

  it('non-premium tiers (free, unknown, missing) are free and never lapsed', () => {
    for (const tier of ['free', 'enterprise', undefined, null, 'Premium']) {
      const s = derivePremiumState(biz({ subscription_tier: tier, subscription_expires_at: '2000-01-01T00:00:00Z' }), NOW);
      expect(s, String(tier)).toMatchObject({ planSlug: 'free', subscription: null, lapsed: false });
    }
  });

  it('missing fields entirely (sparse row) do not throw', () => {
    expect(derivePremiumState({ id: 'x' } as Business, NOW)).toEqual({
      subscription: null,
      planSlug: 'free',
      eventCount: 0,
      lapsed: false,
    });
  });
});

// ── Time-zone sensitivity, in subprocesses with TZ set ──────────────────────

/**
 * Runs derivePremiumState and the HEAD rule in a child Node with `TZ=tz`
 * (Node strips the type-only import). Returns one result per case.
 */
function runInZone(tz: string, cases: { row: Record<string, unknown>; now: string }[]) {
  const modUrl = pathToFileURL(path.join(ROOT, 'utils/premiumState.ts')).href;
  const script = `
    const { derivePremiumState } = await import(${JSON.stringify(modUrl)});
    const cases = JSON.parse(process.argv[1]);
    const head = (b, now) => {
      let c = b.events_created_this_month;
      const lr = b.last_reset_date ? new Date(b.last_reset_date) : null;
      if (lr && (now.getMonth() !== lr.getMonth() || now.getFullYear() !== lr.getFullYear())) c = 0;
      const expired = !b.subscription_expires_at ? false : new Date(b.subscription_expires_at).getTime() <= now.getTime();
      return { count: c, premium: b.subscription_tier === 'premium' && !expired };
    };
    const out = cases.map(({ row, now }) => {
      const d = new Date(now);
      const s = derivePremiumState(row, d);
      return { count: s.eventCount, premium: s.planSlug === 'pro', head: head(row, d), zone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    });
    process.stdout.write(JSON.stringify(out));
  `;
  const res = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', script, JSON.stringify(cases)],
    { env: { ...process.env, TZ: tz }, encoding: 'utf8', timeout: 20_000 }
  );
  if (res.status !== 0) throw new Error(`child failed (${tz}): ${res.stderr}`);
  return JSON.parse(res.stdout) as { count: number; premium: boolean; head: { count: number; premium: boolean }; zone: string }[];
}

const ZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/New_York',
  'Pacific/Honolulu',
  'America/St_Johns',
  'Europe/London',
  'Asia/Tokyo',
  'Asia/Kathmandu',
  'Pacific/Kiritimati',
  'Australia/Lord_Howe',
];

function zoneCases() {
  const cases: { row: Record<string, unknown>; now: string }[] = [];
  const days = ['2026-11-01', '2026-11-02', '2026-11-30', '2026-12-01', '2026-12-31', '2027-01-01', '2028-02-29', '2028-03-01'];
  const nows = [
    '2026-11-01T00:30:00Z',
    '2026-11-01T12:00:00Z',
    '2026-11-15T12:00:00Z',
    '2026-11-30T23:30:00Z',
    '2026-12-01T09:00:00Z',
    '2027-01-01T00:00:00Z',
    '2028-02-29T12:00:00Z',
    '2028-03-01T06:00:00Z',
  ];
  for (const last of days)
    for (const now of nows)
      for (const tier of ['free', 'premium'])
        cases.push({
          now,
          row: {
            id: 'b',
            subscription_tier: tier,
            subscription_expires_at: tier === 'premium' ? '2026-11-15T12:00:00Z' : null,
            events_created_this_month: 2,
            last_reset_date: last,
          },
        });
  return cases;
}

describe('derivePremiumState — TZ matrix (child processes)', () => {
  it('tier matches HEAD in every zone; month rollover follows the server (UTC) in every zone', () => {
    const cases = zoneCases();
    for (const tz of ZONES) {
      const results = runInZone(tz, cases);
      // The child really ran in that zone (ICU may report a legacy alias, e.g. Asia/Katmandu).
      expect([tz, tz.replace('Kathmandu', 'Katmandu')]).toContain(results[0].zone);
      results.forEach((r, i) => {
        // Tier logic is unchanged from HEAD. The month rule now compares in
        // UTC (the server's reset semantics), so the count is the same in
        // every zone; it equals HEAD wherever HEAD's local-month rule agreed.
        const c = cases[i]; const last = new Date(c.row.last_reset_date as string); const now = new Date(c.now);
        const expectedCount = last.getUTCMonth() === now.getUTCMonth() && last.getUTCFullYear() === now.getUTCFullYear() ? 2 : 0;
        expect({ count: r.count, premium: r.premium }, `${tz} ${JSON.stringify(c)}`).toEqual({ count: expectedCount, premium: r.head.premium });
      });
    }
  }, 60_000);

  it('fixed pre-existing west-of-UTC bug: a reset dated the 1st keeps the count everywhere', () => {
    const row = { id: 'b', subscription_tier: 'free', events_created_this_month: 2, last_reset_date: '2026-11-01' };
    const now = '2026-11-15T20:00:00Z'; // mid-November everywhere
    const [la] = runInZone('America/Los_Angeles', [{ row, now }]);
    const [utc] = runInZone('UTC', [{ row, now }]);
    const [tokyo] = runInZone('Asia/Tokyo', [{ row, now }]);
    expect(utc.count).toBe(2);
    expect(tokyo.count).toBe(2);
    expect(la.count).toBe(2); // fixed (UTC-month comparison)
    expect(la.head.count).toBe(0); // HEAD's local-month rule read it as last month
  }, 30_000);
});

// Real bug (PRE-EXISTING — identical in HEAD's checkEventLimit, so not a
// regression of this refactor; see report). `last_reset_date` is a Postgres
// `date`; `new Date('YYYY-MM-DD')` is UTC midnight, then compared with LOCAL
// getMonth(). West of UTC, a counter reset on the 1st reads as last month for
// the WHOLE month, so the client shows 0 events used (premium/free limit UI
// says "can create" until the server's check rejects it).
describe('FIXED (pre-existing): month rollover west of UTC', () => {
  it('a reset dated the 1st of this month keeps the count in America/Los_Angeles', () => {
    const row = { id: 'b', subscription_tier: 'free', events_created_this_month: 2, last_reset_date: '2026-11-01' };
    const [la] = runInZone('America/Los_Angeles', [{ row, now: '2026-11-15T20:00:00Z' }]);
    expect(la.count).toBe(2);
  });
});
