# Prepared migrations — phase 4 (2026-11-18)

**Status: PREPARED, NOT APPLIED.** Four files: Batch D's chat window, the
biggest open correctness item (E-R1), the recurrence edge fixes, and the
Joined-lists gap. Nothing in the shipped app depends on any of them
(ground rules: no probe-and-retry), so they wait for your apply-day with the
other two folders (`2026-11-18_batch_c`, `2026-11-18_duplicate_v2`).

**Decisions taken (owner delegated to the recorded recommendations, 2026-11-18):**
- **D1 window: 7 days.** Posting stays open for 7 days after the event is
  over, then the chat is read-only; for a series the days count from the
  series end; a cancelled event follows the same rule from its scheduled end.
- **D2 (series reviews): recommendation accepted (they count toward the venue
  rating) but the migration is DEFERRED** — building it surfaced a sequencing
  hazard; see "D2, deferred" below.

| # | File | What | Apply order |
| --- | --- | --- | --- |
| 1 | `20261118120000_effective_occurrence_everywhere.sql` | E-R1: ranking, saved/going, calendar and the three collection RPCs stop ignoring per-date exceptions | **Before #3** |
| 2 | `20261118130000_recurrence_edge_fixes.sql` | S1 monthly month-end drift; S2 long-interval v2 walk; O-5 endDate-before-start refused | any |
| 3 | `20261118140000_joined_lists_date_only.sql` | EJ-24: date-only attendees appear in Joined/attended | **After #1** (it re-creates `get_user_going_events` on top of #1's version) |
| 4 | `20261118150000_post_event_chat_window.sql` | D1: `event_chat_posting_open()`, wired into the INSERT policy, `can_post` and the announcement mirror | any |

No signatures or output shapes change anywhere: **no type regeneration and no
client change is required by #1–#3**. #4 needs no types either (`can_post`
already exists); its client half is listed below.

## Validation (2026-11-18, throwaway PG17 containers, unique names, destroyed)

| Check | Result |
| --- | --- |
| Each file applies cleanly and is idempotent on re-apply | yes (×4) |
| **All 15 SQL suites with all four applied** | 15/15 |
| **All 15 SQL suites with none applied** (skip paths) | 15/15; `test-lifecycle [8]` skips with a NOTICE |
| E-R1 fingerprints on the seed DB (deterministic data), before vs after | identical (ranked / saved / going / calendar / collections) |
| E-R1 behaviour: a series whose next date is cancelled | all six surfaces report the following week |
| E-R1 perf (120k-event fixture, `scripts/perf/bench_ranked.sql`) | dense page ~82 ms baseline → ~83 ms at zero exceptions; ~100–107 ms with a cancelled exception on half the in-box recurring events (design predicted 83 → 85.5 → ~125 on its machine) |
| S1: monthly-31 asked between the clamped Feb occurrence and March | `2027-03-31` (was `2027-03-28`) |
| S2: nthWeekday every 36 months asked mid-cycle | `2029-11-13` (was the stale series start) |
| Parity: the original 14-shape × 40-now grid, regenerated after the fix | byte-identical to the committed fixture (zero regression) |
| Parity, widened (2b-3): 18 shapes, +3 drift-window instants, first-5 dates | client == server everywhere (`tests/recurrenceParity.test.ts`, 59 tests) |
| O-5: endDate before the first date / on the first date | refused / accepted |
| EJ-24: date-only goer | in Joined upcoming, in attended once finished; `interested` scope untouched; a lone `not_going` row adds nothing |
| D1: +3 h / +8 days after the end | posting open / read-only (one-off AND series), host included, `can_read` untouched, announcement notifications still sent, chat mirror skipped, INSERT policy carries the rule (asserted on the catalog — never provoked as a role; segfault ground rule) |
| D1 pinned forever | `scripts/test-lifecycle.sql` block [8] + the new `ended_week` phase |

**A false lead, documented so nobody chases it again:** the perf fixture's
result fingerprints CANNOT be compared across runs — the ranking score decays
with hours-to-start measured from `now()`, so two benches 150 s apart on an
identical, unchanged database already produce different hashes (verified).
Equivalence evidence lives in the deterministic seed-DB fingerprints above.

**Two suite fixtures were changed** (they used `endDate: "2020-01-01"` —
years before their events' own starts, the exact shape O-5 now refuses and the
app has always refused client-side): `test-host-tools` 11.9 ends its series a
week after its start; `test-attendance-rpcs`' `rec_done` ends on its start day
(one session ran), so the per-session attended expectation moved 6 → 7. Both
pass with and without the migrations applied.

## How to apply (owner) — after the roadmap's client work is done

Local first; hosted only after the §0 inventory in `docs/MIGRATIONS_PENDING.md`.
File-number order already encodes the one dependency (#1 before #3).

```sh
# 0. optional: re-validate on a throwaway container (UNIQUE name — a sibling
#    session shares this Docker host)
PG17_NAME=ph4_check scripts/pg17-isolated.sh init
for f in supabase/prepared/2026-11-18_phase4/2026*.sql; do PG17_NAME=ph4_check scripts/pg17-isolated.sh apply "$f"; done
PG17_NAME=ph4_check scripts/pg17-isolated.sh suites && PG17_NAME=ph4_check scripts/pg17-isolated.sh destroy

# 1. move them into the migrations folder
git mv supabase/prepared/2026-11-18_phase4/2026*.sql supabase/migrations/

# 2. apply to the local stack
npx supabase migration up

# 3. verify: max(version) = 20261118150000 (count depends on the other folders)
#    select count(*), max(version) from supabase_migrations.schema_migrations;

# 4. types: NOT needed for these four (no signature changed). If you apply the
#    other folders in the same sitting, run `npm run backend:types` once at the
#    end for them.
```

## After applying: client follow-ups

- **E-R1 (B4, ~1–2 h):** retire or demote `useEffectiveNextDates` where the
  server now returns the effective date (lists, calendar, collections). Purely
  an optimisation clean-up; nothing is wrong meanwhile.
- **D1 (~2–3 h):** mirror the rule as `CHAT_AFTER_END_DAYS = 7` in
  `utils/eventChatAccess.ts`; event page chat row after the end — "Chat open
  until <date>" during the window (the row currently hides at `ended`), then
  "Chat closed — read the history"; the chat screen's composer says "This chat
  closed on <date>" when `can_post` is false and the event is over (it already
  consumes `can_post`); the rehearsal "Ended" scenario shows the same states;
  flip `suiteLifecycle` L4's "chat row gone" check to the new states.
- **S1/S2/O-5, EJ-24:** nothing — the client already behaves this way.

## D2 — series reviews: deferred, and what you'd be deciding

The design (plan §5a): `reviews.event_id` (nullable), unique
`(user, business) WHERE event_id IS NULL` + unique `(user, event)` for series
reviews, eligibility via `user_series_sessions_attended`, and — your answered
sub-question — series reviews DO count toward the venue's overall rating.

**Why it is not staged:** the design replaces the plain
`UNIQUE (user_id, business_id)` constraint with partial unique indexes, but
the deployed client submits reviews with
`upsert(..., { onConflict: 'user_id,business_id' })`
(`services/reviews.ts:40-50`), and Postgres will not infer a PARTIAL unique
index as that arbiter — **the moment the migration applies, every review
submission from the running app errors**. Unlike everything else staged here,
it cannot sit applied under today's client, and "apply at the end of the
roadmap" is exactly when it would break the app. It needs its own
migration + client cutover pair, shipped together.

Safe shapes to choose between (recommendation: **a**):
- **(a) Two-step:** first a client release that submits reviews through a new
  `submit_review(...)` RPC (which the server can evolve underneath); then the
  schema migration. Slightly slower, no breakage window.
- **(b) Separate `series_reviews` table:** venue reviews untouched, no upsert
  hazard, "counts toward the venue" implemented in the rating aggregation.
  Diverges from the recorded design; two places reviews live forever.

**Decided 2026-11-18: option (a).** The order is therefore:

1. A client release that submits reviews through a new `submit_review(...)`
   RPC instead of the PostgREST upsert (`services/reviews.ts:40-50`), with the
   RPC added by its own small migration that changes no constraint. After that
   release, the schema is free to move underneath.
2. Then the D2 migration itself: `reviews.event_id`, the two partial unique
   indexes, eligibility via `user_series_sessions_attended`, and series
   reviews counted into the venue's overall rating.
3. Then the D2 client half (series page's own reviews + rating, the review
   button's eligibility line, the rehearsal "Ended" scenario).

Nothing in step 1 is urgent — but it is the gate for everything else in D2,
so it is the first thing to build when D2 is picked up.

Also decided 2026-11-18, both from phase 2: duplicate v2 does **not** get
`p_keep_recurrence` (a copied series stays a one-off until a host asks for
otherwise — the sheet says so), and `event_bans` do **not** carry over to a
duplicated event.
