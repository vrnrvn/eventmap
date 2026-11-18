# Prepared migrations — event-journey review (2026-11-17)

**Handoff status:** All seven files moved to `supabase/migrations/` and
were applied locally on 2026-11-17. The staging notes below are historical.

The Supabase CLI and `scripts/pg17-isolated.sh init` read only
`supabase/migrations/`; this folder is a staging area so that no stack start,
reset or test harness can apply these files by accident. The owner applies
them, at the end, by moving them into `supabase/migrations/`.

Findings: `docs/EVENT_JOURNEY_REVIEW_2026-11-17.md`. Sequencing and owner
decisions: `docs/EVENT_JOURNEY_REVIEW_PLAN_2026-11-17.md` §5a.

| # | File | Fixes | Owner OK |
| --- | --- | --- | --- |
| 1 | `20261117100000_occurrence_rsvp_guards.sql` | EJ-1 suspended accounts refused per-date RSVPs (**security**) · EJ-13 a finished date can't be changed | not needed |
| 2 | `20261117110000_freeze_attendance_after_end.sql` | EJ-12 a "going" RSVP can't be deleted once the event is over; waitlist/host triggers silent after the end | not needed |
| 3 | `20261117120000_event_notice_audience.sql` | EJ-19/21 one shared notice audience (date-only goers, savers, opt-outs) · EJ-20 "Schedule changed" · EJ-15 "now ends at" · EJ-23 `events.rescheduled_at` · split stays silent | not needed |
| 4 | `20261117130000_date_only_chat_access.sql` | EJ-19 date-only goers get the chat (your decision) · EJ-22 chat notices only to people who can open the chat, no duplicate for announcements. **Apply after 3.** | not needed |
| 5 | `20261117140000_move_past_series_end.sql` | EJ-14 moving past the series end extends it when that adds no other date, else refuses | approved 2026-11-17 |
| 6 | `20261117150000_expire_requests_at_end.sql` | EJ-18 pending requests removed once the event is over (your decision) + a cron job | approved 2026-11-17, incl. the notice |
| 7 | `20261117160000_attendance_per_session.sql` | EJ-16 "attended" counted per session (your decision) | not needed |

5 and 6 are independent: drop either file and the rest still applies and
passes (validated).

## Validation done (2026-11-17, throwaway PG17 container, stack's own image)

| Check | Result |
| --- | --- |
| Every `scripts/test-*.sql` **before** applying (14 suites, incl. the new `test-event-journey.sql`, which skips its blocks) | 14/14 |
| Apply all 7 in order | clean |
| Every suite **after** applying | 14/14; `test-event-journey` blocks [1]–[7] all executed |
| Re-apply all 7 (idempotency) + every suite | clean, 14/14 |
| Apply 1, 2, 3, 4, 7 only (without 5 and 6) + every suite | 14/14; blocks [5] [6] skipped |

Two existing suites failed on the first run after applying, and both were
addressed before the results above:
- `test-attendance-rpcs`: its "attended" assertions encoded the per-event
  meaning. They now accept either meaning, keyed on whether migration 7 is
  present (6 attended per session vs 2 per event).
- `test-categories-series`: "split sends no notifications" caught that a
  split would send the new "Schedule changed" notice. Migration 3 now keeps
  `split_series_from` silent.

## How to apply (owner, at the end)

Local database first. Hosted only after its inventory
(`docs/MIGRATIONS_PENDING.md` item 0).

```sh
# 0. optional: re-validate on a throwaway container
PG17_NAME=apply_check scripts/pg17-isolated.sh init
for f in supabase/prepared/2026-11-17_event_journey/2026*.sql; do PG17_NAME=apply_check scripts/pg17-isolated.sh apply "$f"; done
PG17_NAME=apply_check scripts/pg17-isolated.sh suites && PG17_NAME=apply_check scripts/pg17-isolated.sh destroy

# 1. (5 and 6 were approved 2026-11-17 — nothing to decide)
# 2. move the chosen files into the migrations folder
git mv supabase/prepared/2026-11-17_event_journey/2026*.sql supabase/migrations/
# 3. apply to the local stack (your usual command, e.g.)
npx supabase migration up
# 4. verify
#    select count(*), max(version) from supabase_migrations.schema_migrations;
#    → 130 / 20261117160000 with all seven (128 / … without 5 and 6)
# 5. regenerate types
npm run backend:types
```

## After applying: client follow-ups (each needs the server change first)

These are written down rather than coded, because the app must not depend
on objects that don't exist yet (`docs/ISSUES.md` Ground rules: no
probe-and-retry). The details are in the plan's §5a "Batch C".

1. **Types:** `npm run backend:types` (`rescheduled_at`, the new functions).
2. **EJ-19:** the event page's chat row counts a per-date "going" as going.
3. **EJ-14 (if #5 applied):** relax the move picker's interim guard and show
   the server's "would add <date>" message.
4. **EJ-20/21:** Edit's confirm dialog also fires for schedule changes, and
   names savers and date-only goers.
5. **EJ-23:** "Time changed — update your calendar" on the event page when
   `rescheduled_at` is after the viewer's RSVP.
6. Optional, **EJ-16:** "You've been to N sessions" on a series' page.
