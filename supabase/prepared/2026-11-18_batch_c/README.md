# Prepared migration — Batch C follow-up (2026-11-18)

> **Status 2026-11-20: APPLIED locally** as
> `supabase/migrations/20261118100000_series_sessions_attended_self.sql`.
> `get_event_sessions_attended` exists in the DB and is granted to
> `authenticated`. **The C6 client half below is NOT built yet**: nothing in
> the app calls the function. Tracked in `docs/ROADMAP_2026-11-20.md`.

*Original status:* **PREPARED, NOT APPLIED.** One file, needed only by C6, the optional
Batch C item. C2–C5 are built and need nothing from you.

The Supabase CLI and `scripts/pg17-isolated.sh init` read only
`supabase/migrations/`; this folder is a staging area so no stack start, reset
or test harness applies it by accident.

| # | File | Unblocks | Owner decision |
| --- | --- | --- | --- |
| 1 | `20261118100000_series_sessions_attended_self.sql` | C6 (EJ-16) "You've been to N sessions" on a series' page | none needed |

## Why it is needed

`20261117160000` (applied) added `user_series_sessions_attended(event, user)`
and deliberately **revoked it from `anon` and `authenticated`**, because it can
be asked about any user. That left no granted path to the number for the
signed-in viewer: `get_event_details` doesn't carry it and
`get_user_attendance_counts` is per-user totals, not per-series.

This file adds only the missing seam: `get_event_sessions_attended(p_event_id)`,
a `SECURITY DEFINER` wrapper that passes `auth.uid()` itself, so a client can
only ever ask about themselves. The counting rule is not restated — it calls
the existing function, keeping one definition of "attended".

## Validation (2026-11-18, throwaway PG17 container, the stack's own image)

Run on `scripts/pg17-isolated.sh` with 130 migrations + seed, destroyed
afterwards. The shared database was not touched.

| Check | Result |
| --- | --- |
| Apply | clean |
| Re-apply (idempotency) | clean, one copy of the function |
| `authenticated` may execute the wrapper | true |
| `anon` may execute the wrapper | false |
| The inner function stays internal to `authenticated` / `anon` | true (unchanged) |
| Definer / volatility / search_path | `SECURITY DEFINER`, `STABLE`, `search_path=public` |
| Signed-in viewer going to a 4-week-old weekly series | wrapper `4` = internal `4` |
| Same event, signed out | `0` (no leak, no error) |
| All `scripts/test-*.sql` suites with it applied | 14 passed, 0 failed, 0 crashed |

Privileges were **asserted** with `has_function_privilege`, never provoked by
calling as a restricted role — see the segfault ground rule in `docs/ISSUES.md`.

## How to apply (owner)

Local database first. Hosted only after its inventory
(`docs/MIGRATIONS_PENDING.md` §0).

```sh
# 0. optional: re-validate on a throwaway container (unique name — sibling
#    sessions share this Docker host and reuse the default one)
PG17_NAME=batchc_check scripts/pg17-isolated.sh init
PG17_NAME=batchc_check scripts/pg17-isolated.sh apply supabase/prepared/2026-11-18_batch_c/20261118100000_series_sessions_attended_self.sql
PG17_NAME=batchc_check scripts/pg17-isolated.sh suites && PG17_NAME=batchc_check scripts/pg17-isolated.sh destroy

# 1. move it into the migrations folder
git mv supabase/prepared/2026-11-18_batch_c/20261118100000_series_sessions_attended_self.sql supabase/migrations/

# 2. apply to the local stack
npx supabase migration up

# 3. verify: expect 131 | 20261118100000
#    select count(*), max(version) from supabase_migrations.schema_migrations;

# 4. regenerate types (adds the new function)
npm run backend:types
```

## After applying: the C6 client half (~1 h)

Deliberately not written yet — the app must not call an object that doesn't
exist (`docs/ISSUES.md` ground rules: no probe-and-retry):

1. `npm run backend:types`.
2. A service call in `services/occurrences.ts` (or `services/events.ts`) for
   `get_event_sessions_attended`.
3. "You've been to N sessions" on a series' event page, next to the dates
   section, for a viewer with `N > 0`. Hide it for one-off events — the
   function returns 0 for them.
