# Prepared migration — EJ-17, host notices for series (2026-11-19)

> **Status 2026-11-20: APPLIED locally** as
> `supabase/migrations/20261119120000_series_host_notices.sql`, and the
> `host_event_notices` cron job is scheduled. **The Settings copy follow-up
> is DONE (2026-11-20).** `screens/Settings.tsx` now says "A few hours before
> each event starts, including every date of a series" and "After each event
> or series date: how it went, and what to do next". Verified rendered in
> business mode at 390/320 px (`suiteHostUi` U5 18/18 plus a direct text
> check).

*Original status:* **PREPARED, NOT APPLIED.** One file, independent of every other
prepared folder; apply it in any order with the rest.

| # | File | Fixes | Owner decision |
| --- | --- | --- | --- |
| 1 | `20261119120000_series_host_notices.sql` | EJ-17: a series host's day-of and post-event notices never fired | none needed |

## Why

`send_host_event_notices` filters `is_recurring = false` for **both** notices
(20261113110000:47,80). A host who runs a weekly club and turns on "Remind me
on the day" or "Summary after the event" gets nothing, ever. Batch A patched
the Settings copy to admit this ("each one-off event … not yet for series");
this file makes the switches mean what they said, and the copy goes back.

The notices are per **occurrence**, not per event:

- **Day-of** fires for the series' next *effective* occurrence when it starts
  in 2–4 hours — the same window one-offs use. "Effective" is
  `event_next_effective_occurrence`, so a cancelled date is skipped and a
  moved date uses its new time.
- **Post-event** fires for each occurrence that ended 2–26 hours ago,
  including dates moved *into* that window, excluding cancelled ones.
- The attendee count is for **that date** — series goers minus per-date
  opt-outs, plus date-only goers — via the existing `occurrence_going_count`
  (20261109150000:51), which already states that rule. (My first draft
  restated it and collided with the real function; validation caught it.)

**Dedupe.** `host_notifications_sent` gains `occurrence_start`, and its
primary key `(event_id, kind)` becomes a unique index over
`(event_id, kind, COALESCE(occurrence_start, '-infinity'))`. One-offs keep
writing NULL, so **rows already in the table keep working with no backfill** —
verified below.

## Validation (2026-11-19, throwaway PG17 containers, unique names, destroyed)

| Check | Result |
| --- | --- |
| Applies cleanly; idempotent on re-apply | yes |
| **All 16 SQL suites with it applied / without it** | 16/16 both; `test-lifecycle [9]` skips when absent |
| One-off day-of and post-event | unchanged (suite blocks [2] and [5.4] still pass) |
| Series day-of, next session 3 h away | one notice |
| …counted for that date | "2 people going" = series goer + date-only goer |
| …next date cancelled | no notice |
| Series post-event, session ended 3 h ago | one summary |
| …a date moved INTO the window | summary fires, marker records the moved start |
| Re-running the cron job (twice more) | adds nothing |
| A pre-migration marker (NULL `occurrence_start`) | still dedupes its one-off |
| Markers for a series | one row per occurrence |

## How to apply (owner)

Local first; hosted only after the §0 inventory in `docs/MIGRATIONS_PENDING.md`.

```sh
# 0. optional: re-validate on a throwaway container (UNIQUE name — a sibling
#    session shares this Docker host and removes stray containers)
PG17_NAME=ej17_check scripts/pg17-isolated.sh init
PG17_NAME=ej17_check scripts/pg17-isolated.sh apply supabase/prepared/2026-11-19_series_host_notices/20261119120000_series_host_notices.sql
PG17_NAME=ej17_check scripts/pg17-isolated.sh suites && PG17_NAME=ej17_check scripts/pg17-isolated.sh destroy

# 1. move it into the migrations folder
git mv supabase/prepared/2026-11-19_series_host_notices/20261119120000_series_host_notices.sql supabase/migrations/

# 2. apply to the local stack
npx supabase migration up

# 3. types: not needed (no signature changed, and the new column is on a
#    cron-only table the client cannot read)
```

**Rollback:** re-create `send_host_event_notices` from
`supabase/migrations/20261113110000_host_notice_optin.sql` and, if you want
the old key back, `DROP INDEX host_notifications_sent_key;` then
`ALTER TABLE host_notifications_sent ADD PRIMARY KEY (event_id, kind);`
(delete any per-occurrence rows first). The `occurrence_start` column can stay.

## After applying: the client follow-up (~10 min)

`screens/Settings.tsx` — the interim copy becomes true again:

- line ~1105: "A few hours before each one-off event starts (not yet for
  series)" → "A few hours before each event starts" (a series now gets one per
  session).
- line ~1127: "After each one-off event: how it went, and what to do next" →
  "After each event: how it went, and what to do next".

Nothing else: the notices route through `utils/notificationRoute.ts` by type,
which already handles `host_day_of` and `host_post_event_summary`.

## A judgement call worth knowing about

A weekly club now produces a day-of notice and a summary **per session** for a
host who opted in — that is what the switches say, and what EJ-17 asked for.
If it proves noisy in practice, the narrower variants are each a one-line
filter in the series loops: only the first and last session of a series, or
only sessions with at least one attendee. Say the word and I'll prepare it;
nothing else depends on the choice.
