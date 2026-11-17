# Migration work waiting for the owner

**Handoff verification, 2026-11-16:** The local database records all 123
repository migrations through `20261115100000`; no new migration files were
prepared in the latest session. Regenerated local schema types are identical
to the committed types. The 13 SQL suites pass on a disposable PG17 container
after replacing an expired date fixture in `test-categories-series.sql`.
The §2b migrations and expanded parity fixture remain unwritten. Hosted
database inventory remains outstanding; no hosted database was changed.

**Owner checklist, 2026-11-15 (the full list is at the top of `docs/ISSUES.md`):**

1. Item 0 below — the hosted-database inventory. Read-only; do it first.
2. Item 2 below — `20261115100000_get_events_compare.sql` was applied locally
   on 2026-11-15 and generated types were refreshed. Client cutover remains
   deferred (decision D7).
3. Only after item 0 has a row for a hosted project: apply the missing files
   there in version order, security set (`20261030*`) first.
4. After any apply: `PG17_NAME=x scripts/pg17-isolated.sh init && … suites`
   on a throwaway container, never the shared cluster.

**Local apply update, 2026-11-15:** the local database records 123 migrations,
through `20261115100000`; types were regenerated and 13 isolated SQL suites
passed. Hosted databases have not been checked or changed. Earlier status and
runbook entries below are retained as historical context.

**Local apply update, 2026-11-14:** migration `20261114100000` was applied
and recorded in the local Supabase database. Types were refreshed to match.
Hosted databases have not been checked or changed. Item 2 remains unwritten;
the original runbook and dated review below are retained as history.

**Status 2026-11-14: the agent-doable work is finished** (see
`docs/REVIEW_AND_ROADMAP_2026-11-14.md` §0 — roadmap steps 0–3, the isolated
test foundations, the client fixes and all nine UI/UX flow passes). The
database work below is the main thing standing between the project and a
coherent next milestone. **This file is the complete list of it**, written so
it can be applied without re-reading the review. Nothing here has been
applied; no session writes to the shared database (see `docs/ISSUES.md`
"Ground rules").

**State verified read-only on 2026-11-14:** the shared local database has
**121** migrations recorded and the repository now holds **122** files, so
at that time exactly one prepared file was unapplied. Confirm with:

```sql
select count(*) as applied, max(version) as latest
  from supabase_migrations.schema_migrations;
```

| Before applying | After item 1 | After item 2 |
| --- | --- | --- |
| 121 / `20261113110000` | 122 / `20261114100000` | 123 / `20261115100000` |

**2026-11-15:** the repository holds **123** files and all 123 are now applied locally.

Hosted or production databases have **never** been checked. If one exists,
run the same query against it first — in particular for the Oct 30 security
set (`20261030100000`, `…101000`, `…102000`, `…107000`).

---

## 0. Before anything else — the hosted-database inventory (decision D10, 2026-11-15)

No hosted or production project's migration state has **ever** been checked.
The comparison RPC below is the first new function a client feature would
depend on, so this inventory is a prerequisite of applying it anywhere but
locally — and it is owner work: it needs the hosted project's connection.

Run against **each** hosted project (read-only; nothing here writes):

```sql
-- 1. What is recorded
select count(*) as applied, max(version) as latest
  from supabase_migrations.schema_migrations;

-- 2. Which repository files are NOT recorded (paste the version list from
--    `ls supabase/migrations | cut -c1-14` into the VALUES list)
with files(version) as (values ('20261015100000'), ('…'))
select version from files
except select version from supabase_migrations.schema_migrations
order by 1;

-- 3. The Oct 30 security set in particular
select version from supabase_migrations.schema_migrations
 where version in ('20261030100000','20261030101000','20261030102000','20261030107000');
```

Record the three answers per project in this file under a dated heading.
Expected outcomes and what each means:

| Finding | Meaning | Next step |
| --- | --- | --- |
| Count = repository file count, nothing missing | In step with the repo | Apply new files in order as they land |
| Files missing, security set present | Behind but safe | Apply the missing files in version order on a maintenance window |
| **Security set missing** | Admin / premium self-grant and storage-ownership holes are open | Apply those four first, before any feature migration |
| Recorded versions that are not files | Hand-applied drift | Diff the live objects against the repo before anything else |

Until this table has a row per hosted project, items 2+ below are **local
only**.

---

## 2. Applied locally — `20261115100000_get_events_compare.sql`

**What:** one RPC, `get_events_compare(p_event_ids uuid[], p_lat, p_lng)`,
returning up to four events by id with host name / logo / verified, category
label / slug, going / save / waitlist counts, the viewer's RSVP and save,
distance from the given point (`calculate_distance`) and the **effective**
next date (`event_next_effective_occurrence`). Visibility mirrors
`get_event_details`: `SECURITY DEFINER`, drafts only for the owner or an
admin, unlisted events returned by id, cancelled / postponed returned with
their status, unknown ids silently absent. Duplicates collapse, nulls are
ignored, caller order is kept, a fifth distinct id raises `too_many_events`.
Callable by `anon` and `authenticated` (a shared comparison link opens
signed-out). ROADMAP.md "Phase 8 in detail"; docs/EVENT_COMPARISON_PLAN.md §8.

**Why it is not urgent:** the client does **not** call it (decision D7,
2026-11-15: the four cached per-event calls are not a user-visible problem;
cut over when usage says otherwise). Nothing breaks without it. It also
fixes E-R1 for this surface only.

**Validated 2026-11-15** on a throwaway container from the stack's own
Postgres 17 image (`PG17_NAME=… scripts/pg17-isolated.sh init`, 123
migrations + seed): applies cleanly in order; `scripts/test-events-compare.sql`
passes all five blocks (grants, shape and order, distance and next date,
visibility for viewer / other user / owner / anon, input hygiene and the cap);
**all 13 SQL suites pass**; re-applying the file is a no-op (one function
afterwards). Container destroyed afterwards. The shared local database was
not touched during that validation; it recorded 122 migrations at the time.

**Not done, by design:** no client change (D7), no numeric price columns
(D3 still open — D8 says they ride this file only if D3 is a yes), no
PostgREST shape check (needs a private PostgREST bound to the container;
part of the cutover, below), no `npm run backend:types` (regenerate after the
apply, not before).

**Apply (owner, local first):**

```sh
npx supabase migration up --local          # records 20261115100000
npm run backend:types                      # then regenerate types
PG17_NAME=x scripts/pg17-isolated.sh init && PG17_NAME=x scripts/pg17-isolated.sh suites
```

Hosted: **only after item 0's inventory has a row for that project.**

**Cutover, when D7 flips (agent work, ~2 h):** `hooks/useCompareEvents.ts`
gains a single `useQuery` keyed `['event','compare', idsKey, lat, lng]` that
calls the RPC and fans each row into the per-event `eventDetails` cache
entries, keeping the event page warm; `useEffectiveNextDates` becomes
unnecessary there because the RPC returns the effective date; a
`suiteCompare` scenario asserts one `POST rpc/get_events_compare` instead of
four details calls; the fake backend learns the RPC. No probe-and-retry
fallback (docs/ISSUES.md client/schema policy).

## 1. Applied locally — `20261114100000_drop_unfiled_past_event_count.sql`

**What:** drops `public.get_user_past_event_count(uuid)`.

**Why:** the function exists on the shared local database but in no migration
file — the single object making a fresh (or hosted) database differ from the
shared one. It is an orphan from a sibling worktree's unmerged
`20261029100000_profile_attendance_and_privacy.sql`; this branch shipped
`20261029110000_profile_attendance_history.sql` for the same ground.

**Verified unreferenced before the file was written (2026-11-14):** no client,
admin, script or test calls it; no other database function's source mentions
it; no RLS policy, view, trigger or column default uses it.

**Validated** on a throwaway container built from the stack's own image
(`scripts/pg17-isolated.sh`), three ways: a no-op on a fresh database where
the function never existed; a clean drop when present; idempotent on re-apply
(`DROP FUNCTION IF EXISTS`). All 12 SQL suites pass with it in place.

**Apply:**

```sh
# preferred: the CLI records it in schema_migrations for you
npx supabase migration up --local

# fallback, if you apply by hand — then record it, or the next CLI run re-applies:
#   psql ... -f supabase/migrations/20261114100000_drop_unfiled_past_event_count.sql
#   insert into supabase_migrations.schema_migrations (version, name)
#     values ('20261114100000', 'drop_unfiled_past_event_count');
```

**After applying:**

1. `npm run backend:types` — the regenerated types currently *include*
   `get_user_past_event_count` (`types/supabase.generated.ts`), so they must be
   refreshed or they will describe a function that no longer exists.
2. No application code changes: nothing calls it.
3. Optional re-check: `scripts/pg17-isolated.sh init && scripts/pg17-isolated.sh suites` (12/12 expected).

**If you would rather keep the function:** replace this file with one that
`CREATE OR REPLACE`s it (its current definition is in the git history of this
note and on the shared DB today). Do **not** simply delete the migration — the
drift returns, and a fresh database still will not have it.

---

## 2. Decided, not yet written — E-R1: server-side effective occurrence

**Status: the design decision is settled and measured; the migration still has
to be written.** It was deferred so that agent-doable work could continue; it
is the only substantive schema work outstanding.

**The bug:** `get_ranked_events`, the saved/going lists, `get_user_calendar`
and the three collection RPCs compute an event's next date with
`event_next_occurrence`, which ignores per-date exceptions
(`event_occurrence_exceptions`, `20261109140000`). A skipped or moved date
therefore still ranks and renders as the next date unless the client's
`useEffectiveNextDates` happens to correct it. Open since 2026-11-09; the
collections migration reused the plain helper in three more places.

**Scope — 6 functions, 9 call sites** (confirmed against the live database):

| Function | Sites |
| --- | --- |
| `get_ranked_events` | 2 |
| `get_user_saved_events` | 2 |
| `get_user_going_events` | 2 |
| `get_user_calendar` | 1 |
| `get_user_collections` | 1 |
| `get_collection_events` | 1 |

**The decision (option A), with the numbers behind it.** Benchmarked on the
stack's own image with the repo's perf fixture (120k events, 12k recurring,
480k RSVPs; SF dense page; `scripts/perf/`):

| Events with an exception, in box | Baseline | A: `EXISTS` guard | B: column + trigger |
| --- | --- | --- | --- |
| 0 (today) | 83 ms | 85.5 ms | 83.7 ms |
| 190 (5% of in-box recurring) | 81 ms | 88.5 ms | 88.3 ms |
| 1,900 (50%) | 83.5 ms | 125 ms | 123 ms |
| 3,771 (100%, worst case) | 85 ms | 163 ms | 160 ms |

Result fingerprints were identical for all three. B wins only in the
zero-exception case and only by ~2 ms, in exchange for a column, a trigger, a
backfill and a derived-state invariant that can silently drift. **A it is.**

**What the migration must do**, at each of the nine sites, keeping the
existing cheap-path guard intact:

```sql
CASE
  WHEN COALESCE(e.is_recurring, false) AND e.recurrence_pattern IS NOT NULL
       AND EXISTS (SELECT 1 FROM event_occurrence_exceptions x WHERE x.event_id = e.id)
    THEN event_next_effective_occurrence(e.id, now())
  WHEN COALESCE(e.is_recurring, false) AND e.start_datetime < now() AND e.recurrence_pattern IS NOT NULL
    THEN event_next_occurrence(e.start_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)
  ELSE e.start_datetime
END
```

Notes for whoever writes it:

- The two helpers have **different shapes** — `event_next_occurrence` is pure
  over event columns, `event_next_effective_occurrence(event_id, now)` re-reads
  the row, queries the exceptions table and loops up to 400 times. It is not a
  textual swap.
- The `EXISTS` probe rides the existing
  `event_occurrence_exceptions_event_id_occurrence_date_key` unique index — no
  new index required.
- `get_ranked_events` already guards the *lighter* call with
  `CASE WHEN is_recurring AND start < now() AND pattern IS NOT NULL` and the
  comment "skip the (subtransaction-opening) plpgsql call in that common
  case" (from `20261106120000_perf_ranked_events`). Keep that ordering: the
  heavy call must stay behind the exceptions guard.
- Each function has to be re-created in full (`CREATE OR REPLACE`) from its
  current definition; signatures and output columns do not change, so **no
  type regeneration and no client change are needed**.

**Validation plan before you are asked to apply:** build the isolated
container, apply, run all 12 SQL suites, add a ranking assertion for a skipped
date to `scripts/test-categories-series.sql` and `scripts/test-collections.sql`,
then re-run `scripts/perf/bench_ranked.sql` against the fixture and compare
timings and fingerprints with the table above.

---

## 2b. From the recurrence + host dashboard programme (2026-11-16)

Everything below was found while building roadmaps A, B and C
(`docs/HOST_DASHBOARD_AND_RECURRENCE_REVIEW_2026-11-16.md`). **None is
written**: no session has touched the shared database, and all SQL work is
to be validated on `scripts/pg17-isolated.sh` first. Listed in the order to
tackle them.

| # | Work | What it is | Notes |
| --- | --- | --- | --- |
| 2b-1 | **Hosted-database inventory** | Owner-only; no hosted project's migration state has ever been checked | §0 of this file. Do first: everything else inherits it |
| 2b-2 | **Generated types check — done 2026-11-16** | Freshly generated types match `types/supabase.generated.ts` | Read-only local schema check |
| 2b-3 | **A4 — widen the recurrence parity fixture** | `scripts/recurrence-parity.sql` currently captures only the NEXT date for 14 shapes. Needs first-N-dates plus long-interval, far-future and month-end shapes | Needs Docker for the isolated PG17 container |
| 2b-4 | **S1 — monthly drift after a clamped date** | `event_next_occurrence` (`20261109130000:173-176`) adds `+N months` to an already-clamped candidate, so a 29th-31st series names 28 Mar instead of 31 Mar for the hours between a short month's occurrence and that month's end. Client is correct; pinned by `tests/recurrenceHorizon.test.ts` | Low severity. Fix: compute each candidate as `start + (k × N) months` |
| 2b-5 | **S2 — v2 walk capped at 800 days** | `20261109130000:145`: a `byWeekday` / `nthWeekday` series with an interval beyond ~26 months (or ~114 weeks) falls off the cap and returns the series start | Low severity, legal patterns (`interval ≤ 99`). Same stepping fix the client got |
| 2b-6 | **O-5 — no `endDate >= start` check** | `c_validate_event_recurrence` only checks the `YYYY-MM-DD` format. Create and Edit both reject it client-side, so this is defence-in-depth for API writes | Ride with 2b-4/2b-5: one migration, same function family |
| 2b-7 | **E-R1 server half** | Ranking, saved/going, calendar and the three collection RPCs still use `event_next_occurrence`, not `event_next_effective_occurrence` | Design + measurements in §2 above. Biggest user-visible win |
| 2b-8 | **B4 — client follow-up to E-R1** | Retire or demote `useEffectiveNextDates` where 2b-7 makes it dead | Client-only, after 2b-7 is applied |
| 2b-9 | **C3 — `get_host_dashboard`** | One RPC for the dashboard's agenda + counts + requests + reports: up to 17 requests today, bounded at 10 events (DC5) | Design in `docs/HOST_DASHBOARD_PLAN.md` §4; C1/C2 ship on the N-call path so this has a measured baseline |
| 2b-10 | **C4 — check-in / CSV export** | `checked_in`, `host_checkin_attendee`, per-date check-in for series, `export_event_attendees`; premium | Needs decision DC6 and a device. Host tools Phase 4 |

Two client-side things also wait on a database run, needing no migration of
their own: the shape checks in `scripts/regress-isolated.mjs` (updated
2026-11-16 for the venue "Upcoming" count, B5) and the S1 expectation pinned
in `tests/recurrenceHorizon.test.ts`.

**Earlier access limitation:** Docker was denied in the 2026-11-16 model
sessions. It was available during handoff and the existing SQL suites passed
in isolation; the new work in 2b-3 onward is still unwritten and unvalidated.

---

## 3. Identified, deliberately not written

These need a migration but are not scoped; none blocks anything.

- **`get_event_host_overview` lacks `chat_mode` / `open_policy` /
  `pinned_message_id`**, so the host hub makes a second call for them
  (archive A:886; `docs/ISSUES.md` Low).
- **Going-reminder window is ±5 minutes**, so two missed `pg_cron` runs drop
  the reminder; widening to ±10 was suggested (archive F:118-119).
- **The "Not written (low)" list** in `docs/ISSUES.md` Database migrations:
  reminder nudge ignoring the event's time zone, a blanket
  `REVOKE EXECUTE … FROM PUBLIC` with explicit grants, requiring a session for
  `get_event_attendees_public`, server-side length limits on event
  title/description, and a `^https?://` CHECK on banner `link_url`.
- **Host tools Phase 4** (check-in + QR, CSV export, `event_sections`) and
  **co-hosts** (`business_members`) are feature work that will each need
  schema; see `docs/HOST_TOOLS_PLAN.md` §11.

**Not needed, decided:** the event-photo dedupe constraint from
`docs/OFFLINE_PLAN.md` step 9 — every upload gets a unique URL, so a unique
`(event_id, url)` index would never fire; the real fix shipped in
`eventsService.addEventPhoto` on 2026-11-08.

---

## 4. Apply-day runbook

Follow this in order. Steps 1–3 are item 1 (ready today); step 4 is item 2
(ask for the migration to be written first).

1. **Check the starting point.**
   ```sh
   docker exec -i -e PGPASSWORD=postgres supabase_db_eventmap-local \
     psql -U postgres -d postgres -At \
     -c "select count(*), max(version) from supabase_migrations.schema_migrations;"
   ```
   Expect `121 | 20261113110000`. Anything else means another session
   applied something — stop and reconcile before continuing.

2. **Dry-run it in isolation first** (optional but cheap — about 10 seconds):
   ```sh
   scripts/pg17-isolated.sh init      # throwaway container, same image as the stack
   scripts/pg17-isolated.sh suites    # expect: 12 passed, 0 failed, 0 crashed
   scripts/pg17-isolated.sh destroy
   ```

3. **Apply item 1 and finish it off.**
   ```sh
   npx supabase migration up --local                 # applies + records
   npm run backend:types                             # REQUIRED: the types still
                                                     # describe the dropped function
   npm run typecheck && npx vitest run               # expect clean / 1,048 tests
   ```
   Then re-check the count: `122 | 20261114100000`.

4. **When you want E-R1**, ask for the migration to be written (§2 has the
   design, the nine call sites and the measurements). It will arrive
   validated on the isolated container, with the suites extended; you then
   apply it the same way. No type regeneration or client change is needed for
   it — signatures do not change.

5. **After any apply, re-run the two things that read the real schema:**
   ```sh
   npm run backend:types                             # only if signatures changed
   npm run test:backend                              # writes demo rows — your call
   ```
   `npm run test:backend` is still the one check nobody has run since the
   Nov 9–13 migrations; it needs the shared stack and writes disposable rows,
   which is why no session has run it.

### If something goes wrong

- Item 1 is `DROP FUNCTION IF EXISTS`, so re-applying is harmless and there is
  nothing to roll back; to restore the function, see §1 "If you would rather
  keep the function".
- A failed apply leaves `schema_migrations` untouched for that file — fix the
  cause and re-run; both files are written to be idempotent.
- Never run `supabase db push` (it targets a linked remote) and never
  `backend:reset` on the shared database.

### Two cautions that cost us time

- **The shared cluster is not isolation.** A crashed backend restarts every
  connection in it, including other sessions. `scripts/db-scratch.sh` now
  refuses to run without `ALLOW_SHARED_CLUSTER=1` for that reason.
- **Never provoke `permission denied for function` from a superuser psql
  session after `SET ROLE anon`** — it segfaults this Postgres image
  (`supautils.hint_roles`). It is not reachable over HTTP; only psql suites
  hit it. Details in `docs/ISSUES.md` "Ground rules".
