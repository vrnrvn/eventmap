# Event comparison plan

**Status: P1 (foundations) built 2026-11-15; everything with a UI is still a
proposal.** Written 2026-11-15 against the code on this branch. Section 7
lists the decisions; none of them block what is built so far, and D2/D6 block
the tray (roadmap phase 4). Section 9 is the implementation log.

The goal: let someone who is choosing between several events see them side by
side on the attributes that actually decide it — when, how far, how much, what
type, is there room — and act (join / save / open) without leaving the view.

---

## 1. What exists today

### 1.1 The data a comparison can draw on

`RankedEvent` (`types/database.ts:301`) is what every browse surface already
holds in memory, and it is nearly a complete comparison row:

| Attribute | Field | Notes |
| --- | --- | --- |
| Type | `category_label`, `category_slug`, `category_id` | Always present |
| When | `start_datetime`, `end_datetime`, `timezone` | Recurring: see 1.3 |
| Distance | `distance_km` | **Relative to the fetch centre** — see 3.2 |
| Price | `price_label` | **Free text**, 60 chars — see 3.3 |
| Tickets | `ticket_url` | |
| Capacity | `max_attendees`, `rsvp_count` | "spots left" is derived |
| Popularity | `rsvp_count`, `save_count` | |
| Host | `business_name`, `business_logo_url`, `is_premium` | No rating in this row |
| Repeats | `is_recurring`, `recurrence_pattern` | `utils/recurrence.cadenceLabel` |
| Viewer state | `user_rsvp`, `user_saved` | |
| Where | `lat`, `lng`, `address` | |

`get_event_details` (`services/events.ts:224`) adds the rest: `age_restriction`,
`accessibility_notes`, `what_to_bring`, `rsvp_mode`, `rsvp_closed`,
`waitlist_mode`, `visibility`, the full `business` row (verified badge) and
`waitlist`. There is **no batch read** — no `get_events_by_ids` exists in the
121 migrations, and `get_event_details` takes one uuid.

`queryKeys.eventDetails(eventId)` (`hooks/queryKeys.ts:56`) already caches and
persists those payloads per event, so for events the viewer has opened, the
comparison data is on the device.

### 1.2 Surfaces a comparison would start from

- **Discover** (`app/(tabs)/discover.tsx`) — map + bottom-sheet list of
  `DiscoverEventCard`s, header with search pill, filter button and a category
  chip row (`:1011-1129`). Already has a FAB for hosts (`:1319`).
- **Saved events** (`app/saved-events.tsx`), **Joined events**,
  **Collection detail** (`screens/CollectionDetail.tsx`) — `EventListItem`
  rows. These are *already shortlists*, which makes them the most natural
  place to compare.
- **Category browse** (`screens/CategoryBrowse.tsx`) — one category, which is
  exactly the "which of these five gigs" case.

### 1.3 Plumbing to reuse

- `useBrowseCenter()` (`hooks/useBrowseCenter.ts`) — one agreed reference
  point ("near you") that never prompts for permission.
- `useEffectiveNextDates` (`hooks/useEffectiveNextDates.ts`) — corrects the
  next date of a recurring series for per-date exceptions. Needed: the server
  still returns the uncorrected date (ISSUES "E-R1, the server half").
- `utils/formatEventWhen.ts` (`formatEventDate`, `formatDistance`),
  `utils/eventDatetime.ts` (`describeEventTime`, zone handling),
  `utils/recurrence.ts` (`cadenceLabel`), `utils/eventStatus.ts`
  (`hasEventEnded`).
- `components/ui/SegmentedControl.tsx` — the table/cards toggle.
- `hooks/useScreenReaderEnabled.ts` — pick the accessible layout by default.
- `components/AddToCollectionSheet.tsx` + `@gorhom/bottom-sheet` — the
  multi-select-from-a-sheet pattern, if the tray turns out to need a sheet.
- `stores/*.ts` — the house store pattern is a tiny module with
  `get / set / consume`, not a Zustand slice, even though Zustand is a
  dependency.

---

## 2. Goals and non-goals

**Goals**

1. Pick 2–4 events from any browse surface and see them side by side.
2. Make the *differences* obvious — identical attributes should get out of the
   way; the better value on an objective attribute (nearest, soonest, cheapest,
   most room) should be marked.
3. Decide and act in place: join, save or open each event from its column.
4. Work on a 320 px phone, with a screen reader, and offline for events
   already opened.
5. Ship Phase 1–4 **without a migration** (see the client/schema policy in
   `docs/ISSUES.md` Ground rules; the shared DB is read-only to sessions).

**Non-goals**

- Comparing more than 4 events (the table stops being readable; the filter
  list is the right tool above that).
- Comparing past events, or events from other people's collections.
- An automatic "best pick" recommendation or scoring. The app marks objective
  bests per row; it does not rank overall.
- Multi-user / collaborative comparison.

---

## 3. Design

### 3.1 Selection: the compare tray

A **dock** pinned above the tab bar, not a modal, so browsing continues while
the shortlist builds:

```
┌────────────────────────────────────────────┐
│ [img] [img] [img]  3 selected   Compare →  │   ← tray, dismissible
└────────────────────────────────────────────┘
```

- Opening: "Compare" control in the header of Saved / Collection detail /
  Category browse; long-press on a Discover card (with
  `selectionAsync()` haptic); "Add to compare" on the event page.
- While the tray is open, every event row/card in the list shows a selection
  checkbox (44 px target) in place of its press-to-open behaviour being
  replaced — tapping the row still opens the event; only the checkbox selects,
  which keeps the primary gesture stable.
- Cap at 4. The 5th tap replaces nothing — it is refused with a toast
  ("Comparing up to 4 events. Remove one first.") rather than silently
  dropping the oldest.
- Each tray thumbnail is removable (× on the chip) and announces
  ("Removed Jazz Night. 2 events selected.").
- State lives in `stores/compareStore.ts`, following the house store shape:
  the id list plus a snapshot of each `RankedEvent` so the tray renders with no
  fetch. Session-scoped; cleared on sign-out. **Decision D1:** whether it also
  persists to AsyncStorage across app restarts.

### 3.2 The comparison screen

`app/compare.tsx` → `screens/CompareEvents.tsx`, a pushed screen (back returns
to where the shortlist was built), deep-linkable as `/compare?ids=a,b,c`
(**decision D2** — unlisted events make a shareable link a privacy question).

**Table mode** (default when no screen reader):

```
            │ Jazz Night   │ Open Mic     │ Quartet
────────────┼──────────────┼──────────────┼────────────
 When       │ Fri 20:00 ★  │ Sat 19:30    │ Fri 21:00
 Distance   │ 1.2 km ★     │ 4.8 km       │ 2.0 km
 Price      │ €12          │ Free ★       │ €18
 Spots left │ 8            │ Unlimited ★  │ 2
 ⋯ 4 identical rows hidden (Type, Age, …)        [Show]
────────────┼──────────────┼──────────────┼────────────
            │ [Join] [♡]   │ [Join] [♡]   │ [Full]
```

- **Sticky attribute column on the left; event columns scroll horizontally.**
  Two columns fit a 390 px screen comfortably; the third is the scroll hint.
- **Sticky header row** with cover thumbnail + title + host, so the column
  stays identified while scrolling vertically. Tapping it opens the event.
- **Sticky footer row** with the per-column actions. The action reuses the
  event page's state machine, not a second copy of it (see 3.5).
- **Identical rows collapse** into one "N identical rows hidden" row with a
  Show/Hide control. This is the single highest-value behaviour in the screen
  and should not be cut from Phase 2.
- **Best-value marks** (★ plus a soft brand tint, never colour alone) on:
  soonest start, nearest distance, lowest price *only when every column parsed
  confidently* (3.3), most spots left. A row with a tie marks nothing.
- Row order, decided by what changes a decision: When · Distance · Price ·
  Spots left · Type · Repeats · Host (+verified) · Going · Age · How to join
  (open / request / waitlist / closed) · Accessibility · What to bring ·
  Tickets.

**Cards mode** (SegmentedControl toggle; default when a screen reader is on):
one card per event, each a linear label/value list, differences marked with
text ("Nearest", "Cheapest"). This is the accessible and the 320 px fallback;
it is not a lesser mode.

### 3.3 Price

`price_label` is free text entered in one field
(`components/EventExtrasFields.tsx:66`, placeholder "Free · €12 at the door ·
From $20"). It cannot be sorted. Two options:

- **(a) Parse, Phase 3, no migration.** `utils/comparePrice.ts` classifies a
  label into `{ kind: 'free' | 'paid' | 'unknown', min, max, currency }` —
  "free"/"gratis"/"no charge" → free; a currency symbol or code with a number →
  paid, taking the lowest number in a range ("From $20", "€10–15"). **The raw
  label is always what is displayed**; the parse only drives the "cheapest"
  mark, and the mark is suppressed unless *every* column parsed confidently.
  An unparsed label shows as-is with no mark. Pure function, unit-tested — it
  fits the repo's logic-only test layer exactly.
- **(b) [DB] numeric columns** `price_min` / `price_max` / `currency` /
  `is_free`, with a Free/Paid control in Create. Correct, but it needs a
  migration (owner-applied), a form change and a backfill decision for the
  existing free-text labels.

**Recommendation: (a) now, (b) as decision D3 later.** Independently of both,
the Create form should offer a one-tap "Free" chip that writes the label
`Free` — it costs nothing, it is the most common case, and it makes the parse
reliable where it matters. **Shipped 2026-11-15** as roadmap phase 3
(`components/EventPriceFields.tsx`, `utils/eventPrice.ts`): Free / Paid chips
on Create and Edit, with price and tickets promoted out of "More options".
Review finding C4 in `docs/CREATE_AND_JOIN_UX_REVIEW_2026-11-15.md`.

### 3.4 Distance

`RankedEvent.distance_km` is measured from whatever centre that list was
fetched with, so two events selected from two surfaces can carry
non-comparable numbers. The compare screen **recomputes every distance from a
single reference** — `useBrowseCenter()` — with the haversine helper, using
the `lat`/`lng` every row carries, and labels the reference in the row header
("from your location" / "from your home area"). With no centre available the
distance row is hidden rather than guessed.

### 3.5 Data layer

Phase 1–2 need **no server change**:

- `hooks/useCompareEvents.ts` — `useQueries` over the selected ids with
  `queryKeys.eventDetails(id)`, so an event the viewer already opened is
  instant and available offline, and at most 4 requests fire otherwise.
  Tray snapshots render the columns while the details load (skeleton rows,
  not a blank screen).
- `utils/compare.ts` — pure and testable: build the row model from
  `EventDetails` + the tray snapshot, detect identical rows, compute the
  best-value marks, format each cell.
- Writes (join / save) go through the existing `socialService` calls and
  invalidate the same keys `EventDetail` does, so the event page and the
  comparison never disagree.

Phase 6 (optional, **[DB]**, only if the feature proves itself):
`get_events_compare(p_event_ids uuid[], p_lat, p_lng)` returning one row per
event with the compare fields, viewer state and a server-computed distance —
4 round trips become 1. Per the client/schema policy, the client would target
it outright; no probe-and-retry fallback.

### 3.6 Recurring series

Compare the **effective next occurrence** via `useEffectiveNextDates`, not
`start_datetime` and not the server's `next_start` (which ignores per-date
exceptions — ISSUES, Medium, E-R1). The When cell shows the next date and the
Repeats row shows `cadenceLabel`, so a weekly series is never silently
compared against a one-off as if both happened once.

### 3.7 States

- 0–1 selected → the screen is not reachable; the tray CTA stays disabled with
  "Select one more event to compare".
- An event cancelled / ended / filled while the tray was open → the column
  renders with its status badge and its action becomes the right one
  ("Cancelled", "Event full · Join waitlist"), matching `screens/EventDetail`.
- A details fetch fails for one column → that column shows the snapshot fields
  and an inline retry; the other columns still work.
- Offline → compares whatever is in the persisted cache; the banner already
  tells the user, and joining is already refused offline by `blockedOffline`.

### 3.8 Accessibility

React Native has no table semantics, so the table mode must not rely on
position:

- Every cell carries its own label: `"Price, Jazz Night: €12. Cheapest."`
- Column headers are `accessibilityRole="header"`; the attribute column cells
  name the row.
- **Cards mode is selected automatically when `useScreenReaderEnabled()` is
  true**, and the toggle remains available to everyone.
- Selection changes are announced through `announce()`
  (`utils/accessibility.ts:14`), as the create form already does for
  validation.
- Best-value is marked by a ★ glyph *and* a tint, never tint alone (WCAG
  1.4.1).
- This screen is the right place to start setting `maxFontSizeMultiplier`
  deliberately — the app currently sets it nowhere (ISSUES, Low), and a table
  is the most fragile layout at 200 % text. Cards mode is the escape hatch:
  **decision D4** is whether large text forces cards mode.
- 44 px minimum on tray chips, checkboxes and column actions.

---

## 4. Testing

- **vitest (logic)**: `utils/compare.ts` row model and identical-row
  detection; `utils/comparePrice.ts` across a table of real-world labels
  including unparseable ones; distance recomputation; the 4-item cap and
  dedupe in `stores/compareStore.ts`.
- **Fake-backend browser suite** `scripts/fake-backend-e2e/suiteCompare.mjs`,
  in the style of `suiteCollections.mjs`: build a shortlist from Saved, open
  the comparison, assert the rows, the collapsed-identical behaviour, the
  cheapest/nearest marks, joining from a column updating that column, the cap
  refusal, and the cards toggle. Screenshots at 390 px and 1280 px for the
  visual sweep (flow 9).
- **a11y**: extend `suiteA11y.mjs` — labels on every cell, 44 px targets, no
  horizontal overflow at 320 px, cards mode under a simulated screen reader.
- **Device** (owner): horizontal scroll vs. the bottom sheet's pan gesture on
  Discover, long-press selection on iOS and Android, VoiceOver/TalkBack
  reading order in both modes.

---

## 5. Phasing and estimates

Sequencing across both this plan and the UX review lives in `ROADMAP.md`
("Planned: event comparison + create/join UX"); the roadmap phase each item
belongs to is in the last column.

| Phase | Deliverable | Estimate | Roadmap | Status |
| --- | --- | --- | --- | --- |
| P0 | Foundations: `utils/comparePrice.ts`, `utils/compare.ts`, `stores/compareStore.ts` + unit tests. Renderer-free, nothing wired in | 4–5 h | 1 | **Done 2026-11-15** (§8) |
| P1 | The tray, selection + cap + announcements, entry points on Saved / Collection detail / Category browse | 4–6 h | 4 | **Done 2026-11-15** (§8) |
| P2 | `screens/CompareEvents.tsx` + `app/compare.tsx`: table and cards modes, sticky column/header/footer, identical-row collapse, per-column actions | 8–11 h | 5 | **Done 2026-11-15** (§8) |
| P3 | `hooks/useCompareEvents.ts`, best-value marks and single-reference distance wired into the screen | 3–4 h | 5 | **Done 2026-11-15** (§8) |
| P4 | Discover long-press entry, `/compare?ids=` deep link (D2: yes) | 2–3 h | 6 | **Done 2026-11-15** (§8) — the event-page "Add to compare" entry was dropped as redundant with the three list entries and long-press |
| P5 | `suiteCompare.mjs` + a11y additions (the vitest half shipped with P0) | 3–5 h | 6 | **Done 2026-11-15** (§8) — 45 checks |
| P6 | **[DB]** `get_events_compare` RPC + client switch | 3–4 h + owner-applied migration | 8 | **Migration applied locally and SQL suite validated 2026-11-15 (§8); client cutover deferred (D7)** |

**P1–P5: 20–29 h, no migration.** P6 is optional and only pays for itself if
the feature is used.

---

## 6. Risks

- **Horizontal scroll inside the Discover bottom sheet** — the comparison
  screen is pushed, not embedded, specifically to avoid nesting a horizontal
  scroll in `@gorhom/bottom-sheet`'s pan handling. Keep it that way.
- **Price parsing overreach.** Marking the wrong event "cheapest" is worse
  than marking none. Hence: display the raw label always, suppress the mark
  unless every column parsed.
- **Yet another surface that can disagree with the event page.** Mitigated by
  routing every write through the same service calls and query keys; there is
  deliberately no second RSVP state machine.
- **Feature discoverability.** A tray nobody opens is dead weight. The honest
  Phase 1 test is the Saved/Collection entry point, where the shortlist already
  exists; Discover long-press is a bonus, not the primary path.

---

## 7. Decisions needed

- **D1** — ~~Does the tray survive an app restart (AsyncStorage) or is it
  session-only?~~ **Decided 2026-11-15: session-only**, as built.
- **D2** — ~~Is `/compare?ids=…` shareable?~~ **Decided 2026-11-15: yes**,
  with unlisted events (`visibility = 'unlisted'`) dropped from a link opened
  by someone who was not already able to see them. Lands in phase 6.
- **D3** — Numeric price columns (3.3 option b) — yes/no/later. Affects Create,
  Edit, the comparison and any future "free events" filter.
- **D4** — ~~Does a large system font force cards mode, or only offer it?~~
  **Decided 2026-11-15: forces it**, with the table/cards toggle still
  available. Lands in phase 5.
- **D5** — ~~Cap of 4: confirm.~~ **Decided 2026-11-15: 4**, as built.
- **D6** — ~~Is "Compare" a top-level affordance on Discover, or only on the
  shortlist screens?~~ **Decided 2026-11-15: long-press only** on Discover
  cards; the header keeps its two controls. Lands in phase 6.

---

## 8. Implementation log

### P1 — foundations, 2026-11-15 (this branch)

Three renderer-free modules and their tests. No UI, no server change, nothing
wired into a screen yet — deliberately, so the decisions in §7 can still move
the UX without rewriting the logic.

- **`utils/comparePrice.ts`** — `parsePriceLabel`, `arePricesComparable`,
  `priceRank`. Classifies a host's free-text label into free / paid / unknown
  with a `confident` flag. Deliberate calls, all pinned by tests:
  - "Free for members, €5 otherwise" parses as **paid but not confident** —
    something is free and something is not, and guessing which is the
    admission is exactly the error to avoid.
  - "From $20" **is** confident: comparing floors is what comparison UIs do.
  - A qualifier that changes what the number means ("donation", "deposit",
    "around", "TBC") drops confidence.
  - Decimal commas and thousands separators are resolved by position
    (`€1,50` → 1.5, `1.500 Ft` → 1500).
  - `arePricesComparable` refuses mixed currencies, and refuses a stated
    currency next to a bare number; free entries are exempt (zero costs the
    same everywhere).
- **`utils/compare.ts`** — `buildCompareRows` and the row model, plus
  `fromRankedEvent` / `fromEventDetails` adapters, `spotsLeft`,
  `joinModeLabel`, `partitionRows`, `cellAccessibilityLabel`. Behaviour worth
  recording:
  - **A tie marks nothing** (§3.2). `bestOf` returns null unless exactly one
    cell holds the best value.
  - **An attribute nobody filled in is dropped**, which is not the same as a
    row where everyone says the same thing (that one collapses and can be
    expanded).
  - Distance is only built when a reference point is given, and is always
    recomputed from it (§3.4) rather than trusting `distance_km`.
  - Unlimited capacity ranks as the most room. This surfaced the one bug of
    the pass: `bestOf` filtered ranks with `Number.isFinite`, which threw away
    the `-Infinity` that encodes "uncapped", so a capped event with 2 spots
    beat an unlimited one. The filter now rejects only `NaN`.
- **`stores/compareStore.ts`** — selection, cap, `subscribe`/`getSnapshot` for
  `useSyncExternalStore`, and the shared copy (`compareCtaLabel`,
  `compareAnnouncement`). Past the cap an add is **refused**, never a silent
  eviction. `upsert` only touches something already selected, so a late
  details response cannot re-add an event the user just removed.

**Tests:** `tests/comparePrice.test.ts` (18), `tests/compare.test.ts` (18),
`tests/compareStore.test.ts` (12). Full suite after the pass: **1,096 unit
tests in 89 files**, typecheck clean, lint 0 errors / 7 warnings (the
pre-existing baseline).

**Still to wire up after P0:** `hooks/useCompareEvents.ts` over
`queryKeys.eventDetails`, the tray, the screen, the entry points — the tray
and entry points landed in P1 below.

### P1 — the tray and its entry points, 2026-11-15 (this branch)

- **`stores/compareStore.ts`** gained compare *mode* (`isActive` /
  `setActive` / `exit`), global rather than per screen so a shortlist started
  on Saved continues in a collection. `exit` drops the selection and the mode
  in one notification. Store tests: 14.
- **`hooks/useCompareSelection.ts`** — `useSyncExternalStore` over the store
  plus the side effects every entry point shares: `selectionHaptic`, the
  spoken `compareAnnouncement`, and the **refusal toast at the cap** (never a
  silent eviction). `toggle(event, nextIso)` builds the snapshot through
  `fromRankedEvent`, so a series carries its effective next date.
- **`components/CompareCheckbox.tsx`** — 44 px target around a 24 px box,
  `choiceA11y(..., 'checkbox')`. It takes `EventListItem`'s `rightAction`
  slot, which that component keeps *outside* the row's press area, so tapping
  the row still opens the event and only the box selects (§3.1). Ended and
  cancelled rows are disabled.
- **`components/CompareThumb.tsx`** — the cover thumbnail the tray and the
  cards share, with the list rows' `useImageFallback`: a missing or broken
  cover shows the event's initial on the brand tint. Found by screenshot — the
  first cut drew blank grey squares when the image failed to load.
- **`components/CompareTray.tsx`** — the dock: thumbnails with a remove ×
  (24 px with a 10 px hitSlop), dashed empty slots up to the cap, "N of 4",
  an exit control, and the single CTA (`compareCtaLabel`), disabled below two.
  It reports its height so the list behind it pads its bottom. Shown while
  the mode is on or anything is selected.
- **Entry points** — a Compare toggle (`ArrowLeftRight`, "Compare events" /
  "Exit compare mode", `aria-pressed`) in the headers of **Saved events**,
  **Collection detail** and **Category browse**, shown once the list has two
  or more events. In compare mode each row's actions (unsave, add to
  collection, remove from collection, chevron) give way to the checkbox and
  return when the mode ends.
- **`app/compare.tsx` → `screens/CompareEvents.tsx`**, first cut: the plan's
  cards mode on the tray's snapshots — one card per event, every row from
  `buildCompareRows`, ★ where the event is clearly ahead, Open / Remove per
  card, "Clear" in the header, and a two-events-minimum empty state. Distances
  come from `useBrowseCenter()` and the note says which reference was used.
  Phase 5 adds the table, identical-row collapse, the details fetch,
  per-column Join / Save, and the D4 switch.

**Verification:** typecheck clean, **1,112 unit tests in 91 files**, lint 0
errors / 7 warnings (baseline), `suiteCollections` **168/168** and `suiteB`
**46/46** (the suites that drive Saved, collection detail and category
browse — every pinned row action and label still present with the mode off),
plus a scripted walk in headless Chrome: enter the mode, tick three rows, hit
the cap and read the refusal, open the comparison. No database touched.

**Decided 2026-11-15, recorded in §7:** D1 session-only, D5 cap of 4, D4
large text forces cards mode, D2 shareable minus unlisted, D6 long-press only.

### P2 + P3 — the comparison screen, 2026-11-15 (this branch)

- **`hooks/useCompareEvents.ts`** — `useQueries` over `queryKeys.eventDetails`
  (the key the event page writes), one `get_event_details` per column, 60 s
  stale. A column renders from the tray snapshot until details land, then
  switches to the authoritative row — which also carries the viewer's RSVP
  and save for the actions. Series take their *effective* next date from
  `useEffectiveNextDates` over the fetched rows (§3.6). Per column: loading /
  error-with-retry / "No longer available" (server returned null).
- **`components/compare/CompareTable.tsx`** — the side-by-side view: sticky
  attribute column (fixed 96 px), event columns in a horizontal ScrollView
  (`columnWidthFor`: two fit a phone, the third peeks), a header row pinned
  with `stickyHeaderIndices`, and a pinned footer of actions. Header and
  footer are `scrollEnabled={false}` ScrollViews driven by the body's
  `onScroll`, so the three stay aligned. Row heights are measured on the
  value rows and applied to the label cells. Best cells get the ★ and a soft
  tint; every cell carries `cellAccessibilityLabel` (§3.8).
- **Identical-row collapse** — rows where every column agrees are hidden
  behind "N identical rows hidden · Show" and render dimmed when shown, in
  both modes.
- **`components/compare/CompareActions.tsx`** — the per-column pair shared
  by table footer and cards: a primary from `joinActionFor` plus the
  bookmark. `joinActionFor` is deliberately the *reduced* machine: only the
  plain case (open RSVPs, room left, signed in) joins from here; waitlist,
  approval, closed, sign-in and blocked states hand off to the event page
  with its own label ("Join waitlist", "Request to join", "Full"…), so one
  screen owns those flows. Join and save write through `socialService` /
  `runOrQueueWithNotice`, patch both the details cache and the tray
  snapshot, and mark the attendance lists stale — the same keys the event
  page uses, so the two never disagree. Save is optimistic with revert.
- **`components/compare/CompareCards.tsx`** — the P1 cards promoted to a
  component with the same rows, marks, collapse and actions.
- **`screens/CompareEvents.tsx`** — Table / Cards `SegmentedControl`; D4
  default to cards under a screen reader or `fontScale ≥ 1.3`, with the
  toggle always available.

**Found and fixed on the way:**

- **`AccessibilityInfo.isScreenReaderEnabled()` always resolves `true` on
  react-native-web** — a browser cannot tell — so the first cut defaulted
  every web visitor to cards. The D4 screen-reader half is now native-only
  (`Platform.OS !== 'web'`); `hooks/useScreenReaderEnabled.ts` documents the
  trap for the next caller. Its other consumer (toast timing) is harmless.
- The table header's Retry link sat inside the tappable header cell — a
  touchable inside a touchable, one VoiceOver element. Caught by
  `tests/a11yGuards.test.ts`; they are siblings now.
- The mode toggle truncated "Cards" at its natural width; it has a fixed one.

**Verification:** typecheck clean, **1,116 unit tests in 91 files** (22 in
`compare.test.ts` incl. `joinActionFor`), lint 0 errors / 7 warnings
(baseline), and a scripted headless walk at 390 px: table is the default
(`aria-selected` on the Table tab), three header cells, "1 identical row
hidden" with Host behind it, three ★ marks, Join from the footer → "You're
going" with the Going count stepping 9 → 10, the bookmark flipping to "Save
…", the header and footer following a 120 px horizontal scroll, the
identical rows expanding, and Cards mode rendering the same — zero runtime
errors. No database touched.

### P4 + P5 — reach and verification, 2026-11-15 (this branch)

- **Discover long-press (D6).** `DiscoverEventCard` takes `onLongPress` and
  `compareSelected`: a 350 ms press toggles the event; a selected card wears a
  "COMPARING" badge over its cover and says "selected for comparison" in its
  label. A long-press is not discoverable to a screen reader, so the same
  toggle is a **custom accessibility action** ("Add to comparison" /
  "Remove from comparison") beside the existing "View <host>" one. The
  header keeps its two controls. The tray renders above the tab bar
  (`respectBottomInset={false}`), the bottom sheet is lifted by the tray's
  height (`bottomInset`) and the FAB moves up with it.
- **Shareable link (D2).** `utils/compareLink.ts` (9 tests): a link never
  *includes* an unlisted event (`shareableCompareIds`, the share toast says
  how many were left out), and an opened link *drops* an unlisted event the
  viewer could not already see — not in their selection or details cache
  (`filterLinkedEvents`) — plus anything the server returns nothing for, with
  one toast counting the drops. `parseCompareIds` trims, de-duplicates,
  rejects junk and caps at four. The compare screen hydrates from `?ids=`
  through `queryClient.fetchQuery` on the same details key, shows a loading
  state meanwhile, and gains a Share control in its header.
- **`scripts/fake-backend-e2e/suiteCompare.mjs`**, 45 checks in six
  scenarios: the tray on Saved (mode, ticks, the refusal at the cap, exit);
  the table (default mode, header cells, identical rows hidden, ★ marks,
  per-cell labels, header and footer following a 120 px body scroll);
  footer actions (Join → "You're going" via exactly one
  `join_event_with_capacity` call, bookmark flip) and Cards; Discover
  long-press (badge + tray, no navigation); the shared link (two public ids
  kept, an unknown id and a never-seen unlisted event dropped, "2 events in
  this link aren't available", one details call per id, Share offered);
  accessibility and layout at 320 and 390 px (every control labelled, 44 px
  targets, no document overflow in either mode). Row added to the harness
  README.

**Found by the suite and fixed:** the header toggle and the tray's × both
said "Exit compare mode" but did different things — the header only turned
the checkboxes off and left the tray up with the selection. Both now leave
the mode *and* drop the selection (`compareStore.exit`).

**Verification:** typecheck clean, **1,124 unit tests in 92 files**, lint 0
errors / 7 warnings (baseline), `suiteCompare` **45/45**. No database touched.

### P6 — the batch RPC, applied locally 2026-11-15

- **`supabase/migrations/20261115100000_get_events_compare.sql`** —
  `get_events_compare(p_event_ids uuid[], p_lat, p_lng) RETURNS json`: each
  event row plus host name / logo / verified, category label / slug, going /
  save / waitlist counts, the viewer's RSVP and save, `distance_km` from the
  point (null without one) and `next_start_datetime` from
  `event_next_effective_occurrence`. Visibility **mirrors
  `get_event_details`** (SECURITY DEFINER, owner/admin-only drafts, unlisted
  by id, cancelled with status, unknown ids absent). Distinct ids in caller
  order, nulls ignored, more than four distinct raises `too_many_events`.
  `anon` and `authenticated` may call it.
- **`scripts/test-events-compare.sql`** — five ASSERT blocks: grants; shape
  and order (labels, counts, the viewer's own state, columns passing through);
  distance against `calculate_distance` and the effective next date for a
  series; visibility as another user, the owner and anon; hygiene (duplicates,
  nulls, empty, unknown, four ok, five refused, five-with-a-duplicate ok).
  Every block hands the session back to superuser before it ends — the first
  run failed on `permission denied for table ctx` because block [1] did not,
  and the next on `json = json` (no such operator; `->>` IS NULL instead).
  Both were suite bugs, not function bugs.
- **Validated** on `scripts/pg17-isolated.sh` (Postgres 17.6.1.106, 123
  migrations + seed): the new suite passes, **13/13 suites pass**, re-applying
  the file is a no-op. Container destroyed. **The shared database was not
  touched.**
- **Not done by decision:** client cutover (D7 — the `useCompareEvents` batch
  path is specified in `docs/MIGRATIONS_PENDING.md` item 2), numeric price
  columns (D8/D3), hosted apply (D10 — inventory runbook in item 0).

## 9. Open dependency

The best-value mark on **When** for recurring series depends on the effective
next date. The client-side correction (`useEffectiveNextDates`) is enough for
Phase 2, but the underlying server gap (E-R1) stays open and is tracked in
`docs/ISSUES.md`, not here.
