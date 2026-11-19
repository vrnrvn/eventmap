# Status and apply-day runbook — 2026-11-19

**Handoff, 2026-11-18 (New York):** Sitting A is complete locally. The nine
files are now in `supabase/migrations/`; the local database records 139
migrations through `20261119130000`, and generated types are refreshed.
All 17 isolated SQL suites passed with the nine-file set. Hosted databases
were not changed. Sitting A's move commands below are historical.
Sitting B remains staged until the client using `submit_review()` is live.

The single document to read before applying anything. It records what is
finished, what is half-finished and why, what was never started, and exactly
how to apply the ten prepared migrations.

Companion docs: [`ROADMAP_PROGRESS_2026-11-18.md`](ROADMAP_PROGRESS_2026-11-18.md)
(how the work was sequenced), [`MIGRATIONS_PENDING.md`](MIGRATIONS_PENDING.md)
(the older database backlog), and a README inside each
`supabase/prepared/<folder>/` (per-file detail, validation tables, rollbacks).

---

## 1. Final regression pass (2026-11-19)

Run under the standing constraints: the shared database was never written to
(two read-only count queries only), every database test ran in throwaway
containers with unique names, and every suite ran in the foreground.

### Database — throwaway PG17 container, the stack's own image

| Check | Result |
| --- | --- |
| Baseline: 130 migrations + seed, nothing prepared applied | **17/17 suites** |
| **All 10 prepared migrations applied in filename order** | all 10 apply cleanly |
| All suites with everything applied | **17/17 suites** |
| **Whole set re-applied (idempotency)** | all 10 clean, **17/17 suites** again |
| Ambiguous overloads after the signature changes | none (`duplicate_event` ×1, `submit_review` ×1) |

Resulting schema: three new columns (`events.duplicated_from`,
`reviews.event_id`, `host_notifications_sent.occurrence_start`) and eleven new
or re-created functions.

### Client

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npx vitest run` | **1,316 tests / 103 files, all passing** |
| `npm run lint` | 0 errors (7 warnings, all pre-existing in files this work never touched) |
| Browser suites (19 suites, foreground) | **1,128 / 1,138 checks pass** |

Browser detail: A 21/21 · B 46/46 · C 13/13 · D 30/30 · F 25/25 ·
Attendee 27/27 · **Lifecycle 21/21** · Rehearsal 108/108 · Host 93/93 ·
HostDashboard 104/105 · Compare 45/45 · Notifications 55/55 ·
Moderation 38/38 · Collections 166/168 · Onboarding 57/57 · Account 10/10 ·
Premium 19/19 · Privacy 15/15 · Visual 68/68 · HostUi 167/174.

**All 10 failures are pre-existing and were proven so by re-running the same
suites with this work's client files reverted to HEAD:**

| Suite | Failures | Note |
| --- | --- | --- |
| HostUi | 7 | "clipped label" checks at 320/390 px on category chips and the Manage-event tab bar. Identical at HEAD |
| HostDashboard | 1 | `H15 [1.6×] no clipped text` — forced 1.6× scaling, the artifact class `lib.mjs layoutFacts` documents. Identical at HEAD |
| Collections | 2 | `K12` calendar/collection rows. **Passed 168/168 earlier the same day**, fails identically at HEAD now, so it is time- or environment-dependent, not a code regression. Cause not diagnosed — worth a look before trusting K12 as a gate |

`suiteA11y` was **not** run: it needs an `axe-core` bundle passed on the
command line.

---

## 2. What is finished, partially finished, and not started

### Finished and live in the app (no migration needed)

| Work | Where |
| --- | --- |
| **Batch C** C2–C5: date-only goers get the chat; the move picker lets a date pass the series end; Edit warns before schedule changes and names the real audience; "Time changed — update your calendar" | `utils/eventChatAccess.ts`, `components/MoveDateModal.tsx`, `utils/eventEditNotice.ts`, `utils/calendarStale.ts` |
| **"Run it again"** — duplicate with the date chosen up front, keeping local time of day and duration, on Manage event and the My Events *Past* tab | `utils/duplicateDate.ts`, `hooks/useDuplicateEvent.ts`, `components/RunItAgainSheet.tsx` |
| **Time-simulation harness**, both halves | `scripts/test-lifecycle.sql`, `scripts/fake-backend-e2e/suiteLifecycle.mjs`, `docs/TIME_HARNESS.md` |
| **Widened recurrence parity** (2b-3): 18 shapes, drift-window instants, first-five dates | `scripts/recurrence-parity.sql`, `tests/recurrenceParity.test.ts` |
| Regression suites added | `test-lifecycle`, `test-series-reviews`, `test-host-dashboard` (17 SQL suites in total) |

### Partially finished — server side done, client half waits on the apply

Each of these is **complete and validated on the server**, and deliberately
has **no client code yet**, because the app must not call an object that does
not exist (`docs/ISSUES.md` ground rules: no probe-and-retry).

| Item | Server | Client still to do |
| --- | --- | --- |
| **C6** "You've been to N sessions" | `2026-11-18_batch_c` | ~1 h |
| **Duplicate v2** (server-side dates, title, idempotency, lineage) | `2026-11-18_duplicate_v2` | ~1 h cutover |
| **E-R1** effective occurrence everywhere | `2026-11-18_phase4` #1 | optional ~1–2 h cleanup of `useEffectiveNextDates` |
| **D1** post-event chat window (7 days) | `2026-11-18_phase4` #4 | ~2–3 h of states and copy |
| **D2** series reviews | `2026-11-19_series_reviews` (2 files) | **two releases**, see §3 |
| **EJ-17** host notices per occurrence | `2026-11-19_series_host_notices` | ~10 min of Settings copy |
| **C3** dashboard in one request | `2026-11-19_host_dashboard_rpc` | ~4–6 h cutover + one persistence decision |

Fully finished server-side with **no client work at all**: the recurrence
fixes (S1/S2/O-5) and EJ-24 — the client already behaves correctly.

### Not started / blocked

| Item | Why |
| --- | --- |
| **Check-in + CSV export** (host tools Phase 4, 2b-10) | Needs decision DC6 **and** a physical device |
| **Hosted-database inventory** (§0) | Owner-only; needs hosted credentials. No hosted project's migration state has **ever** been checked |
| `npm run test:backend` | Writes to the shared stack; no session has run it since the Nov 9–13 migrations |
| **EJ-12** stale open page | Needs an in-page clock; `suiteLifecycle` L5 pins today's behaviour so the check can be flipped when it lands |
| Device passes (rehearsal P8, duplicate click-through) | Need a real device |

---

## 3. The apply-day runbook

### 3.1 The one ordering rule that matters

Nine of the ten files are safe to apply in any sitting. **One is not:**

> `2026-11-19_series_reviews/20261119110000_series_reviews.sql` replaces the
> `UNIQUE (user_id, business_id)` constraint with partial indexes. The
> **deployed app submits reviews with
> `upsert(onConflict: 'user_id,business_id')`**, and Postgres cannot use a
> partial index as that arbiter — so every review submission starts failing
> the moment this file lands, until a client release that calls
> `submit_review()` is live.

So the recommended plan is **two sittings**:

| Sitting | Apply | Then |
| --- | --- | --- |
| **A (now)** | the 9 safe files | regenerate types, ship the client halves (including the `submit_review` switch) |
| **B (after that release is live)** | `20261119110000_series_reviews.sql` | ship the series-reviews UI |

If you would rather do it all at once, that is fine **only** if no build using
the old upsert is in users' hands.

### 3.2 Sitting A — the nine safe files, in this order

Filename order is the correct order; the only internal dependency is
`20261118120000` before `20261118140000`.

```sh
# 0. Optional dry run on a throwaway container. Use a UNIQUE name: a sibling
#    session shares this Docker host and removes stray containers.
PG17_NAME=applyday scripts/pg17-isolated.sh init
for f in $(ls supabase/prepared/*/*.sql | sort -t/ -k4); do PG17_NAME=applyday scripts/pg17-isolated.sh apply "$f"; done
PG17_NAME=applyday scripts/pg17-isolated.sh suites      # expect 17 passed
PG17_NAME=applyday scripts/pg17-isolated.sh destroy

# 1. Move the nine into the migrations folder.
git mv supabase/prepared/2026-11-18_batch_c/20261118100000_series_sessions_attended_self.sql supabase/migrations/
git mv supabase/prepared/2026-11-18_duplicate_v2/20261118110000_duplicate_event_v2.sql        supabase/migrations/
git mv supabase/prepared/2026-11-18_phase4/20261118120000_effective_occurrence_everywhere.sql supabase/migrations/
git mv supabase/prepared/2026-11-18_phase4/20261118130000_recurrence_edge_fixes.sql           supabase/migrations/
git mv supabase/prepared/2026-11-18_phase4/20261118140000_joined_lists_date_only.sql          supabase/migrations/
git mv supabase/prepared/2026-11-18_phase4/20261118150000_post_event_chat_window.sql          supabase/migrations/
git mv supabase/prepared/2026-11-19_series_reviews/20261119100000_submit_review_rpc.sql       supabase/migrations/
git mv supabase/prepared/2026-11-19_series_host_notices/20261119120000_series_host_notices.sql supabase/migrations/
git mv supabase/prepared/2026-11-19_host_dashboard_rpc/20261119130000_get_host_dashboard.sql  supabase/migrations/

# 2. Apply locally.
npx supabase migration up

# 3. Verify: expect 139 | 20261119130000
#    select count(*), max(version) from supabase_migrations.schema_migrations;

# 4. Regenerate types (new RPCs and columns).
npm run backend:types

# 5. Sanity: unit tests and a throwaway-container suite run.
npm run typecheck && npx vitest run
```

After sitting B: **140 | 20261119110000** is *not* the max — `20261119130000`
stays the highest version; the count becomes 140.

### 3.3 What each file does, and what it needs from you

| File | Inert on apply? | Types? | Client work after |
| --- | --- | --- | --- |
| `20261118100000_series_sessions_attended_self` | yes — adds one function | yes | C6 (~1 h) |
| `20261118110000_duplicate_event_v2` | **no** — improves `duplicate_event` immediately (the one-argument call keeps working and gets correct dates) | yes | cutover (~1 h) |
| `20261118120000_effective_occurrence_everywhere` | **no** — ranking/lists/calendar stop showing skipped dates straight away | no | optional cleanup |
| `20261118130000_recurrence_edge_fixes` | **no** — fixes month-end drift, long intervals, and refuses `endDate` before the first date | no | none |
| `20261118140000_joined_lists_date_only` | **no** — date-only attendees appear in Joined | no | none |
| `20261118150000_post_event_chat_window` | **no** — chats go read-only 7 days after the end | no | states + copy (~2–3 h) |
| `20261119100000_submit_review_rpc` | yes — adds one function | yes | the submit switch (~1 h) — **gates sitting B** |
| `20261119120000_series_host_notices` | **no** — series hosts start getting notices | no | two lines of Settings copy |
| `20261119130000_get_host_dashboard` | yes — adds one RPC nothing calls | yes | cutover (~4–6 h) |
| `20261119110000_series_reviews` *(sitting B)* | **no** — schema change; see §3.1 | yes | series-reviews UI (~3–4 h) |

### 3.4 Rollbacks

Every file's README has its own. The ones worth knowing up front:

- `duplicate_event_v2`: re-create the one-argument function from
  `20261103170000_rsvp_approval_mode.sql:817-868` and drop the five-argument
  one. `events.duplicated_from` can stay.
- `post_event_chat_window`: drop `event_chat_posting_open` *after* restoring
  the INSERT policy and `get_event_chat_post_status` from
  `20261103160000`/`20261117120000`.
- `series_host_notices`: re-create `send_host_event_notices` from
  `20261113110000`; to restore the old key, drop
  `host_notifications_sent_key` and re-add `PRIMARY KEY (event_id, kind)`
  after deleting per-occurrence rows.
- `get_host_dashboard`: plain `DROP FUNCTION`; nothing references it.
- `series_reviews`: delete series reviews, then re-add
  `UNIQUE (user_id, business_id)`.

### 3.5 Hosted projects

Unchanged and still first: **§0 of `MIGRATIONS_PENDING.md`.** No hosted
project's migration state has ever been checked, and the Oct 30 security set
(`20261030100000`, `…101000`, `…102000`, `…107000`) is what to confirm before
anything else goes out.

---

## 4. Open decisions

| Decision | Recommendation |
| --- | --- |
| Dashboard cutover: persist the whole payload and hide a stale needs-you list, or persist a stripped copy | persist the whole payload (README in `2026-11-19_host_dashboard_rpc`) |
| Per-session host notices for a weekly club — too noisy? | ship as is; narrower variants are a one-line filter (README in `2026-11-19_series_host_notices`) |
| Collections `K12` browser failure | investigate before relying on K12 as a gate; it is not caused by this work |
