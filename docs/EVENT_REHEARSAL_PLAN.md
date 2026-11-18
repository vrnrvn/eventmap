# Event rehearsal — "Preview as attendee" for hosts — plan (2026-11-17)

**Status: proposal only. Nothing here is built.** Planned against the code at
`50a2a57`. Companion doc:
[`docs/EVENT_JOURNEY_REVIEW_PLAN_2026-11-17.md`](EVENT_JOURNEY_REVIEW_PLAN_2026-11-17.md)
(the journey review whose findings shape Phase 1 here).

**Standing constraints (owner, hard constraints from 2026-11-17):** never touch,
modify or reset the shared database directly; work only in an isolated
environment when a database is needed. Run long processes (E2E/browser suites)
only in the foreground, never in the background. Migrations are prepared as
files and validated in isolation; the owner applies them. This feature needs
no migration.

## 0. Status board

| Phase | What | Status | Waiting on |
| --- | --- | --- | --- |
| 1 | `ViewerState` seam in EventDetail (refactor, no behaviour change) | **Done 2026-11-17** | — (`utils/eventViewer.ts` + `tests/eventViewer.test.ts`; verified no behaviour change: Attendee 24/24, B 46/46, Privacy 15/15, 1,232 unit tests) |
| 2 | Rehearsal core: role swap, simulated RSVP state machine, write interception, banner, owner-only gating, ManageEvent entry | **Done 2026-11-17** | — (`utils/rehearsal.ts`, `components/RehearsalBanner.tsx`, EventDetail + ManageEvent wiring; `tests/rehearsal.test.ts` 11, `suiteRehearsal` 36/36 with a zero-write check per tap; see §9) |
| 3 | Scenarios: Phase (upcoming / day of / live / ended) and Fullness toggles; per-date chips | **Done 2026-11-17** | — (virtual clock `scenarioNow` + spots override in `utils/rehearsal.ts`; collapsible panel in `RehearsalBanner`; "You (preview)" in faces and list; `suiteRehearsal` 58/58; see §10) |
| 4 | Chat dress, playbook + published-sheet entries, a11y/haptics polish | **Done 2026-11-17** | — (read-only chat preview; checklist item "Walk through it as a guest"; "Preview as a guest" on the published sheet; collections gap closed; same-day cue; `suiteRehearsal` 76/76; see §11) |
| 5 | Evidence: `suiteRehearsal` (incl. zero-mutation assertion), unit tests, manual draft pass | **Done 2026-11-17 (agent part)** | Left for the owner: the axe engine pass (`axe-core` not installed) and a device pass with a draft. `suiteRehearsal` 108/108 (V1–V22); see §12 |

**Status (2026-11-17): Phases 1–5 done — shipped in the working tree,
uncommitted.** Only owner items remain (§12). Earlier note: **Ready to start (2026-11-17).** The journey review is complete. The fixes
rehearsal needed first (EJ-2, EJ-4, EJ-5, EJ-13) are in the app. Its server
halves (Batch B) are prepared, not applied, and rehearsal does **not** depend
on them: it is a client-only simulation and needs no migration. One thing to
mirror once Batch B is applied: date-only attendees get the chat (EJ-19,
migration 4). Rehearsal's "going on one date" scenario should follow whichever
rule the server is on at the time, which is the same `eventChatAccess`
inputs as Batch C2. Nothing in this plan is built yet; Phase 1 is next.

---

## 1. The problem

A host cannot see their own event the way an attendee does. When the owner
opens `/event/<id>`, `isOwner` (`screens/EventDetail.tsx:243`) flips the whole
page into the owner view:

| Element | Host sees | Attendee sees |
| --- | --- | --- |
| Join bar (Join / Leave / Interested / Waitlist) | **not rendered** (`:1952`) | shown |
| Chat row | "Manage chat" (`:1578`) | attendee chat row (`:1513`) |
| Per-date Go / Can't go chips (series) | hidden (`:1704`) | shown |
| Follow chip, Report, Write a review | hidden (`:1644`, `:1855`, `:1881`) | shown |
| "Event ended" notice + review prompt | hidden (`:1818`) | shown |
| Insights banner + "Manage event", draft/unlisted notices | shown (`:1829`, `:1263`) | hidden |

Worse, ManageEvent's "Preview page / View public page" row
(`screens/ManageEvent.tsx:1258-1263`) promises "See the event the way
attendees do" — and then opens exactly this owner view. The promise is
currently false; it is also the natural entry point for the real feature.

The playbook/checklist (`utils/eventPlaybook.ts`) tells the host *what* to
prepare but never lets them *experience* the result. Rehearsal closes that
loop: walk the page as a joiner, watch the states change across the event's
life, and catch problems (missing arrival info, confusing copy, chat locked
when they expected it open) before real attendees do.

## 2. Design decision: simulate, don't RSVP

Two ways to let a host "be an attendee" were examined. **Chosen: a
client-only simulation.** The real-RSVP route is rejected, with the evidence:

- The DB permits a host RSVP (`rsvps` has no owner guard;
  `docs/ISSUES.md` "Decided 2026-11-08" keeps it that way), **but** a real
  "going" row from the host:
  - takes a real seat — `join_event_with_capacity`
    (`20261103170000:138-213`) has no owner exemption, so the host can
    trigger `EVENT_FULL` for real attendees;
  - counts in `rsvp_count`, `event_rsvp_counts`, `get_event_host_overview`,
    `get_host_events_counts`, `rsvp_history`, `get_event_insights`, and the
    public "Who's going" list (`get_event_attendees_page`);
  - can unlock chat for one other attendee (the default rule needs two going,
    `user_can_access_event_chat`, `20261103160000:59-83`);
  - subscribes the host to attendee reminders (`send_event_reminders` does
    not exclude the host, `20261109150000:312-380`) and to the notices for
    their own cancel/reschedule/announcements;
  - in approval mode becomes a `'requested'` row the host must approve
    themselves (`guard_rsvp_approval`, `20261103170000:48-98`).
- **Drafts cannot be RSVP'd at all** — `event_is_open_for_rsvp` requires
  `publish_state = 'published'` (`20261103150000:103-117`), and only the
  owner can read a draft, so even a second test account cannot preview one.
  Rehearsing a draft before publishing is one of the main points of the
  feature; only a simulation can do it.

Undoing all of that server-side would mean owner-exemptions in ~6 count RPCs,
the capacity trigger, the reminder loop and several notification triggers —
a migration-heavy project that buys nothing a simulation doesn't. A
simulation needs **no migration at all**, which also fits the standing
constraints.

A second rejected idea: a "sandbox clone" of the event (create a hidden copy,
join it for real). It doubles every row the dashboards count, needs cleanup,
and still can't rehearse the *actual* event's chat or dates.

## 3. The feature

### 3.1 Entering rehearsal

- Route: the existing `/event/<id>` with a `rehearse=1` param, honoured
  **only when the viewer is the owner** (checked against the same
  `isOwner` derivation; for anyone else the param is ignored).
- Entry points:
  1. ManageEvent's existing "Preview page" row — repointed, so its copy
     finally becomes true. Keep a secondary "View as owner" link for the old
     behaviour.
  2. A playbook item in the **before** stage ("Walk through your event page
     as an attendee"), using the existing `PlaybookTarget` →
     `handlePlaybookAction` routing (`ManageEvent.tsx:1050`). It can be a
     derived tick: done once rehearsal has been opened for this event
     (device-local, same pattern as other local ticks).
  3. `EventPublishedSheet` after publishing ("See it as attendees will").
- Naming: **avoid "preview"** — `isPreview` / `blockedByPreview` /
  `utils/eventPreview.ts` already mean "placeholder data while loading"
  inside EventDetail, and `EventPreviewSheet` means the static publish card.
  The internal name is `rehearsal`; UI copy is decision D3 (§6).

### 3.2 What rehearsal shows

A persistent banner pins the mode ("Rehearsal — you're seeing this page as
an attendee. Nothing you do here is saved."), with an exit button back to the
owner view / ManageEvent.

Inside the mode the page renders the **attendee** column of the table in §1:
join bar present, owner banners gone, attendee wording for postponed/
cancelled, Follow/Report/Review rendered but inert (§3.4).

**Simulated RSVP state.** Tapping Join/Interested/Leave/Waitlist drives a
local state machine instead of `services/social.ts`:

```
none → interested → none
none → going → (leave confirm, with its real "you lose chat access" copy) → none
none → requested (when approval mode is on) → …
none → waitlist (when the event is full) → …
```

Transitions reuse the real UI pieces — button label chain
(`EventDetail.tsx:2013-2047`), leave confirmation (`:742-759`), waitlist copy
(`:670-713`), the post-join "Add to calendar" prompt (rendered, not fired) —
so the host sees exactly the flow an attendee gets, including the states
their own settings produce (approval mode → "Request to join"; capacity
reached → waitlist).

**Scenario toggles** in the banner (small chips), because the point is to
rehearse the *flow*, not one frame of it:

- **Phase:** Upcoming · Day of · Happening now · Ended. Overrides the derived
  `hasEventEnded` / `isEventInProgress` inputs so the host can see the
  "Happening now" label, then the ended notice, review prompt and the chat
  row disappearing (`:1513`, `:1818-1827`). Known issue to coordinate with
  the review: `isEventInProgress` is always false for recurring series
  (`utils/eventStatus.ts:44`), so "Happening now" must be fixed or the
  toggle will rehearse a state series never actually show.
- **Fullness:** Spots left · Full (waitlist). Overrides the count inputs so
  `eventFull` / `canWaitlist` flip.
- For series: the real five-date list with its per-date chips (`:1694-1747`),
  driven by the same simulated store keyed per date.

Scenario state is in-memory only — leaving rehearsal discards it.

### 3.3 Chat in rehearsal

The host can already read any of their event's chats (host/admin bypass in
the RLS, `20261106160000:191`), so the attendee chat row navigates to the
real chat screen **in read-only rehearsal dress**: composer replaced by a
"Rehearsal — attendees with access can post here" bar, no presence/typing
emitted, no `markRead`. What the row itself shows must follow the real
access rule for the *simulated* attendee (`utils/eventChatAccess.ts`):
e.g. with the default policy and one real attendee, a simulated "going"
makes two — the row explains "chat unlocks when 2 people are going", which
is itself useful rehearsal information. Depth of chat simulation is
decision D2 (§6).

### 3.4 What rehearsal must never do

Every network write is intercepted at the handler level (the same shape as
the existing `blockedByPreview` guards, `EventDetail.tsx:123-143`):

- No RSVP / waitlist / per-date RPC, no `rsvps` or `rsvp_occurrences` rows.
- No Follow, Report, Review submission — the controls render, a tap explains
  they're disabled in rehearsal (so the host still sees that attendees have
  them).
- No calendar app launch, no `.ics` share, no `invalidateLists` on the
  joined/calendar caches.
- Tracking: `track_event_view` / `track_event_interaction` already skip the
  owner server-side (`20261029110000:566`, `20261104090000:39-68`) — no
  extra work, but the suite should pin it.
- The 20 s count poll and `event_rsvp_counts` realtime subscription
  (`EventDetail.tsx:460-503`) keep running — real counts stay honest under
  the simulated overlay — except when a Fullness override is active.

A regression check asserts **zero mutating requests** during a full
rehearsal walk (the fake-backend harness can count POST/PATCH/DELETE).

## 4. Implementation shape

EventDetail is 2,969 lines and derives host-vs-attendee behaviour in ~12
scattered `isOwner` / `user_rsvp` conditionals (§1). Hacking a `rehearse`
flag into each would make the file worse and the mode fragile.

**Phase 1 — the viewer seam (refactor, no behaviour change).** Extract one
derived object, e.g.

```ts
type ViewerState = {
  role: 'owner' | 'attendee' | 'visitor'
  rsvp: 'none' | 'interested' | 'going' | 'requested'
  waitlist: { on: boolean; position?: number }
  phase: 'upcoming' | 'live' | 'ended' | 'postponed' | 'cancelled' | 'draft'
  full: boolean
  // …the inputs the 12 split points actually read
}
```

computed in one place (a `useViewerState(details, user, userBusiness)` hook,
unit-testable in isolation), with every render split reading from it instead
of raw `isOwner` / `details.user_rsvp`. Pinned by unit tests on the hook and
the existing browser suites (no visual change expected). This is also the
seam several journey-review findings want (the "Manage chat" row gated on
`user_rsvp !== 'going'` inconsistency; the review-button eligibility
mismatch), which is why the review runs first.

**Phase 2 — rehearsal core.** A `RehearsalController` (context or hook) that,
when active, (a) substitutes the simulated `ViewerState`
(`role: 'attendee'`, simulated rsvp/waitlist), (b) exposes the state-machine
transitions the join-bar handlers call instead of `social.ts`, (c) supplies
the write-interception wrapper. Banner + entry/exit + the ManageEvent row
repoint + owner-only gating.

**Phase 3 — scenarios.** Phase and Fullness overrides; per-date simulated
chips for series; the rendered-but-inert Follow/Report/Review and the
calendar prompt.

**Phase 4 — chat dress + playbook/published-sheet entries + polish** (haptics
on simulated join via `utils/haptics.ts`, a11y: banner as live region, mode
announced, all chips ≥44 px, `FontScaleCaps` where the bar already uses it).

**Phase 5 — evidence.** New `scripts/fake-backend-e2e/suiteRehearsal.mjs`:
enter from ManageEvent, join/leave/waitlist walk, approval-mode walk, phase
toggles, series chips, the zero-mutations assertion, non-owner gets no mode;
unit tests for the state machine and `useViewerState`; a short manual pass on
a draft event (the case only this feature can reach).

**No migration in any phase.** Nothing server-side changes.

## 5. Explicitly out of scope (v1)

- Rehearsing the *unsaved* Create form (no event id; `EventPreviewSheet`
  keeps that job with its static card).
- Simulated *other* attendees (fake roster, fake chat traffic).
- Posting in chat as a simulated attendee.
- Rehearsing push notifications/reminders (server-sent; would need real rows).
- A second real "test attendee" account flow.

## 6. Decisions for the owner **[decision]** — DECIDED 2026-11-17

The owner delegated all four to the recommendations below ("go with your
suggestions"): **D1** Phases 1–3 ship together · **D2** read-only dressed
chat · **D3** "Preview as attendee" · **D4** rehearsal as the ManageEvent
row's primary action, "View as owner" secondary. Kept as written for the
rationale:

- **D1 — v1 scope:** ship Phases 1–2 alone first (role swap + join
  simulation), or hold for Phase 3's scenario toggles? Recommendation:
  1–3 together — the phase toggle is most of the "rehearse the flow" value.
- **D2 — chat depth:** read-only dressed chat (§3.3, recommended) vs. just an
  explanatory row with no navigation.
- **D3 — UI naming:** "Preview as attendee" (recommended; matches the
  existing row's promise) vs. "Rehearsal mode" vs. "View as attendee".
- **D4 — ManageEvent row default:** rehearsal as the row's primary action
  with "View as owner" secondary (recommended), or two equal rows.

## 7. What the journey review (R1–R3) changed (2026-11-17)

Findings in [`docs/EVENT_JOURNEY_REVIEW_2026-11-17.md`](EVENT_JOURNEY_REVIEW_2026-11-17.md):

- **EJ-2 blocks Phase 3's "Happening now" toggle for series.** Today no
  series is ever live, the host's checklist drops to lead-up mid-session, and
  only Host Dashboard computes live per occurrence. Fix EJ-2 first, or ship
  the Phase toggle for one-off events only.
- **EJ-5 folds into Phase 1.** The `ViewerState` seam should gate "Manage
  chat" on role alone. Today a host holding a going RSVP gets no chat row
  at all.
- **EJ-3 decides the rehearsal review row.** Once eligibility is known,
  rehearsal should show what an attendee *at that phase* would see: the
  reason line before attending, the button after.
- **EJ-4.** If rehearsal's chat dress (§3.3) reuses the chat screen, the
  screen must use `eventChatAccess` first. Otherwise an "off" chat rehearses
  the wrong "waiting for one more attendee" copy.
- **EJ-6 / EJ-8 confirm §2.** A real host RSVP becomes a self-request in
  approval mode and subscribes the host to attendee reminders. Simulation
  avoids both.
- **EJ-10:** confirmed. The ManageEvent row is the entry point as planned.

Added after R2/R3:

- **EJ-13: per-date chips need per-row state.** Today a finished session
  still shows "Go". Phase 3's series chips should come from the same
  occurrence-aware rule as EJ-2 (live while running, ended after), so the
  fix lands once and rehearsal reads it.
- **EJ-19: simulating "going on one date" must be honest.** A date-only
  attendee gets no chat access and no lifecycle notices today. Until EJ-19
  is fixed, rehearsal should either show exactly that (chat row: "Join the
  series to chat"), or hide the one-date path. It must not imply access the
  real attendee lacks.
- **EJ-16: "You attended" for series.** The Phase toggle's *Ended* scenario
  must use the attendance rule the owner decides on. Today an open-ended
  series never reaches "ended" at all, so the scenario is one-off-only
  until EJ-16 is settled.
- **EJ-12:** no change needed. Rehearsal never writes, so a simulated Leave
  after the end can't trigger the misfiring server path.

## 9. Phase 2 as built (2026-11-17)

How it works, for whoever picks up Phase 3:

- **Entry and gating.** `/event/<id>?rehearse=1`, honoured only when the
  signed-in user's business owns the event (`ownsEvent` in EventDetail);
  anyone else gets the normal page and real actions (V7). The entry point is
  ManageEvent's "Preview as attendee" row (D4), with "View as owner" below it.
- **One seam, as planned.**
  - `rehearsalDetails(real, sim)` is the page data as the simulated guest
    sees it: their RSVP / saved / following, counts moved by them, a waitlist
    place after the real line, and a draft shown as published.
  - The render region reads it through `pageDetails`. The Phase 1 viewer is
    derived from it with no business, so `isOwner` is false and every
    host-only control disappears without touching the render conditions.
- **Writes.** Every write handler branches at the top to a pure transition
  in `utils/rehearsal.ts` (join, interested, leave, request, waitlist
  join/leave, per-date chips, save, follow). Each one mirrors the server's
  answer and reuses the real screen's words: "Request sent…", "You're
  #2 on the waitlist…", the post-join "Add it to your calendar?" prompt
  and the leave confirmation.
- **What isn't simulated.** Calendar export, reporting the event or a
  review, posting a review, the chat row and "Add to collection" say what
  an attendee could do there and do nothing (`REHEARSAL_NOT_SAVED`).
- **No tracking.** View, share, ticket, directions and calendar tracking are
  skipped in preview.
- **Works offline.** The preview branch runs before the offline guard,
  since nothing needs the network.
- **Evidence.** `suiteRehearsal` asserts no POST/PATCH/DELETE to any table
  and none of the write or tracking RPCs, after every tapping scenario
  (V1–V6); a non-owner's Join is still real (V7).

Gaps noted while building it, for later phases:

- **Attendee sheet.** The going count includes the simulated guest, but the
  "Who's going" sheet doesn't list them. Phase 3 could add a "You
  (preview)" row.
- **Review eligibility** in preview uses the server's rule as it is today
  (going + started). After Batch B migration 7 / EJ-3's series nuance, revisit
  for series.
- **The chat row** explains instead of opening the chat: that is Phase 4's
  dressed, read-only chat.
- **Phase 4 entry points** are not added yet: the playbook item and the
  published sheet.

## 10. Phase 3 as built (2026-11-17)

**Scenarios, behind a collapsible "Scenario" control in the banner.** There
are two radio groups:
- **When:** Right now · Days before · Day of · Happening now · Ended.
- **Spots:** As it is · Spots left · Full.

When anything isn't real, the collapsed banner says so ("Simulating: Ended ·
Full"), so a simulated state is never mistaken for the real one. Each choice
is announced to screen readers.

**"When" is a virtual clock, not edited event dates.** `scenarioNow` puts
"now" before, during or after the event (or, for a series, around its
running or next date). The page's time-based decisions all read that one
value:
- the viewer derivation (live, ended, the header date)
- review eligibility
- the series date rows
- every simulated join, which is refused with the real "This event is over"
  copy after the end

Only the reference date is moved by it; the event's own dates are never
changed, so they always display correctly. Two scenarios are hidden where
they make no sense:
- "Ended" for an open-ended series, which never ends (EJ-16).
- "Happening now" for a cancelled event.

**"Spots".** "Full" takes every seat, and invents a limit at today's count
when the event has none. "Spots left" frees one seat on a genuinely full
event. A guest who already joined keeps their seat either way.

**The simulated guest is visible.** Once going, they appear among the faces
and first in "Who's going" as "You (preview)", not tappable (this closes
§9's first gap).

**Fixed in passing:**
- **EJ-25** (`docs/ISSUES.md`): the real page offered "Join the waitlist"
  on a full event whose host had switched the waitlist off, or that takes
  requests, and the server then refused. The viewer seam now requires an
  open waitlist to *join*; leaving one still works.
- The guest's face rendered as **"Y("**, because Avatar initials take each
  word's first character of "You (preview)". The face is named "You".

**Observation (no decision needed to ship):** "Day of" looks the same as
"Days before" on a one-off, because the attendee page has no same-day cue
such as "Today · starts in 2 h". The preview is faithful; the page itself
doesn't change on the day. A day-of cue would be a small product
improvement.

## 11. Phase 4 as built (2026-11-17)

- **Read-only chat preview (D2).**
  - **Entry:** in the preview, the attendee chat row opens
    `/event-chat/<id>?rehearse=1`, and only when the simulated guest has
    access by the real rule (going, and the two-going unlock). Otherwise the
    row stays locked with its reason (V15).
  - **What the host sees:** the chat as an attendee does. Moderation tools
    are off, and the composer is replaced by a bar ("Preview as attendee —
    this is the chat guests see…") with Back.
  - **Nothing leaves the device:** no read marker, no presence or typing
    (`participate: false`), no host tip. Mute and reporting explain
    themselves instead of sending.
  - **Gate:** kept while the server confirms the viewer hosts the event
    (`postStatus.is_host`). The side effects are suppressed from the first
    render, because the guard starts from the URL. A non-owner's
    `?rehearse=1` link is the normal chat (V17).
- **Entry points.**
  - The checklist's **"Walk through it as a guest"** (before publishing and
    in the lead-up) opens the preview and ticks itself on this device. It can
    also be ticked by hand, for a host who previewed elsewhere. It isn't
    offered on the unsaved Create form, where there is nothing to preview.
  - The published sheet's **"Preview as a guest"**.
  - Both join D4's Manage event row.
- **Gap found and closed.** The event page's own **"Add to collection"**
  (and the bookmark long-press) opened the real collections sheet in
  preview. That sheet creates collections and pins events, which are writes.
  Both now explain instead, and the sheet is never handed an event while
  previewing (V18).
- **Same-day cue** (owner decision). The header now reads "Today · in 3 h",
  "Starts in 40 min" or "Tomorrow". The preview's virtual clock drives it, so
  "Day of" finally differs from "Days before" (V19).
- **Fixed in passing.**
  - My Phase 2 banner imported icons straight from `lucide-react-native`,
    against the repo rule (`scripts/generate-icons.mjs`: always
    `@/components/icons.generated`). Fixed, and the generator re-run with no
    diff.
  - The fake backend's chat status always says `is_host: false`. Owner
    scenarios now say `true`, as the real server does.

## 12. Phase 5 as built, and what remains (2026-11-17)

**Layout and accessibility sweep.** `suiteRehearsal` V20–V22 check the
banner with its Scenario panel open, and the chat preview, at a real 320 px
and 390 px and at 1.3× / 1.6× text:
- no horizontal overflow and no clipped text;
- every control named, at least 44 px, and inside the screen.

**Found while building it:**
- **The harness never rendered below 500 px** (EJ-26, `docs/ISSUES.md`).
  Headless Chrome clamps the window size. Fixed in `harness.mjs` with
  device-metrics emulation.
- **At a real 320 px the banner squeezed its title** to one word per line.
  The Scenario and Exit controls now wrap together under the title when
  space runs out (one row at 390 px).
- **The event page cut the locked-chat reason** to one line. It may now
  wrap.

**Final suite:** 108/108, with every tapping scenario asserting nothing was
written.

**Remains (owner):**
- **A device pass:** open a draft with "Preview as attendee", try join /
  leave / waitlist and each scenario, and open the chat preview with
  VoiceOver or TalkBack.
- **The axe WCAG engine pass,** once `axe-core` is installed.

**After the owner applies the prepared migrations:** the preview should
follow two server changes:
- date-only goers get chat (Batch C2, through the same `eventChatAccess`
  inputs);
- review eligibility for series (Batch D2).

## 8. Dependencies and sequencing

1. The journey review first
   ([`docs/EVENT_JOURNEY_REVIEW_PLAN_2026-11-17.md`](EVENT_JOURNEY_REVIEW_PLAN_2026-11-17.md)):
   its findings in EventDetail/chat (series "Happening now", chat-rule
   duplication, review-button eligibility) should be fixed or at least
   triaged before rehearsal simulates those states, so the rehearsal shows
   the *intended* behaviour, not today's bugs.
2. Phase 1 (viewer seam) doubles as the fix surface for several of those
   findings — one refactor serves both.
3. Phases 2–5 are client-only and independent of any migration window.
