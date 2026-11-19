# EventMap roadmap

**Current work (2026-11-18):** the "Finish what's paid for" roadmap — Batch C
→ "Run it again" (duplicate) → a time-simulation test harness → Batch D and
the older backlog. Status, and the two prepared migrations waiting to be
applied, are in
[`docs/ROADMAP_PROGRESS_2026-11-18.md`](docs/ROADMAP_PROGRESS_2026-11-18.md).

This is ongoing product work. Estimates exclude the local setup already implemented.

| Planned work | Deliverable | Estimate |
| --- | --- | --- |
| Chat reliability | Subscribe-before-fetch, reconnect recovery, pagination, focused-screen cleanup | 5-7 h |
| Chat moderation | Reporting, host moderation, server send limits, ban enforcement | 5-7 h |
| Profile and attendance | Refresh on focus, upcoming/history separation, remove remaining mock cards | 3-5 h |
| Workflow coverage | Signup, onboarding, creation, RSVP, two-user chat, leave-event tests on web/native | 5-7 h |
| Authorization review | Profile/admin field restrictions, RPC privacy, ownership and storage policies | 4-6 h |
| Dependency maintenance | Review npm advisories, compatible upgrades, native build verification | 4-6 h |
| Provider/accessibility polish | Production tile configuration, global geocoding, screen-reader and small-screen checks | 4-6 h |

Original estimate: approximately 30-44 hours for the items above, before recent
work; their current status and remaining effort need review.

## Shipped since this roadmap was written

Status verified 2026-11-14. The remaining work for each is tracked in
`docs/ISSUES.md` and `docs/REVIEW_AND_ROADMAP_2026-11-14.md`, not here.

- **Host analytics** — built. `screens/EventInsights.tsx`, business analytics,
  `get_event_insights` / `get_business_analytics` (`20261104100000`, applied).
  Plan and open items: `docs/ANALYTICS_AND_CALENDAR_PLAN.md`.
- **Personal event calendar** — built. `screens/Calendar.tsx`, `app/calendar.tsx`,
  `get_user_calendar` (`20261104110000`, applied). Open: a `webcal://` feed and
  a device run of `.maestro/calendar.yaml`.
- **Offline and poor-connection UX** — built, steps 0-8 of
  `docs/OFFLINE_PLAN.md` (connectivity layer, persisted cache, pending-write
  queue, chat outbox). Verified on web only; never on a device. Note: RSVPs are
  deliberately **not** queued offline (plan §6 decision 1), contrary to the
  original wording of this entry.
- **Event collections** — Phases A-F built 2026-11-12; migration
  `20261112100000` applied. Remaining: the §6-§7 product decisions and the
  §8 steps 3-6 verification. `docs/EVENT_COLLECTIONS_PLAN.md`.
- **Host event playbook** — P1-P7 built 2026-11-13; both migrations
  (`20261113100000`, `20261113110000`) applied. Remaining: type regeneration
  and a real-device pass (P8). `docs/HOST_EVENT_PLAYBOOK_PLAN.md`.
- **Host onboarding** (not previously listed here) — Stages 1-7 built
  2026-11-10; all eight `20261110*` migrations applied. Remaining in
  `docs/HOST_ONBOARDING_PLAN.md` §18-§20: appeals queue, verified badge on
  Discover cards, transfer of ownership, Stage 8 growth.

## Added 2026-11-17: event-journey review + "Preview as attendee"

- **Event-journey review** (`docs/EVENT_JOURNEY_REVIEW_PLAN_2026-11-17.md`,
  findings in `docs/EVENT_JOURNEY_REVIEW_2026-11-17.md`): 26 findings (EJ-1…
  EJ-26).
  - **Built, client-only:** "happening now" for series, review eligibility,
    the chat access rule, the waitlist offered only when it's open, the
    same-day cue and more.
  - **Prepared, not applied:** the server halves, 7 approved migrations in
    `supabase/prepared/2026-11-17_event_journey/`.
  - **Designed:** Batch D, post-event chat window and series reviews, which
    need two answers.
- **"Preview as attendee"** (`docs/EVENT_REHEARSAL_PLAN.md`, Phases 1–5).
  A host walks their own event, or a draft, as a guest:
  - simulated join, leave, request and waitlist; nothing saved;
  - scenarios: when (days before → ended) and how full;
  - a read-only chat preview;
  - entry from Manage event, the checklist and the published sheet.
- What's left for the owner: `docs/ISSUES.md` → "Owner to-do (updated
  2026-11-17)".

## Planned: event comparison + create/join UX (added 2026-11-15)

One roadmap covering two pieces of work that reinforce each other — the
comparison feature needs better-structured event data (price especially), and
the create/join review is where that data is entered and acted on.

Backing documents:

- `docs/EVENT_COMPARISON_PLAN.md` — design, data model, risks, decisions D1-D6.
- `docs/CREATE_AND_JOIN_UX_REVIEW_2026-11-15.md` — 19 findings (J1-J9 joining,
  C1-C10 creating), each with the file and line it was read at.

Findings are tracked as open items in `docs/ISSUES.md`; this table is the
sequencing.

| Phase | Scope | Deliverable | Estimate | Status |
| --- | --- | --- | --- | --- |
| **0** | UX quick wins | J1 in-flight Join state · J3/C9 haptics · J4 post-join next step · J7+C5 44 px targets · J9 approval-mode expectation | 2-3 h | **Done 2026-11-15** |
| **1** | Comparison foundations | `utils/comparePrice.ts`, `utils/compare.ts`, `stores/compareStore.ts` + unit tests. Renderer-free; no UI, no migration | 4-5 h | **Done 2026-11-15** |
| **2** | Create form structure | C1 sticky action bar · C2 required-field progress · C7 time-zone row placement · C8 shorter first-event card | 4-6 h | **Done 2026-11-15** |
| **3** | Price out of hiding | C3 promote price/tickets into the main form · C4 one-tap "Free" chip. Makes Phase 1's parser reliable for the common case | 1-2 h | **Done 2026-11-15** |
| **4** | Compare tray | The dock, selection + 4-item cap, entry points on Saved / Collection detail / Category browse (plan P1), plus a first `/compare` screen in cards form | 4-6 h | **Done 2026-11-15** |
| **5** | Compare screen | `screens/CompareEvents.tsx`: table + cards modes, identical-row collapse, best-value marks, per-column actions (plan P2-P3) | 11-15 h | **Done 2026-11-15** |
| **6** | Reach + verification | Discover long-press entry, `/compare?ids=` deep link (D2), `suiteCompare.mjs`, a11y additions (plan P4-P5) | 5-8 h | **Done 2026-11-15** |
| **7** | Remaining review items | C6 explicit cover choice (withdrawn — already built; hint fixed) · J5/J6 join-state copy · J8 save on Discover cards · C10 font scaling (targeted pass) | 5-8 h | **Done 2026-11-15** |
| **8** | **[DB]** optional | `get_events_compare` RPC — 4 round trips to 1 (plan P6); detailed below | 3-4 h + owner-applied migration | **Migration + suite prepared and validated 2026-11-15; client cutover deferred (D7)** |

**Phases 0-7 are complete (2026-11-15). Phase 8's database half is applied
locally and validated on the isolated engine; its client
half waits on usage (D7). A final regression pass over the whole tree ran the
same day: 18/18 browser suites (1,054 checks), 1,124 unit tests, 13/13 SQL
suites, app + admin typecheck / lint / build all clean — details in
`docs/ISSUES.md` → Done log → "final regression pass". The owner to-do is at
the top of `docs/ISSUES.md`.** What remains is owner work: the hosted-database
inventory (`docs/MIGRATIONS_PENDING.md` item 0), applying item 2 locally when
wanted, and the device checks listed in `docs/ISSUES.md`.

### Phase 8 in detail — `get_events_compare` (optional, [DB])

**What it is.** Today the comparison makes one `get_event_details` call per
column (at most four) through the same query key the event page uses, so
anything already opened is instant and offline-capable. Phase 8 replaces the
cold path with one RPC returning every column at once:

```sql
get_events_compare(p_event_ids uuid[], p_lat double precision, p_lng double precision)
  → setof (event row + business name/verified + category label
           + rsvp_count, save_count, waitlist_count
           + user_rsvp, user_saved           -- auth.uid()-scoped, null anon
           + distance_km                     -- from (p_lat, p_lng), server-side
           + next_start_datetime)            -- event_next_effective_occurrence
```

**Steps (3-4 h of agent work + the owner's apply):**

1. Migration `supabase/migrations/2026MMDD…_get_events_compare.sql`: the
   function above, `SECURITY INVOKER` so RLS still decides visibility (an
   unlisted event is returned by id, as the event page does; a cancelled or
   unpublished one is not), `REVOKE EXECUTE FROM PUBLIC` + `GRANT` to
   `anon, authenticated`, a cap of 4 ids (raise on more), and the effective
   next date — fixing E-R1 for this surface at the same time.
2. `scripts/test-events-compare.sql`: ASSERT-based, rollback-only suite in the
   house style — visibility (public / unlisted / cancelled / draft), viewer
   state for anon vs. signed-in, distance against `calculate_distance`, the
   4-id cap, and that **nothing is asserted by calling the function under
   `SET ROLE`** (the supautils segfault rule) — `has_function_privilege` only.
3. Run it on the isolated PG17 container only (`scripts/pg17-isolated.sh`),
   never the shared cluster. Record the result in `docs/ISSUES.md`.
4. Client: `hooks/useCompareEvents.ts` gains a batch path — one `useQuery`
   keyed `['event','compare', idsKey, lat, lng]` that fans the rows out into
   the per-event `eventDetails` cache entries, so the event page still
   benefits. Per the client/schema policy, **no probe-and-retry fallback**:
   the client targets the migration set once the owner has applied it.
5. `npm run backend:types`, `scripts/regress-host-tools.mjs`-style shape check
   against a private PostgREST, and a `suiteCompare` scenario asserting one
   request instead of four.

**Decisions before phase 8 starts:**

- **D7 — Do it at all?** Four small requests, deduplicated against the
  details cache, is not a user-visible problem today. The honest trigger is
  usage data (comparisons opened per week) or a cold-path latency complaint.
  **Decided 2026-11-15: prepare the migration, defer the client cutover**
  until the feature has shipped to real users.
- **D8 — Ride D3 on the same migration?** If numeric price columns
  (`price_min`, `price_max`, `currency`, `is_free`) are wanted, one migration
  can carry both; the RPC would then return the numeric price and the
  "Cheapest" mark could drop the free-text parser. **Decided 2026-11-15: only
  if D3 is a yes** — D3 is still open, so the prepared file is single-purpose.
- **D9 — Viewer state in the RPC?** Returning `user_rsvp` / `user_saved`
  makes the function `auth.uid()`-dependent (fine, the details RPC already
  is). **Decided 2026-11-15: included** (null / false for anon).
- **D10 — Hosted databases.** No hosted project's migration state has ever
  been checked. **Decided 2026-11-15: inventory first.** The runbook is
  `docs/MIGRATIONS_PENDING.md` item 0; it is owner work (needs the hosted
  connection), and the prepared file stays local-only until it has a row per
  project.

**Deviation from the sketch above, recorded:** the function is
`SECURITY DEFINER` with `get_event_details`' draft gate, not
`SECURITY INVOKER`. Events RLS hides cancelled events from visitors, but the
event page shows them (with their status) through its definer RPC — and the
comparison has to see exactly what the event page sees, or a column would
vanish where the page says "Cancelled".

Decisions, by the phase that needs them (all six are in the plan's §7 and
mirrored under "Needs a product decision" in `docs/ISSUES.md`):

- **Phase 3** — none required. **D3** (numeric price columns, [DB]) only
  decides whether phase 3's Free chip is the permanent answer or an interim
  one; the chip is useful either way.
- **Phase 4** — **D1** (session-only tray) and **D5** (cap of 4): **confirmed
  by the owner 2026-11-15**, kept as built.
- **Phase 5** — **D4 decided 2026-11-15:** a large system font switches to
  cards mode automatically; the toggle stays.
- **Phase 6** — **D2 decided 2026-11-15:** `/compare?ids=…` is shareable,
  dropping unlisted events the opener could not already see. **D6 decided
  2026-11-15:** long-press is the only Discover entry; the header keeps two
  controls.

## Planned: recurrence review + host dashboard (added 2026-11-16)

Three roadmaps, tracked in
`docs/HOST_DASHBOARD_AND_RECURRENCE_REVIEW_2026-11-16.md`:

- **A — recurrence correctness (client):** A1-A3, A5 done 2026-11-16; A4
  deferred (needs an isolated database run).
- **B — server recurrence and architecture debt:** B5, B6 done 2026-11-16;
  B1-B4 deferred (database work, done last).
- **Database work from all three roadmaps** is consolidated in
  `docs/MIGRATIONS_PENDING.md` §2b (items 2b-1 … 2b-10); nothing is written
  and the shared database is untouched.
- **C — host operations dashboard:** C0 (design, `docs/HOST_DASHBOARD_PLAN.md`)
  C1 (the `/hosting` agenda), C2 ("Needs you") and C5 (per-date skip / move /
  restore) and C6's web half (110 browser checks) done 2026-11-16; C6's
  device pass, C3 and C4 remain.

## Additional ideas

- **Host workflow UI review:** keep `scripts/fake-backend-e2e/suiteHostUi.mjs`
  green as host screens change (labels, 44 px targets, 320 px layout,
  host-type wording), and extend it to large widths, font scaling and native.
- **Discovery modes:** "Surprise me", "My neighbourhood" and "Just added"
  browse modes on Discover, built on the ranked-events RPC and the browse
  centre. Planned in `docs/DISCOVERY_MODES_PLAN.md` (20-30 h; 15-22 h without the
  server sort change). Proposal only — nothing built, and the six decisions in
  §6 are open.
- **Host tools Phase 4:** attendee check-in + QR, CSV export, event sections
  and co-hosts (`business_members`). `docs/HOST_TOOLS_PLAN.md` §11.

These ideas have not yet been scoped or estimated. Hosted deployment, production
payments, device push, and store releases remain separate decisions.
