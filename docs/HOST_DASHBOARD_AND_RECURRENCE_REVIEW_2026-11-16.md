# Host dashboard + recurrence/architecture review — plan (2026-11-16)

Scope requested: (a) a host dashboard — one place for attendance, times,
events and day-to-day operations; (b) a performance and architecture review,
focused on the recurring-events system; (c) a sweep of `docs/` for
outstanding related issues.

**Structure: three separate roadmaps (A, B, C), each split into phases.**
Roadmap A was executed on 2026-11-16 as far as is possible without a
database; its status is recorded per phase below.

**Standing constraints (owner, 2026-11-16):**

- Never modify the shared database. SQL work happens only in an isolated
  environment (`scripts/pg17-isolated.sh`).
- Migrations are *prepared* as files and validated in isolation; the owner
  applies them.
- No long-running background processes (E2E/browser suites, servers). Long
  work runs in the foreground only.

---

## 1. What already exists (do not rebuild it)

| Piece | Where | What it already answers |
| --- | --- | --- |
| My Events | `screens/MyEvents.tsx` | Upcoming / Drafts / Past, per-row counts (`get_host_events_counts`) |
| Manage event hub | `screens/ManageEvent.tsx` | Overview · Attendees · Settings · Chat for **one** event |
| Host overview facts | `get_event_host_overview` (`20261103100000`) | going, waitlist, pending, views — per event |
| Insights | `screens/EventInsights.tsx`, `20261104100000` | Premium analytics per event / business |
| Event playbook | `utils/eventPlaybook.ts`, `20261113100000/110000` | Phase-aware per-event checklist |
| Getting-started checklist | `utils/hostChecklist.ts` | Per host profile |
| Phase model | `utils/hostEvent.ts` | `draft \| upcoming \| live \| ended \| postponed \| cancelled` |
| Per-date operations | `20261109140000`, `20261109150000` | skip / reschedule / restore a date; per-date RSVP, counts, waitlist |

**The gap:** everything is scoped to one event or to the profile. Nothing
gives a cross-event, time-ordered "what needs me today / this week" view, and
"attendance" cannot mean attendance until check-in exists (host tools Phase 4,
never started).

---

## 2. Recurring events — findings

### 2.1 Client defects — FIXED 2026-11-16

All three came from the 731-day, one-day-at-a-time walk in
`getNextOccurrences` (`utils/recurrence.ts`), which silently returned short
lists.

| ID | Defect (measured before the fix) | Status |
| --- | --- | --- |
| R1 | Monthly every 3 months, 12 requested → **8** returned; `interval` up to 99 is legal, so a valid pattern could return none | Fixed |
| R2 | Series starting >~2 years out → `[]` (walk began at *today*); blank next date. An existing test pinned this as intended | Fixed; test corrected |
| R3 | `endDateAfterCount` → `null` for 25 monthly, 36 monthly, 60 every-2-weeks — "Ends after N times" could not store ordinary values | Fixed |

**The fix.** `getNextOccurrences` now generates candidates by stepping whole
occurrences (days / Monday-based weeks / months) from
`max(today, series start)` — the same lower bound the server uses
(`GREATEST(now, start)`). `isEventOnDate` is still the single matching rule;
candidates are filtered through it, so the speed-up cannot change which days
match. A 10,000-step guard bounds malformed input only. Public signature and
the documented midnight behaviour (today's earlier slot is included) are
unchanged.

**Evidence.** New `tests/recurrenceHorizon.test.ts` (22 tests): R1-R3
regressions, an **equivalence suite** comparing the new generator with an
uncapped day-by-day reference across 12 pattern shapes × 5 starts (31st, last
weekday, Sunday, leap day, future) × 3 "now" values, and a Lisbon DST check.
Recurrence + occurrence + calendar + ICS tests also pass under
`TZ=America/New_York`, `Australia/Lord_Howe` (30-min DST),
`Pacific/Kiritimati` (UTC+14) and `America/Santiago` (midnight DST). Full
unit suite **1,146 / 93 files** green; `tsc` and eslint clean.

### 2.2 Withdrawn

- **R4 (nthWeekday "4th" vs "last")** — not a bug. The SQL matcher
  (`20261109130000:73-82`) uses the same `ceil(day / 7)` rule as the client.
  A 4th-Thursday series correctly fires on a month's 4th Thursday even when
  that is also its last. The earlier reading confused a label helper
  (`weekOfMonthFor`) with the match rule.

### 2.3 Server-side findings (need a migration — not changed)

- **S1 — monthly drift after a clamped date (low severity).**
  `event_next_occurrence`'s v1 monthly path (`20261109130000:173-176`) adds
  `+N months` to the already-clamped candidate. For a series on the 29th-31st,
  between a short month's occurrence and that month's end (a window of
  hours), the server names 28 Mar instead of 31 Mar (30 May instead of
  31 May, …). The client is correct; pinned by a test in
  `tests/recurrenceHorizon.test.ts`. Fix: compute each candidate as
  `start + (k × N) months` instead of incrementing the candidate.
- **S2 — v2 walk is capped at 800 days.** For `byWeekday` / `nthWeekday`
  series (`20261109130000:145`), an interval beyond ~26 months (nthWeekday) or
  ~114 weeks (byWeekday) runs off the cap and returns the **series start** as
  the next date. Legal (`interval ≤ 99`) but rare. Same stepping approach as
  the client fix.
- **E-R1 (open since 2026-11-09)** — ranking, saved/going, calendar and
  collection RPCs use `event_next_occurrence`, not
  `event_next_effective_occurrence`; skipped/moved dates still rank. Design
  decided and measured; migration never written.
- Ended-series counts on profile/venue include finished series
  (`docs/ISSUES.md:522`).

### 2.4 Performance — measured 2026-11-16 (B6)

`npm run bench:recurrence` (`scripts/perf/bench-recurrence.mjs`; pure client
logic, no database or browser, runs in the foreground in ~2 s). Node 22.13,
darwin/arm64; 200 iterations after warm-up; series spread over 7 pattern
shapes and 4 zones:

| Scenario | Median | p95 |
| --- | --- | --- |
| 50 cards × `getNextOccurrences(_, 1)` | 0.535 ms | 0.662 ms |
| 50 cards × `getNextOccurrences(_, 5)` | 1.489 ms | 1.638 ms |
| Calendar month: `filterEventsByDateRange(200 events, 31 days)` | 1.159 ms | 1.225 ms |
| `listOccurrences(count 8)` with 5 exceptions | 0.120 ms | 0.189 ms |
| `listOccurrences(count 8)` × 50 series | 3.314 ms | 3.449 ms |
| `exceptionsForIcs` (200 occurrences) | 1.648 ms | 1.773 ms |

**Conclusion: do not memoise anything yet.** Every shape the app asks for is
well inside one animation frame, including the heaviest (50 series × 8
occurrences each). The suspicions in the original review are answered:
`filterEventsByDateRange` being events × days costs ~1 ms at 200 events, and
`listOccurrences`' triple filter is ~0.1 ms. Revisit only if the host
dashboard (Roadmap C) pushes these an order of magnitude — the benchmark is
in the repo to re-run.

Still open, unaffected by the measurements:

- `filterEventsByDateRange` ignores per-date exceptions (a skipped date still
  matches a range).
- `refetchAll` identity churn in `screens/ManageEvent.tsx:378-386` matters
  once a dashboard polls.

### 2.5 Other outstanding items (context)

Hosted-database inventory never done (`docs/MIGRATIONS_PENDING.md` item 0);
`npm run backend:types` outstanding; production map tiles remain the release
blocker; no component/e2e layer.

---

## 3. Roadmap A — Recurrence correctness (client)

| Phase | Scope | Status |
| --- | --- | --- |
| **A1** | Regression tests for R1-R3 | **Done 2026-11-16** |
| **A2** | Occurrence-stepping walk in `getNextOccurrences`; equivalence suite vs. day-by-day reference; multi-zone runs | **Done 2026-11-16** |
| **A3** | Verify R4 against SQL | **Done — withdrawn (not a bug)**; surfaced S1 and S2 instead |
| **A4** | Widen the SQL parity fixture: regenerate with `scripts/recurrence-parity.sql` on the isolated PG17 container, first-N-dates output, long-interval / far-future / month-end shapes | **Blocked** — needs Docker access on the isolated container, not available in this session. Owner action or permission to run `scripts/pg17-isolated.sh` (foreground) |
| **A5** | Ratify Categories **D1** and record it on both sides | **Done 2026-11-16.** Owner decided: **the next real occurrence**, never a date the event does not happen on. Ratifies shipped behaviour; recorded in `docs/ISSUES.md` and `docs/CATEGORIES_AND_SERIES_PLAN.md` §7 Phase D; pinned by `tests/recurrenceHorizon.test.ts` |

---

## 4. Roadmap B — Server recurrence and architecture debt

Each phase is one prepared migration or one client change, validated on the
isolated container, applied by the owner.

| Phase | Scope | Est. | Status |
| --- | --- | --- | --- |
| **B5** | Venue "Upcoming" stat: subtract finished recurring series; align the filter with the list | 1-2 h | **Done 2026-11-16** |
| **B6** | Client-side recurrence benchmark; decide on memoising | 3-4 h | **Done 2026-11-16 — see §2.4. Answer: do not memoise** |
| **B1** | Prerequisites: hosted-database inventory; `npm run backend:types` | owner | **Deferred** (§7) |
| **B2** | Prepared migration: `event_next_occurrence` v1 monthly fix (**S1**) + stepping v2 walk without the 800-day cap (**S2**); ASSERT suite; regenerate the parity fixture (completes A4) | 3-5 h | **Deferred** (§7) |
| **B3** | Prepared migration: **E-R1** — ranking, saved/going, calendar and collection RPCs to `event_next_effective_occurrence` (design + measurements already in `docs/MIGRATIONS_PENDING.md` §2) | 3-4 h | **Deferred** (§7) |
| **B4** | Client follow-up to B3: retire or demote `useEffectiveNextDates` where B3 makes it dead | 2-3 h | Blocked on B3 |

**B5, what changed.** `getBusinessEventsCount` kept every `is_recurring` row
in the "Upcoming" stat forever, while the list beneath it drops ended series
with `hasEventEnded` — so the number disagreed with the rows. The end date
lives in `recurrence_pattern` jsonb and is judged on the event's own calendar
day, which a PostgREST filter cannot express; rather than introduce an
unverifiable JSON-path filter (no DB access this session), the service now
fetches the recurring rows' timing fields (bounded at 200, one extra query
only when the venue has any upcoming events) and subtracts the finished ones
with the same helper the list uses. A second defect found in the same filter:
it used `status = 'active'` with **no `publish_state` filter**, so the stat
counted unpublished drafts and omitted postponed events; it now mirrors the
list. Nine tests in `tests/businessEventsCount.test.ts`, including the
zone-boundary case and the >200-series fallback. The matching check in
`scripts/regress-isolated.mjs` was updated for whenever an isolated stack is
next run.

Remaining in B: ≈ 8-12 h, all of it gated on database access.

---

## 5. Roadmap C — Host operations dashboard

A feature, not a cleanup. Builds on A (done) and benefits from B3.

Full design, data plan, rules and decisions: **`docs/HOST_DASHBOARD_PLAN.md`**.

| Phase | Scope | Est. | DB? | Status |
| --- | --- | --- | --- | --- |
| **C0** | Design + decisions doc | 3-5 h | No | **Done 2026-11-16.** DC1-DC3 decided |
| **C1** | Agenda: "Today & next 7 days" across all the host's events, series expanded with skips/moves; new `app/hosting.tsx` screen + Profile "Today" card | 6-8 h | No | **Done 2026-11-16** — plan §10 |
| **C2** | Needs-attention queue (7 rules: chat reports, requests, postponed, waitlist, RSVPs off, stale draft, just filled); bounded overview fan-out (≤ 10) | 5-7 h | No | **Done 2026-11-16** — plan §11 |
| **C3** | `get_host_dashboard` — one request instead of up to 17 | 4-6 h | **Yes** | Deferred (§6) |
| **C4** | Check-in + QR + CSV export (host tools Phase 4); premium | 12-18 h | **Yes** + device | Deferred (§6); needs DC6 |
| **C5** | Per-date operations from the agenda (skip / reschedule / restore) over existing RPCs | 5-7 h | No | **Done 2026-11-16** — plan §12 |
| **C6** | Browser suite (foreground only), a11y, 320 px, large font; device pass | 5-8 h | Web no / device yes | **Web half done 2026-11-16** (110/110) — plan §13. Device pass outstanding |

Remaining ≈ 18-27 h, **none of it database-free**: C6's device half needs a
phone, C3 and C4 need migrations (C4 also a device and DC6).
`suiteHostDashboard.mjs` stands at 110 checks across C1, C2, C5 and C6-web.

---

## 6. Deferred database work — do this last, together

Owner instruction 2026-11-16: anything needing a migration or the shared
database is noted here and left until everything else is done. Nothing in
this list has been started. In the order it should be tackled:

| # | Work | Why it needs the database | Prepared? |
| --- | --- | --- | --- |
| 1 | **Hosted-database inventory** (`docs/MIGRATIONS_PENDING.md` item 0) | Needs the hosted connection. No hosted project's migration state has ever been checked, including the Oct 30 security set | Runbook exists |
| 2 | **`npm run backend:types`** | Reads the live local schema; generated types are ~510 lines behind | — |
| 3 | **A4 — widen the parity fixture** | `scripts/recurrence-parity.sql` on an isolated PG17 container; needs Docker. Output must become first-N-dates, not next-date only, plus long-interval / far-future / month-end shapes | Script exists, needs extending |
| 4 | **B2 — `event_next_occurrence` S1 + S2** (+ O-5: `endDate >= start` in the validation trigger) | New migration + ASSERT suite, validated in isolation, applied by the owner | Not written; §2.3 has the fix |
| 5 | **B3 — E-R1 server half** | New migration across ranking, saved/going, calendar and the three collection RPCs | Not written; design + measurements in `docs/MIGRATIONS_PENDING.md` §2 |
| 6 | **B4 — client follow-up to B3** | Only meaningful once B3 is applied | — |
| 7 | **C3 / C4 migrations** (dashboard RPC, check-in) | Roadmap C, much later | — |

Two already-updated files are waiting for the next isolated run and need no
new work: `scripts/regress-isolated.mjs` (B5's filter and correction query)
and the S1 expectation pinned in `tests/recurrenceHorizon.test.ts`.

## 7. Decisions for the owner

1. ~~**D1 (Categories)**~~ — **decided 2026-11-16: the next real
   occurrence.** Closed; see A5 and `docs/CATEGORIES_AND_SERIES_PLAN.md`.
2. **Docker for isolated runs (blocks A4 and validating B2/B3).** A command
   checking Docker was denied this session. When the deferred database work
   starts, allow `scripts/pg17-isolated.sh` to run in the foreground.
3. **S1 + S2 packaging** — recommended: one prepared migration carrying both
   server recurrence fixes, written and validated alongside E-R1 (B3) rather
   than on its own, since all three touch the same function family.
4. ~~What runs next~~ — C0 done 2026-11-16.
5. ~~Dashboard decisions DC1-DC3~~ — **decided 2026-11-16 as recommended**:
   own screen + Profile "Today" card; free; 7 days. DC4 (skipped dates
   struck through) was implemented as recommended without being asked.
   **DC5 decided 2026-11-16: 10 events**, approval-mode first. DC6
   (check-in scope) is still open and is needed by C4.

---

## 8. Review round 2 (2026-11-16) — dashboard + recurrence

Light-touch pass after C6-web; basic tests only, the thorough regression
round is next.

**Fixed this round**

| # | Area | Finding | Fix |
| --- | --- | --- | --- |
| R2-1 | Recurrence | `filterEventsByDateRange` (Discover "Today"/"This weekend", Category Browse) judged series on the device-local weekday of the first start. Wrong for a zoned series whose local time crosses the viewer's midnight on one side of a DST change: a Tokyo 13:30 Tuesday class is Monday 23:30 in New York in winter but Tuesday 00:30 in summer, and the old filter said Monday all year | Uses real occurrence instants (`getNextOccurrences`). Zone-less events are proven unchanged by an equivalence test against the old code. `tests/filterByDateRange.test.ts`, green in 4 zones |
| R2-2 | Dashboard | The Profile "Today" card quoted a cache of any age (it never fetches). A host who last opened `/hosting` weeks ago could be told "Nothing on this week" while events existed | Cache older than 12 h → invitation copy instead (`CARD_CACHE_MAX_AGE_MS`) |
| R2-3 | Dashboard | Stale-draft rule read 20 drafts **newest-first**, so a host with more than 20 never saw the oldest — exactly the ones the rule targets | Limit raised to 50 (still one request) |
| R2-4 | A11y | `CollectionActionsSheet`, `EventPublishedSheet` didn't move focus on open (same defect as the C6 date sheet) | Shared `hooks/useFocusOnOpen.ts`, used by all three sheets |
| R2-5 | A11y | Large text never tested outside the dashboard | `scaleText` / `layoutFacts` in `lib.mjs`; new `suiteA11y` scenario **T** (8 main screens × 1.3×/1.6×): 34/34, no overflow |

**Withdrawn:** "a series can end before it starts" — Create and Edit both
already reject it (`create.tsx`, `EditEvent.tsx:524-532`). Only the SQL
trigger lacks the check (API writes bypass the client) → deferred list.

**Round 3 (2026-11-16) — the open items**

| # | Outcome |
| --- | --- |
| **O-1** | **Fixed.** Discover's date filter now drops a series whose only date in the window was skipped. Exceptions arrive after the load-time filter, so the row disappears once they do; the check is `hasEffectiveDateInRange` (`utils/occurrences.ts`), shares Discover's existing exceptions query (no extra request), and is unit-tested. **Residual:** a date moved *into* the window still cannot be added back — that row is not in the fetched set at all, and needs the server (E-R1 / 2b-7). |
| **O-2** | **Partly withdrawn, detector fixed.** The clipped tab labels were an artifact of the test: the tab bar sets `tabBarAllowFontScaling: false` on purpose, which `scaleText` overrides. No device bug. The detector gained vertical-clipping detection, which first produced ~30 false hits from intended `numberOfLines` truncation, so clamped and ellipsised text is now excluded; the caveat about forced scaling is documented on `layoutFacts`. Clean afterwards except two benign sideways hits (a horizontally scrolling chip row, and Discover's search placeholder ellipsising at 1.6×). |
| **O-3** | **Fixed.** The dashboard clock re-arms at the next local midnight, so a screen left open overnight stops showing yesterday as "Today". One timer, re-armed per day, guarded against a backwards clock jump. |
| **O-4** | **Fixed.** The time column grows with the text (`minWidth: 78, maxWidth: 45%`) instead of wrapping "12:00 PM UTC" over three lines at 1.6×. |
| **O-5** | Unchanged — server-side `endDate >= start`; now tracked as `docs/MIGRATIONS_PENDING.md` item **2b-6**. |
| **O-6** | Unchanged — accepted axe warning (plan §13). |

### Full regression round, 2026-11-16 (foreground, no database)

| Suite | Result |
| --- | --- |
| Unit (vitest) | **1,207** in 96 files |
| `tsc --noEmit` (app) | clean |
| `npm run lint` | 0 errors, **7 warnings — the documented baseline**, none in any file this programme touched |
| suiteHostDashboard (with axe) | **110/110** |
| suiteA11y S,E,V (with axe) | **138/138** |
| suiteA11y T (large text 1.3×/1.6×) | **34/34** |
| suiteHostUi | **174/174** |
| suiteCollections (K1-K12) | **168/168** |
| suiteVisual | **68/68** |
| suiteCompare | **45/45** |
| suiteA / suiteB / suiteD / suiteF | **21/21 · 46/46 · 30/30 · 25/25** |

Not run: suiteC (stress) and the device-only passes. Every suite ran in the
foreground, one per command — chaining them exceeds the 600 s limit and gets
moved to the background, which happened once on 2026-11-16 and was stopped.

**Database work from this programme is consolidated in
`docs/MIGRATIONS_PENDING.md` §2b** (items 2b-1 … 2b-10), in the order to
tackle it. Nothing there is written, and nothing has touched the shared
database.

