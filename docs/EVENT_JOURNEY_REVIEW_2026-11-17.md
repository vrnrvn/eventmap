# Event-journey review — findings (2026-11-17)

Findings doc for the review planned in
[`docs/EVENT_JOURNEY_REVIEW_PLAN_2026-11-17.md`](EVENT_JOURNEY_REVIEW_PLAN_2026-11-17.md).
Read-only: nothing was fixed. Line numbers are at `50a2a57`.

**Status: R1–R4 done 2026-11-17 (23 findings, EJ-1…EJ-23); the app-only
fix batch (Batch A) is done.**

- **Fixed:** EJ-2, EJ-3, EJ-4 and EJ-5.
- **Client half fixed, server half pending:** EJ-1, EJ-12 and EJ-13.
- **Interim fixes:** the EJ-14 move guard and the EJ-10 copy.
- **Copy fixed:** EJ-15/21 and EJ-17.
- **Server halves (Batch B):** prepared and validated, **not applied**:
  7 files in `supabase/prepared/2026-11-17_event_journey/`, the apply runbook
  is in its README.
- **After you apply:** the Batch C client follow-ups (plan §5a).
- **New:** EJ-24 (below), not yet fixed.

The findings below are kept as written, as evidence. R2 and R3 used the same method
as R1: code walks, then one rolled-back batch per phase in a fresh throwaway
container (`eventmap_pg17_oak_r2_1117`, `…_r3_1117`). Each container was
destroyed straight after its batch, and nothing ran in the background.

Severity: **M** = should be done soon · **L** = tidy-up / edge ·
**D** = needs a product decision. Tags: **[DB]** needs a migration ·
**[client]** client-only · **[decision]**.

How R1 was verified: every seed re-read at `HEAD` in the app code and in the
*latest* migration that defines each object. The four server-side claims were
reproduced in a throwaway Postgres 17 container from the stack's own image
(`PG17_NAME=eventmap_pg17_oak_r1_1117 scripts/pg17-isolated.sh init`, 123
migrations + seed). The repro was one rolled-back transaction, impersonating
via JWT claims only (no `SET ROLE`, so the supautils segfault path in the
Ground rules could not be hit). The container was destroyed afterwards. The
shared database was not connected to.

---

## Summary

| ID | Seed | Verdict | Sev | Tag | Fix surface |
| --- | --- | --- | --- | --- | --- |
| EJ-1 | 4 | **Confirmed + wider: server gap** | M | [DB] + [client] | `set_occurrence_rsvp`; `toggleDateRsvp` |
| EJ-2 | 2 | **Confirmed + wider** | M | [client] | `utils/eventStatus.ts` + callers |
| EJ-3 | 3 | **Confirmed** (+ series nuance) | M / L | [client] (+ [DB] nuance) | EventDetail review section |
| EJ-4 | 1 | **Confirmed, narrowed** | L | [client] | `app/event-chat/[id].tsx` |
| EJ-5 | 5 | **Confirmed, sharper** | L | [client] | EventDetail chat rows |
| EJ-6 | 6 | **Confirmed** (edge, no UI path) | L | note | — (rehearsal avoids it) |
| EJ-7 | 7 | **Confirmed; inconsistent** | D | [decision] | chat lifecycle |
| EJ-8 | 8 | **Confirmed** (latent) | L | note | `send_event_reminders` |
| EJ-9 | 9 | **Confirmed as design** | D | [decision] | reviews model |
| EJ-10 | 10 | **Confirmed** | L | [client] | rehearsal entry point |
| EJ-11 | 11 | **Confirmed, 32 files; no action** | — | won't do | — |
| EJ-12 | R2 | Leaving after the end is allowed and has side effects | M | [DB] | `rsvps` DELETE policy / triggers |
| EJ-13 | R2 | Today's finished series session stays joinable | L | [client] + [DB] | per-date list; `set_occurrence_rsvp` |
| EJ-14 | R2 | Moving the final date past `endDate` ends the series early | M | [DB] + [client] | `reschedule_occurrence`; `MoveDateModal` |
| EJ-15 | R2 | "Running late" sends "rescheduled… now starts <same time>" | L | [DB] + [client] | `reschedule_event`; Edit dialog copy |
| EJ-16 | R2 | Attendance: open-ended series never count as attended | D | [decision] | attendance model |
| EJ-17 | R2 | Host day-of / post-event notices silently skip series | L | [client] (copy) / [DB] | `send_host_event_notices` |
| EJ-18 | R2 | Pending requests are stranded once an event ends | L | [decision] (existing) | approval mode |
| EJ-19 | R3 | **Date-only attendees get no lifecycle notice and no chat** | M | [DB] | every notice + chat access |
| EJ-20 | R3 | Changing a series pattern is silent and prunes RSVPs | M | [DB] + [client] | guard/notice triggers; EditEvent |
| EJ-21 | R3 | Notice audiences disagree (savers, opt-outs) | L | [DB] + [client] | notice functions; Edit dialog |
| EJ-22 | R3 | Chat notifications ignore chat access; announcements double up | L | [DB] | `notify_attendees_on_chat_message` |
| EJ-23 | R3 | External calendar entries go stale after a reschedule | L | [client] | event page / notice |

Nothing was withdrawn outright. Seed 1 is narrower than first stated; seed 11
becomes a "won't do". Seeds 2, 4 and 5 are worse than first stated.

---

## EJ-1. Suspended accounts can RSVP to single series dates (M, [DB] + [client])

**Server.** `set_occurrence_rsvp` (`20261109150000_rsvp_occurrences.sql:117-196`,
the only definition) checks `user_is_banned_from_event`, which means removed
from *this* event, but never `user_is_banned`, which means account
suspended. Its two siblings both refuse suspended accounts:
`join_event_with_capacity` (`20261103170000`, `user_is_banned` at body
line 19) and `join_event_waitlist` (body line 13). `rsvp_occurrences` has no
trigger that would catch it either. This contradicts the 2026-11-08
decision "suspended accounts lose all write actions (enforced
server-side)".

**Reproduced (isolated):** with `alex` in `banned_users`:

```
control  join_event_with_capacity | REFUSED: not_allowed: account suspended
control  join_event_waitlist      | REFUSED: not_allowed: account suspended
subject  set_occurrence_rsvp(going) | OK: {"date" : "2026-11-24", "status" : "going"}
rows written for suspended user   | 1
counted in per-date going count   | 1      ← takes a seat on a capped date
```

**Client.** `toggleDateRsvp` (`screens/EventDetail.tsx:192-216`) has none of
`handleRsvp`'s guards (`:582-598`): no `blockedByPreview`, no
`blockedOffline`, no `isBanned` message, and no cancelled or ended pre-check.
The server covers cancelled and ended (`rsvp_closed`). Offline produces the
generic "Couldn't update that date" message instead of the offline copy.

**Fix:** one-line guard in a prepared migration (`IF user_is_banned(v_uid)
THEN RAISE EXCEPTION 'not_allowed: account suspended'`, mirroring the
siblings) plus a check in `scripts/test-attendance-rpcs.sql`. On the client,
give `toggleDateRsvp` the same guard prelude as `handleRsvp`.

## EJ-2. Recurring series are never "Happening now", and surfaces disagree (M, [client])

`isEventInProgress` returns `false` for every recurring event by design
(`utils/eventStatus.ts:43-45`, "one-off events only"). It drives:

- the event page's live state (`EventDetail.tsx:1097`)
- My Events (`MyEvents.tsx:303`), Joined Events (`JoinedEvents.tsx:146`) and
  Profile (`app/(tabs)/profile.tsx:509`)
- Calendar, which additionally excludes series explicitly (`Calendar.tsx:320`)
- the host phase model (`utils/hostEvent.ts:34`) and through it the LIVE
  badge and the playbook stage

Meanwhile **Host Dashboard computes "live" per occurrence**
(`utils/hostDashboard.ts:142,165` → "Happening now", `:308`). During a
weekly session the dashboard says "Happening now" while every other screen
says upcoming.

**Wider consequence: the host's checklist leaves "day of" mid-session.**
`playbookStage` (`utils/eventPlaybook.ts:198-207`) falls back to
`hoursUntilStart`, which reads `next_start_datetime`. The server's
`event_next_occurrence` returns the first candidate `>= now`
(`20261109130000:148,164,174`). So once a session starts, the next start
is next week, `hours > 24`, and the stage becomes **lead-up** while the event
is in progress. Nothing tests `isEventInProgress` directly
(`grep tests/` finds no reference).

**Fix (client-only):** an occurrence-aware "in progress" check. Take the
latest effective occurrence start `<= now`, honouring exceptions the way
`useEffectiveNextDates` / `listOccurrences` already do, and test
`now < start + (end_datetime − start_datetime)`. Feed it to the callers above
and to `getHostEventPhase`. Reuse the dashboard's per-occurrence logic so
there is one rule. **Blocks the rehearsal "Phase" toggle** (rehearsal plan
§3.2).

## EJ-3. "Write a review" is offered to people the server will refuse (M; series nuance L)

The button renders for any signed-in non-owner (`EventDetail.tsx:1881`).
The insert policy requires `user_can_review_business`
(`20261030103000:76-98`; policy re-created `20261106160000:465`), which
means a `going` RSVP to an event of that business with
`start_datetime <= now()`. An ineligible person writes the review, presses
submit, and gets the generic **"Failed to submit review"**
(`components/ReviewForm.tsx:35-36`). They are never told why.

**Reproduced:** `sam`, going only to an upcoming one-off, has
`user_can_review_business = false`.

**Fix (client-only):** the function is callable as an RPC (in the generated
types, `types/supabase.generated.ts:2739`, and no REVOKE). Ask it once with
the reviews load. Replace the button with a one-line reason ("Reviews open
after you've attended an event here") when it returns false. Map the
RLS refusal (`42501`) to the same copy as a backstop.

**Series nuance (L, [DB]):** for a series, `start_datetime` is the *first*
date. **Reproduced:** `sam` joins a weekly series whose first date was 7
days ago and is eligible immediately, before attending any session.
Tightening it needs an occurrence-aware check server-side. Low value. File
it, don't do it.

## EJ-4. Chat screen re-implements the access rule (L, [client])

`app/event-chat/[id].tsx:212,495,671` hard-code
`user_rsvp === 'going' && rsvp_count >= 2` instead of
`utils/eventChatAccess.ts`. **Narrowed from the seed:** each site ORs in the
server's `can_read`, so the "any going" policy works whenever the status
call succeeds. What remains:

- **Off mode, 2+ going (reproduced server-side:**
  `can_read=f can_post=f mode=off`): the client still sets `canChat`. The
  room loads empty because RLS hides messages. The notice chain
  (`:1830-1852`) has no `off` branch for attendees, so it says **"Waiting
  for one more attendee before the chat opens"**. That is wrong, and it
  implies the chat will open.
- **Off mode, fewer than 2 going, cached messages:** "Chat is locked — it
  reopens when at least 2 people are going" (`:1624`, `:1821-1826`). Also
  wrong.
- "Any going", status call failed: access denied even though the server
  allows it.

**Reachable:** an old `chat_message` / `chat_mention` notification routes
straight to `/event-chat/<id>` (`utils/notificationRoute.ts:50-51`),
bypassing the event page's correct "turned off" row. No data is exposed,
because the server enforces access.

**Fix:** derive `attendeeAccess` from `eventChatAccess(user_rsvp, rsvp_count,
postStatus)` at all three sites. Add an attendee `off` branch to the notice.

## EJ-5. A host holding a "going" RSVP gets no chat entry on their event page (L, [client])

The attendee chat row is hidden by `isOwner` (`EventDetail.tsx:1513`). The
"Manage chat" row is hidden by `details.user_rsvp !== 'going'` (`:1578`). A
host with a going row, which the DB allows and
`scripts/test-local-backend.mjs:364-367` creates, gets **neither**.
ManageEvent's own chat link (`ManageEvent.tsx:1798`) still works, so the
impact is low. **Fix:** gate "Manage chat" on `isOwner` alone. This belongs
in the rehearsal plan's Phase 1 `ViewerState` seam.

## EJ-6. Owner's own join in approval mode becomes a request to themselves (L, note)

**Reproduced:** with `rsvp_mode = 'approval'`, the host's
`join_event_with_capacity('going')` returns `requested` and writes a
`requested` row (`guard_rsvp_approval`, `20261103170000:48-98`). No UI path
produces it today, because the join bar is hidden for owners. File it as a
known edge. The rehearsal feature's simulate-don't-RSVP design
(rehearsal plan §2) is what keeps it unreachable.

## EJ-7. Chat after the event ends: open on the server, hidden in the app (D)

- Server: `user_can_access_event_chat` (`20261103160000:59-83`) has no time
  condition. Posting works indefinitely after the end.
- Chat screen: no ended handling at all. It has explicit copy for
  **cancelled** ("The chat stays open for everyone who was going",
  `app/event-chat/[id].tsx:1811-1818`), which is a deliberate policy for
  that case.
- Event page: the attendee chat row disappears once ended
  (`EventDetail.tsx:1513`, `!eventEnded`).

As a result, the chat stays open after the event, but the only way in is an
old notification. Either policy is defensible. The current mix is not.
**[decision]:** (a) keep it open after the end and show the row with
"Event ended — chat stays open" (matches the cancelled case); (b) read-only
after N days, which needs a server condition [DB]; or (c) close at end.
Recommendation: **(a)**. It is client-only and consistent with cancelled.

## EJ-8. Reminders and attendee notices don't exclude a host's own RSVP (L, latent)

`send_event_reminders` (latest: `20261109150000`) targets every `going`
row in `rsvps` / `rsvp_occurrences` with no owner exclusion. The cancel
notices do the same. This is only reachable if a host RSVPs, which no UI
allows (EJ-5, EJ-6). No action beyond the tracker entry. Revisit only if
host RSVP becomes a product feature.

## EJ-9. Reviews are per business, not per event (D)

Confirmed as the design. `reviews` is one row per user × business
(`services/reviews.ts:40-50`, `onConflict: 'user_id,business_id'`), and the
event page already labels the section "Reviews of <venue>"
(`EventDetail.tsx:1870-1874`). Reviewing after a second event **edits** the
same review. **[decision]**: is that the product? If event-level feedback is
wanted, it is a new feature (per-event rating, possibly host-only), not a
fix.

## EJ-10. ManageEvent's "Preview page" copy is false (L)

Confirmed at `screens/ManageEvent.tsx:1258-1263`: "See the event the way
attendees do" opens `/event/<id>`, which renders the owner view. This is
fixed by the rehearsal feature's entry point (rehearsal plan §3.1). If
rehearsal slips, change the copy to "Open your event page".

## EJ-11. Applied migrations still say "prepared, NOT applied" — no action

Confirmed and wider than seeded: **32** files in `supabase/migrations/`
carry a "NOT applied" status header (e.g. `20261103170000:3`,
`20261104090000:3`). All 123 are recorded locally (`docs/ISSUES.md` Ground
rules). **Won't do:** editing applied migration files to change history
comments is churn with no reader benefit. The authoritative state is the
Ground rules' verify query. That is now noted in the tracker so it is not
re-raised.

---

# R2 — the event plays out, and finishing (segments C + D)

## EJ-12. Leaving after the event ended is allowed, and the triggers misfire (M, [DB])

The app means to freeze an attendee's RSVP after the end. The secondary
button is hidden once an event is cancelled, ended or a draft
(`EventDetail.tsx:2060-2063`, "Only cancelled/ended/draft events freeze
it"), and the server's UPDATE policy uses `event_allows_rsvp_changes`. But
the **DELETE policy has no condition beyond ownership**
(`20261106160000:501-506`, `USING (auth.uid() = user_id)`), and no trigger
refuses. A page left open across the end time can still delete, because
`eventEnded` is computed at render. So can any API caller.

**Reproduced** on a one-off that ended 3 h earlier, capacity 1, alex going,
sam waitlisted, alex deletes their row:

```
rows deleted            | 1
alex attended_count now | 0                              ← attendance erased
notification → host     | rsvp | Someone left your event   ← after it's over
notification → sam      | waitlist | A spot opened up     ← for a finished event
```

**Fix:** a prepared migration that refuses DELETE of a `going` row once
`event_has_ended` (mirror the UPDATE policy), or at minimum makes
`sync_event_waitlist_on_rsvp` and `notify_business_on_rsvp_delete` no-ops
after the end. Whether a user may *hide* a past event from their history is
a separate question. That would be a visibility flag, not a delete.

## EJ-13. Today's series session can be joined after it finished (L, [client] + [DB])

The event page's five-date list uses `listOccurrences` in its default,
non-strict walk, which per its own comment "starts at midnight so a 19:00
date still lists at 21:00" (`utils/occurrences.ts:68-73`). The chip's
`canToggle` doesn't check the occurrence's end
(`EventDetail.tsx:1704`). The server accepts any `p_date >= today`
(`set_occurrence_rsvp`).

**Reproduced:** at 16:43 UTC, sam RSVP'd "going" to today's 13:43–15:43
session: `OK: {"date": "2026-11-17", "status": "going"}`.

**Fix:** per-row state from `Occurrence.end`: "Happening now" while it runs,
"Ended" and no chip after. This pairs with EJ-2, which needs the same
occurrence-aware rule. Optionally the server compares the occurrence's end
instead of the date [DB].

## EJ-14. Moving a series' final date past its end date ends the series before that session (M)

`reschedule_occurrence` validates only `new_end > new_start` and
`new_start > now()` (`20261109140000:221-225`). `MoveDateModal` bounds
the picker only by `minimumDate={new Date()}` (`components/MoveDateModal.tsx:41,67,69`).
But "ended" for a series is `endDate < today` (`event_has_ended`,
`20261103140000:81-84`).

**Reproduced:** endDate 2026-11-24, final date moved to 2026-11-27 →
`OK`; on the session's day `endDate < session date` is **true**. On that
day the series therefore reads ended everywhere:
- RSVPs closed (`event_is_open_for_rsvp`)
- the "This event has ended" notice and no chat row
- **no reminder** (`send_event_reminders` filters `NOT event_has_ended`,
  `20261109150000:363`)
- going rows counted as "attended"

A realistic trigger: the last session of a season pushed a week for weather.

**Fix:** either refuse to move a date past the series end (server error and
picker `maximumDate`), or extend `endDate` along with the move. **[decision]**,
light. Recommendation: extend, and tell the host ("This also moves the
series end to 27 Nov"). Refusing strands a real need.

## EJ-15. "Running late": extending the end sends a misleading "rescheduled" notice (L)

With anyone going, any start/end change must go through `reschedule_event`
(`guard_event_time_changes`, `20261103150000:395-405`). Edit allows
changing only the end of an event that has started (`EditEvent.tsx:503-516`),
so the path is reachable while live.

**Reproduced:** extending the end by 30 min notified 2 people:
`Event rescheduled | "Community Art Evening" now starts Wed, Nov 18, 06:00 PM UTC.`
The start did not change.

Also, Edit's confirm dialog says the notice goes to "everyone who's going,
interested or **has saved** this event" (`EditEvent.tsx:676`), but
`reschedule_event` targets going, interested, requested **and the waitlist**,
not savers (`:549-551`). See EJ-21.

**Fix:** when only the end moved, word the notice "now ends at …" or skip it
for a small extension [DB]. Correct the dialog's audience copy [client].

## EJ-16. Attendance is series-level and "ended"-only (D)

`attended_count` counts `going` rows whose event `event_has_ended`
(`20261104120000:178-186`). Consequences:
- an **open-ended series never ends**, so a member of a weekly club who went
  20 times has attended it 0 times
- a per-date "Can't go" doesn't subtract
- EJ-12 lets attendance be erased afterwards

Without check-in (host tools Phase 4), attendance is "RSVP'd going",
everywhere. **[decision]:** count per occurrence (a going series goer
"attended" each past date not opted out of), or wait for check-in?
Recommendation: per occurrence. It's what "You attended" means to people.
It's a [DB] change to the count and the past list.

## EJ-17. Host day-of and post-event notices skip series, silently (L)

`send_host_event_notices` filters `is_recurring = false` for both notices
(`20261113110000:47,80`). The Settings switches read "Remind me on the day —
A few hours before **each event** starts" and "Summary after the event"
(`screens/Settings.tsx:1104-1129`). A series host who opts in gets nothing.
**Fix:** say "one-off events" in the copy now [client]. Per-occurrence
notices later [DB].

## EJ-18. Pending requests are stranded once the event ends (L, existing decision)

**Reproduced:** `host_review_rsvp(approve)` after the end →
`REFUSED: event_closed`. The requester stays `requested` and is never told.
The Host Dashboard correctly stops listing them (`utils/hostDashboard.ts:406`).
This joins the existing open decision "Approval-mode events when RSVPs are
closed" in `docs/ISSUES.md`. Suggested answer: when an event ends, auto-decline
open requests with a "the host didn't get to your request" notice.

**Checked in R2 and found fine:** client `hasEventEnded` and the server
`event_has_ended` agree. The only difference is the documented legacy case of
a NULL time zone, where the device day is used instead of UTC. RSVP *updates*
are frozen after the end on the server. Host Dashboard skips ended events.
The host's Attendees tab goes read-only after the end.

---

# R3 — cross-cutting seams, then lead-up and create (segments E, B, A)

## EJ-19. Date-only attendees are invisible to every lifecycle notice and to chat (M, [DB])

A **date-only attendee** RSVP'd "going" to one date of a series via
`set_occurrence_rsvp`, without a series RSVP. They exist since
`20261109150000`. Every notice that predates or ignores that table builds its
audience from `rsvps`:

| Notice | going / interested / requested | waitlist | savers | **date-only** |
| --- | --- | --- | --- | --- |
| `cancel_event` (`20261103170000:527-540`) | ✓ | ✓ (via trigger†) | ✓ | **✗** |
| `postpone_event` (`20261103150000:613-614`) | ✓ | ✓ | ✓ *(corrected 2026-11-17: my grep searched `saved_events`; the table is `saves`)* | **✗** |
| `reschedule_event` (`:549-551`) | ✓ | ✓ | ✗ | **✗** |
| per-date skip / move / restore (`notify_occurrence_change`, `20261109140000:142-170`) | ✓ | ✓ | ✓ | **✗** |
| announcement, "going" (`20261103160000`) | going only | ✗ | ✗ | **✗** |
| chat message notices (`20261103120000:474-522`) | going only | — | — | **✗** |
| reminders (`send_event_reminders`, `20261109150000`) | going | — | — | ✓ |

† `clear_event_waitlist_on_cancel` (`20261102160000:163-183`).

**Reproduced:** sam is a date-only attendee for 24 Nov, alex a series goer:
- The host **cancels 24 Nov, notify on** → `notified: alex [Date cancelled]`.
  Sam, the one person who signed up for exactly that date, is not told. Her
  row stays `going` on the cancelled date.
- An announcement to "going" reaches alex, not sam.
- Chat: `can_read = false` for sam. `user_can_access_event_chat` requires a
  series `rsvps` going, and date-only attendees don't count toward the
  two-going unlock either.

`notify_occurrence_change` predates the per-date table by one migration and
was never updated. **Fix:** one shared SQL audience helper (`event_audience(event,
date?, kinds)`) used by every notice, including date-only goers of the
affected date(s). Decide chat access for date-only goers [decision, light]:
recommendation, they can read and post on the day they're going.

## EJ-20. Changing a series' pattern is silent and prunes per-date RSVPs (M)

`guard_event_time_changes` and `notify_rsvp_users_on_event_update` only
compare start, end and place (`20261103150000:396-397`, `:433-439`). So a
`recurrence_pattern` change with people going is neither forced through a
reschedule nor announced. Edit sends a changed pattern as a plain update
(`EditEvent.tsx:612-613`), and its "Notify attendees?" dialog only fires for
time/place.

**Reproduced:** weekly → every 3 weeks with alex (series) and sam
(date-only, 24 Nov) going → `UPDATE OK`, 24 Nov no longer occurs,
**`notified: (nobody)`**, sam's per-date row **gone** (orphan-prune trigger).
Alex silently loses today's session too.

**Fix:** treat a pattern or end-date change that removes dates as a
reschedule. Server-side, include `recurrence_pattern` in the guard and the
notice trigger, with a "Schedule changed" notice listing what was dropped
[DB]. Client-side, include it in Edit's confirm dialog.

## EJ-21. Notice audiences disagree with each other (L)

From the EJ-19 matrix, for ordinary attendees:
- **Savers** hear about cancellation, postponement and per-date changes, but
  not a reschedule, while Edit's dialog told the host they did (EJ-15).
  *(Corrected 2026-11-17: this said savers miss postponements too. They
  don't.)*
- The waitlist cancel trigger ignores the `event_update` opt-out that
  `cancel_event` honours.

**Fix:** folds into EJ-19's shared helper. The rule, once: going, interested,
requested, waitlist, savers, and the affected date's date-only goers, all
honouring `event_update`.

## EJ-22. Chat notifications ignore chat access; announcements arrive twice (L)

`notify_attendees_on_chat_message` targets every `going` row with no
`user_can_access_event_chat` check (`20261103120000:474-522`; not
redefined by the chat-mode migration). **Reproduced:** with one series goer
(chat locked by "two going"), the host's announcement produced
`alex [chat_message]; alex [host_announcement]`. That's two notices, one of
them for a chat alex can't open. **Fix:** gate on access, and skip the
chat notice for the announcement mirror [DB].

## EJ-23. External calendar entries go stale after a reschedule (L, [client])

"Add to calendar" writes a static Google URL or `.ics` (`EventDetail.tsx:854-916`).
After a reschedule, the notice routes to the event page, and nothing there
mentions that the time changed or offers re-adding. **Fix:** when the
latest `event_update` for this event is a reschedule, show "Time changed —
update your calendar" with the same Add action.

**Segment B/A seams checked and found fine, or already tracked:** postpone
and reschedule notices reach the waitlist, and the time/place-edit notice is
suppressed inside `reschedule_event` (`skip_update_notice`). Description-only
edits are deliberately silent. Reminders include date-only goers and skip
cancelled dates. Create → publish hand-off and preset failures (reported as
warnings, `create.tsx:727-830`) were covered by the 11-15 review. The
reminder ±5 min window is already tracked. Notification routing changed after
the 11-14 browser pass (`aafa2f9`): unit suite 10/10, browser suite
`suiteNotifications` not re-run (R5).

**Retracted during R3 (my own reading error, corrected by the repro):** the
draft matrix said waitlisted people aren't told about a cancellation.
They are, via `clear_event_waitlist_on_cancel`.

## EJ-24. Events attended only by date appear in no Joined list (L, [DB]) — found 2026-11-17

Found while writing the per-session attendance migration.
`get_user_going_events` selects from `rsvps` only, so an event someone goes to
**only** through per-date RSVPs (`rsvp_occurrences`) is in neither Joined ›
Upcoming nor › Past. With migration 7 their sessions do count in
`attended_count`, so the count and the list can disagree for these users.
**Fix:** the list's row source should also include events with a per-date
going row, upcoming or past by the same per-session rule [DB]. It is not in
the prepared set.

## Defect in Batch A1, found by R5 and fixed (2026-11-17)

`suiteAttendee` A6, the new "during the event" walk, showed the event page
header reading **"Tue, Nov 24 · Happening now"** while the running session was
on Nov 17. A1 made series "live", but the header still showed the *next* date,
because the strict walk skips a date that has started. The header now shows
the running occurrence (`occurrenceInProgress`), labelled "Date", not "Next
date", and A6 asserts the date itself, not just the words. Typecheck, 1,219
unit tests, Attendee 24/24 and B 46/46 pass after the fix.

---

## EJ-25. Waitlist offered where the server refuses it (L) — found and fixed 2026-11-17

Found while building rehearsal Phase 3. On a full event the page offered
"Join the waitlist" whenever `get_event_details` returned a `waitlist` key.
`join_event_waitlist` refuses in two cases the client never checked:
- `waitlist_mode = 'off'` (`waitlist_off`, `20261103170000:794`);
- approval mode (`approval_required`, `:789-792`), where the request queue
  replaces the waitlist.

The attendee tapped, and got an error. **Fixed** in `deriveEventViewer`:
joining requires an open waitlist, while leaving one you're on still works.
Pinned by `tests/eventViewer.test.ts` and `suiteAttendee` A8.

## What R1–R3 change downstream

- **R4 fix batch candidates.**
  - *Client-only:* EJ-1 (client half), EJ-2 + EJ-13 (one occurrence-aware
    live/ended rule), EJ-3, EJ-4, EJ-5, EJ-15/EJ-21 dialog copy, EJ-17 copy,
    EJ-23.
  - *[DB], to prepare (not apply):* EJ-1 guard; EJ-12 delete guard;
    EJ-14 move-past-end; EJ-19 + EJ-21 shared audience helper; EJ-20
    pattern-change guard and notice; EJ-22 chat notice gating; EJ-15 wording.
  - *Decisions:* EJ-7, EJ-9, EJ-14 (extend vs refuse), EJ-16, EJ-18 (with the
    existing approval decision), EJ-19 chat access for date-only goers, J2.
- **Rehearsal plan:**
  - EJ-2 blocks the Phase toggle.
  - EJ-5 folds into Phase 1.
  - EJ-3 decides the review row.
  - EJ-6 and EJ-8 confirm simulate-don't-RSVP.
  - **EJ-13 / EJ-19:** the rehearsal's per-date chips must reflect per-row
    live/ended, and simulating "going on one date" must show what a date-only
    goer actually gets (today: no chat).
