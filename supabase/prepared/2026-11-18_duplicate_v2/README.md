# Prepared migration — "Run it again" / duplicate v2 (2026-11-18)

**Status: PREPARED, NOT APPLIED.** One file. Apply it whenever you like — it
is independent of every other prepared file, and **the app works correctly
without it**. Nothing in the client calls the new parameters yet, by design
(`docs/ISSUES.md` ground rules: no probe-and-retry, nothing depends on an
unapplied object).

| # | File | Fixes | Owner decision |
| --- | --- | --- | --- |
| 1 | `20261118110000_duplicate_event_v2.sql` | The copy's date, title, idempotency, chat set-up and lineage | none needed |

## Why

`duplicate_event` (live definition: `20261103170000:840`) shifts a past
event's copy by `(now() + 7 days) - start`, so the copy starts **at the
current clock time** — 14:37:22 instead of 19:00 — and does it with UTC
interval arithmetic, so a daylight-saving change inside that week moves the
local start by an hour. "Run it again" is mostly used on an event that has
already happened, so that is the ordinary case.

The file fixes seven things:

1. The copy keeps the source's **local time of day**, in the event's own zone.
2. The day is chosen sensibly: an event still ahead → a week later; an event
   that has happened → the next time that weekday comes round. DST-safe.
3. `p_start` / `p_end` let the caller say exactly when.
4. `p_title` — " (copy)" is wrong for "the same event, again". Omitting it
   keeps the old default, so an unchanged caller behaves exactly as before.
5. `p_client_request_id` makes a double tap return the first copy instead of
   making a second draft (same contract as `create_event_with_limit_check`).
6. `chat_mode` / `open_policy` / `slow_mode_seconds` are copied server-side.
   The room's *state* — `locked`, `pinned_message_id` — deliberately is not.
7. A `duplicated_from` column records which event a copy came from.

**Not in scope, deliberately — `p_keep_recurrence`.** Recurrence is a Premium
feature enforced by `check_recurring_premium_on_update` (20261108110000:44),
an **UPDATE** trigger, and by `create_event_with_limit_check`. Inserting a
recurring row inside this `SECURITY DEFINER` function would bypass both and
hand out a Premium feature for free. Copying a series' repeat needs its own
decision plus an explicit `business_has_premium()` check. Until then the copy
is a one-off, as today, and the client's sheet says so out loud.

## Validation (2026-11-18, throwaway PG17 container, the stack's own image)

130 migrations + seed, unique container name, destroyed afterwards. The shared
database was never touched.

| Check | Result |
| --- | --- |
| Apply | clean |
| Re-apply, twice (idempotency) | clean — no-op |
| Exactly one `duplicate_event` (no ambiguous overload) | 1 |
| `authenticated` may execute / `anon` may not | true / false |
| **Old one-argument call still works** | yes |
| …and now keeps the local time of day | `19:00` (was the current clock time) |
| …keeps the weekday and lands in the future | Saturday, future |
| …keeps the duration, makes a draft, not recurring | 2 h 30, `draft`, `is_recurring=false` |
| **DST**: Oct 19:00 EDT source → 21 Nov copy | `2026-11-21 19:00` local (`00:00Z`, i.e. EST) |
| Upcoming source | +7 days, `18:30` kept |
| Explicit start / end / title | honoured |
| Links / photos copied | 1 / 1 |
| Chat set-up copied; `locked` not | `announcements`, `any_going`, `30`, `locked=false` |
| `duplicated_from` set | yes |
| Idempotency key reused | same id, one row |
| Past start / end ≤ start refused | `invalid_duplicate: …` |
| Non-owner / signed out refused | `not_allowed` / `not_authenticated` |
| All `scripts/test-*.sql` suites (incl. `test-host-tools`, which calls this RPC) | 14 passed, 0 failed, 0 crashed |

Two defects were found and fixed during this validation: the file was not
idempotent (`CREATE` → `CREATE OR REPLACE` for the new signature), and the
first run of the behaviour script built its fixture with an unparenthesised
`AT TIME ZONE`, which made an 18:30 event at 13:30.

## How to apply (owner) — do this AFTER the roadmap's client work is done

Local database first. Hosted only after its inventory
(`docs/MIGRATIONS_PENDING.md` §0).

```sh
# 0. optional: re-validate on a throwaway container. Use a UNIQUE name — a
#    sibling session shares this Docker host and uses the default one.
PG17_NAME=dupv2_check scripts/pg17-isolated.sh init
PG17_NAME=dupv2_check scripts/pg17-isolated.sh apply supabase/prepared/2026-11-18_duplicate_v2/20261118110000_duplicate_event_v2.sql
PG17_NAME=dupv2_check scripts/pg17-isolated.sh suites && PG17_NAME=dupv2_check scripts/pg17-isolated.sh destroy

# 1. move it into the migrations folder
git mv supabase/prepared/2026-11-18_duplicate_v2/20261118110000_duplicate_event_v2.sql supabase/migrations/

# 2. apply to the local stack
npx supabase migration up

# 3. verify — the count depends on which other prepared files you applied first
#    select count(*), max(version) from supabase_migrations.schema_migrations;
#    → max(version) = 20261118110000

# 4. regenerate types: the signature changed and events gained duplicated_from
npm run backend:types
```

**Order note.** If you also apply `2026-11-18_batch_c` (C6), either order
works — they touch different objects. Apply both before regenerating types and
you only need one `npm run backend:types`.

**Rollback.** Re-create the old one-argument function from
`supabase/migrations/20261103170000_rsvp_approval_mode.sql:817-868` and drop
the five-argument one. `duplicated_from` can stay: it is nullable and nothing
breaks if it is unused.

## After applying: the client cutover (~1 h)

The client works today by writing the chosen date to the fresh draft right
after the copy is made. Once this is applied, collapse that into one call:

1. `npm run backend:types`.
2. `services/hostTools.ts` → `duplicateEvent(eventId, opts)` passing
   `p_start`, `p_end`, `p_title` and a `p_client_request_id` generated once
   per sheet opening.
3. `hooks/useDuplicateEvent.ts` → delete the follow-up
   `eventsService.updateEvent` block and the `dated` flag with it, including
   the "the date didn't save" message. The hook's doc comment points here.
4. `services/eventPresetSettings.ts` → `carryOverToDuplicate` keeps only the
   `event_type` half; the chat half is now server-side. (`event_type` is also
   copied by v2, so this function can go entirely once you are sure no older
   backend is in play.)
5. `utils/eventPlaybook.ts:441` → feed `facts.ranAgain` from
   `duplicated_from`, so "Run it again" stops depending on a device-local flag.
6. Worth adding then, cheaply: a "Run it again" action on **Event Insights**
   ("that went well → do it again"). It was left out now only because the
   insights view-model carries `startDatetime` but no end, and v2 computes the
   end server-side from the source, so the client no longer needs it.

## Decisions (owner, 2026-11-18)

- **`p_keep_recurrence`: not doing.** A duplicated series stays a one-off
  until a host actually asks for the repeat to carry over. The reason is in
  this file's SQL header: recurrence is Premium-gated by an **UPDATE** trigger
  that a `SECURITY DEFINER` insert would bypass, so carrying it over needs an
  explicit `business_has_premium()` check and its own decision. The "Run it
  again" sheet already tells the host the repeat is not copied.
- **`event_bans`: do not carry over.** Someone removed from the last edition
  starts the new one with a clean slate; the host can remove them again. Add a
  carry-over toggle only if hosts ask for it.

Neither decision changes this migration — both are already its behaviour.
