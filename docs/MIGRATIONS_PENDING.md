# Migration work waiting for the owner

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
exactly one prepared file is unapplied. Confirm before and after with:

```sql
select count(*) as applied, max(version) as latest
  from supabase_migrations.schema_migrations;
```

| Before applying | After item 1 |
| --- | --- |
| 121 / `20261113110000` | 122 / `20261114100000` |

Hosted or production databases have **never** been checked. If one exists,
run the same query against it first — in particular for the Oct 30 security
set (`20261030100000`, `…101000`, `…102000`, `…107000`).

---

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
