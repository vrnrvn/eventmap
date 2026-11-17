/**
 * Client-side recurrence benchmark (Roadmap B6,
 * docs/HOST_DASHBOARD_AND_RECURRENCE_REVIEW_2026-11-16.md §2.4).
 *
 *   npm run bench:recurrence
 *
 * Everything here is pure client logic — no database, no network, no browser.
 * It runs in the foreground in a couple of seconds.
 *
 * The shapes measured are the ones the app actually asks for:
 *   - list cards (Discover, Saved, collections): getNextOccurrences(event, 1)
 *   - event page / host list: listOccurrences with exceptions applied
 *   - calendar month: filterEventsByDateRange over a 31-day window
 *   - ICS export: exceptionsForIcs, which asks for 200 occurrences
 *
 * Use it to decide whether memoising these is worth the complexity before the
 * host dashboard (Roadmap C) starts calling them across many events at once.
 */
import { filterEventsByDateRange, getNextOccurrences } from '@/utils/recurrence';
import { exceptionsForIcs, listOccurrences } from '@/utils/occurrences';

const NOW = new Date('2026-11-16T12:00:00Z');

const PATTERNS = [
  { frequency: 'weekly', interval: 1 },
  { frequency: 'weekly', interval: 2, byWeekday: [2, 4] },
  { frequency: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] },
  { frequency: 'daily', interval: 1 },
  { frequency: 'daily', interval: 3 },
  { frequency: 'monthly', interval: 1 },
  { frequency: 'monthly', interval: 3, monthly: 'nthWeekday' },
];

const ZONES = ['UTC', 'Europe/Lisbon', 'America/New_York', null];

/** `count` series spread across the pattern shapes and zones above. */
function makeSeries(count) {
  return Array.from({ length: count }, (_, i) => {
    // Starts spread over the past year, so the walk has ground to cover.
    const start = new Date(Date.UTC(2026, 0, 1 + (i % 330), 19, 0, 0));
    return {
      id: `evt-${i}`,
      start_datetime: start.toISOString(),
      end_datetime: new Date(start.getTime() + 2 * 3600_000).toISOString(),
      is_recurring: true,
      recurrence_pattern: PATTERNS[i % PATTERNS.length],
      timezone: ZONES[i % ZONES.length],
    };
  });
}

const discoverPage = makeSeries(50);
const calendarEvents = makeSeries(200);
const oneSeries = makeSeries(1)[0];

const exceptions = Array.from({ length: 5 }, (_, i) => ({
  event_id: 'evt-0',
  occurrence_date: `2026-12-0${i + 1}`,
  kind: i % 2 === 0 ? 'cancelled' : 'rescheduled',
  new_start: i % 2 === 0 ? null : `2026-12-0${i + 1}T20:00:00Z`,
  new_end: i % 2 === 0 ? null : `2026-12-0${i + 1}T22:00:00Z`,
  note: null,
}));

/** Median and p95 of `iterations` runs, in milliseconds. */
function measure(name, fn, iterations = 200) {
  for (let i = 0; i < Math.min(20, iterations); i++) fn(); // warm up
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return {
    name,
    median: samples[Math.floor(samples.length / 2)],
    p95: samples[Math.floor(samples.length * 0.95)],
  };
}

const results = [
  measure('50 cards × getNextOccurrences(_, 1)', () => {
    for (const e of discoverPage) getNextOccurrences(e, 1, NOW);
  }),
  measure('50 cards × getNextOccurrences(_, 5)', () => {
    for (const e of discoverPage) getNextOccurrences(e, 5, NOW);
  }),
  measure('calendar month: filterEventsByDateRange(200 events, 31 days)', () => {
    filterEventsByDateRange(calendarEvents, new Date('2026-12-01T00:00:00Z'), new Date('2026-12-31T23:59:59Z'));
  }),
  measure('listOccurrences(count 8) with 5 exceptions', () => {
    listOccurrences(oneSeries, exceptions, { count: 8, now: NOW });
  }),
  measure('listOccurrences(count 8) × 50 series, no exceptions', () => {
    for (const e of discoverPage) listOccurrences(e, [], { count: 8, now: NOW });
  }),
  measure('exceptionsForIcs (asks for 200 occurrences)', () => {
    exceptionsForIcs(oneSeries, exceptions, NOW);
  }),
];

const pad = (s, n) => String(s).padEnd(n);
const num = (v) => `${v.toFixed(3)} ms`.padStart(10);
console.log(`\n${pad('scenario', 58)}${pad('median', 12)}p95`);
console.log('-'.repeat(82));
for (const r of results) console.log(`${pad(r.name, 58)}${num(r.median)}  ${num(r.p95)}`);
console.log(`\nnode ${process.version} · ${process.platform}/${process.arch}\n`);
