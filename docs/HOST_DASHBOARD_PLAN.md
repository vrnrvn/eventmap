# Host dashboard plan (Roadmap C, phase C0)

Status: **C0 design done; C1, C2, C5 built and C6's web half done 2026-11-16.**
Review rounds 2 and 3 (fixes + full regression) are in
`docs/HOST_DASHBOARD_AND_RECURRENCE_REVIEW_2026-11-16.md` §8; remaining
database work is `docs/MIGRATIONS_PENDING.md` §2b (see §8 and §10). DC1-DC3
decided by the owner 2026-11-16. Parent roadmap:
[`docs/HOST_DASHBOARD_AND_RECURRENCE_REVIEW_2026-11-16.md`](HOST_DASHBOARD_AND_RECURRENCE_REVIEW_2026-11-16.md) §5.

Standing constraints: no changes to the shared database; migrations are
prepared and validated in isolation, then applied by the owner at the end;
no long background processes. **Phases C1, C2, C5 and C6 (web half) need no
database work.** C3 and C4 do, and are listed as deferred.

---

## 1. The problem

A host today has excellent *per-event* tools (Manage event, insights, the
playbook) and an account-level getting-started checklist. What is missing is
the view a host opens first thing in the morning:

- **What is happening today and this week**, across all my events, with
  series expanded into their actual dates (skipped dates gone, moved dates at
  their new time).
- **How many people are coming** to each of those — per date for a series.
- **What needs me**: requests waiting for approval, a waitlist I could
  promote, reported chat messages, a draft I never published, an event that
  just filled.
- **One tap to the tool** that handles each of those.

Non-goals for this roadmap: analytics (insights already exist and stay
premium), a new notification type, editing events in place, co-host access.

---

## 2. Facts from the code that shape the design

| Fact | Evidence | Consequence |
| --- | --- | --- |
| One business per user | `businesses.owner_id` unique (`20260213092127:18`) | "Per-business vs per-account" is not a choice today — they are the same thing. Co-hosts would change this; not built |
| Upcoming events for a business: one query | `eventsService.getBusinessEvents(id, { scope: 'upcoming' })` | Agenda source, already used by My Events |
| Going / interested / waitlist for up to 100 events: one RPC | `hostToolsService.getEventsCounts` → `get_host_events_counts` (`20261103120000`) | Attendance numbers for the whole agenda in a single call |
| Per-date exceptions for up to 200 series: one query | `occurrencesService.listExceptionsForEvents` | Series expansion with skips/moves applied, one call |
| Pending requests, open chat reports, announcements sent today: **per event only** | `hostToolsService.getOverview` → `get_event_host_overview` | The needs-attention queue must fan out per event until a batch RPC exists (C3) |
| Per-date going counts: **per series only** | `occurrencesService.getDateGoingCounts` (≤ 60 dates) | Only fetched for series that appear in the agenda window |
| ManageEvent caches the overview under `['host','event',id,'overview']` | `screens/ManageEvent.tsx:340` | Reusing that key makes every dashboard → Manage tap open instantly |
| Occurrence expansion is cheap | `npm run bench:recurrence`: 50 series × 8 dates = 3.3 ms | Expansion can run on every render of the agenda; no memo layer needed |
| `app/host.tsx` is taken | the `eventmap://host` signup-intent deep link | The dashboard needs a different route |
| Business-mode Profile is today's host home | `app/(tabs)/profile.tsx` (`isBizMode` stats, "Events Created") | Natural place for an entry point |

---

## 3. What the host sees

```
┌─────────────────────────────────────────┐
│ Hosting · Today                          │
│                                          │
│ NEEDS YOU (3)                            │
│  ● 4 requests waiting · Board game night │  → Manage › Attendees (Requested)
│  ● 2 chat reports · Salsa Thursdays      │  → Manage › Chat
│  ● Draft not published · Spring market   │  → Edit event
│                                          │
│ TODAY                                    │
│  19:00  Salsa Thursdays     28 going     │  → Manage (that date)
│         (series · Thu 20 Nov)            │
│                                          │
│ TOMORROW                                 │
│  10:00  Spring market       112 / 150    │
│                                          │
│ NEXT 7 DAYS                              │
│  Sat 22  Board game night   12 going ·   │
│          4 waiting                       │
│  Thu 27  Salsa Thursdays    9 going      │
│          Tue 25 skipped                  │
│                                          │
│ [ Create event ]  [ My events ]          │
└─────────────────────────────────────────┘
```

Rules:

- **Agenda (C1)** lists *occurrences*, not events: a weekly series shows once
  per date it actually happens in the window. A skipped date is shown struck
  through in the day it would have been ("Tue 25 skipped") so the host sees
  the hole they made; a moved date appears at its new time with "moved".
- **Day grouping is the host's device day** ("Today" means the host's today),
  and each row uses the existing time rule (`describeEventTime`) so an event
  in another zone also shows its own local time.
- **Attendance**: one-off events show going (and `going / capacity` when
  capped); series dates show the per-date going count when available, else
  the series count with no per-date claim.
- **Needs you (C2)** is ordered by urgency (see §5), each row naming the
  event and the count, each a deep link to the exact tool.
- **Empty states**: no events → the Create CTA and the first-event guide; no
  items needing attention → the section is hidden, not shown as "0".

---

## 4. Data plan

### C1 — agenda: three requests, all existing, all batched

1. `getBusinessEvents(businessId, { scope: 'upcoming', limit: 50 })`
2. `getEventsCounts(ids)` — going / interested / waitlist (≤ 100 ids)
3. `listExceptionsForEvents(recurringIds)` — per-date exceptions (≤ 200 ids)

Then, pure client work: expand series over the window with
`listOccurrences(…, { strict: true })`, merge one-offs, group by day.

Optionally 4. `getDateGoingCounts(seriesId, dateKeys)` for each series that
appears in the window — one call per *series in the window*, not per event.
Typical hosts run 0-3 series, so 0-3 extra calls.

### C2 — needs attention: bounded fan-out

`getOverview(eventId)` is the only source of `requested`, `chat.open_reports`
and `announcements_today`. Until a batch RPC exists (C3), the dashboard calls
it for a **bounded** set:

- every event in the agenda window (next 7 days), plus
- every upcoming event in **approval mode** (`rsvp_mode = 'approval'`, known
  from the rows already fetched — that is where requests can pile up),
  approval-mode events first, since only they can have requests,
- **capped at 10**, soonest first. Events beyond the cap are not inspected;
  the dashboard says "Showing the next 10 events" rather than implying
  nothing else needs attention.

Each call uses the ManageEvent key `['host','event',id,'overview']`, so the
dashboard warms the cache for the screens it links to, and ManageEvent's own
mutations already invalidate it. Waitlist and capacity come from the C1
counts (no extra calls). Drafts come from `getBusinessEvents(…, { scope:
'drafts' })` — one more call.

Worst case for C1 + C2: 3 + 3 + 1 + 10 = **17 requests**, typical 5-8, all
in parallel. Acceptable for a screen opened a few times a day; C3 collapses
it to one.

### Refresh and offline

- **Refresh on focus** (`useRefetchOnFocus`, as My Events does) and pull to
  refresh. **No interval polling** — it costs battery and requests for a
  screen nobody watches continuously.
- The agenda (C1) is **persisted** like the business page
  (`PERSISTED_QUERY`), because hosts often open it at a venue with poor
  signal; the stale banner from `useScreenState` says how old it is. The
  needs-attention queue (C2) is **not** persisted: showing yesterday's
  "4 requests waiting" as current would be worse than showing nothing.
- `refetchAll` identity churn in `screens/ManageEvent.tsx:378-386` (filed as
  a nitpick) should be fixed in C2, since the dashboard invalidates the same
  keys.

---

## 5. Needs-attention rules (C2)

Ordered by urgency; a row appears only when its condition holds.

| # | Item | Condition | Source | Links to |
| --- | --- | --- | --- | --- |
| 1 | Chat reports | `chat.open_reports > 0` | overview | Manage › Chat |
| 2 | Requests waiting | `rsvp_mode = 'approval'` and `requested > 0` | overview | Manage › Attendees › Requested |
| 3 | Postponed, no new date | `status = 'postponed'` | event row | Manage › Reschedule |
| 4 | Waitlist promotable | `waitlist > 0` and (`max_attendees` null or `going < max_attendees`) and `waitlist_mode` is not `'auto'` (undefined = `'notify'`) | counts + event row | Manage › Attendees › Waitlist |
| 5 | Starting soon with RSVPs switched off | starts in < 48 h, `rsvp_closed = true`, going = 0 | event row + counts | Manage › Settings |
| 6 | Unpublished draft | `publish_state = 'draft'`, `updated_at` > 3 days ago, start in the future | drafts query | Edit event |
| 7 | Just filled | `max_attendees` set, `going >= max_attendees`, `waitlist_mode = 'off'` | counts + event row | Manage › Settings (capacity) |

Items 5 and 7 are suggestions, not problems, and are labelled as such. All
rules live in one pure module (§7) with unit tests; thresholds are constants.
Field names verified against `types/database.ts` (`Event`, `RsvpMode =
'open' | 'approval'`, `WaitlistMode = 'off' | 'notify' | 'auto'`,
`EventStatus` includes `'postponed'`). "RSVPs closed" is the boolean
`rsvp_closed` switch, not an `rsvp_mode` value.

---

## 6. Decisions

Each has a recommendation. **DC1-DC3 were decided by the owner on
2026-11-16, as recommended.** DC4 and DC5 were not asked; C1 implements their
recommendations (DC4: skipped dates struck through; DC5 applies to C2) and
either is a one-line change if the owner prefers otherwise.

| # | Decision | Options | Recommendation |
| --- | --- | --- | --- |
| **DC1** | **Where the dashboard lives** | (a) a fifth tab shown only in business mode; (b) its own screen `app/hosting.tsx`, entered from a compact "Today" card at the top of business-mode Profile and from the My Events header; (c) replace My Events | **(b).** No tab-bar change (a mode-dependent tab bar shifts every other tab), reversible, and My Events stays the full list. Promote to a tab later if usage says so |
| **DC2** | **Free or premium** | (a) free; (b) premium; (c) agenda free, needs-attention premium | **(a) free.** Everything it shows is already free per event; gating the morning view would push hosts back to tapping through events. Premium stays on insights, check-in and CSV, as already planned |
| **DC3** | **Agenda window** | 7 days; 14 days; host-selectable | **7 days**, fixed. Matches "this week"; keeps the C2 fan-out bounded |
| DC4 | Skipped dates in the agenda | show struck through; hide | **Show struck through** — the host made the hole and should see it; attendees' views already hide them |
| DC5 | Fan-out cap before C3 | 5; 10; 20 | **10**, with an explicit "showing the next 10" note |
| DC6 | Check-in scope (C4, deferred) | manual list only; list + QR; per-date for series | **List + QR, per-date for series from the start** — retrofitting per-date later means a second migration. Decide before C4 is written, not now |
| — | Per-business vs per-account | — | **Not a decision**: one business per user (§2). Revisit only with co-hosts |

---

## 7. Implementation outline (for C1-C2)

Pure logic first, tested without a renderer — the house pattern
(`utils/hostChecklist.ts`, `utils/eventPlaybook.ts`).

`utils/hostDashboard.ts`

```ts
export type AgendaEntry = {
  eventId: string;
  title: string;
  start: Date;            // effective start (moved time when moved)
  end: Date;
  dateKey: string | null; // occurrence key for series, null for one-offs
  status: 'scheduled' | 'moved' | 'cancelled';
  going: number | null;   // per-date for series when known, else series count
  capacity: number | null;
  waitlist: number | null;
  isSeries: boolean;
  timezone: string | null;
};

export type AgendaDay = { key: string; label: 'Today' | 'Tomorrow' | string; entries: AgendaEntry[] };

export function buildAgenda(input: {
  events: Event[];
  counts: Map<string, HostEventCounts>;
  exceptions: OccurrenceException[];
  dateGoing?: Map<string, Record<string, number>>; // seriesId → dateKey → going
  now: Date;
  days?: number;           // default 7 (DC3)
}): AgendaDay[];

export type AttentionItem = {
  kind: 'chat_reports' | 'requests' | 'postponed' | 'waitlist' | 'closed_soon' | 'stale_draft' | 'just_filled';
  eventId: string;
  title: string;
  count: number | null;
  severity: 'action' | 'suggestion';
};

export function buildAttentionQueue(input: {
  events: Event[];
  drafts: Event[];
  counts: Map<string, HostEventCounts>;
  overviews: Map<string, HostOverview>;
  now: Date;
}): AttentionItem[];

/** Which events get an overview call before C3 (§4, DC5). */
export function overviewTargets(events: Event[], now: Date, cap?: number): string[];
```

Then `hooks/useHostDashboard.ts` (the queries in §4), `screens/HostDashboard.tsx`,
`app/hosting.tsx`, the Profile "Today" card, and the My Events header link.

---

## 8. Phases

| Phase | Scope | DB? | Est. | Done when |
| --- | --- | --- | --- | --- |
| **C0** | This document | No | — | **Done 2026-11-16** |
| **C1** | `buildAgenda` + tests; `useHostDashboard` agenda queries; `HostDashboard` screen with the agenda; route `app/hosting.tsx`; Profile "Today" card; My Events header link | **No** | 6-8 h | **Done 2026-11-16** — §10 |
| **C2** | `buildAttentionQueue` + `overviewTargets` + tests; bounded overview fan-out on the ManageEvent key; drafts query; the "Needs you" section | **No** | 5-7 h | **Done 2026-11-16** — §11 |
| **C3** | `get_host_dashboard(p_business_id, p_from, p_to)` — agenda rows + counts + requested + open reports in one call; client cutover behind the existing shape | **Yes — deferred** | 4-6 h | Prepared and validated in isolation; one request instead of up to 17 |
| **C4** | Check-in (`checked_in`, `host_checkin_attendee`, QR, per-date for series) + CSV export; premium | **Yes — deferred** | 12-18 h | Needs DC6, a migration and a device |
| **C5** | Per-date operations from the agenda (skip / reschedule / restore a date) using the existing RPCs and the ManageEvent sheets | **No** | 5-7 h | A date can be skipped from the agenda and disappears from attendees' views |
| **C6** | `suiteHostDashboard.mjs` browser suite (**foreground only**), a11y, 320 px, large font; device pass | Web half no; device yes | 5-8 h | **Web half done 2026-11-16** — §13. Device pass outstanding |

---

## 9. Risks

- **Fan-out cost before C3.** Bounded at 10 overview calls with an explicit
  note; C3 removes it. If hosts with many simultaneous approval-mode events
  appear, raise C3's priority.
- **Agenda vs. server disagreement on next dates.** The agenda computes
  occurrences on the client with exceptions applied, so it is *not* affected
  by E-R1 (server ranking ignoring exceptions). It will disagree with Discover
  ordering for a skipped date until B3 lands — the agenda is the correct side.
- **Stale counts at the door.** The agenda is persisted for offline use; the
  stale banner must be visible, and C4's check-in must never rely on cached
  counts.
- **Scope creep into analytics.** Views, saves and trends stay in insights;
  the dashboard links to insights instead of duplicating them.

---

## 10. C1 — what was built (2026-11-16)

| Piece | File |
| --- | --- |
| Pure agenda logic: window, series expansion with exceptions, day grouping, summary, per-date targets, attendance and card wording | `utils/hostDashboard.ts` |
| Data hook (persisted query, refresh on focus, clock refreshed on focus) + cache-only summary for the Profile card | `hooks/useHostDashboard.ts`, `queryKeys.hostDashboard` |
| Screen + route | `screens/HostDashboard.tsx`, `app/hosting.tsx` |
| Profile entry (business mode, below the checklist) | `components/HostTodayCard.tsx`, `app/(tabs)/profile.tsx` |
| My Events header entry ("This week's schedule") | `screens/MyEvents.tsx` |

**Behaviour as built.** Today plus six days on the device calendar. One-offs
show going, capacity and waitlist; a series appears once per date it happens;
a skipped date stays in place, struck through, with the host's note (DC4); a
moved date shows at its new time, marked "Moved". A series date uses its
per-date going count when the server has one, and otherwise says
"N going to the series", because attendees can opt out of single dates.
Events in progress show "Happening now", and one that began yesterday stays
under Today. Rows open Manage event. Cancelled, postponed and draft events
are left out; postponed ones belong to C2's queue.

**Requests (as measured by the browser suite):** one events query, one
counts RPC, one exceptions query, and one per-date count call per series in
the window (capped at 10). With no series, the exceptions and per-date
calls are skipped entirely. The Profile card reads only the cache: **zero
requests**. Before the first visit it shows an invitation rather than
numbers.

**Failure policy.** Event rows and exceptions are required. Without the
exceptions a skipped date would show as happening, so a failure keeps the
last good copy with the freshness note, or shows the error state with Retry.
Counts are optional: if they fail, the agenda still renders without numbers
and explains why.

**Verification.**
- `tests/hostDashboard.test.ts`: 26 tests, passing in 5 device zones (New
  York, Lord Howe, Kiritimati, Santiago, Lisbon).
- `scripts/fake-backend-e2e/suiteHostDashboard.mjs` (fake backend, no
  database, foreground): **33/33**. It covers the agenda content, strike-through,
  the request plan, row → Manage, the My Events link, the Profile card before
  and after a visit, 390 and 320 px layout (labels, 44 px targets, no
  overflow), the empty week, and a failed load.
- Regression: suiteHostUi 174/174, suiteB B7-B8, suiteVisual 68/68.
- Full unit suite 1,181; typecheck and lint clean.

**Fixed during verification:** the Profile card said "Next: 12:00 PM UTC"
for an item that was tomorrow. It now names the day ("Next: Tomorrow
12:00 PM UTC", "Next: Fri …"), pinned by a unit test and by H3.

**Known limits, accepted for C1:**
- The agenda reads the first 50 upcoming rows and says so when it hits the
  limit.
- A series date moved from *beyond* the walk into the window is not
  shown (a moved date's original day must itself be near the window).
- The clock refreshes on focus, not on a timer, so a screen left open across
  midnight shows yesterday's "Today" until it is refocused or pulled.

---

## 11. C2 — what was built (2026-11-16)

DC5 decided by the owner: **10 events inspected**, approval-mode first.

| Piece | File |
| --- | --- |
| `buildAttentionQueue` (7 rules), `overviewTargets` (DC5), `describeAttention` | `utils/hostDashboard.ts` |
| Bounded fan-out through Manage event's own query key + drafts query | `hooks/useHostDashboard.ts` |
| "Needs you" section, per-rule icons, deep links | `screens/HostDashboard.tsx` |
| `?tab=` / `?seg=` deep links into the hub's tabs and attendee segments | `screens/ManageEvent.tsx` |

**Rules, in display order** (all seven from §5): chat reports → join
requests (approval mode only) → postponed, needs a new date → waitlist with
room to promote → stale draft → starting soon with RSVPs off → full with no
waitlist. The first five are "actions" (someone is waiting on the host); the
last two are suggestions and are styled as such. A postponed event raises
only its own row: the others would be noise on an event with no date. One
event can raise several rows. Cancelled, ended and draft rows are never
inspected.

**Honesty about what was checked.** The queue only claims what it looked at.
Rules needing per-event facts (requests, chat reports) fire only for the
inspected events; the rest come from rows the dashboard already has. When
more events exist than the cap, the screen says *"Checked your next 10
events for requests and reports."*

**Cost.** One drafts query plus at most 10 overview calls, each through
Manage event's `['host','event',id,'overview']` key — so opening an event
from a queue row needs no fresh fetch, and that screen's mutations
invalidate the dashboard's copy too. Not persisted: a stale "4 requests
waiting" is worse than silence.

**Verification.**
- `tests/hostDashboard.test.ts`: 40 tests total (14 new for C2), green in 5
  device zones.
- `suiteHostDashboard.mjs`: **49/49**. H6 covers the rules, the urgency
  order and a deep link that genuinely opens Attendees › Requests
  (`aria-selected` = Attendees, Requests); H7 pins the 10-call cap and its
  on-screen note; H8 pins silence when nothing needs the host.
- Regression: suiteHostUi 174/174, suiteB B7-B8, suiteVisual 68/68; 1,195
  unit tests; typecheck and lint clean.

**Found and fixed during verification:** the "Checked your next 10 events"
note was rendered *inside* the queue section, so it disappeared when the
queue was empty — exactly when an unbounded-looking silence is most
misleading. It now renders whenever the fan-out was truncated.

**Not done, and why:** the plan listed "fix `refetchAll` identity churn" in
C2. On inspection that is already fixed (`screens/ManageEvent.tsx` depends
on the stable `refetch` functions and a boolean). The tracker nitpick is
obsolete and is marked so.

---

## 12. C5 — what was built (2026-11-16)

| Piece | File |
| --- | --- |
| `dateActionsFor` (which operations a row allows) + `originalStart` on entries | `utils/hostDashboard.ts` |
| Shared skip / move / restore flow (confirm → "Tell attendees?" → RPC → toast → refresh) | `hooks/useOccurrenceActions.ts` (lifted unchanged from `SeriesDatesSection`) |
| Shared move-date picker | `components/MoveDateModal.tsx` (lifted unchanged) |
| Per-date sheet on the dashboard | `components/AgendaDateActionsSheet.tsx` |
| "Date options" button on series rows | `screens/HostDashboard.tsx` |
| Manage event's "Upcoming dates" now uses the shared hook and picker | `components/SeriesDatesSection.tsx` |

**What the rows allow** (mirrors what the RPCs accept): a scheduled future
date can have its time changed or be skipped; a skipped or moved date can be
restored while its original time is still ahead; one-offs, live dates and
past dates offer nothing. One-off events keep Manage event's reschedule.
"Split series" stays in Manage event only.

**One code path.** The dashboard and Manage event call the same hook, so the
wording, the notify prompt, the error messages and the refresh are
identical. Any change refreshes the series' exceptions and details, plus the
dashboard, wherever it was made.

**Layout.** The options button is a sibling of the row's touchable, not a
child, so there are no nested interactive controls.

**Accessibility defects found and fixed during the browser pass:**
- Every series row's options button had the same name ("Date options for
  Morning yoga, 12:00 PM UTC"), because a daily series has the same time on
  every row. The name now includes the date.
- The sheet's visible text and accessible names differed ("Restore the
  original date" vs "Restore this date"; curly vs straight apostrophe),
  breaking WCAG 2.5.3. Both now come from one `LABELS` constant.

**Verification.**
- `tests/hostDashboard.test.ts`: 44 tests total (4 new).
- `suiteHostDashboard.mjs`: **74/74**.
  - H9: skip from the schedule, sending the right date with notify off, and
    the schedule refreshing.
  - H10: restore, with only Restore offered, and the sheet's names matching
    its text.
  - H11: the move picker opens for the right date, and Cancel sends nothing.
  - H12: regression — Manage event's own Skip still works through the shared
    hook, with notify on and the count reported in the toast.
  - Plus distinct labels for every options button.
- Regression: suiteHostUi 174/174, suiteCollections 168/168, suiteVisual
  68/68.
- 1,199 unit tests; typecheck and lint clean.

---

## 13. C6 web half — what was checked (2026-11-16)

`AXE=node_modules/axe-core/axe.min.js node scripts/fake-backend-e2e/suiteHostDashboard.mjs "$PWD" <dist> all <outDir>`
→ **110/110**, foreground, no database. axe-core is already a dev dependency;
nothing to vendor.

| Scenario | Covers |
| --- | --- |
| **H13** | axe WCAG 2.0/2.1 A + AA on the schedule, with the date sheet open, and with the move picker open; a 22-stop keyboard walk (all stops named, none off-screen, not stuck, every stop shows a focus ring); focus moving into the date sheet; Escape closing both overlays; nothing changed by opening and closing |
| **H14** | 1280 px and 640 px (200 % zoom of 1280): no horizontal overflow, every control named, nothing under 24 px, heading present, no clipped text, plus axe at both widths |
| **H15** | Large text at 1.3× and 1.6×: no overflow, no clipped text, content still renders |

**Defect found and fixed:** the date sheet did not move focus when it opened,
so a keyboard user stayed on the trigger behind the modal and tabbed through
the page underneath, and a screen reader kept reading the schedule. The
overlays that pass this check elsewhere get it from a text field's
`autoFocus`; this sheet has none, so it now focuses its first action (DOM
focus on web, `setAccessibilityFocus` on native — `findNodeHandle` throws on
web and is guarded).

**Test defect found and fixed:** the first version of H15 used Chrome's
minimum-font-size (`Page.setFontSizes`). Measured against a screenshot, it
does **not** affect React Native Web's inline px text — the render was
identical, so the check passed without testing anything. It now scales every
element's computed font size directly, which is what an OS large-text
setting does to RN's px values, and asserts the scale applied (18px → 28.8px
across 326 elements) before measuring.

**Accepted warning:** `label-content-name-mismatch` (WCAG 2.5.3, axe
"experimental") fires 4-5 times per view on the row buttons, as it does
elsewhere in the app — the comma-separated accessible name is not a literal
substring of the row's visible text. Both orderings were tried; clearing it
would mean dropping the punctuation a screen reader uses for pauses. Kept as
a warning, consistent with `suiteA11y`/`suiteHostUi`.

**Cosmetic, not fixed:** at 1.6× text the fixed 78 px time column wraps
"12:00 PM UTC" over three lines. Readable, nothing clipped or overlapping.

**Still outstanding for C6:** the device pass (iOS/Android with VoiceOver /
TalkBack and the OS large-text setting). Web cannot stand in for it.
