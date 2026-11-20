# Prepared migration — live events page RPC (2026-11-20)

**Status: PREPARED, NOT APPLIED — anywhere.** One file, no schema change, two
new functions nothing else references. The shared local database has NOT been
touched (owner constraint, 2026-11-19: all database changes are applied by the
owner, later, in one sitting).

| File | Adds |
| --- | --- |
| `20261120100000_get_live_events.sql` | `event_occurrence_in_progress()` (which session of a series runs at a given instant) and `get_live_events()` (running-now rows ranked by proximity/popularity/premium/interests + a seeded sprinkle, then "starting soon" rows) |

## Why it can be applied any time (and why later is fine)

The client shipped FIRST with a fallback: `services/liveEvents.ts` probes for
`get_live_events`, and where it is missing (every backend today) classifies a
`get_ranked_events` page on the device with the same occurrence rules
(`utils/liveEvents.ts`). So:

* applying nothing: the live page works, ranked by distance only;
* applying this file: the page silently upgrades to one request with the full
  ranking (interests boost, never a filter; sprinkle stable per visit seed).

Owner decisions encoded (2026-11-19): in-progress first with a smaller
"starting soon" block (60 min, parameter capped at 240); interests boost but
never filter; seeded randomness.

## How to apply (owner, with the other prepared files)

```sh
# dry run in a throwaway container first (unique name!)
PG17_NAME=<unique> scripts/pg17-isolated.sh init
PG17_NAME=<unique> scripts/pg17-isolated.sh apply supabase/prepared/2026-11-20_live_events/20261120100000_get_live_events.sql
PG17_NAME=<unique> scripts/pg17-isolated.sh apply scripts/test-live-events.sql   # expect: all assertions passed
PG17_NAME=<unique> scripts/pg17-isolated.sh destroy

git mv supabase/prepared/2026-11-20_live_events/20261120100000_get_live_events.sql supabase/migrations/
npx supabase migration up
npm run backend:types   # then drop the untypedRpc cast in services/liveEvents.ts (optional cleanup)
```

## Validation (2026-11-19, throwaway PG17 container `live_ev_fab`, destroyed)

| Check | Result |
| --- | --- |
| Applies cleanly; idempotent on re-apply | yes (applied twice) |
| `scripts/test-live-events.sql` | all assertions passed — membership of live/soon, live-before-soon order, a running series listed once, cancelled-today excluded, interests boost (and boost-not-filter), same seed ⇒ same order, limit, soon-window parameter, banned host hidden, anon caller |
| Suite skips where the file is absent | yes (`get_live_events not applied; suite skipped`) |
| **All 18 SQL suites with the file applied** | 18/18 passed |
| Client ↔ server parity on "which session runs now" | `scripts/live-parity.sql` → `tests/fixtures/liveParity.json` (27 rows: moved/cancelled dates, endDate, month-end clamp, overnight, America/New_York DST, one-offs); `tests/liveParity.test.ts` 28/28 against the client's `occurrenceInProgress` |

## Rollback

Plain `DROP FUNCTION public.get_live_events(double precision, double precision,
double precision, integer, integer, uuid[], text);` and
`DROP FUNCTION public.event_occurrence_in_progress(uuid, timestamptz);` — the
client falls back by itself (one failed probe per session).

## The client half (already built, works without this file)

`utils/liveEvents.ts` (pure classification + labels), `services/liveEvents.ts`
(RPC + fallback), `screens/LiveEvents.tsx` + `app/live.tsx` (the page:
"Happening now" then a capped "Starting soon", 60 s refresh, countdowns),
Discover's "Happening now" strip (derived from rows already fetched — no extra
request). Tests: `tests/liveEvents.test.ts`, `tests/liveParity.test.ts`,
browser `scripts/fake-backend-e2e/suiteLive.mjs` (LV1 fallback, LV1b skipped
date, LV2 one-request RPC path, LV3 empty state, LV4 the strip).

## UX review (2026-11-19)

Refinements after a UI/UX pass (client only; this file is unchanged):
re-bucketing against the ticking clock between refreshes (ended sessions drop
out, started "soon" rows move up — `rebucket` in `utils/liveEvents.ts`);
pull-to-refresh spinner only for a pull, not the 60 s timer; an
"approximate location" note when location permission is missing; a "nothing
live right now" line when only "starting soon" has rows; multi-day sessions
read "Ends in 2 days"; 44 px back button and Discover strip; 16 px gutters
and 10 px gaps matching Joined/Saved; a clock icon for the countdown line;
countdown included in each row's screen-reader label. Covered by
`suiteLive` LV5 (320 px, 1.6× text, targets) and LV6 (re-bucketing with a
frozen server answer).

## Final regression (2026-11-20)

Re-validated in throwaway container `final_reg_fab`: applies with 0 errors,
idempotent, 18/18 suites; the parity fixture regenerated identically.
Browser: `suiteLive` 35/35; accessibility scenario N (axe WCAG A/AA) passes
for the populated and empty live page — row labels carry every visible word
in order. Apply-day commands: `docs/STATUS_2026-11-20_LIVE_REVIEWS_DASHBOARD.md` §3.
