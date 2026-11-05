# Host analytics and personal calendar plan

Status: written 2026-11-04. Proposal only; nothing implemented, nothing applied
to any database. Covers two roadmap items: **host analytics** (a host sees real
stats for each event and across events) and a **personal events calendar** (an
attendee sees their upcoming events in a calendar/agenda view).

Ground rule for all work below: the shared local Supabase DB is used by other
dev sessions. No resets, no migrations applied there. Every SQL change is
validated on a per-worktree scratch copy (`SCRATCH_DB=eventmap_scratch_<tag>
scripts/db-scratch.sh refresh|apply|psql`) and, for client-visible checks, the
isolated PostgREST stack in `scripts/e2e-isolated-env.sh`. Migration files are
committed as "prepared, not applied", the same way the `20261103*` set was.

---

## Part 1 — Host analytics

### 1.1 What exists today

| Piece | Where | State |
| --- | --- | --- |
| `event_views` table + `track_event_view(event_uuid)` | `20260225000000` | Real. One row per viewer per event per day (unique index). Owner self-views skipped. **Anonymous viewers are not counted** (returns early when `auth.uid()` is null). |
| `get_business_analytics(business_uuid, days)` | `20260225000000` | Real, owner-checked, **not tier-gated server-side**. Returns totals, 5 top events, daily trend. Counts drafts and cancelled events as "posts"; `upcomingEvents` is `start_datetime >= now()` so it ignores recurrence, cancelled and drafts. Granted to the default roles (anon included). |
| `get_event_host_overview(p_event_id)` | latest in `20261103170000` (prepared) | Live per-event counts: going / interested / waitlist / requested / removed / saves / `views_total` / `views_7d` / announcements today / chat stats. Host-or-admin. No time series. |
| `app/profile-analytics.tsx` | client | Business-wide screen on `get_business_analytics`. Hand-rolled bar "chart" (`trendBars`), KPI cards, `LockedAnalytics` blurred preview for free tier. Manual state, no React Query. |
| `app/business/event-insights/[id].tsx` | client | Per-event screen. Real saves/RSVP from `get_event_details`; everything else is `premiumService.getSampleEventAnalytics` with "Sample data" badges. Gate is client-only (`isPremium && canUse('analytics')`). Linked from My Events rows, Event Detail owner block and the Manage hub Overview. |
| `host_announcements` + `notifications.read` | `20261103130000` (prepared) | Enough to compute announcement reach and read rate. |
| `rsvps` | initial schema | Only `created_at`; status flips overwrite the row and leaving deletes it, so there is **no history** (no "left" count, no interested→going conversions). |
| Share / ticket / map taps | — | Not tracked at all. `shareEventLink` and the ticket link open with no server call. |

Also relevant: `businesses.subscription_tier IN ('free','premium')` is the
only tier source; `is_admin_user()` exists; the `test-host-tools.sql` pattern
(single transaction, `pg_temp.login(uid)`, `ASSERT`, rollback) is the way to
test RPCs on scratch.

### 1.2 Goals and non-goals

Goals
- Replace every "Sample data" card with real numbers from one per-event RPC.
- Give hosts the questions they actually ask: how many people saw it, how many
  of those committed, when do people RSVP relative to the date, did my
  announcement land, is the room going to fill.
- Fix the correctness bugs in `get_business_analytics` and gate both analytics
  RPCs server-side (plan `HOST_TOOLS_PLAN.md` §4H, Phase 4 "real insights").
- Aggregates only. Hosts already see the attendee list, but analytics must not
  add new per-person information (no "who viewed", no per-user timelines).

Non-goals (this plan)
- Check-in rate (needs the Phase 4 check-in feature first; leave a slot).
- Revenue/ticket sales (no payments in the product).
- Cohort or geo analytics on viewers (privacy; no viewer location is stored).

### 1.3 Server design

One prepared migration, `supabase/migrations/20261104100000_event_insights.sql`,
ordered after the `20261103*` set (it reads `host_announcements`,
`event_bans`, `rsvps.status = 'requested'`, `publish_state`).

**A. `get_event_insights(p_event_id uuid, p_days integer DEFAULT 30) RETURNS json`**
`SECURITY DEFINER`, `STABLE`, `SET search_path = public`, `GRANT EXECUTE TO
authenticated` only (revoke from anon/public).

Checks, in order: authenticated → event exists → caller is the owner of
`events.business_id` or `is_admin_user()`. `p_days` clamped to 7..365 (free
tier is forced to 30). The RPC does **not** raise for free businesses: it
returns `"tier": "free" | "premium"` and leaves the premium-only sections
(`trend`, `lead_time`, `audience`, `announcements`, `chat`,
`business_median`) as `null`, so the screen can render locked cards instead
of an error. See §1.8 for the split. Admins get the premium payload.

Returned shape (all integers unless noted):

```
{
  "event": { "id", "title", "start_datetime", "timezone", "status",
             "publish_state", "max_attendees", "created_at" },
  "period_days": 30,
  "totals": {
    "views": N, "unique_viewers": N, "views_period": N,
    "saves": N, "going": N, "interested": N, "requested": N,
    "waitlist": N, "removed": N,
    "fill_rate": float|null,          -- going / max_attendees
    "view_to_going": float,           -- going / unique_viewers (0 when no views)
    "view_to_save": float
  },
  "trend": [ { "date": "YYYY-MM-DD", "views", "saves", "going", "going_cumulative" } ],
  "lead_time": { "same_day", "d1_3", "d4_7", "d8_14", "d15_plus" },
                                       -- buckets of (start - rsvp.created_at) for going rows
  "audience": {
    "followers_going": N,              -- going attendees who follow the business
    "returning_going": N,              -- going attendees with a past 'going' at another event of this business
    "first_time_going": N
  },
  "announcements": { "sent", "recipients", "read" },
  "chat": { "messages", "active_senders" },
  "business_median": { "views": N, "going": N }   -- median over this business's published, non-cancelled events; for "vs your usual"
}
```

Notes
- `trend` uses `generate_series` in the **event's zone** when `timezone` is
  set (`viewed_at AT TIME ZONE e.timezone`) so day buckets match what the
  host sees in the hub; falls back to UTC like `get_business_analytics`.
- `lead_time` is computed from `rsvps.created_at`, which is the row's first
  creation. Because `join_event_with_capacity` upserts, an interested→going
  flip keeps the original `created_at`; document this in the UI copy ("since
  they first RSVP'd").
- Counts for `removed`, `requested`, `waitlist`, `announcements` reference
  tables from the prepared `20261103*` migrations, so the RPC needs those
  applied first. Same ordering constraint the hub already has.

**B. Harden `get_business_analytics`** (same migration, `CREATE OR REPLACE`)
- Exclude `publish_state = 'draft'` from every aggregate; exclude
  `status = 'cancelled'` from `upcomingEvents`; use
  `event_next_occurrence(...) >= now()` for upcoming so recurring series count
  correctly (fixes the cosmetic ISSUES item about the Created stat).
- Same tiering as above: totals for everyone, `trend` and `topEvents` null
  on the free tier, plus `tier` in the payload. `REVOKE EXECUTE FROM anon, public`.
- Add `periodViews`, `periodSaves`, `periodRsvps` (window totals) so the KPI
  row can show "last 30 days" without summing the trend client-side.
- Top events: include `start_datetime`, `status` so the client can label them.

**C. Optional, phase B: `event_interactions`**
```
event_interactions(id, event_id, viewer_id null, kind text CHECK IN
  ('share','ticket_click','map_open','calendar_add'), created_at, day date)
unique (event_id, viewer_id, kind, day) where viewer_id is not null
track_event_interaction(p_event_id uuid, p_kind text) RETURNS void
```
Same privacy posture as `event_views` (owner self-taps skipped, no anon
tracking). Surfaces "Share taps", "Ticket link taps" and "Added to calendar"
in the insights screen. Client hooks: `shareEventLink` callers in
`EventDetail`, the ticket pill, the Google/ICS calendar actions.

**D. Optional, phase B: RSVP history**
A trigger-maintained `rsvp_history(event_id, user_id, from_status, to_status,
at)` (statuses include `left`) enables "cancelled their RSVP" counts and a
true going-over-time curve. Costs one row per change; worth it only if hosts
ask for drop-off. Defer unless requested.

**E. Anonymous views** — count unauthenticated detail views without identity
in a daily counter table (`event_view_daily(event_id, day, anon_views)`) via
`track_event_view` when `auth.uid()` is null. Low value until the web build is
public; defer.

### 1.4 Client design

Files
- `services/analytics.ts`: add `getEventInsights(eventId, days)` with the same
  defensive mapping as `getBusinessAnalytics`; map `premium_required` to a
  typed `AnalyticsLockedError` so the screen shows the upgrade state even if
  the client-side tier check is stale. Remove `premiumService.getSampleEventAnalytics`
  once the screen no longer imports it.
- `types/database.ts`: `EventInsights` type mirroring §1.3A. Regenerate
  `types/supabase.generated.ts` only after the migration is applied somewhere
  the generator can read (scratch is fine: point the generator at it).
- `hooks/queryKeys.ts`: `eventInsights(eventId, days)`,
  `businessAnalytics(businessId, days)`. Both screens move to `useQuery` +
  `useRefetchOnFocus`, matching `JoinedEvents`.
- New `screens/EventInsights.tsx`, routed from the existing
  `app/business/event-insights/[id].tsx` (keep the path so the three entry
  points stay valid). Layout with existing primitives (`ScreenHeader`,
  `SegmentedControl` for 7 / 30 / 90 days, `SettingsSection`-style cards):
  1. Header card: title, status badge, "vs your usual" delta vs
     `business_median` (views, going).
  2. KPI grid: Views, Unique viewers, Saves, Going (+ "/ cap" and fill bar
     when capped), Interested, Waitlist, Requested (only when approval mode).
  3. Funnel: Views → Saves → Going with percentages.
  4. Trend: daily bars (views/saves/going) with a metric toggle and a
     cumulative going line. Extract the bar renderer from
     `profile-analytics.tsx` into `components/analytics/TrendBars.tsx` so both
     screens share it (the current one is inline styles only).
  5. Lead time: five-bucket horizontal bars with a one-line reading
     ("Most people RSVP 1–3 days before").
  6. Audience: followers / returning / first-time split.
  7. Announcements and chat cards (hidden when zero).
  8. Locked state for free tier: reuse the `LockedAnalytics` blurred preview
     pattern with "Upgrade" CTA; forbidden/not-found/error states via
     `ErrorState`.
- `app/profile-analytics.tsx`: consume the new fields, link each top event to
  its insights screen, use the shared `TrendBars`.
- `screens/ManageEvent.tsx` Overview: no new data; the Insights quick action
  stays. Optionally show `views_7d` sparkline later.
- Pure helpers in `utils/analytics.ts` (`bucketLeadTime`, `pct`, `funnel`,
  `deltaVsMedian`, trend normalisation) with `tests/analytics.test.ts`.

Copy rules: no "sample data" anywhere; state the counting rule in a footnote
("Views count one signed-in person per day; your own visits are excluded").

### 1.5 Testing

- `scripts/test-event-insights.sql` in the `test-host-tools.sql` style:
  seed views/saves/RSVPs for the demo host's event, assert totals, trend
  length = `p_days`, lead-time buckets, tier gate (free business raises
  `premium_required`), non-owner raises, anon raises, admin passes, drafts
  excluded from business analytics.
- `scripts/regress-host-tools.mjs`: add PostgREST-shape checks for both RPCs
  against the isolated stack (shape of JSON, error code mapping).
- `scripts/test-local-backend.mjs` runs against the shared DB and must not
  assume the new RPC exists; add nothing there until the migration is applied.
- Vitest: `utils/analytics.ts` helpers; a render-free test of the service
  mapping with a fake `rpc`.

### 1.6 Steps and estimate

| Step | Work | Est. |
| --- | --- | --- |
| A1 | Migration: `get_event_insights`, hardened `get_business_analytics`, grants | 4–5 h |
| A2 | Scratch validation + `test-event-insights.sql` + regress additions | 2–3 h |
| A3 | Service, types, query keys, `utils/analytics.ts` + tests | 2–3 h |
| A4 | `EventInsights` screen, shared `TrendBars`, locked/error states | 5–6 h |
| A5 | `profile-analytics.tsx` migration to React Query + new fields | 1–2 h |
| B1 (optional) | `event_interactions` + client hooks + cards | 3–4 h |
| B2 (optional) | `rsvp_history` + drop-off card | 3–4 h |

Core (A1–A5): ~14–19 h. Dependencies: the prepared `20261103*` migrations
must be applied on the target DB before `20261104100000`.

### 1.7 Risks and decisions to confirm

1. **Server-side tiering changes behaviour** for the existing
   `profile-analytics` screen: today a free business gets the full payload and
   the lock is client-only. After the change the free payload has null
   `trend` / `topEvents`, so the screen must render its locked preview from
   the `tier` field rather than from `usePremium()` alone. The free totals
   stay visible, which is an improvement over today's fully blurred screen.
2. `rsvps.created_at` semantics for lead time (see §1.3A note). Acceptable
   for v1; `rsvp_history` fixes it later.
3. Median-based comparison needs ≥ 3 published events; below that show
   nothing rather than a misleading delta.
4. `event_views` has no retention policy; at current scale fine. Note for
   later: roll up rows older than a year into daily counts.

### 1.8 Free vs premium split (decided 2026-11-04)

Principle: the free tier must be able to see that hosting on EventMap works
(plain counts for the event in front of them). Premium adds the layers that
need time series, cross-event aggregation or extra tracking: the "when",
"who" and "compared to what" questions. Everything is enforced in the RPCs
via `businesses.subscription_tier`; the client only decides how to draw the
locked state.

| Area | Free (every host) | Premium |
| --- | --- | --- |
| Per-event counts | Views (total, unique viewers), saves, going, interested, waitlist, requested, removed, fill rate | — (same) |
| Funnel | Views → saves → going percentages | — (same) |
| Time window | Fixed 30 days | 7 / 30 / 90 / 365 day selector |
| Trend | — | Daily views / saves / going + cumulative going |
| RSVP lead time | — | Five-bucket histogram and reading |
| Audience | — | Followers / returning / first-time split |
| Announcements | Sent count (already in the hub) | Recipients and read rate |
| Chat | Message count (already in the hub) | Active senders, messages over time |
| Comparison | — | "vs your usual" against the business median |
| Business overview | Totals: events, upcoming, followers, rating, all-time views / saves / going | 30-day deltas, engagement trend, top-5 events ranking |
| Interaction tracking (phase B) | — | Share, ticket and calendar-add taps |
| Export (Phase 4) | — | CSV attendee export |

Consequences for the plan above: `get_event_insights` and
`get_business_analytics` return `tier` and null out premium sections rather
than raising; the Manage hub Overview (free) keeps its live counts; the
insights screen shows real free cards on top and blurred premium cards with
one "Upgrade" CTA underneath, replacing today's all-or-nothing lock.

### 1.9 Implementation log

- 2026-11-04: the split in §1.8 was decided so the RPC shape can be written once.

**2026-11-04 — analytics foundations (A1–A5 core).**

Server (prepared, NOT applied to the shared DB):
- `20261104100000_event_insights.sql`: `business_has_premium` (same rule as
  the client: tier premium and not expired); `get_event_insights` (host or
  admin; free = counts + funnel over a fixed 30 days, premium = 7–365 day
  window, zone-bucketed daily trend with cumulative going, RSVP lead time,
  audience split, announcement reach, chat activity, median of the
  business's other published events, withheld below 3); hardened
  `get_business_analytics` (same keys plus `tier`, `periodDays`,
  `period*`; drafts excluded; zone-aware upcoming that skips cancelled;
  admins allowed; trend / topEvents null on free; top events carry start and
  status; EXECUTE revoked from anon).
- `scripts/test-event-insights.sql`: 40 assertions on scratch (guards,
  grants, free payload, expired premium, premium windows and sections,
  recurring lead time, admin override, business analytics tiering).

Client:
- `utils/analytics.ts` (parsing, funnel, lead-time reading, median delta) +
  `tests/analytics.test.ts`; `services/analytics.ts` `getEventInsights` with
  typed forbidden / not-found errors and a fallback to the host overview while
  the migration is missing; tier fields on `getBusinessAnalytics`.
- `screens/EventInsights.tsx` at the existing route: real counts for every
  host, Pro-locked card on free, full premium sections, "more on the way"
  notice in fallback mode (no Pro lock, no distinct-viewer guess).
  `components/analytics/TrendBars.tsx`. Sample analytics removed from
  `services/premium.ts`.
- `app/profile-analytics.tsx`: loads for every owner; the server tier decides
  (free sees totals with a Pro card for top events and trends; older backends
  keep the client lock); top events open their insights.

Decision recorded: RSVP lead time is not shown for recurring series (RSVPs
cover the series, not one date); the RPC returns `available: false`.

Checked on an isolated scratch copy: SQL suites for insights, calendar and
host tools pass with all four 20261104* migrations; `scripts/insights-visual.mjs`
passes 12 checks (premium, free, Saved / Joined zones) plus 3 in fallback mode.

**2026-11-04 (second pass) — analytics follow-ups.**

- `20261104090000_event_interactions_and_rsvp_history.sql` (prepared, NOT
  applied; ordered before the insights file): `event_interactions` +
  `track_event_interaction` (share / ticket / calendar / directions; signed-in
  only, one per person, kind and day, host's own taps and drafts skipped, no
  direct reads); `rsvp_history` + `z_record_rsvp_history` trigger (status
  changes and deletions classified as left / declined / removed by actor;
  never blocks the RSVP change or a cascade delete; no direct reads; starts
  empty).
- `get_event_insights` gains premium `interactions` and `rsvp_changes`
  (joined / left / downgraded / declined / removed in the window,
  `tracked_since`); `get_business_analytics` gains premium
  `interactionTotals`.
- Client: Event Detail records taps (share when not dismissed, Google
  calendar, .ics, ticket link, directions; fire-and-forget, no-op until the
  migration lands). Insights: "Taps on your event page" and "RSVP changes"
  with a drop-off line; both in the free tier's locked list.
  `profile-analytics` now uses React Query (previous period kept on screen,
  refetch on focus), the shared `TrendBars` over the whole window, and a
  premium taps card.
- Checked on scratch: insights suite (now 56 assertions), calendar and
  host-tools suites pass with the trigger installed; visual check 17 + 3
  fallback, screenshots reviewed (one padding fix on the business chart).

Decisions:
- **Anonymous view counter: deferred.** The anon key ships in the app, so an
  identity-less counter can be inflated by anyone. Doing it properly needs an
  edge function with IP rate limiting and bot filtering; revisit when the web
  build is public.
- **Retention for `event_views` / `event_interactions`: proposal only.**
  Rows are small (≈100 bytes) and capped at one per person per event per day,
  so growth is bounded by real traffic. When either table passes a few
  million rows: add `event_view_daily(event_id, day, views, unique_viewers)`,
  a `rollup_event_views(p_before date)` that aggregates and deletes raw rows
  older than 13 months, scheduled monthly with pg_cron, and switch the
  insights queries to raw-recent + rolled-up-old. Unique viewers across the
  boundary become an upper bound, which the UI must say. Not built now because
  it deletes data and needs a scheduling decision from the DB owner.

Still open (analytics):
- Apply `20261104090000` and `20261104100000` (owner's go-ahead), regenerate
  types, drop the `untypedRpc` casts in `services/analytics.ts` / `events.ts`.
- Check-in rate (needs the Phase 4 check-in feature from HOST_TOOLS_PLAN).
- Anonymous views and retention as above, when their triggers are met.

---

## Part 2 — Personal events calendar

### 2.1 What exists today

- `screens/JoinedEvents.tsx` (`/joined-events?tab=upcoming|interested|past`):
  paged `useInfiniteQuery` on `get_user_going_events(user, scope, limit,
  offset)`; `EventListItem` rows; chat unread badges; `useRefetchOnFocus`;
  `queryKeys.joinedEvents`. Rows show `next_start_datetime` and "· repeats".
- `screens/SavedEvents.tsx` on `get_user_saved_events` (has `status`,
  `has_ended`, `saved_at`).
- `get_user_going_events` returns one row **per series** with
  `next_start_datetime`, `status`, `timezone` (latest definition in
  `20261103140000`). Max 100 per page. It does not return `requested` rows
  (ISSUES "Phase 3 leftovers").
- Hosting: `eventsService.getBusinessEvents(businessId, {scope})` used by
  `screens/MyEvents.tsx` (upcoming / drafts / past).
- Recurrence expansion on the client: `utils/recurrence.ts`
  (`getNextOccurrences`, `isEventOnDate`, `filterEventsByDateRange`), zone
  aware since Phase 2. Zone helpers in `utils/timezone.ts`
  (`dateKeyInZone`, `describeEventTime`, `getDeviceTimeZone`).
- Calendar export: `utils/eventIcs.ts` builds a **single** VEVENT with
  `TZID` + `RRULE`; `utils/eventShare.ts` shares it per platform; Google
  Calendar link with `ctz`.
- No calendar grid component, no `SectionList` usage, no date library beyond
  `@react-native-community/datetimepicker`. Tabs are Discover · Create ·
  Notifications · Profile. Profile shows a preview of joined events with a
  "View All" link to `/joined-events`.

### 2.2 Goals and non-goals

Goals
- One screen that answers "what am I doing and when": a month grid with
  markers plus a day/agenda list, covering going, interested, saved and (for
  hosts) hosting, with recurring events expanded into real dates.
- Zero new DB objects in the first phase so it can ship without touching the
  shared DB; a range RPC only if the client approach hits its limits.
- Export the whole upcoming set as one `.ics`.

Non-goals
- Writing into the device calendar (`expo-calendar` is not a dependency and
  needs a native rebuild and permission copy). Keep ICS share.
- A live subscription feed (`webcal://`) needs a public token endpoint (edge
  function); record as a later option.
- Per-occurrence RSVP for recurring series (plan §9 Q6; unchanged).

### 2.3 UX design

Route `app/calendar.tsx` → `screens/Calendar.tsx`. Entry points: profile
quick link "Calendar" (user mode, next to Saved / Following), a calendar icon
in the `JoinedEvents` header, and the "View All" on the profile joined
preview can point here once the screen is stable. A fifth tab is a product
decision; not proposed now.

Layout
1. `ScreenHeader` "Calendar" with right actions: Today, Export.
2. Source chips (multi-select, persisted in AsyncStorage): **Going** (on),
   **Interested**, **Saved**, **Hosting** (only when the user has a
   business). Pending approval ("Requested") rows render inside Going with a
   "Pending" badge once the RPC exposes them (§2.4 B).
3. Month grid (custom, ~150 lines): 7 columns, locale week start
   (`Intl.Locale.weekInfo` with Monday fallback), swipe/arrows for prev/next,
   today ring, selected day fill, up to 3 dots per day coloured by source
   (going = primary, interested = secondary, saved = accent, hosting =
   success). Days from adjacent months dimmed. Tap selects the day.
4. Below the grid: the selected day's occurrences as `EventListItem` rows
   (`dateLine` from `describeEventTime` so event-zone and "your time" both
   show), badges: LIVE, Cancelled, Postponed, Pending, Repeats icon. Tap →
   `/event/[id]`. Empty day copy: "Nothing on this day".
5. Agenda toggle (segmented Month · Agenda): a `SectionList` grouped by day
   for the next 8 weeks across the enabled sources, infinite-scroll by
   extending the range. Same row component.
6. Conflicts: when two going occurrences overlap, both rows get a small
   "Overlaps" badge (pure helper, cheap and useful).
7. Export: builds one ICS with all upcoming occurrences in the enabled
   sources (series stay series via RRULE), via `shareEventIcs`.

Accessibility: grid cells are `accessibilityRole="button"` with label
"Tue 12 Nov, 2 events"; header announces month changes; reduce motion
respected for the swipe animation.

### 2.4 Data design

**Phase A — client only, existing RPCs**
- Hook `useCalendarSources(range, sources)` that runs, in parallel and only
  for enabled sources:
  - going: `get_user_going_events(uid,'upcoming',100,0)` (+ `'past'` pages
    when the visible month is in the past, bounded to 100 rows),
  - interested: `get_user_going_events(uid,'interested',100,0)`,
  - saved: `get_user_saved_events(100,0)`,
  - hosting: `eventsService.getBusinessEvents(bizId,{scope:'upcoming'})`.
  Each with its own React Query key (`queryKeys.calendarSource(uid, source)`)
  under the existing `attendanceLists()` prefix so RSVP/save mutations keep
  invalidating them for free.
- Pure expansion in `utils/calendar.ts`:
  `expandOccurrences(events, range, viewerTz) → Occurrence[]` where
  `Occurrence = { key, event, source, start, end, dayKey, isSeries }`. Uses
  `getNextOccurrences`/`isEventOnDate` for recurring rows, dedupes an event
  that appears in several sources (priority going > interested > saved;
  hosting shown as its own marker), skips `status='cancelled'` from the grid
  by default but keeps them in the day list with a badge. Group by
  `dateKeyInZone(start, viewerTz)`.
  `findOverlaps(occurrences)`, `monthMatrix(year, month, weekStart)`,
  `buildCalendarIcs(occurrences)` (multi-VEVENT; extend `eventIcs.ts` to
  export `buildVEvent` and a wrapper that concatenates).
- Limits: 100 rows per source. For the target user base this covers months
  ahead. If the first page is full, show a quiet "Showing the first 100
  events" note and schedule Phase B.

**Phase B — range RPC (small migration, prepared not applied)**
`get_user_calendar(p_from timestamptz, p_to timestamptz, p_sources text[])
RETURNS json` returning series rows that intersect the range (not expanded
occurrences; expansion stays client-side so there is one recurrence
implementation). Owner-only (`auth.uid()`), joins rsvps (going, interested,
requested), saves and, when `'hosting'` is requested, the caller's business
events. Includes `status`, `timezone`, `publish_state`, `max_attendees`,
`user_rsvp`. Intersection test: `start_datetime <= p_to` and
(`event_has_ended(...) = false` or `end_datetime >= p_from`); recurring series
with an end date before `p_from` excluded. Also adds `requested` to
`get_user_going_events` scopes to close the ISSUES leftover. Test in a
`scripts/test-calendar.sql` on scratch.

### 2.5 Steps and estimate

| Step | Work | Est. |
| --- | --- | --- |
| C1 | `utils/calendar.ts` (matrix, expansion, grouping, overlaps) + tests | 3–4 h |
| C2 | Multi-event ICS (`buildCalendarIcs`) + tests | 1 h |
| C3 | `MonthGrid` component (gestures, a11y, dots) | 3–4 h |
| C4 | `screens/Calendar.tsx`: sources hook, chips, day list, agenda mode, export, empty/error states | 4–5 h |
| C5 | Entry points (profile quick link, JoinedEvents header icon), route, Maestro smoke step | 1 h |
| D1 (Phase B) | `get_user_calendar` + `requested` scope, scratch tests, service swap behind a feature check | 4–5 h |

Phase A: ~12–15 h, no DB changes. Phase B: ~4–5 h when needed.

### 2.6 Risks and decisions to confirm

1. **Series vs occurrences**: calendar shows every occurrence of a series the
   user joined; RSVP is per series. Row copy must not imply a per-date RSVP.
2. **Day bucketing zone**: group by the viewer's device zone (what a personal
   calendar means), show event-zone time on the row. A travelling user sees
   dates shift accordingly; this matches system calendars.
3. **Past months**: Phase A loads past going rows lazily (only when
   navigating back) and caps them; full history browsing is a Phase B item.
4. **Hosting source** reuses `getBusinessEvents`, which returns drafts in a
   separate scope; drafts are excluded from the calendar.
5. Web: `SectionList` and gesture swipe both work on `react-native-web`;
   verify the month swipe degrades to arrows when gestures are unavailable.

### 2.7 Implementation log

**2026-11-04 — Phase A foundations shipped (client only, no DB changes).**

Built:
- `utils/calendar.ts`: day-key arithmetic, `monthMatrix` / `matrixRange`,
  `weekStartForLocale`, `expandOccurrences` (series → dated occurrences,
  source merging, cancelled kept for badging), `groupByDay`, `findOverlaps`
  (committed sources only), `calendarIcsInputs` (series anchored at next
  occurrence, ended/cancelled/duplicates skipped), `formatOccurrenceTimeRange`.
  `tests/calendar.test.ts` (25 cases, incl. a WEST→WET week).
- `utils/eventIcs.ts`: `buildCalendarIcs` (multi-VEVENT); `buildEventIcs` now
  delegates to it. `utils/eventShare.ts`: `shareCalendarIcs`.
- `hooks/useCalendarEvents.ts`: one cached query per enabled source over the
  existing RPCs (`get_user_going_events` upcoming / interested,
  `get_user_saved_events`, business events for hosting), 100-row cap with a
  `truncated` flag; keys live under `queryKeys.calendarSource` and the
  `attendanceLists` prefix so RSVP / save invalidation already refreshes them.
- `components/calendar/MonthGrid.tsx`: month header with arrows, localized
  weekday labels, today ring, selection, up to three source dots, per-cell
  accessibility labels.
- `screens/Calendar.tsx` at `/calendar`: source chips (persisted per user in
  AsyncStorage), grid, selected-day list on `EventListItem` with
  Cancelled / Postponed / LIVE badges, "Overlaps" pill, source tag, event-zone
  time range plus "your time" line, Today and Export actions, pull to
  refresh, refetch on focus, loading / error / empty states.
- Entry points: profile quick link "Calendar" (user mode) and a calendar icon
  in the Joined Events header.

Deliberately left for a second pass (all done in the second pass below):
- Agenda mode (`SectionList` over the next 8 weeks) and month swipe gestures
  (arrows only for now).
- Past months: the going source only loads the upcoming list, so earlier
  months show saved / hosting rows but not attended events.
- Pending-approval ("requested") rows need the RPC scope from Phase B.
- Multi-day events appear on their start day only.
- Maestro smoke step and web screenshots on the isolated stack.

**2026-11-04 (second pass) — Phase A complete, Phase B foundation prepared.**

Phase A, client:
- Agenda mode (`SectionList` from today, 8 weeks, "Show 8 more weeks" up to
  52; explicit button rather than auto-extend so a short list doesn't chain
  fetches). Month / Agenda toggle persisted per user with the sources.
- Month swipe (`Gesture.Pan`, horizontal-only activation, fails on vertical
  movement so the list still scrolls); arrows remain the accessible path.
- Multi-day occurrences: one segment per day (`occurrenceDayKeys`, capped at
  14 days), "Day N of M" line and a "Fri 4:00 PM → Sun 11:00 PM" span. An
  evening event under 24 h that ends before 06:00 stays on its start day.
  Overlaps are computed per occurrence (`occurrenceId`), so a festival doesn't
  overlap itself.
- Grid markers via `dayMarkers`: hollow ring for a source whose events that
  day are all pending requests, grey ring for a day with only cancelled plans.
- Past months in list mode load the attended list lazily (only when the
  visible range starts before today).
- Rows padded like the Joined / Saved lists; Pending badge + "Awaiting host
  approval" line; status note shown on cancelled / postponed rows.
- `.maestro/calendar.yaml` (unrun: no simulator in this session).

Phase B foundation (prepared, NOT applied to the shared DB):
- `20261104110000_user_calendar_rpc.sql`: `get_user_calendar(p_from, p_to,
  p_sources, p_limit)` → `{rows, truncated}`. Caller-only; sources going /
  requested / interested / saved / hosting merged per event; returns
  `timezone`, `status`, `status_note`; keeps cancelled / postponed; never
  returns drafts; zone-aware series end check; 400-day range cap; limit
  300 (max 500); EXECUTE for `authenticated` only.
- `scripts/test-calendar.sql`: 20 assertions on scratch (guards, grants,
  intersection incl. a Honolulu end-date edge, merge, pending, cancelled,
  source filter, truncation, caller scoping, hosting without drafts).
- Client: `services/calendar.ts` + pure `utils/calendarRpc.ts`;
  `useCalendarEvents` tries the range RPC first and falls back to the Phase A
  lists on `42883` / `PGRST202`, remembering the miss for the session.

Why Phase B matters beyond pending requests: the existing list RPCs return
neither `timezone` nor cancelled / postponed going events, so in list mode
zoned series are walked in the viewer's zone and an attendee never sees that
an event they were going to got cancelled.

Verification: 439 unit tests; typecheck and lint clean;
`scripts/calendar-visual.mjs` (headless Chrome, locally minted token, private
PostgREST on a scratch copy, no shared-GoTrue sign-in) passes 16 checks in
range mode and 14 in fallback mode (`EXPECT_FALLBACK=1`, RPC dropped on
scratch). Fixture: `scripts/calendar-visual.fixture.sql` (scratch only).

Incident, 2026-11-04 16:41:06 UTC: the first draft of `test-calendar.sql`
ran `SET LOCAL role anon` and then called a `pg_temp` helper on the scratch
copy. The backend segfaulted (signal 11) and Postgres crash-restarted every
connection in the cluster, shared DB included, for about 0.4 s. No data
changed, but in-flight queries from other sessions would have failed. Grants
are now checked with `has_function_privilege`. Don't switch to `anon` inside
psql suites on this build.

Still open:
- Apply `20261104110000` (needs the owner of the shared DB); then regenerate
  types and drop the `untypedRpc` cast in `services/calendar.ts`.
- A "Requested" tab in Joined Events (the RPC now exposes the data; the list
  RPC still doesn't).
- Run `.maestro/calendar.yaml` on a device.

**2026-11-04 (third pass) — Phase B items that don't need the shared DB.**

- `20261104120000_going_events_requested_scope.sql` (prepared, NOT applied):
  `get_user_going_events` gains `p_scope = 'requested'` (owner-only, upcoming,
  active) and a `timezone` key on every row; `get_user_attendance_counts`
  gains `requested_count` (owner-only). Both re-created from the live
  definitions with only those changes; signatures and grants unchanged.
- Joined Events: a "Requests N" tab with Pending badges, shown only when
  `requested_count` is present and above 0 (or deep-linked with
  `?tab=requested`), so it stays hidden on backends without the migration.
- Calendar list fallback: pending requests come from the new scope (marked
  pending; an "Invalid scope" error from an old backend yields an empty
  list), and going rows now carry the event zone.
- `scripts/test-calendar.sql` section 4 (6 assertions, skipped when the
  migration is absent). `scripts/calendar-visual.mjs` checks the Requests tab
  and takes `REQUESTED_SCOPE=0` for old backends.

Checked on an isolated scratch copy in three backend states: both
migrations (18 visual checks), RPC dropped but requested scope present, and
neither (the shared DB as it is today: no Requests tab, no errors). The
host-tools SQL suite still passes with both migrations applied.

Still open (calendar):
- Apply `20261104110000` and `20261104120000` on the shared DB (owner's
  go-ahead), then `npm run backend:types` and drop the `untypedRpc` cast in
  `services/calendar.ts`.
- Saved-events RPC rows still lack `timezone` (list mode only).
- Subscribable `webcal://` feed (needs a token endpoint / edge function).
- Device run of `.maestro/calendar.yaml`; the thorough testing round.

**2026-11-04 (fourth pass) — saved-event zones.**
`20261104130000_saved_events_timezone.sql` (prepared, NOT applied) adds
`timezone` to `get_user_saved_events` rows (from the live definition, nothing
else changed); `scripts/test-calendar.sql` section 5. Saved and Joined rows
now use `describeEventDateTime`: event-zone date and time, plus a "your
time" line when the viewer's clock differs (legacy rows unchanged).

## Final polish pass (2026-11-04)

Cohesion:
- Shared analytics components: `components/analytics/KpiTile.tsx` (one KPI
  card, icon well), `ProUpsellCard.tsx` (one Pro prompt on the shared
  `Button`, "View Pro plans"), `AnalyticsSection.tsx` (the app's uppercase
  section label, same as `SettingsSection`). Event insights and business
  analytics both use them; business analytics' period chips became the shared
  `SegmentedControl`, matching insights.
- Copy: the paid tier is "Pro" on every analytics surface; window notes say
  "All-time totals" plus what also shows the window; Saves / Going tiles carry
  their window counts so the copy is true; plan catalog lists free event
  insights and Pro "advanced analytics".

UX:
- Hosts in business mode get a Calendar quick link (next to Public profile),
  and their first calendar visit shows Hosting alongside Going (applied once
  the business has loaded; never over saved or hand-picked sources).
- Empty-state button centred on the calendar; taps grid is 2×2.

Accessibility (web): react-native-web drops `accessibilityState`, so source
chips, day cells and the shared `SegmentedControl` now also pass
`aria-checked` / `aria-selected` (screen readers on web announce state).

Verified on an isolated scratch copy: both visual scripts pass (calendar 18,
insights / analytics / lists 18), screenshots reviewed; 454 unit tests.

### Handoff: what finishing needs (all DB-side)

1. Apply, in order, on the shared DB (owner's go-ahead): `20261104090000`,
   `20261104100000`, `20261104110000`, `20261104120000`, `20261104130000`.
   Each was validated on scratch copies of the current shared schema and
   re-applies cleanly.
2. `npm run backend:types`; replace the `untypedRpc` casts in
   `services/analytics.ts`, `services/calendar.ts`, `services/events.ts`.
3. Run `scripts/test-event-insights.sql` and `scripts/test-calendar.sql`
   against a scratch copy of the post-apply DB, then the two visual scripts.
Until then every new screen works against today's DB through its fallback
(overview counts in insights, list mode in the calendar, no Requests tab).

---

## Suggested order

1. Calendar Phase A (C1–C5): independent of the unapplied migrations, pure
   client, quickest user-visible win, exercises the isolated web stack only
   for screenshots.
2. Analytics A1–A2 on scratch (needs the `20261103*` set applied to scratch
   first), then A3–A5 on the client with the service falling back to the
   locked/unavailable state when the RPC is missing (same `42883 / PGRST202`
   detection `hostTools.ts` uses).
3. Calendar Phase B and analytics Phase B as follow-ups, each one small
   migration.

Both features touch `queryKeys.ts`, `types/database.ts` and the profile
quick links, so run them in separate worktrees but merge the calendar first
to keep the analytics diff small.
