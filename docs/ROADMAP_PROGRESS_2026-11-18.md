# Roadmap progress — 2026-11-18

The roadmap being run is **"Finish what's paid for"**: Batch C → duplicate
("Run it again") → a time-simulation test harness → the rest. This file is the
running status; it is the one to read first next session.

**Final status, regression results and the apply-day runbook live in
[`docs/STATUS_AND_APPLY_DAY_2026-11-19.md`](STATUS_AND_APPLY_DAY_2026-11-19.md).**
This file remains the record of how the work was sequenced.

## Where the three original questions landed

The session started from three asks (2026-11-18). All four roadmap phases are
now **built**; what is left is almost entirely the owner's apply-day plus the
client halves that legally cannot ship before it.

| Original ask | Answer / outcome | What remains |
| --- | --- | --- |
| **1. Does Batch C still need doing?** | Yes — the migrations were applied on 11-17 but no client work had been done. C1 was already done; **C2–C5 built**; C6 turned out to be blocked by a deliberate `REVOKE` | Apply `2026-11-18_batch_c`, then ~1 h for C6's client half |
| **2. Can we build a time-travel test harness?** | Nothing general existed (only the rehearsal screen's `scenarioNow`, the suites' date-moving and unit fake timers). **Built both halves**: SQL phase-walk + a controllable browser clock | Nothing. Optional later: a server that truly lives through time (container clock), and an in-page clock tick that would close EJ-12 |
| **3. Plan an event-duplication feature** | It already existed and was quietly broken for its main use (a past event's copy landed at the current clock time, in UTC). **"Run it again" shipped**; the server v2 is staged | Apply `2026-11-18_duplicate_v2`, then the ~1 h cutover |

Everything else in the table below (E-R1, recurrence fixes, EJ-24, Batch D)
was backlog picked up in phase 4 because it was decided, designed and cheap
next to its value.

## Decisions on record (owner)

| Decision | Answer | Where it lives |
| --- | --- | --- |
| D1 — post-event chat window | **7 days**, then read-only; series count from the series end | `2026-11-18_phase4/20261118150000_*.sql` |
| D2 — series reviews count toward the venue rating | **Yes** | phase-4 README |
| D2 — how to ship it safely | **Option (a)**: `submit_review` RPC in a client release first, then the schema change, then the D2 client half | phase-4 README |
| Duplicate v2 — `p_keep_recurrence` | **Not doing** until a host asks (Premium gate is an UPDATE trigger an insert would bypass) | `2026-11-18_duplicate_v2/README.md` |
| Duplicate v2 — `event_bans` carry-over | **No**; a copy starts with a clean slate | `2026-11-18_duplicate_v2/README.md` |

**Standing constraints (owner):** never touch, modify or reset the shared
database — an isolated throwaway container only, and a **unique** container
name, because a sibling session shares this Docker host and uses the default
one. Migrations are prepared and validated here; **the owner applies them, at
the end, after the roadmap's client work is done**. Long processes (browser /
E2E suites) run in the foreground only.

## Status board

| Phase | Status | What is left |
| --- | --- | --- |
| **1. Batch C** (event-journey client follow-ups) | **Done**, except optional C6 | C6 needs `2026-11-18_batch_c` applied, then ~1 h of client work |
| **2. "Run it again"** (duplicate) | **Client done.** Server v2 prepared | Apply `2026-11-18_duplicate_v2`, then the ~1 h cutover in its README |
| **3. Time-simulation harness** | **Done** | `docs/TIME_HARNESS.md`. SQL: `scripts/test-lifecycle.sql` (15th suite). Browser: `open({ clock: true })` + `suiteLifecycle.mjs` (21 checks) |
| **4. Batch D, and the older backlog** | **Done**, except D2 (deferred with a reason) | Four more prepared migrations in `supabase/prepared/2026-11-18_phase4/`: E-R1, the 2b-4/5/6 recurrence fixes (with 2b-3's widened parity fixture), EJ-24, and D1 (answered: 7 days). D2 answered (counts toward the venue rating) but NOT staged — its schema change breaks the deployed client's review upsert on apply, so it needs a migration + client pair; see that folder's README |

Verification at the end of phase 2: typecheck clean · **1,294 unit tests**
across 103 files · lint 0 errors (7 warnings, all pre-existing in files not
touched) · browser `suiteAttendee` 27/27, `suiteRehearsal` 108/108,
`suiteHost` 93/93, `suiteHostUi` 167/174 — **those 7 failures are
pre-existing**, confirmed by re-running the suite with the three changed
screens reverted to HEAD: identical failures, same strings (clipped category
and tab labels at 320/390 px, none of them text this work introduced).

## Phase 1 — Batch C (done)

Batch B was applied by the owner on 2026-11-17; the shared database records
**130 migrations through `20261117160000`** (verified read-only, unchanged).

| # | What | State |
| --- | --- | --- |
| C1 | Types carry `rescheduled_at` and the new functions | Already done at the 11-17 handoff |
| C2 | A per-date "going" counts for the chat (EJ-19) | **Done** — `utils/eventChatAccess.ts` gained a `dateGoing` input; the event page now also keeps the server's own `can_read`, which it was fetching and discarding. That is the only thing that knows about *other* people's date-only RSVPs |
| C3 | Move picker no longer refuses a date past the series end (EJ-14) | **Done** — `components/MoveDateModal.tsx` explains that the series end moves with it; the server's "would add `<date>`" refusal already surfaces through `occurrenceErrorMessage` |
| C4 | Edit's dialog fires for schedule changes and names the real audience (EJ-20/21) | **Done** — `utils/eventEditNotice.ts`, unit-tested. A pattern change is confirmed but deliberately **not** routed through `reschedule_event` |
| C5 | "Time changed — update your calendar" (EJ-23) | **Done** — `utils/calendarStale.ts`, comparing `events.rescheduled_at` with the viewer's own `rsvps.created_at` (read under the existing own-rows policy, so no migration was needed) |
| C6 | "You've been to N sessions" (EJ-16) | **Blocked on a migration.** `user_series_sessions_attended` is revoked from `authenticated` by design, so the viewer's own number has no granted path. Wrapper prepared: `supabase/prepared/2026-11-18_batch_c/` |

## Phase 2 — "Run it again" (client done, server prepared)

Duplication already existed end to end; this phase made it usable for its main
purpose, running a past event again.

**Shipped (works against today's server):**

- `utils/duplicateDate.ts` — the copy keeps the source's **local time of day
  and duration**, on a day the host picks. Default: a week later for an event
  still ahead, the next matching weekday for one that has happened. DST-safe.
- `hooks/useDuplicateEvent.ts` + `components/RunItAgainSheet.tsx` — one shared
  action and one sheet, the same split `useOccurrenceActions` + `MoveDateModal`
  use.
- **Manage event**: the "Duplicate" row became "Run it again", with the date
  chosen up front instead of the copy landing a week out at whatever time it
  happened to be. The host playbook's "Run it again" item opens the same sheet.
- **My events → Past**: a "Run it again" action per row, including cancelled
  events. Its drafts empty-state copy was corrected to match.
- The sheet says the repeat is **not** copied for a series — it never was, but
  it used to happen silently.

**Why the date is written as a second call for now:** `duplicate_event` takes
no date today. The copy is a draft, and `guard_event_time_changes` returns
early for any draft, so writing the chosen start straight afterwards is a
plain update with no notification and nobody to notify. If that second write
fails the host still gets a usable draft and is told to set the date in Edit.

**Deliberately left for after the migration:** a "Run it again" action on
Event Insights. The insights view-model carries `startDatetime` but no end;
v2 computes the end server-side, so it becomes trivial then.

## Migrations waiting for the owner (apply after the roadmap)

Both are validated on throwaway PG17 containers, both are idempotent, neither
is depended on by any shipped code. Each folder's README has the runbook, the
validation table and the client work that follows.

| Folder | File | Unblocks | Client work after |
| --- | --- | --- | --- |
| `supabase/prepared/2026-11-18_batch_c/` | `20261118100000_series_sessions_attended_self.sql` | C6 "You've been to N sessions" | ~1 h |
| `supabase/prepared/2026-11-18_duplicate_v2/` | `20261118110000_duplicate_event_v2.sql` | The copy's date/title/idempotency/chat/lineage | ~1 h cutover |

Order does not matter; they touch different objects. Applying both before one
`npm run backend:types` is enough.

Still unwritten and listed in `docs/MIGRATIONS_PENDING.md`: the hosted-database
inventory (§0, owner-only, do first), E-R1's server half (§2), the §2b
recurrence and host-dashboard set, Batch D (needs two answers), EJ-24 and
EJ-17.

## Phase 3 — the time-simulation harness (done 2026-11-18)

Built as approach A, both halves; the design, the phase table, the limits and
the run commands live in **`docs/TIME_HARNESS.md`**.

- **SQL**: `scripts/test-lifecycle.sql`, the 15th suite — one event walked in
  order through `before → dayof → reminder → live → ended`, each phase aligned
  to a measured server window, the scheduled job functions called at every
  phase (silent outside their window, firing once inside it). Self-contained
  like every suite; its `pg_temp.set_phase` is the canonical helper for new
  suites to copy. Verified non-vacuous by a mutation test.
- **Browser**: `open({ clock: true })` in `scripts/fake-backend-e2e/lib.mjs`
  injects an offset clock (survives reloads); `get_ranked_events` in the fake
  backend now derives `has_ended` from the fixture's own dates;
  `suiteLifecycle.mjs` (21/21) walks one fixed event purely by moving the
  clock, including the end passing under an open page — stale until reload,
  pinned as EJ-12 documentation.
- Regression after the shared-file changes: `suiteA` 21/21, `suiteAttendee`
  27/27, `suiteCollections` 168/168; all 15 SQL suites pass.
- Deliberately not done: a server that lives through time (the LD_PRELOAD
  container-clock spike) and an in-page `useNow()` tick that would close
  EJ-12 — both recorded in `docs/TIME_HARNESS.md`.

## What is next (after this session)

Nothing in the app is waiting on more client work that can legally be done
today: every remaining item either needs the owner's apply-day first, or is
new scope.

**Step 1 — the apply-day (owner).** Seven prepared migrations in three
folders, each with its own runbook. Order: `2026-11-18_phase4`'s files by
number (#1 before #3), the other two folders anywhere. One
`npm run backend:types` at the end covers `2026-11-18_batch_c` and
`2026-11-18_duplicate_v2`; the phase-4 four need none.

**Step 2 — the client halves that unlock with it (~4–6 h total).**

| After applying | Client work |
| --- | --- |
| `2026-11-18_batch_c` | C6 "You've been to N sessions" on a series page (~1 h) |
| `2026-11-18_duplicate_v2` | Collapse the two-call duplicate into one, retire the chat half of `carryOverToDuplicate`, feed `facts.ranAgain` from `duplicated_from`, add "Run it again" to Event Insights (~1 h) |
| `20261118120000` (E-R1) | B4: retire/demote `useEffectiveNextDates` where the server now returns the effective date (~1–2 h, optimisation only) |
| `20261118150000` (D1) | `CHAT_AFTER_END_DAYS = 7`, the event page's chat row during/after the window, the chat screen's "closed on …", the rehearsal Ended scenario, and flipping `suiteLifecycle` L4's chat-row check (~2–3 h) |

**Step 3 — new scope, in the order I would take it.**

1. ~~**D2 series reviews**~~ — **server side done 2026-11-19**, both
   migrations prepared and validated in all three deployment states:
   `supabase/prepared/2026-11-19_series_reviews/`. Its two client releases
   (submit through `submit_review()`, then the series-reviews UI) cannot be
   written until step 1 is applied, so they wait on the apply-day. That
   folder's README is the ordering contract.
2. ~~**EJ-17**~~ — **done 2026-11-19**, prepared and validated:
   `supabase/prepared/2026-11-19_series_host_notices/`. Day-of and post-event
   notices now fire per occurrence for a series, counted for that date,
   skipping cancelled dates and honouring moved ones. Pinned by
   `scripts/test-lifecycle.sql` block [9]. Client follow-up after apply: two
   lines of Settings copy (~10 min).
3. **§2b leftovers** — ~~`get_host_dashboard` (C3)~~ **done 2026-11-19**,
   prepared and validated with parity against every call it replaces:
   `supabase/prepared/2026-11-19_host_dashboard_rpc/`. Its client cutover
   (~4–6 h) waits on the apply-day and carries one persistence decision,
   written up in that README. Check-in / CSV export (C4) still needs decision
   DC6 and a device.
4. **Owner-only, before any hosted deploy:** the §0 hosted-database inventory.
   No hosted project's migration state has ever been checked, and the Oct 30
   security set is the thing to confirm first.

**Known gaps deliberately left open** (documented where they live): EJ-12's
stale open page (needs an in-page clock; `suiteLifecycle` L5 pins the current
behaviour), the 7 pre-existing `suiteHostUi` clipped-label failures, and
`npm run test:backend`, which nobody has run since the Nov 9–13 migrations
because it writes to the shared stack.
