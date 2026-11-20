# Plan B — alternatives when an event falls through

**Status (2026-11-20): P1 + P1b BUILT and verified (client only); P2 and P3
NOT started.**
* P1 and P1b (T1 cancelled, T2 cancelled date, T3 full, T5 "Can't make it?")
  need no migration and read only RPCs already applied.
* P2 (`get_plan_b_events`) and P3 (notification changes, which include T4)
  need migrations. Nothing is written yet, and the shared local database is
  untouched: still 140 / `20261120100000`.
* §9 is the implementation log, including where the build deviates from the
  sections below.
* The plan was written 2026-11-20 against `c34139c`. **Sequencing and the DB workflow are in
[`ROADMAP_2026-11-20.md`](ROADMAP_2026-11-20.md)** (phases 2 and 4).

The goal: when an event stops being an option for someone — it is cancelled,
their date is cancelled, it is full, their request is declined or expires, or
they will not make it in time — show them one to three alternatives that fit
the plan they had (same kind of thing, near where they were going, around the
same time), so a cancelled evening becomes a different evening rather than
none.

---

## 1. The moments (triggers)

| # | Moment | How the app knows today | Where the user is when it happens |
| --- | --- | --- | --- |
| T1 | **Whole event cancelled** | `events.status = 'cancelled'`; `cancel_event()` notice (`20261117120000`) — **no `data.kind`** | Notification → event page with the "This event was cancelled" banner (`screens/EventDetail.tsx`) |
| T2 | **Their date of a series cancelled** | `event_occurrence_exceptions.kind = 'cancelled'`; `skip_occurrence()` notice, kind `occurrence_cancelled`, `data.date` | Notification → event page, cancelled row in the per-date list |
| T3 | **Full** (series or one date) | `deriveEventViewer().full` (`utils/eventViewer.ts`); `set_occurrence_rsvp` answers `waitlist` for a full date; `EVENT_FULL` error | Event page, join block reads "Event full · Join waitlist" |
| T4a | **Request declined** | `host_review_rsvp` notice, kind `request_declined` (row deleted) | Notification |
| T4b | **Request expired** | `expire_ended_requests()` notice, kind `request_expired` | Notification — but the event is already over (see T4c) |
| T4c | **Waitlisted, never promoted** | **Nothing.** No job tells them; the row just stays | — (gap) |
| T5 | **Won't make it / running late** | **Nothing.** "Running late" in the codebase is the *host* extending the end time (EJ-15) | Event page while it is live or about to start |

T1–T3 and T4a can be served with existing signals. T4c and T5 need new ones (§4.3, §4.4).

## 2. What "fits" means — the matching model

### 2.1 The anchor

Every Plan B request carries an **anchor**, i.e. the plan that fell through:

* **Where:** the original venue (`events.lat/lng`) for T1–T4. For T5, the
  viewer's current position if we have it, otherwise the venue.
* **When:** the original session window. For a one-off that is
  `start_datetime → end_datetime`. For a series date it is that date's
  effective start/end (`utils/occurrences.ts` `listOccurrences` client-side;
  the effective-occurrence helpers server-side). For T5 it is
  "from now".
* **What:** `category_id`, the host (`business_id`), and the viewer's
  `profiles.preferred_categories`.

### 2.2 Candidates (hard filters)

The candidate must be active, published and public, and not ended. Its
banned/blocked host must be excluded, as `get_ranked_events` already does.
On top of that:

* **not the anchor event.** For T2, other dates of the *same* series are
  offered separately (§3.2), not mixed in;
* **inside a time window around the anchor** (defaults, tunable):
  * T1/T2/T3/T4: starts between anchor start − 2 h and anchor end + 1 h, or
    is in progress at anchor start with ≥ 45 min left.
  * T5: live now with ≥ 30 min left, or starts within 90 min.
* **within 10 km of the anchor** (widen to 25 km if fewer than 3 results; the
  `MoreOfTypeRail` sparse-widen pattern);
* **has room:** `max_attendees` is null or `rsvp_count < max_attendees`, and
  RSVPs are not closed. Full events are dropped, because a Plan B that is
  also full is no Plan B;
* **the viewer is not already going** (`user_rsvp` null).

### 2.3 Score (soft ranking)

| Signal | Weight (start) | Notes |
| --- | --- | --- |
| Same category as the anchor | 1.0 | Strongest "what they wanted" signal we have |
| In the viewer's preferred categories | 0.4 | Boost, never a filter (same rule as live events, owner decision 2026-11-19) |
| Time fit | 0–0.8 | 0.8 if it starts within ±30 min of the anchor, decaying linearly to 0 at the window edge |
| Distance from anchor | 0–0.8 | 0.8 at 0 km → 0 at the radius |
| Same host | 0.2 | A host the user already chose |
| Popularity | 0.1 × log(1 + rsvp) | Small tiebreaker |
| Approval mode | −0.3 | Still shown, labelled "Request to join" (D6) |

Tie-break: earlier start, then id. **No randomness**, so the same situation
always shows the same picks, which keeps the logic testable and explainable.

### 2.4 Explain every pick

Each card carries one to three **reason chips** built from the signals that
fired, for example "Also live music", "0.6 km from the original", "Starts
15 min later", "8 spots left" or "Same host". Showing the reasons is what makes
a suggestion feel like a real alternative rather than an ad. Reasons are
returned as codes (`same_category`, `near_anchor`, `time_close`, `has_room`,
`same_host`, `interest`) and turned into copy on the client.

## 3. UX

### 3.1 Where it appears

| Moment | Surface | Copy (draft) |
| --- | --- | --- |
| T1 | Event page, directly under the cancelled banner | **"Still want to go out?"** + up to 3 cards + "See more nearby" (→ Discover filtered to the window) |
| T2 | Event page, under the cancelled date | First **"Other dates of this series"** (next 2 effective dates with room), then "Or something else that evening" |
| T3 | Event page, under the join block, **alongside** the waitlist button, not instead of it | **"Full — here's what else is on then"** |
| T4a/b/c | Notification body ends with "…see similar events"; tapping it opens the event page, which shows the Plan B section for that state | |
| T5 | Event page for a *going* viewer while live or within 30 min of start: a quiet **"Can't make it?"** row | Opens a sheet. "Free my spot" leaves the RSVP for a one-off, or `set_occurrence_rsvp(…, 'not_going')` for that date only on a series. It always shows "Here's what's on later nearby" |

The Plan B section shows nothing when there are no candidates, the same
convention as `MoreOfTypeRail`. "Nothing nearby fits" is not useful on its
own; the "See more nearby" link to Discover always remains.

### 3.2 Why "Free my spot" matters

A going attendee who leaves frees a seat, and `handle_event_seats_freed`
already promotes or notifies the waitlist. So the T5 flow helps the host and
the next waitlister too. Once attendance is frozen after the end
(`20261117110000`) the option is hidden.

## 4. Architecture

### 4.1 P1 — client-only, no migration (ships first)

* **`utils/planB.ts`** (pure). `planBAnchor(event, viewerState, now, date?)`
  works out the anchor and window. `rankPlanB(anchor, rows, prefs)` applies
  the hard filters, scores and reason codes from §2, and is fully
  unit-tested.
* **`services/planB.ts`** `getPlanBCandidates(anchor)` makes **one**
  `getRankedEventsPage` call (`services/events.ts`), centred on the anchor's
  lat/lng, with radius 10 km, `start_date`/`end_date` set to the window and
  `p_preferred_category_ids` from the profile. It drops the anchor id
  client-side. For a sparse result it makes one retry at 25 km. For T5 it
  uses `liveEventsService.getLiveEvents` instead: `get_live_events` is
  **applied locally**, so it returns `occ_end` for the "≥ 30 min left" rule.
* **`hooks/usePlanB.ts`** wraps it in `useQuery` keyed
  `['planB', eventId, date, reason]`. It is enabled only when the viewer
  state calls for it, so a normal event page makes no extra request.
* **`components/PlanBSection.tsx`** draws the cards and chips and reuses
  `EventListItem`. **`components/CantMakeItSheet.tsx`** covers T5.
* Wired into `screens/EventDetail.tsx` from the states `deriveEventViewer`
  already computes (`cancelled`, `full`, `live`, plus the cancelled-date row).

Known P1 limits, accepted:

* `get_ranked_events` does not return `rsvp_mode`, `waitlist_mode`,
  `rsvp_closed`, `price_label` or `timezone`. Approval-mode events therefore
  cannot be labelled or down-ranked, and closed-RSVP events can slip through.
  Joining them fails cleanly with the existing errors.
* Series candidates use `next_start_datetime`, so a series whose *next*
  session is outside the window is missed even if a later one fits. The
  exceptions-aware check the live page uses could close this at the cost of
  one more request; deferred to P2.

### 4.2 P2 — one server RPC (prepared migration, owner applies)

`get_plan_b_events(p_event_id uuid, p_date date, p_reason text, p_lat double precision, p_lng double precision, p_limit int default 3)`

* It is **`SECURITY DEFINER`** because table RLS hides cancelled events from
  non-owners, so only a definer function can read a cancelled anchor
  server-side. It applies `get_event_details`' draft gate to the anchor, so
  it never exposes more than the event page already does.
* The anchor window comes from `event_occurrence_in_progress` /
  `event_next_effective_occurrence` / the exception row for `p_date`, which
  makes it exception-aware, unlike P1.
* It returns the ranked-events columns plus `rsvp_mode`, `rsvp_closed`,
  `waitlist_mode`, `price_label`, `timezone`, `occ_start`, `occ_end`,
  `spots_left`, `reasons text[]` and `score`.
* `REVOKE … FROM PUBLIC`, `GRANT` to `anon, authenticated`; `p_limit` is
  capped at 10. `p_reason` is checked against the T-codes.
* The client probes it and falls back to P1, the same pattern as
  `services/liveEvents.ts` (D4).
* Tests:
  * `scripts/test-plan-b.sql` in the house style, rollback-only and
    ASSERT-based. Run it in a throwaway PG17 container (`scripts/pg17-isolated.sh`,
    unique `PG17_NAME`), **never on the shared cluster**.
  * `scripts/plan-b-parity.sql` → `tests/fixtures/planBParity.json` checks
    that the server and `utils/planB.ts` agree on the same fixture, like
    `live-parity`.

### 4.3 P3 — notification follow-through (migration)

1. **Fix T1's missing kind:** `cancel_event()` and the
   `clear_event_waitlist_on_cancel()` notice add
   `data = {eventId, kind: 'cancelled'}`. This is a small, standalone fix
   worth doing even without Plan B, because today a cancellation can only be
   told apart from other `event_update` rows by its title text.
2. **Body copy:** the cancelled, declined, expired and occurrence-cancelled
   notices gain "Tap to see similar events nearby." Routing does not change
   (`utils/notificationRoute.ts` already opens `/event/:id`). The event page
   decides what to show from live state, not from the notification, so a
   stale notification never shows stale picks.
3. **T4c, the new job** `notify_waitlist_not_promoted()` runs on pg_cron
   every 15 minutes, like `expire_ended_requests`.
   * **When:** at the anchor's start, *not* its end, while there is still
     time for a Plan B.
   * **Who:** users still on `event_waitlist` (or `rsvp_occurrences.status
     = 'waitlist'` for that date).
   * **What:** one notice, kind `waitlist_not_promoted`: "*X* started
     without a spot opening — here's what else is on nearby." It is
     deduplicated through a sent-marker table, like `event_reminder_sent`,
     and honours `notification_preferences.event_update`.
   * **Tests:** pinned with `scripts/test-lifecycle.sql`'s
     `pg_temp.set_phase`.
4. **Not in v1:** computing picks inside the notification itself.
   `cancel_event` can reach about 500 recipients, and ranking per recipient
   inside the host's transaction is too heavy for what it adds (D3).

### 4.4 T5 needs no new server state

"Can't make it" is the viewer leaving through existing RPCs. No ETA or
location tracking is involved; the row is offered by time alone (live, or
within 30 min of start, while going).

## 5. Privacy and safety

* Candidates come from the same visibility rules as Discover: public,
  published, banned hosts excluded. The P2 RPC must also exclude hosts the
  viewer has blocked, if `user_blocks` covers hosts. **Check this before P2**,
  and confirm whether `get_ranked_events` filters it today.
* No other user's data is used. "What they wanted" is the viewer's own
  anchor and interests only.
* For a cancelled anchor, nothing beyond what the cancelled event page
  already shows is revealed.

## 6. Testing

| Layer | What |
| --- | --- |
| Unit | `tests/planB.test.ts`: anchor windows for one-off, series date, moved date, overnight, DST; hard filters; score order; reason codes; sparse-widen |
| Browser (fake backend) | `suitePlanB.mjs` with a pinned clock (`lib.mjs` `pinClock`, plus `clearSeededDates` when re-dating `ev[0]`). Scenarios: PB1 cancelled → section with 3 cards; PB2 cancelled date → "other dates" first; PB3 full → section beside waitlist; PB4 nothing fits → no section; PB5 "Can't make it" → leaves + shows later picks; PB6 normal event → **no** Plan B request in the network log. Add P2's RPC as a default 404 in `fakebackend.mjs`, so the fallback path is what runs by default |
| A11y | Add a scenario to `suiteA11y.mjs` (section populated) |
| SQL (P2/P3) | `test-plan-b.sql`, a lifecycle block for T4c, and the parity fixture, all in throwaway PG17 containers only |

## 7. Phases and effort

| Phase | Scope | Estimate | DB |
| --- | --- | --- | --- |
| P1 | `utils/planB.ts` + tests, service/hook, `PlanBSection`, T1/T2/T3 on the event page | 1–1.5 days | none |
| P1b | T5 "Can't make it" sheet | 0.5 day | none |
| P2 | `get_plan_b_events` + SQL suite + parity + client probe | 1 day + owner apply | prepared migration |
| P3 | `cancel_event` kind fix, notice copy, T4c job | 0.5–1 day + owner apply | prepared migration |

P1 is useful on its own and touches no database. P2 and P3 are independent
of each other.

## 8. Decisions (recommendation in bold)

* **D1 — Full events:** show Plan B beside the waitlist button, or only after
  the viewer joins the waitlist? **Beside it.** Waitlisting and having a
  backup are not exclusive.
* **D2 — "Can't make it" frees the spot:** leaving is real, not a soft "maybe".
  **Yes, with a one-line confirm. On a series it applies to this date only.**
  **Confirmed by the owner 2026-11-20.**
* **D3 — Picks inside notifications:** **No in v1.** The notification
  routes to the event page, which ranks live.
* **D4 — P2 rollout:** probe-and-fallback (like live events) or target the
  migration only? **Probe-and-fallback.** It fits the `docs/ISSUES.md`
  client/schema policy: the RPC is read-only, so a missing function changes
  only *what is shown*, never what is written. P1's code path exists anyway,
  and sibling worktrees share the DB. P3's notification changes are
  server-only, so they need no client fallback.
* **D5 — T4c timing:** notify unpromoted waitlisters at the start, or at the
  end? **At the start.** At the end, a Plan B is useless.
* **D6 — Approval-mode candidates:** **include them, labelled "Request to
  join" and ranked lower.** Needs P2's columns, so P1 cannot label them.
* **D7 — Explicit "what were you after?" chips** (Closer / Same kind / Anything
  tonight) to re-rank the section? **Not in v1.** Revisit if the implicit
  picks miss.

## 9. Implementation log

### 2026-11-20 — P1 + P1b built (roadmap phase 2)

**Files:**

| File | What |
| --- | --- |
| `utils/planB.ts` | Pure core: `planBAnchor`, `candidateSession`, `rankPlanB`, the reason codes and labels, and the section copy. Tunables live in `PLAN_B` |
| `utils/planBMoments.ts` | Pure: which moments apply to the viewer, from what the page already holds (no request) |
| `services/planB.ts` | The fetch: one ranked page plus exceptions for series candidates, widened once; the live endpoint for T5 |
| `hooks/usePlanB.ts` | React Query wrapper, keyed per moment and session, disabled unless the state calls for it |
| `components/PlanBSection.tsx` | The section: title, picks with up to three reasons, "See more nearby" |
| `components/CantMakeItSheet.tsx` | T5: free the spot, then see what's on, with a "freed" state that keeps the picks |
| `screens/EventDetail.tsx` | Wiring. The hooks sit above the early returns; T1/T3 and the T5 row go under the key facts; T2 goes under the series dates |

**Tests:**
* Unit: `tests/planB.test.ts` (27), `tests/planBMoments.test.ts` (15),
  `tests/planBService.test.ts` (4).
* Browser: `scripts/fake-backend-e2e/suitePlanB.mjs` PB1–PB6 (32 checks).
* Accessibility: `suiteA11y.mjs` scenario **B** (14 checks), covering the
  section on a cancelled event and the sheet: axe, names, targets, headings,
  Escape.

**Deviations from §2–§4, each deliberate:**

1. **T5 window: "starts within 60 min", not 90.** It matches the live page's
   "starting soon" (`SOON_WINDOW_MINUTES`), which is the query T5 uses.
2. **T5 searches from the venue, not the device's position.** No location
   prompt is added for this. The viewer was heading to the venue anyway.
   `planBAnchor` accepts a `viewer` position, so this can change later.
3. **Series candidates: exceptions are fetched** (one extra request, only
   when a series is among the rows), and the matching session is computed
   on the device. This mostly closes P1 limit #2 in §4.1. What remains: the
   ranked rows carry no `timezone`, so a series' dates are walked in the
   device's zone.
4. **The ranked query opens its date window 6 h before the candidate
   window.** The SQL filters one-offs on `next_start >= start_date`, so
   without this an event already running at the anchor's start would never
   come back.
5. **T3 is placed under the event's key facts, not "beside the waitlist
   button".** The join and waitlist controls are in a fixed bottom bar, so
   the section is visible without scrolling while the waitlist button stays
   where it was. Its subtitle says "Keep your waitlist spot and have a
   backup."
6. **T2 has no separate "Other dates of this series" list.** The series'
   dates list, with per-date Go toggles, sits directly above the T2 section,
   so a second copy would repeat it. The T2 section is "<day> is cancelled —
   here's what else is on".
7. **"See more nearby" opens the category page** (`/category/<slug>`), or
   Discover when there is no category. Discover has no date deep link. T5
   links to `/live`.
8. **Rows the viewer marked "interested" stay eligible.** Only `going` and
   `requested` are excluded. They liked it, which makes it a good Plan B.
9. **Signed-out visitors see T1/T3.** Nothing personal is involved. T2 and
   T5 need a signed-in attendee.
10. **"Free my spot" is the confirmation (D2, owner-confirmed).** It is an
    explicit, explained button in the sheet, so there is no second dialog.
    It reuses the page's own paths (`handleRemoveRsvp`, and `toggleDateRsvp`
    for one series date), with their guards: preview, offline, attendance
    frozen after the end, banned. "Freed" is read from the page's state
    (the viewer no longer attends that session), so a failed leave never
    shows "Your spot is free".
11. **Approval-mode events are neither labelled nor down-ranked (D6).** This
    P1 limit was expected: the ranked rows don't say which events need
    approval. P2 fixes it.
12. **T4 (declined, expired, waitlist never promoted) is not on the client.**
    Nothing on the page can tell those apart: a declined or expired request
    deletes the row. These come with P3's notifications.

**Found while building, not fixed (outside this scope):** `MoreOfTypeRail`
is always empty against the real database. It filters on `status`, which
`get_ranked_events` does not return. It is logged in `docs/ISSUES.md`
(Medium). Plan B treats a missing status as active.

**Database:** none needed. Nothing was applied, and no isolated container was
needed, because no SQL changed. P2/P3 remain the database work. They go in
`supabase/prepared/2026-11-2x_plan_b_*` with versions after
`20261120100000`, validated in a throwaway `scripts/pg17-isolated.sh`
container with a unique `PG17_NAME`, and applied by the owner (see
`ROADMAP_2026-11-20.md` §5).
