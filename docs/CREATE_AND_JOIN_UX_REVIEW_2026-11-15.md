# Create & join — UI/UX review, 2026-11-15

A read-only review of the two journeys that carry the product: **creating an
event** (`app/(tabs)/create.tsx`, `components/EventExtrasFields.tsx`,
`components/EventPreviewSheet.tsx`, `components/EventPublishedSheet.tsx`) and
**joining one** (`screens/EventDetail.tsx`, `components/DiscoverEventCard.tsx`).
Nothing was changed. Every finding names the file and line it was read at.

Items already tracked in `docs/ISSUES.md` are marked **[tracked]** and are
repeated here only where this journey makes them concrete; they are not new.

**Status (2026-11-15, end of day).** Every finding is resolved: phases 0, 2, 3
and 7 fixed **J1, J3, J4, J5, J6, J7, J8, J9, C1, C2, C3, C4, C5, C7, C8, C9**;
**C6 was withdrawn** (already implemented — see the finding); **J2** stays a
filed decision; **C10**'s font-scaling half got a targeted pass (below) and
its other items remain tracked in `docs/ISSUES.md`. Everything else is open and sequenced in
`ROADMAP.md` → "Planned: event comparison + create/join UX". Verification
after phase 2: typecheck clean, 1,103 unit tests, lint 0 errors / 7 warnings
(unchanged baseline), `suiteHost` 92/92 and `suiteHostUi` 174/174 (44 px
targets, overflow and clipped labels at 320 and 390 px) against the fake
backend.

---

## What is already good (so it does not get "improved" away)

- **Draft recovery in Create.** The form autosaves and restores with a toast
  carrying a "Start over" action (`create.tsx:225-240`). A restored venue is
  protected from being overwritten by the business address.
- **Duplicate-publish safety.** Idempotency key per form session, an
  uncertain-create set, and a recovery lookup after a lost response
  (`services/events.ts:19-31, 262-307`). The button also locks before the
  first network call (`create.tsx:612-615`).
- **Failure isolation at publish.** The event row is created first; photos and
  links fail non-fatally and are reported rather than rolling the event back
  (`create.tsx:645-712`).
- **Validation that respects screen readers**: a spoken summary plus a scroll
  to the first failing section (`create.tsx:588-602`).
- **The whole waitlist path.** Position shown, auto-join when a spot opened
  between render and tap, honest copy about notification
  (`EventDetail.tsx:670-713`).
- **Leaving is confirmed with its real consequence** — losing chat access —
  and the interested-star still toggles silently (`EventDetail.tsx:742-759`).
- **The join bar is a fixed bottom bar** at 58 px (`EventDetail.tsx:1936`,
  styles `:2795-2850`), so the primary action is always reachable.
- **Time-zone honesty** on the event page: the event's zone plus a "your time"
  line and a date shift when the day differs (`EventDetail.tsx:1326-1346`).

---

## Findings — joining

### J1. The Join button gives no feedback while the request is in flight — FIXED 2026-11-15
`EventDetail.tsx:1970-2026`; `saving` is set at `:597`.

While the RSVP round trip runs, the button is disabled but its label, colour
and icon are unchanged, there is no spinner, and no `busy` state is exposed —
`a11yState({ disabled })` is the only state sent (`:1977-1981`). On a slow
connection the tap looks ignored. The re-entry guard at `:596` means a second
tap is harmless, but the user does not know that.

**Fix:** spinner or "Joining…" in the label, plus `a11yState({ busy: true })`.
Small, and it is the single most-pressed control in the app.

### J2. Joining is not optimistic, while saving is
`EventDetail.tsx:599-621` (awaits the server, then sets state) vs.
`:766-769` (optimistic flip with rollback).

Two adjacent controls on the same screen behave differently under latency.
Either make the RSVP optimistic with the same rollback, or accept the wait and
fix J1 — but the inconsistency is the part worth deciding.

### J3. No haptic anywhere in the join flow — FIXED 2026-11-15
`utils/haptics.ts` exists and is deliberate ("use these instead of calling
expo-haptics directly"), yet it is imported in exactly two files:
`app/(onboarding)/index.tsx` and `screens/HostSetup.tsx`.

Joining, leaving, joining a waitlist and publishing are precisely the moments
a confirmation tap belongs. `notificationAsync` on success, `selectionAsync`
on the interested toggle.

### J4. Joining succeeds silently — FIXED 2026-11-15
`EventDetail.tsx:599-622`. Only the `requested` branch notifies
(`:601-603`). A plain "going" produces no toast and no next step — the state
change is visible, but nothing invites the two things a new attendee actually
wants: the calendar entry and the chat.

**Fix:** `notify.withAction('You're going — add to calendar?', …)`, which
already exists and is used for draft restore (`create.tsx:234`). A fuller
version is a post-join sheet mirroring `EventPublishedSheet` for hosts; that
is a bigger call.

### J5. "Event Joined" is a dead-end label — FIXED 2026-11-15
`EventDetail.tsx:2013-2014`. Once going, the primary button reads "Event
Joined" and is disabled; the way out is a separate "Leave" button beside it
(`:2045-2055`). The disabled primary reads as a status, not a control, and
VoiceOver reaches the state before the action.

**Fix:** "You're going ✓" as a status row, with the primary slot given to the
next useful action (open chat / add to calendar), or keep the layout but say
"You're going · tap Leave to cancel".

### J6. "Interested" is an unlabelled icon — FIXED 2026-11-15
`EventDetail.tsx:2057-2077` — an icon-only star. Its meaning is carried by the
hint line below (`:2081-2091`), which renders only when
`user && !eventClosed && !hasJoinedEvent`. The accessibility label is correct;
the *visual* affordance is not self-describing.

**Fix:** a labelled pill ("Interested") at the same height, or keep the icon
and always show the one-line explanation.

### J7. Secondary chips are below the 44 px touch target — FIXED 2026-11-15
`EventDetail.tsx:2400-2410` — "Google Calendar", ".ics file" and "Add to
collection" share `calendarChoiceBtn`: `paddingVertical: 8` on a 14 px/≈18 px
line ≈ **34 px**, with no `hitSlop`. The "Get tickets" link (`:1369-1379`) is
smaller still but does carry a 6 px `hitSlop`.

The repo asserts 44 px elsewhere (`suiteHostUi`, `suiteA11y`), so this is an
inconsistency rather than a new standard. `minHeight: 44` or a `hitSlop` fixes
it without changing the look.

### J8. A decision cannot be made from the list — FIXED 2026-11-15
Discover cards carry no save and no join (`components/DiscoverEventCard.tsx`);
every comparison between two events costs: open → read → back → open → read →
back. **[tracked]** as "Discover/search cards have no bookmark" (ISSUES, Low) —
noted here because it is the strongest argument for
`docs/EVENT_COMPARISON_PLAN.md`, and because a save control on the card is a
smaller fix than the comparison feature and helps immediately.

### J9. Approval mode tells the attendee nothing about timing — FIXED 2026-11-15
`EventDetail.tsx:2001-2002` — "Request pending · host will review". No
expectation of how long, no way to nudge, no notification promise in the UI
(the server does notify). One line ("Hosts usually reply within a day; you'll
get a notification") would carry it.

---

## Findings — creating

### C1. The submit actions sit at the bottom of a nine-section scroll — FIXED 2026-11-15
`create.tsx:1417-1452`. Publish, Preview and "Save as draft" are three stacked
full-width buttons at the end of the content, inside the ScrollView. The event
page proves the app can do better: its action bar is `position: 'absolute'` at
the bottom (`EventDetail.tsx:2795`).

Consequences: a host cannot preview without scrolling to the end; the
"Drafts are private and free" hint (`:1450`) is seen last, when it is most
useful early; and three equal-width buttons flatten the hierarchy of one
primary action.

**Fix:** sticky footer bar with the primary Publish, Preview as a secondary
beside it, "Save as draft" demoted to a text action or the header.

### C2. No sense of how far along the form is — FIXED 2026-11-15
The sections are labelled and the first-event guide numbers three steps
(`create.tsx:958-971, 986-988, 1050-1052, 1267-1269`), but the form has nine
sections and the guide only covers three of them. Nothing shows which required
fields are still missing until Publish is pressed (`:588-602`).

**Fix:** either a slim progress summary in the sticky bar ("2 required fields
left") or a tick on each section label as it validates. The validation logic
already exists and is pure enough to run live (`:533-582`).

### C3. The most decision-relevant fields are hidden under "More options" — FIXED 2026-11-15
`create.tsx:1343-1380` → `components/EventExtrasFields.tsx`. Price, tickets,
age and accessibility are all behind a collapsed row that defaults to closed
(`showExtras` initial `false`, `:348`).

Price is the attribute attendees filter on hardest, and it is one tap deeper
than "Max attendees". The predictable outcome is that most events publish with
no price at all — which is exactly what makes a comparison view weaker (see
`docs/EVENT_COMPARISON_PLAN.md` §3.3).

**Fix:** promote price (and the tickets link) into the main form, or at
minimum put a "Free / Paid" choice inline with an auto-expand into the
details. Keep age/accessibility/what-to-bring where they are.

### C4. Price is free text with no structure — FIXED 2026-11-15 (the cheap fix; D3 still open)
`EventExtrasFields.tsx:66-73` — one 60-character string, placeholder
"Free · €12 at the door · From $20". Nothing can sort, filter or compare it.

**Fix, cheap:** a one-tap **"Free"** chip that writes the canonical label.
Most events are free, and it makes the common case machine-readable with no
migration. **Fix, proper:** numeric `price_min` / `currency` / `is_free`
columns — **[DB]**, decision D3 in the comparison plan.

### C5. The age chips are 36 px tall — FIXED 2026-11-15
`EventExtrasFields.tsx:156-160` — `minHeight: 36`, no `hitSlop`. Same class of
issue as J7. The radio semantics around them are correct
(`:76-92`).

### C6. The cover photo can only be chosen by reordering — WITHDRAWN 2026-11-15
`create.tsx:1399-1414` — "First image becomes the cover photo", with no
explicit "Set as cover" action; the only way is drag-to-reorder, whose native
and web behaviour is **[tracked]** as untested on a device (ISSUES, device
list item 7).

**Fix:** a "Cover" badge on the first image and a "Make cover" action on the
others. It also removes the dependency on a gesture that has never been
verified on a phone.

**Withdrawn 2026-11-15 — this already exists.** `components/ImagePickerButton.tsx`
has the "Cover" badge on the first photo, a "Cover" button on every other
photo (`handleMakeCover`, `:143`) and a `makeCover` accessibility action
(`:439`). The review read only Create's hint ("First image becomes the cover
photo") and did not open the picker. The one real gap was that the hint hid
the control; it now reads "Tap Cover on another photo to make it the cover,
or drag to reorder."

### C7. The time-zone row leads the Date & Time section — FIXED 2026-11-15
`create.tsx:1054-1071`. A three-line explanation about zones sits above
"Starts" and "Ends", so the two fields every host needs are pushed down. The
copy itself is good; the placement is not. Below the two pickers, as a single
compact line, would cost nothing.

### C8. The guided first-event card competes with the form — FIXED 2026-11-15
`create.tsx:942-971` renders a card of three numbered steps plus a footnote
above the first field, then the same three steps repeat as inline hints inside
the sections (`:986-988, 1050-1052, 1267-1269`). For a first-time
host that is the right content twice. Dropping the card to a single line
("Three things matter: title, time, place — details below") and keeping the
inline hints would shorten the first screen considerably.

### C9. Publishing has no haptic and no confirmation beyond the sheet — FIXED 2026-11-15
Same root as J3. `EventPublishedSheet` is a good moment
(`create.tsx:1479-1500`); a success haptic belongs with it.

### C10. Known, still open **[tracked]**
- The publish preview is taller than a 320 px phone's viewport even after
  playbook P7 (ISSUES, Low). A real fix is a segmented preview, not another
  reorder.
- `maxFontSizeMultiplier` / `allowFontScaling` are set **nowhere** in the app
  (ISSUES, contrast/scaling leftovers). Create is the most form-dense screen
  and `DiscoverEventCard` truncates its title at `numberOfLines={1}`
  (`DiscoverEventCard.tsx:76`), so both journeys degrade at large text. Never
  tested.
- Design-token literals: `app/(tabs)/profile.tsx` (87) and
  `screens/EventDetail.tsx` (58) lead the audit
  (`node scripts/design-token-audit.mjs`).

---

## Ranked shortlist

If only a few things get done, do them in this order.

| # | Finding | Why first | Rough effort | Status |
| --- | --- | --- | --- | --- |
| 1 | J1 in-flight state on Join | Most-pressed control; looks broken on a slow link | 30 min | **Done** |
| 2 | C1 sticky Create action bar | Unblocks Preview and fixes the action hierarchy | 1–2 h | **Done** |
| 3 | J7 + C5 44 px targets | Consistency with a standard the repo already asserts | 30 min | **Done** |
| 4 | C3 + C4 price out of "More options" + a Free chip | Improves every downstream surface, including comparison | 1–2 h | **Done** |
| 5 | J4 post-join next step | Converts a join into a calendar entry and a chat visit | 1 h | **Done** |
| 6 | J3 + C9 haptics | The util exists and is unused on the two key actions | 30 min | **Done** |
| 7 | C2 required-field progress | Fewer refused publishes | 2–3 h | **Done** |
| 8 | C6 explicit cover choice | Removes reliance on an unverified gesture | 1–2 h | **Withdrawn** — already built |
| 9 | J5 / J6 join-state copy and the interested affordance | Clarity; needs a copy decision | 1–2 h | **Done** |
| 10 | J9 approval-mode expectation line | One line | 15 min | **Done** |

Larger and deliberately not ranked here: `maxFontSizeMultiplier` across the
app, the publish-preview redesign, and a save control on Discover cards (J8) —
each is its own piece of work and each is already tracked.

---

## What phase 0 actually changed (2026-11-15)

- **J1** `screens/EventDetail.tsx` — the Join button now says what it is doing
  ("Joining…", "Joining waitlist…", "Updating…"), shows a spinner in place of
  its arrow, and carries `aria-busy`. The label it announces while saving is
  "Saving your RSVP" rather than the stale idle label.
- **J3 / C9** `utils/haptics.ts` is now used where it was always meant to be:
  `successHaptic()` on a confirmed RSVP, a sent request, a waitlist join and a
  publish; `selectionHaptic()` on the interested toggle and on leaving. No-ops
  on web, so nothing changes in the browser suites.
- **J4** A confirmed "going" raises a toast with an **Add** action that opens
  the calendar flow (`notify.withAction`, the same pattern Create uses for
  draft restore). The approval branch now also sets an expectation rather than
  just confirming receipt.
- **J7 / C5** `minHeight: 44` on the event page's calendar/collection chips and
  on the age chips in `EventExtrasFields`.
- **J9** A pending request gets its own hint line ("The host usually replies
  within a day…"). It previously fell through to "Not sure yet? Tap the star",
  which is not what someone waiting on a host needs to read — that fall-through
  was found while fixing the finding, not before it.

Not changed, deliberately: **J2** (optimistic RSVP) is a decision, not a
defect — it is filed in `docs/ISSUES.md` for a call rather than guessed at.

## What phase 2 actually changed (2026-11-15)

All in `app/(tabs)/create.tsx`, plus one new pure module.

- **C1** The three stacked buttons at the end of the scroll are gone. A
  **sticky action bar** sits below the ScrollView (same fixed-bar pattern as
  the event page): Preview (secondary) beside **Publish Event** (primary,
  takes the remaining width), and "Save as draft · private and free" demoted
  to a 44 px text action under them. The scroll content pads by the bar's
  *measured* height (`onLayout`), so the last field clears it on every phone.
  While publishing is blocked (monthly limit, paused host) the Preview button
  steps aside and the status label gets the whole row rather than truncating
  at 320 px. The pinned labels and accessibility names the browser suites
  click on are unchanged.
- **C2** A **live progress line** at the top of the bar, from the new
  `utils/eventFormProgress.ts` (`requiredFieldStatus`, `progressLine`; 7
  tests): "Still needed: Title, Category" → "Ready to publish". Neutral in
  tone, not red; tapping it scrolls to the first missing section through the
  existing `FIELD_SECTION` map. "Place" only counts when the host actually has
  to set one. Photo-upload progress now shows on this line too — it used to be
  the button label, where the button's own spinner hid it.
- **C7** The time-zone row moved **under** Starts/Ends (before Repeat), with
  the note rewritten from "Times below are entered in…" to "Times above are
  in…". The two fields every host needs now come first.
- **C8** The first-event card is one sentence that names the three steps and
  points at the inline "Step N of 3" hints, instead of repeating them as a
  list. The card's title and its "Hide first event tips" control are
  unchanged.

Not changed: Publish stays **enabled** while fields are missing. Disabling it
would hide *why*; the refused tap already scrolls to and announces the first
problem, and now the progress line says so before the tap.

## What phase 3 actually changed (2026-11-15)

- **C3** Price and the tickets link are a **"Price & tickets" section of
  their own** on both Create (its own card, between Capacity and More options)
  and Edit (a block in the same place), through the new
  `components/EventPriceFields.tsx`. `EventExtrasFields` gained a
  `hidePriceAndTickets` prop so the two are not rendered twice; the "More
  options" row now reads "Visibility, age, accessibility, what to bring".
  Validation errors for the two fields route to the new section
  (`splitExtrasErrors`), so a refused publish scrolls to the right card and no
  longer pops the collapsed row open for a bad ticket link.
- **C4** A **Free / Paid** radio pair (44 px, `choiceA11y`). Free writes the
  canonical label `Free` in one tap and closes the amount input; Paid opens
  the free-text amount ("€12 at the door · From $20") and clears a free label.
  Pure logic in `utils/eventPrice.ts` (7 tests), including the one state the
  label alone cannot express — Paid chosen, nothing typed yet. Unset shows
  "Optional — but it is the first thing people compare."
  The stored column is unchanged (`price_label`, a string): this is the cheap
  half of C4. The structured half is decision **D3**.

Not changed: the preview and the publish payload already read
`extras.priceLabel` / `extras.ticketUrl`; only where they are entered moved.

## What phase 7 actually changed (2026-11-15)

- **J8** `components/DiscoverEventCard.tsx` was **restructured**: the image and
  copy are one press area, and the footer (host, going count, and now a
  **bookmark**) sits beside it as its own elements — the split
  `EventListItem` already used. The host button is no longer a touchable
  nested in a touchable exposed through a custom action; screen readers reach
  it directly. Saving from Discover is optimistic, queued offline through the
  same `runOrQueueWithNotice` the event page uses, reverted on failure, and
  marks the attendance lists stale. Signed-out taps go to sign-in.
- **J5** The joined state reads **"You're going"** instead of "Event Joined".
- **J6** The Interested control is a **labelled pill** (star + "Interested"),
  filled when set; its spoken labels ("Mark as interested" / "Remove
  interest") are unchanged, so the moderation suite's tap still lands.
- **C6** Withdrawn; Create's photo hint now names the Cover control.
- **C10 (font scaling, targeted)** `constants/theme.ts` gains
  `FontScaleCaps` (`control` 1.5 for buttons, chips, badges, meta lines and
  segmented controls; `cell` 1.4 for table cells and titles that already
  truncate). Applied to `Button`, `SegmentedControl`, `EventListItem`,
  `DiscoverEventCard`, the compare table / actions / tray, Create's action
  bar and the event page's join bar. Body copy keeps scaling freely. Also
  while in the card: the GOING badge uses `Colors.successText`, the AA-safe
  green the theme audit asked for (ISSUES, contrast leftovers). **Not
  verified on a device** — web reports `fontScale` 1 — so this stays on the
  device list.

Also fixed while here (pre-existing, web only): the Discover filter chips
rendered as ~100 px circles because react-native-web gives every ScrollView
`flexGrow: 1`; the strip no longer grows.
