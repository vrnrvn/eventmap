# Full event-journey review — plan (2026-11-17)

**Status (2026-11-18): all review phases done (R1–R5). Batch A is fixed. Batch B was applied by the owner on 2026-11-17 (130 migrations through `20261117160000`). Batch C is built, except the optional C6, which needs one small prepared migration applied (`supabase/prepared/2026-11-18_batch_c/`). Two answers still unblock Batch D.** Findings live in
[`docs/EVENT_JOURNEY_REVIEW_2026-11-17.md`](EVENT_JOURNEY_REVIEW_2026-11-17.md).
Scope: the whole
life of an event — joining it, creating it, the event playing out, and
finishing — as one connected journey, host and attendee sides together.
Companion doc: [`docs/EVENT_REHEARSAL_PLAN.md`](EVENT_REHEARSAL_PLAN.md)
(the rehearsal feature; this review runs first and feeds it).

**Standing constraints (owner, restated 2026-11-17 as hard constraints):**
never touch, modify or reset the shared DB directly, and work only in an
isolated environment when a database is needed; run long processes (E2E/browser
suites) only in the foreground, never in the background. Migrations are prepared
and validated in isolation, and the owner applies them. Findings land as a dated
doc plus `docs/ISSUES.md` entries before anything is fixed.

## 0. Status board

| Phase | Status | Result / what is left |
| --- | --- | --- |
| R1 Verify the seeds | **Done 2026-11-17** | 11 seeds → EJ-1…EJ-11: 10 confirmed (3 wider than seeded, 1 narrowed), 1 "won't do"; none withdrawn. New: **EJ-1 is a server gap** — suspended accounts can RSVP to single series dates (reproduced in isolation) |
| R2 Walk segments C + D | **Done 2026-11-17** | EJ-12…EJ-18. Worst: **EJ-12**, leaving after the end erases attendance and tells the waitlist "A spot opened up" for a finished event. **EJ-14**, moving a final date past `endDate` ends the series before that session (no RSVPs, no reminder). |
| R3 Walk E, then B/A seams | **Done 2026-11-17** | EJ-19…EJ-23. Worst: **EJ-19**, date-only attendees get no cancel/postpone/reschedule/date-cancel notice and no chat. **EJ-20**, series pattern edits are silent and prune per-date RSVPs. One of my own sub-claims was retracted after the repro. |
| R4 Rank + sequence fixes | **Done 2026-11-17** | §5a: owner decisions recorded (EJ-16, EJ-18, EJ-19 decided; EJ-14 recommendation awaiting OK). Batch A is 8 app-only fixes; Batch B is 11 prepared migrations |
| Batch A (app-only fixes) | **Done 2026-11-17** | All 8 items (§5a). Fully fixed: EJ-2, EJ-3, EJ-4, EJ-5. Client half fixed, server half in Batch B: EJ-1, EJ-12, EJ-13. Interim: EJ-14 guard, EJ-10 copy. Copy: EJ-15/21, EJ-17. Verified: 1,219 unit tests; 435 browser checks across 6 suites, 0 failures |
| Batch B (prepared migrations) | **Done 2026-11-17 — prepared, NOT applied** | 7 files in `supabase/prepared/2026-11-17_event_journey/` (outside the auto-applied folder; README has the apply runbook). Validated in throwaway PG17 containers: 14/14 SQL suites before, after, after re-apply, and without the optional #5/#6. Two existing suites failed on the first run and were fixed (§5a). **#5 and #6's notice wait for your OK.** |
| R5 Regression residue | **Done 2026-11-17** | `tests/seriesInProgress.test.ts`; `scripts/test-event-journey.sql` (7 blocks); Attendee A5–A8, Moderation R6; final pass 2026-11-17: 20 browser suites 1,277/1,285 (8 = pre-existing layout issues made visible by EJ-26), SQL 14/14 before/after the prepared set |
| Batch C (client follow-ups after apply) | **Done 2026-11-18, except optional C6** | Batch B was applied on 2026-11-17 (130 migrations, verified read-only). C1 types were already refreshed; C2–C5 built and unit-tested (1,279 tests pass). **C6 is blocked on one prepared migration**, `supabase/prepared/2026-11-18_batch_c/`: `user_series_sessions_attended` is revoked from `authenticated` by design, so the viewer's own number has no granted path. Validated in a throwaway PG17 container (14/14 suites), not applied; its client half is written down, not coded |
| Batch D (chat window, series reviews) | **Answered 2026-11-18** (owner delegated to the recommendations) | D1 = 7 days: prepared and validated, `supabase/prepared/2026-11-18_phase4/20261118150000_post_event_chat_window.sql`. D2 = series reviews count toward the venue rating: accepted, but the migration is deferred — the designed unique-index change breaks the deployed client's review upsert on apply; hazard + safe shapes in that folder's README |

Evidence for R1–R3: code at `50a2a57`, the latest defining migration for each
object, and one rolled-back repro per phase, each in its own throwaway PG17
container destroyed right after (`…_r1_1117`, `…_r2_1117`, `…_r3_1117`). The
shared DB was never connected to, and nothing ran in the background.

---

## 1. What is already reviewed (do not redo it)

| Prior pass | Covered | Residue |
| --- | --- | --- |
| [`CREATE_AND_JOIN_UX_REVIEW_2026-11-15.md`](CREATE_AND_JOIN_UX_REVIEW_2026-11-15.md) | Create form UX end to end; join bar, waitlist, approval, leave — **all findings fixed except J2 [decision]** | J2 (optimistic join), D3 (price columns) |
| [`HOST_DASHBOARD_AND_RECURRENCE_REVIEW_2026-11-16.md`](HOST_DASHBOARD_AND_RECURRENCE_REVIEW_2026-11-16.md) | Host dashboard; client recurrence (R1-R3 fixed); server S1/S2 found | S1/S2 + `get_host_dashboard` RPC in [`MIGRATIONS_PENDING.md`](MIGRATIONS_PENDING.md) §2b |
| Flow passes 1–9 (`docs/ISSUES.md`, fake-backend suites) | Onboarding, notification routing, moderation, attendee-after-event, premium, privacy, account, visual | device halves; admin manual half |

So the *segments* have been reviewed; what has never been reviewed is the
**journey as a sequence** — the transitions between phases, the host and
attendee experiencing the *same* moment, and the during/after phases
specifically. That is this review's angle.

## 2. Seed findings (already in hand, to verify first)

The 2026-11-17 code mapping that prepared this plan surfaced concrete
suspects. Each gets verified and either filed or withdrawn in Phase R1 — the
review starts from evidence, not from zero.

**Correctness**

1. **Chat access rule duplicated and wrong in the chat screen.**
   `app/event-chat/[id].tsx:212,495,671` hard-codes `rsvp_count >= 2` instead
   of using `utils/eventChatAccess.ts`, so it ignores the host's "any going"
   policy and the off mode. The server rule is
   `user_can_access_event_chat` (`20261103160000:59-83`).
2. **"Happening now" never shows for recurring series.**
   `isEventInProgress` returns false for any recurring event
   (`utils/eventStatus.ts:44`). A weekly event that is on right now reads as
   merely upcoming. Also blocks the rehearsal feature's Phase toggle.
3. **Review button offered to ineligible users.** "Write a review" renders
   for any signed-in non-owner (`screens/EventDetail.tsx:1881`), but the
   insert policy requires a started "going" RSVP
   (`user_can_review_business`, `20261030103000:76-108`); non-attendees get
   a server error instead of an explanation.
4. **Per-date RSVP chips skip the guards the main button has.** The handler
   at `EventDetail.tsx:192-216` ignores ban state and offline, unlike
   `handleRsvp`.
5. **Half-anticipated host-attendee state.** The "Manage chat" row is gated
   on `user_rsvp !== 'going'` (`EventDetail.tsx:1578`) while the join bar is
   gated on `isOwner` (`:1952`) — the screen partly expects a host RSVP that
   no UI can produce. Resolve deliberately (feeds the rehearsal `ViewerState`
   seam).
6. **Approval mode traps the owner's own join** as a `'requested'` row they
   must approve themselves (`guard_rsvp_approval`, `20261103170000:48-98`).
   Low impact until rehearsal/host-RSVP; file as a known edge.

**Lifecycle / policy**

7. **Nothing ends a chat when the event ends** — only the entry row on the
   event page disappears (`EventDetail.tsx:1513`); the chat itself stays
   open and posting works indefinitely. Maybe intended (post-event
   coordination), but it is nowhere decided. **[decision]**
8. **Reminders and attendee notices don't exclude a host RSVP**
   (`send_event_reminders`, `20261109150000:312-380`; cancel notices). Only
   matters because hosts *can* RSVP (decided 2026-11-08); worth one line in
   the tracker either way.
9. **Reviews are business-level, not event-level** (`reviews` table, one row
   per user × business, `services/reviews.ts:32-53`). An attendee of event
   B overwrites their review of event A. Known shape, but the "finishing the
   event" journey should state whether that is the product. **[decision]**

**Copy / small**

10. ManageEvent "Preview page" copy is false (fixed by the rehearsal
    feature's entry point; tracked there).
11. Stale "prepared, NOT applied" headers in applied migrations
    (e.g. `20261103170000:3`, `20261104090000:3`) — doc-only.

**Already tracked, in scope as context only:** E-R1 server next-date, S1/S2,
`get_event_host_overview.chat` fields, going-reminder ±5 min window, J2 —
all in `docs/ISSUES.md` / `MIGRATIONS_PENDING.md`; not re-filed.

## 3. Review method

Same discipline as the two prior reviews:

- **Read-only.** No fixes during the review; every finding has file:line at
  `HEAD`, severity, and a [DB] / [device] / [decision] tag.
- **Dual-persona walks.** Each segment is walked twice — as the attendee and
  as the host of the *same* event at the same moment — on the fake-backend
  browser harness (existing suites drive most states; a throwaway isolated
  stack via `scripts/pg17-isolated.sh` only where a real trigger/cron answer
  is needed, e.g. what a cancel actually sends).
- **Transition focus.** The checklists below lean on *state changes*:
  what each party sees the minute before, during, and after each transition,
  and what notifications fire.
- Output: `docs/EVENT_JOURNEY_REVIEW_2026-11-17.md` (findings, ranked) +
  new entries in `docs/ISSUES.md` + fix phases appended to `ROADMAP.md`.

## 4. Segments and what each walk checks

### Segment A — Create → publish (host)
Mostly settled by the 11-15 review; re-walk only the seams: draft → publish
→ `EventPublishedSheet` → event page hand-off; preset settings best-effort
saves (`services/eventPresetSettings.ts:22` — what does the host learn if
chat-mode save fails?); publish with `guidelines_required`; duplicate
carrying settings (`carryOverToDuplicate`); the monthly-limit path.

### Segment B — Discover → join → lead-up (attendee)
Join states settled 11-15; focus on the lead-up instead: reminder timing vs.
the ±5 min cron window; announcement → notification → chat crosspost (3/day
cap); what a joined attendee sees when the host **edits** (silent field
changes), **reschedules** (notice + `reschedule_required` path), **postpones**
(banner, RSVP kept), **cancels** (who is notified: going, interested,
requested, savers); calendar sync honesty after each of those.

### Segment C — The event plays out (both sides, same clock)
The least-reviewed phase. Live state ("Happening now" one-offs vs. the
series bug, seed #2); chat during the event — unlock rule in both its
implementations (seed #1), slow mode, host moderation while live, what a
removed-from-chat attendee experiences mid-event; per-date behaviour for a
series occurring *today* (chips, counts, waitlist promotion while live);
capacity changes while live; the host's view: does anything on
ManageEvent/HostDashboard actually serve the host *during* the hours of the
event (the playbook "dayof" stage vs. reality); no check-in exists — note
where its absence bites (attendance == RSVPs everywhere, insights included).

### Segment D — Ending → finished (both sides)
`hasEventEnded` client/server agreement (`utils/eventStatus.ts:22` vs.
`event_has_ended`), including timezone edges and the end of a series; the
flip of the event page (RSVP controls drop, "You attended", review prompt);
review eligibility vs. the offered button (seed #3) and the business-level
review model (seed #9); chat afterlife (seed #7); attendance history and
profile counts; host's post-event: insights populated, post-event notice
(opt-in cron), playbook "after" stage, Duplicate / run-again; what a
**waitlisted-but-never-promoted** attendee is told when it's over.

### Segment E — Cross-cutting seams
The simultaneity checks that no single-segment pass catches: event fills up
while an attendee has the page open (realtime count vs. a stale join
button); approval granted while the requester is offline; series date
skipped after someone RSVP'd that date (client shows effective date, server
ranking doesn't — E-R1, context); offline behaviour at each transition
(queued vs. refused writes per the 11-14 gate work); push vs. in-app
routing for every event-lifecycle notification type (suite exists —
`suiteNotifications` — confirm the lifecycle subset still passes);
`isMissingDbFunction` degradation branches along the journey (what the
journey feels like on a hosted DB that is behind).

### Segment order
C → D → E → B → A: least-reviewed first, settled-last.

## 5. Phases

- **R1 — Verify the seeds** (§2): confirm or withdraw each with a minimal
  repro; file in ISSUES.md. Small, sharply bounded.
- **R2 — Walk segments C and D** (during + finish), dual-persona, with the
  harness; findings doc started.
- **R3 — Walk E, then the B/A seams.**
- **R4 — Rank and sequence fixes:** client-only fixes batched first
  (candidates: seeds 1–5, 10); [DB] items *prepared* into
  `MIGRATIONS_PENDING.md` (candidates: 7/8 if decided, review-eligibility
  server hint); [decision] items (7, 9, J2) gathered into one owner sitting.
- **R5 — Regression residue:** any walked state not pinned by an existing
  suite gets a check (the journey's during/after states are thin in the
  current suites — `suiteAttendee` covers "after", nothing covers "during").

Estimated agent effort: R1 ~2 h, R2–R3 ~6–8 h, R4–R5 ~3 h. No migrations
applied at any point; no shared-DB writes.

## 5a. R4 — fix sequencing (2026-11-17)

### Owner decisions, 2026-11-17

| Ref | Question | Decision |
| --- | --- | --- |
| EJ-16 | What "attended" means for a series | **Per session.** A series goer attended each past date they didn't opt out of; a date-only goer attended their dates. |
| EJ-18 | Pending join requests when an event ends | **They go away.** Recommended addition, awaiting your OK: one short notice to the requester ("The event took place before the host replied"), so they aren't left wondering. |
| EJ-19 | Chat for date-only attendees | **Yes.** They read, post and count toward the two-going unlock while they have a going date. Caveat accepted: the chat is series-wide, so they also see talk about other dates. |
| EJ-14 | Moving a date past the series end | **Recommended, awaiting your OK:** extend the series end with the move *when no other pattern date falls in between* (the usual case, e.g. last weekly date pushed 3 days). Otherwise refuse with a clear message. Extending blindly would create phantom dates: a weekly series ending 24 Nov, last date moved to 3 Dec → 1 Dec would appear. **Interim (Batch A):** the app refuses any move past the series end. |

**Decided later the same day (owner, 2026-11-17):**

| Ref | Decision | Status |
| --- | --- | --- |
| EJ-14 | Extend-or-refuse rule **approved** | Migration 5 marked approved |
| EJ-18 | Requester notice **approved** | Migration 6 marked approved |
| EJ-7 | The chat stays open **for a while after the event, not forever** | Designed as D1 below |
| EJ-9 | Reviews **per venue; per event only for recurring series** | Designed as D2 below |
| J2 | **Keep Join non-optimistic.** The owner agreed with the recommendations. Join has many outcomes (going, requested, full, closed, waitlisted) that an optimistic flip would often roll back; Save is a binary toggle that rarely fails. The in-flight state (J1) already covers the wait. | Closed |
| — | Same-day cue on the event page ("Today · in 3 h") | **Built** (`startsSoonLabel`, rehearsal Phase 4) |

### Batch D — features from the decisions (designed; not built yet)

**D1 — the chat after the event ends (EJ-7).** Proposal: attendees can
**post for 7 days after the event ends**, after which the chat becomes
**read-only**; the history stays visible to the people who were going.
- For a series, the 7 days count from the **series** end. A running series'
  chat is the series' chat, so a weekly club's chat never closes mid-run.
- A **cancelled** event follows the same rule from its scheduled end. That
  keeps today's "the chat stays open for everyone who was going" promise for
  a week rather than forever.
- **Server:** a prepared migration adding `event_chat_posting_open(event)`,
  used by the INSERT policy and `get_event_chat_post_status.can_post`.
  Announcement mirrors follow it too.
- **Client:**
  - The event page shows the chat row after the end during the window
    ("Chat open until Tue 24 Nov"), and after it ("Chat closed — read the
    history").
  - The chat screen says "This chat closed on …".
  - The preview's "Ended" scenario shows the same states.
- **Constant:** a single `CHAT_AFTER_END_DAYS = 7` in
  `utils/eventChatAccess.ts`, mirrored in SQL.
- **Open sub-question:** is 7 days right? 3 or 14 are the obvious
  alternatives. *Recommendation: 7.* It covers the "thanks, photos, who has
  my jacket" week without leaving stale rooms.

**D2 — reviews per recurring series (EJ-9).** One-off events keep reviewing
the venue, as today. A recurring series gets reviews of its own, because a
weekly class is a thing people choose on its own merits, separately from the
venue's other events.
- **Server:**
  - `reviews.event_id` (nullable). Unique (user, business) where
    `event_id IS NULL`; unique (user, event) for series reviews.
  - Eligibility: attended at least one finished session, reusing
    `user_series_sessions_attended` from Batch B migration 7. That also
    retires EJ-3's series nuance.
  - Ownership, response and protection rules carry over.
- **Client:**
  - A series page shows "Reviews of this series" with its own rating, plus a
    link to the venue's reviews.
  - The review button and eligibility line follow the series rule.
  - The preview's "Ended" scenario follows it too.
- **Open sub-question:** should series reviews also count toward the
  **venue's** overall rating? *Recommendation: yes.* They are reviews of
  the host's work, and leaving them out would make busy series hosts look
  under-reviewed. The series page shows its own average too.

Both need a migration, which you apply at the end, and their client halves
depend on it. They are written and validated in isolation like Batch B,
once you OK the two sub-questions.

### Batch A — app-only fixes (no migration), in this order

| # | Finding | Change |
| --- | --- | --- |
| A1 | EJ-2 + EJ-13 | One occurrence-aware "in progress" rule (`occurrenceInProgress` in `utils/occurrences.ts`; `isEventInProgress` delegates for series). It feeds the event page, My Events, Joined, Profile, Calendar (per row), the host phase and the playbook stage. `getHostActions` keeps Postpone/Reschedule/Notify for a live *series*. Per-date rows: "happening now" while running; finished rows dropped. |
| A2 | EJ-1 (client) | Per-date chip handler gets `handleRsvp`'s guards: preview, offline, suspended, cancelled/ended. |
| A3 | EJ-12 (client) | Leave re-checks "ended" at tap time, so a page left open across the end can't delete. |
| A4 | EJ-3 | Ask `user_can_review_business` with the reviews load. When ineligible, show the reason instead of the button. Map the refusal to the same copy. |
| A5 | EJ-4 | Chat screen uses `eventChatAccess` at all three sites, plus an attendee "chat is off" notice. |
| A6 | EJ-5 | "Manage chat" gated on ownership alone. |
| A7 | EJ-14 (interim) | Move-date dialog refuses a new date past the series end, with an explanation. |
| A8 | EJ-15 / EJ-21 / EJ-17 / EJ-10 | Copy: Edit's notify-dialog audience; Settings host notices say "one-off events"; ManageEvent row no longer promises the attendee view. |

**Moved out of Batch A:** EJ-23 (stale calendar). The client has no reliable
"time changed since you added it" signal without a server field, so it moves to
Batch B.

### Batch B — prepared migrations, written and validated in isolation, the owner applies them

In order: **B1** EJ-1 suspension guard (one line) → **B2** EJ-12 refuse
deleting a going RSVP after the end, and make the waitlist and host-notice
triggers no-ops after the end → **B3** EJ-19 + EJ-21 one shared audience
helper for every lifecycle notice, plus date-only chat access (decision
above) → **B4** EJ-20 pattern or end-date changes go through the reschedule
guard with a "Schedule changed" notice → **B5** EJ-14 extend-or-refuse
(pending your OK) → **B6** EJ-18 expire requests at the end (+ notice if OK'd)
→ **B7** EJ-16 per-session attendance count and past list → **B8** EJ-22 chat
notices gated on access, with no duplicate for announcement mirrors → **B9**
EJ-15 end-only wording → **B10** EJ-13 server half (compare the occurrence end,
not the date) → **B11** EJ-23 reschedule signal → later: EJ-17
per-occurrence host notices. Each gets an assertion in the matching
`scripts/test-*.sql` (that is also R5's [DB] half).

**Batch B outcome (2026-11-17).** B9 (EJ-15 wording), B11 (EJ-23 column) and
B3 were merged into one file because they re-create the same functions; B10
(EJ-13 server half) went into the same file as B1. The result is 7 files, not
11: the README in `supabase/prepared/2026-11-17_event_journey/` maps each one.
Found and fixed while validating:
- `split_series_from` would have sent the new "Schedule changed" notice; it
  now stays silent.
- `test-attendance-rpcs` encoded per-event "attended"; it now checks either
  meaning.
- My R3 matrix wrongly said postpone doesn't reach savers: it does. The grep
  looked for `saved_events`, but the table is `saves`. The matrix in the
  findings doc is corrected.

Not written, deliberately:
- **EJ-17** per-occurrence host notices (Settings copy fixed instead).
- **EJ-3's series nuance**, which could now reuse
  `user_series_sessions_attended` (small; next time).
- **EJ-24** (new, found while writing #7): events someone attends only through
  per-date RSVPs appear in no Joined list. That needs a further change to
  `get_user_going_events`' row source.

### Batch C — client follow-ups after Batch B is applied

Each depends on a server object that doesn't exist until then, so they must not
ship first (Ground rules: no probe-and-retry).

| # | Finding | Change |
| --- | --- | --- |
| C1 | — | `npm run backend:types` (adds `rescheduled_at` and the new functions) |
| C2 | EJ-19 | Event page chat row counts a per-date "going" as going (`eventChatAccess` inputs) |
| C3 | EJ-14 | If #5 is applied, relax the move picker's interim guard; surface the server's "would add <date>" refusal |
| C4 | EJ-20 / EJ-21 | Edit's notify dialog also fires for schedule changes, and names savers and date-only goers |
| C5 | EJ-23 | "Time changed — update your calendar" when `rescheduled_at` is later than the viewer's RSVP |
| C6 | EJ-16 (optional) | "You've been to N sessions" on a series' page |

## 6. Exit criteria

- Every §2 seed confirmed-and-filed or withdrawn with evidence.
- Each segment-walk checklist has a pass/finding note with file:line.
- `docs/ISSUES.md` updated in place; fix sequencing proposed in ROADMAP.md.
- A short "ready for rehearsal" note: which findings block or bend the
  rehearsal feature's Phases 1–3 (expected: seeds 1, 2, 5 at minimum).
