# Status — live events, series reviews, host dashboard (2026-11-20)

**Read this first.** Single source of truth for the work done on branch
`hfi/ffea3d71-7239-4d64-9f7e-4241cceea0f1/oak` between 2026-11-19 and
2026-11-20: what is finished, what is partial, what the database still needs,
and how it was verified. **Nothing is committed** (owner instruction); every
change listed below is in the working tree.

Companion docs: [`STATUS_AND_APPLY_DAY_2026-11-19.md`](STATUS_AND_APPLY_DAY_2026-11-19.md)
(the older apply-day runbook — still valid for everything before this work),
[`MIGRATIONS_PENDING.md`](MIGRATIONS_PENDING.md) (§0 inventory, owner table),
and the READMEs in `supabase/prepared/2026-11-19_series_reviews/` and
`supabase/prepared/2026-11-20_live_events/`.

---

## 1. At a glance

| Area | Status | What is left |
| --- | --- | --- |
| Phase 0 — hosted-DB inventory | **Finished** | Nothing. No hosted project exists (owner, 2026-11-19); re-run `scripts/hosted-inventory.mjs` if one is ever created |
| Host dashboard in one request (C3 cutover) | **Finished** | Nothing. `get_host_dashboard` is already in the local DB |
| Reviews submit through `submit_review()` (D2 step 2) | **Finished** | Nothing. Function already in the local DB |
| Drafts excluded from "upcoming" lists | **Finished** | Nothing |
| Series reviews UI (D2 step 4) | **Partial — built, dormant** | Owner applies `20261119110000_series_reviews.sql` (§3); the UI turns on by itself |
| Live events page (phase 3) | **Finished on fallback; one-request path partial** | Owner applies `20261120100000_get_live_events.sql` (§3); the page upgrades by itself |
| Clock-independent browser tests | **Finished** | Nothing |
| UI/UX review + accessibility fixes | **Finished** | Two reviewed, documented follow-ups (§6) |
| Commit | **Not done** | Owner decision |

---

## 2. Database state (as of 2026-11-20)

* **Shared local database: untouched by this work.** Read-only inventory on
  2026-11-19: 139 migrations recorded through `20261119130000`, no repository
  file missing, no recorded-but-unknown version (drift), Oct 30 security set
  4/4 present. `submit_review(3 args)` and `get_host_dashboard` present;
  `reviews.event_id` absent.
* **No hosted project.** The app runs on local builds against the local DB.
* **Every database test ran in throwaway PG17 containers** with unique names
  (`live_ev_fab`, `final_reg_fab`), destroyed afterwards. Never the shared
  cluster.

### Pending migrations (prepared, NOT applied anywhere)

| Order | File | Effect when applied | Safe to apply now? |
| --- | --- | --- | --- |
| 1 | `supabase/prepared/2026-11-19_series_reviews/20261119110000_series_reviews.sql` | Reviews per recurring series: `reviews.event_id`, two partial unique indexes (replacing `UNIQUE (user_id, business_id)`), `user_can_review_event`, `review_event_venue`, `get_event_review_summary`, `submit_review` gains `p_event_id`. Series reviews count toward the venue average (owner decision) | **Only after the precondition in §3.1** |
| 2 | `supabase/prepared/2026-11-20_live_events/20261120100000_get_live_events.sql` | `event_occurrence_in_progress()` + `get_live_events()`. No schema change; nothing else references them | Yes, any time — inert until the live page probes it |

The two are independent; the order above is just filename order.

---

## 3. Apply-day instructions (owner)

### 3.1 Precondition for the series-reviews file — other worktrees

Sibling worktrees share the local database. At the time of writing they sit
at commit `a5ba608`, whose `services/reviews.ts` still saves reviews with
`upsert(..., { onConflict: 'user_id,business_id' })`. File 1 replaces that
unique constraint with partial indexes, which Postgres **cannot** use as an
`ON CONFLICT` arbiter — so **from the moment file 1 is applied, review saving
fails in any worktree still on the old code.** Before applying file 1, do one
of:

* **(recommended)** commit this branch and bring its `services/reviews.ts`
  (the `submit_review()` path) into those branches; or
* apply only in a per-worktree scratch DB (`SCRATCH_DB`, see
  `scripts/db-scratch.sh`) until they are updated; or
* accept that review saving is broken in those worktrees until they update.

Check with: `git show <their-commit>:services/reviews.ts | grep -n onConflict`
(no match = safe).

### 3.2 Commands

```sh
# 0. Commit this branch first (a clean point to return to).

# 1. Dry run in a throwaway container — UNIQUE name, a sibling session
#    shares this Docker host. Expect 18 passed each time.
export PG17_NAME=applyday_$(whoami)
scripts/pg17-isolated.sh init
scripts/pg17-isolated.sh suites                         # baseline
scripts/pg17-isolated.sh apply supabase/prepared/2026-11-19_series_reviews/20261119110000_series_reviews.sql
scripts/pg17-isolated.sh apply supabase/prepared/2026-11-20_live_events/20261120100000_get_live_events.sql
scripts/pg17-isolated.sh suites                         # with both
scripts/pg17-isolated.sh destroy
unset PG17_NAME

# 2. Move the files into the migrations folder (after §3.1 is satisfied
#    for file 1; file 2 can go alone at any time).
git mv supabase/prepared/2026-11-19_series_reviews/20261119110000_series_reviews.sql supabase/migrations/
git mv supabase/prepared/2026-11-20_live_events/20261120100000_get_live_events.sql  supabase/migrations/

# 3. Apply to the local database.
npx supabase migration up

# 4. Verify: expect 141 | 20261120100000
#    select count(*), max(version) from supabase_migrations.schema_migrations;

# 5. Regenerate types (new columns/functions).
npm run backend:types

# 6. Sanity.
npm run typecheck && npx vitest run
```

### 3.3 After applying — small cleanups and one real-DB pass

1. **Optional cleanups once types are regenerated:** `services/reviews.ts`
   and `services/liveEvents.ts` each call the new functions through an
   `untypedRpc` helper (they were not in the generated types). Replace with
   `supabase.rpc(...)`; the `.eq('event_id' as never, ...)` casts in
   `services/reviews.ts` can drop `as never`.
2. **Real-DB checks** (the fake backend cannot cover these):
   * A recurring event you attended: "Reviews of this series" shows with its
     own average; "Review this series" submits; after submitting, the button
     reads "Edit your series review" (the fake does not store reviews).
   * The venue page lists the series review labelled "About a recurring
     series"; the event page does not repeat it in the venue list.
   * Someone who never attended sees the "opens once you've attended" line
     only when the series already has reviews.
   * `/live` with a running event nearby: one `get_live_events` request in
     the network log, no `get_ranked_events` from the live page.

### 3.4 Rollback

* `20261120100000_get_live_events`: `DROP FUNCTION public.get_live_events(double precision, double precision, double precision, integer, integer, uuid[], text);`
  and `DROP FUNCTION public.event_occurrence_in_progress(uuid, timestamptz);`
  — the client falls back automatically.
* `20261119110000_series_reviews`: delete series reviews
  (`DELETE FROM reviews WHERE event_id IS NOT NULL`), then
  `ALTER TABLE reviews ADD CONSTRAINT reviews_user_id_business_id_key UNIQUE (user_id, business_id)`
  (full detail in that folder's README). The series section hides itself
  again on its own.

---

## 4. What changed, by system

### 4.1 Host dashboard — one request (C3 cutover) — finished

* `hooks/useHostDashboard.ts` calls `get_host_dashboard` (via
  `services/hostTools.ts` `getHostDashboard`) with the agenda's own window
  (local midnight + 7 days). Where the function is missing — or answers with
  anything other than its object — it uses the previous N-call path.
* "Needs you" comes from the same response and lives in a non-persisted
  query entry, so a restored cache never shows a stale "4 requests waiting".
* The persisted shape is unchanged (optional `source` field), so older
  caches and the Profile "Today" card keep working.
* Parser: `utils/hostDashboardRpc.ts`. Tests: `tests/hostDashboardRpc.test.ts`,
  browser `suiteHostDashboard` H16 (one request, nothing from the old path,
  window starts at local midnight).

### 4.2 Reviews — submit path and series reviews

* **Finished:** `services/reviews.ts` submits through `submit_review()`
  (falls back to the old upsert only where the function is missing).
  `getUserReview` / `deleteReview` target the venue review only, without
  naming `event_id` in a query (the column does not exist until file 1).
* **Dormant until file 1:** `components/SeriesReviewsSection.tsx` +
  `hooks/useSeriesReviews.ts` on a recurring event's page. It probes
  `get_event_review_summary`; missing → renders nothing and asks nothing else.
  Shows its own average, list, form; eligibility from `user_can_review_event`;
  optimistic update after submit; hidden when empty and the viewer cannot
  review yet.
* Venue lists label series reviews (`ReviewCard` `scopeLabel`): "About this
  series" / "About another of their series" on the event page, "About a
  recurring series" on the venue page. The event page does not repeat this
  series' reviews in the venue list.
* Entry point: a finished series' page loads for attendees
  (`get_event_details` is SECURITY DEFINER and hides only drafts), so no
  separate entry point was needed.

### 4.3 Live events page — finished on fallback

* `/live` (`app/live.tsx`, `screens/LiveEvents.tsx`): "Happening now" first,
  then "Starting soon" (≤ 6 rows, 60-minute window); countdowns; 60 s refresh;
  re-bucketing between refreshes (ended sessions drop out, started "soon"
  rows move up); approximate-location note; empty/error/offline states.
* Ranking (owner decisions 2026-11-19): interests are a boost, never a filter;
  a seeded random sprinkle stable within a visit. On the fallback the order
  is by distance only; the RPC adds popularity/premium/interests/sprinkle.
* `services/liveEvents.ts` probes `get_live_events`, otherwise classifies a
  `get_ranked_events` page + series exceptions on the device
  (`utils/liveEvents.ts`).
* Discover shows "Happening now · N live nearby" when a fetched row is live
  (no extra request) and opens `/live`.
* Server/client agreement on "which session runs now":
  `scripts/live-parity.sql` → `tests/fixtures/liveParity.json` →
  `tests/liveParity.test.ts` (27 rows; regenerated in a fresh container on
  2026-11-19 and found identical).

### 4.4 Other fixes

* `services/events.ts`: `getBusinessEvents(scope: 'upcoming')` lists published
  events only (drafts were taking places in the 50-row limit and appearing
  under both Upcoming and Drafts in My Events).
* `scripts/hosted-inventory.mjs`: generates the §0 inventory SQL.
* `components/ReviewCard.tsx`: the star row now has an image role — a
  labelled plain `div` is invalid ARIA (axe `aria-prohibited-attr`, serious).
  Pre-existing; first surfaced by the new accessibility scenario.

### 4.5 Test harness

* Pinned clock (`scripts/fake-backend-e2e/lib.mjs`): `noonUtc` / `noonLocal`,
  `isoFrom`, `PINNED`, `pinClock`, `PIN_DATE` override, and
  **`clearSeededDates`** — the fake seeds `ev[0]` with a cancelled/moved date
  and a per-date RSVP dated from the REAL clock; pinned scenarios that re-date
  `ev[0]` must drop them. That was why A7 still failed at 01:56 UTC on
  2026-11-20 after the first pinning fix. See `docs/TIME_HARNESS.md`.
* New suite `suiteLive.mjs` (LV1–LV6); new scenarios Attendee A9–A13,
  HostDashboard H16, accessibility N (live page populated and empty, series
  reviews section).
* Note on suite arguments: Collections, B, C, D, F, Onboarding and A11y treat
  their third argument as a literal scenario list — pass nothing (A11y: `""`)
  for all scenarios; `all` runs zero scenarios and reports `0/0`.

---

## 5. Final regression pass (2026-11-20, foreground)

**Static:** `npm run typecheck` clean · `npm run lint` 0 errors, 7 warnings
(the same pre-existing 7) · `npx vitest run` **1,376 / 1,376** (107 files).

**SQL — throwaway PG17 container `final_reg_fab`, destroyed:**

| State | Result |
| --- | --- |
| Baseline (139 migrations + seed, nothing prepared) | 18/18 suites |
| Both pending files applied | applied with 0 errors · 18/18 suites |
| Both re-applied (idempotency) | 0 errors · 18/18 suites |
| `live-parity.sql` regenerated vs committed fixture | identical (27 rows) |

**Browser — fake backend (never a database), one build behind run.sh's
safety guard:**

| Suite | Result | Notes |
| --- | --- | --- |
| A | 21/21 | |
| B | 46/46 | |
| C | 13/13 | |
| D | 30/30 | |
| F | 25/25 | |
| Attendee | 45/45 | A7 fixed this pass (`clearSeededDates`); A6/A7/V12 also swept over 5 pinned dates at 01:57 UTC |
| Lifecycle | 21/21 | |
| Rehearsal | 108/108 | |
| Host | 93/93 | |
| HostDashboard | 111/112 | H15 [1.6×] clipped text — pre-existing, identical at HEAD |
| HostUi | 167/174 | 7 clipped labels (category chips, Manage-event tab bar) — pre-existing, identical at HEAD |
| Compare | 45/45 | |
| Notifications | 55/55 | |
| Moderation | 38/38 | |
| Collections | 168/168 | |
| Onboarding | 57/57 | |
| Account | 10/10 | |
| Premium | 19/19 | |
| Privacy | 15/15 | |
| Visual | 68/68 | |
| **Live (new)** | **35/35** | |
| **A11y (axe WCAG A/AA)** | **222/222** | First run of this suite since 2026-11-18 (axe-core is installed); includes the new scenario N |

The 8 failures are the pre-existing layout ones listed in
`STATUS_AND_APPLY_DAY_2026-11-19.md` §1, in screens this work did not touch.

---

## 6. Known limits and follow-ups

* **Discover strip count can overstate** on a day a series' session was
  skipped: it is computed from rows Discover already has, without exceptions,
  to avoid an extra request. The live page itself is exact.
* **axe `label-content-name-mismatch` on live rows (warning, reviewed):** the
  rows' labels contain every visible word in order, but axe's strict matcher
  still flags the composite row — the same reviewed class as every
  `EventListItem` row in the app (`AXE_WARN` in `suiteA11y.mjs`).
* **`StarRatingDisplay`** uses the same labelled-View pattern that was fixed
  in `ReviewCard`, but axe does not flag it on any screen; left unchanged.
* **Series-review after-submit state** is not browser-tested (the fake does
  not store reviews) — covered by the real-DB checks in §3.3.
* **Pre-existing, out of scope:** HostUi clipped labels (7), HostDashboard
  H15 at 1.6×, `nested-interactive` on the event page's business button.

---

## 7. Files touched (38 working-tree entries)

Modified: `app/(tabs)/discover.tsx`, `components/ReviewCard.tsx`,
`hooks/useHostDashboard.ts`, `screens/BusinessDetail.tsx`,
`screens/EventDetail.tsx`, `services/events.ts`, `services/hostTools.ts`,
`services/reviews.ts`, `tests/businessEventsCount.test.ts`,
`scripts/fake-backend-e2e/{fakebackend,lib,suiteAttendee,suiteCollections,suiteHostDashboard,suiteRehearsal,suiteA11y}.mjs`,
`docs/{MIGRATIONS_PENDING,STATUS_AND_APPLY_DAY_2026-11-19,TIME_HARNESS}.md`,
`supabase/prepared/2026-11-19_series_reviews/README.md`.

New: `app/live.tsx`, `screens/LiveEvents.tsx`, `components/SeriesReviewsSection.tsx`,
`hooks/useSeriesReviews.ts`, `services/liveEvents.ts`, `utils/liveEvents.ts`,
`utils/hostDashboardRpc.ts`, `scripts/hosted-inventory.mjs`,
`scripts/live-parity.sql`, `scripts/test-live-events.sql`,
`scripts/fake-backend-e2e/suiteLive.mjs`, `tests/{hostDashboardRpc,liveEvents,liveParity,reviewsService}.test.ts`,
`tests/fixtures/liveParity.json`, `supabase/prepared/2026-11-20_live_events/`
(migration + README), this document.
**Handoff (2026-11-19, New York):** The live-events migration was moved to
`supabase/migrations/` and applied locally. Verified 140 migrations through
`20261120100000`, refreshed types, and 18 passing isolated SQL suites.
Series reviews remains staged because older sibling worktrees still use
the original review upsert. The two-file apply commands are historical.
