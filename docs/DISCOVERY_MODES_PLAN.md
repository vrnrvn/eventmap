# Discovery modes plan: "Surprise me", "My neighbourhood", "Just added"

Status: written 2026-11-13. Proposal only; nothing here is built. Adds
curated browse modes on top of the existing Discover map/list, for people who
do not want to filter: what is close, what fits their interests, what is new
or about to start.

---

## 1. What exists today

**Ranking.** `get_ranked_events(user_lat, user_lng, radius_km, category_ids,
start_date, end_date, search_query, result_limit, p_offset)`
(20261106120000) is the only discovery query. 20261109110000 added an
optional `p_preferred_category_ids` boost; `services/events.ts
getRankedEventsPage` passes `profile.preferred_categories` and falls back
when the argument is unknown. Rows already include `distance_km`,
`created_at`, `rsvp_count`, `save_count`, `max_attendees`, `is_premium`,
`is_recurring`, `next_start_datetime`, `user_rsvp`, `user_saved`,
`has_ended`. Sort order is fixed (rank); there is no "newest" or "soonest"
sort and no "published since" filter.

**User signals.** `profiles.lat/lng/city` (home area from onboarding),
`preferred_categories` (Interests), favourited event types as smart
collections (`useFavouriteCategories`, `docs/EVENT_COLLECTIONS_PLAN.md`
Phase D), RSVPs and saves. Discover already shows a "For you" chip that
selects all favourited types.

**Location.** `hooks/useBrowseCenter.ts`: device last-known fix if permission
was already granted (never prompts), else profile home, else the San
Francisco default. `DEFAULT_BROWSE_RADIUS_KM = 25`, `WIDE_BROWSE_RADIUS_KM =
100`, and `MoreOfTypeRail` already widens once when a neighbourhood is
sparse.

**Browse surfaces.** Discover (map + sheet, date presets in
`utils/datePresets.ts`, filters, search overlay, offline snapshot),
`screens/CategoryBrowse.tsx` (one type near you), smart collections.

**Notifications.** `notify_interested_for_event` (20261109170000) already
pushes "new event in your interests near you" on publish, opt-in. There is
no in-app list of those events.

Gaps: no low-effort entry ("just show me something"), no tight-radius view,
nothing surfaces freshly published or soon-starting events, and "near me"
always means the 25–50 km Discover radius.

---

## 2. Goals and non-goals

Goals

1. Three one-tap modes from Discover, each usable with zero filters set:
   - **Surprise me**: one event at a time, a bit outside the usual.
   - **My neighbourhood**: everything within walking/short-ride distance,
     grouped by when.
   - **Just added / Starting soon**: recently published or starting within a
     few hours, near the viewer.
2. Reuse the ranking RPC and the browse-centre hook; server changes only
   where the client genuinely cannot do it.
3. Works offline from the last snapshot, like Discover, and degrades
   calmly without location permission or a home area.
4. Privacy: the device fix is used in memory and never written to the
   profile; the neighbourhood label is coarse (`profile.city` or a
   reverse-geocoded locality).

Non-goals: a recommendation model, collaborative filtering, server-side
per-user feeds, push for "surprise" picks.

---

## 3. Design

### 3.1 Surprise me (client-only)

- Candidate pool: one ranked page (limit 100) around the browse centre,
  25 km, next 14 days, no category filter, preferred boost on.
- `pickSurprise(pool, { exclude, seen, preferredCategoryIds, rng })` in
  `utils/surprise.ts`, pure and seeded for tests:
  - drop `has_ended`, cancelled, already `user_rsvp`/`user_saved`, and ids
    seen this session;
  - weight = base 1 × (1.5 if category not in preferred and not in the
    viewer's last-N categories, "a bit outside the usual") × (1 + log1p
    rsvp_count × 0.2) × (1.2 if `created_at` within 7 days) × (0.8 if
    distance > 15 km);
  - sample one by weight; return null when the pool is exhausted.
- UI: `components/SurpriseSheet.tsx`, a bottom sheet with one
  `DiscoverEventCard`-style card, "Show another", Save, Going, and "Open".
  After 8 picks or an empty pool: "That's everything nearby — widen to 100
  km?" using the rail's widening pattern.
- Entry: a chip in Discover's overlay chip row next to "For you".

### 3.2 My neighbourhood (client-only, one small server read optional)

- Route `app/neighbourhood.tsx` → `screens/Neighbourhood.tsx`, built like
  `CategoryBrowse`.
- Centre from `useBrowseCenter`; radius chips 2 km / 5 km / 10 km (default
  5 km when `precise`, 10 km when falling back to the profile home). Auto
  widen one step when fewer than 3 usable events.
- Fetch: ranked page(s) at that radius, no categories, next 30 days, boost
  on; client groups by `next_start_datetime` into Today / Tomorrow / This
  week / Later using `datePresets` helpers, and sorts each group by
  distance (`utils/neighbourhood.ts`, pure, tested).
- Header: "Around {profile.city ?? 'you'}" with a distance badge per row
  (`formatDistance` exists). Badges: "New" (`created_at` < 7 days), "Few
  spots left" (`max_attendees` and `rsvp_count` ≥ 80 %).
- States: no permission and no home area → explainer with "Use my
  location" (prompts) and "Set home area" (Settings); offline → last
  snapshot via `PERSISTED_QUERY`.
- Entry: a chip in Discover's chip row and a row in Profile ("My
  neighbourhood").

### 3.3 Just added / Starting soon (needs a server change for correctness)

"Just added" cannot be done reliably client-side: the ranked page is
rank-ordered and capped at 200, so new events can fall off the page.
Two options:

1. **`p_sort` on `get_ranked_events`** (`'rank' | 'newest' | 'soonest' |
   'nearest'`) plus an optional `p_published_since timestamptz`. One
   migration, index on `(publish_state, created_at desc)`; existing callers
   unaffected (defaults). Recommended.
2. A separate `get_fresh_events` RPC. Simpler SQL, but a second row type to
   keep in sync.

Client: a "New & soon" section at the top of My neighbourhood (and as a
Discover chip) showing up to 10 rows: published in the last 7 days, or
starting within 6 hours, nearest first. Until the migration is applied,
the section degrades to the client-side `created_at` filter over the
ranked page (works, just incomplete) via the `isMissingFunction` retry
pattern already in `getRankedEventsPage`.

"Suddenly available" in the sense of a spot opening on a full event needs a
per-user waitlist signal; that already arrives as a notification and is out
of scope here.

### 3.4 Data layer

- `eventsService.getRankedEventsPage` gains `sort` and `publishedSince` in
  `FilterOptions`; `queryKeys.neighbourhood(center, radius)` and
  `queryKeys.surprisePool(center)`.
- Snapshots: reuse `utils/discoverSnapshot.ts` with a mode tag.
- Analytics (`services/analytics.ts`): `surprise_shown`, `surprise_next`,
  `surprise_open`, `neighbourhood_open`, `neighbourhood_radius`, so the
  weights in §3.1 can be tuned from real use.

---

## 4. Testing

- Unit: `pickSurprise` (exclusions, weights, seeded determinism, exhaustion),
  neighbourhood grouping/sorting/widening, freshness and few-spots badges,
  radius default by precision.
- SQL: `scripts/test-discovery-sort.sql` for `p_sort`/`p_published_since`
  (ordering, defaults unchanged, drafts and ended excluded).
- E2E: `scripts/fake-backend-e2e/suiteDiscovery.mjs`: both modes with and
  without location permission, sparse-area widening, offline snapshot.
- Manual: seed data around the default centre is dense; also test a sparse
  centre (set a profile home far from SF).

---

## 5. Phasing and estimates

**Database constraint (2026-11-13).** The local Supabase instance is shared
with another dev session. D5 is the only phase with SQL; it is written as a
file and left unapplied, and D6 ships the degraded client path so "New &
soon" works before it lands.

| Phase | Scope | Est. |
| --- | --- | --- |
| **D1. Foundations** | `utils/surprise.ts` (seeded weighted pick, exclusions, exhaustion) and `utils/neighbourhood.ts` (grouping, radius defaults, widening, freshness and few-spots badges), unit tests | 2–3 h |
| **D2. Surprise me** | `SurpriseSheet`, pool query, Save/Going/Open actions, widen-or-stop state, offline, analytics | 4–6 h |
| **D3. Around you** | `screens/Neighbourhood.tsx` + route, radius chips, grouped list, permission and no-home-area states, snapshot persistence | 5–7 h |
| **D4. Entry points** | Discover chips next to "For you", Profile row, query keys, persisted snapshots, analytics events | 2–3 h |
| **D5. Server sort** (SQL prepared, not applied) | `p_sort` + `p_published_since` on `get_ranked_events`, index, `scripts/test-discovery-sort.sql`, fake-backend double, hand-written types, service plumbing | 3–4 h |
| **D6. New & soon** | Section on Around you + Discover chip, degraded client-side `created_at` path until D5 is applied | 2–3 h |
| **D7. Polish** | A11y (44 px chips, sheet focus order), `suiteDiscovery.mjs`, copy, `docs/ISSUES.md` | 2–3 h |
| **D8. Apply and verify** (owner) | Apply D5 SQL, `npm run backend:types`, `npm run test:backend` | 0.5–1 h |

D1 → D2 and D1 → D3 run in parallel; D5 → D6. **Total 20–30 h.** Surprise me
and Around you alone (D1–D4, D7) are **15–22 h** and need no database change.

---

## 6. Decisions needed

1. Names in the UI: "Surprise me" / "Around you" / "New & soon"? (Recommend
   "Around you" over "My neighbourhood" for hosts' area-only locations.)
2. Surprise weighting: lean toward novelty (categories the viewer does not
   follow) or toward interests? The §3.1 weights lean novelty; "For you"
   already covers interests.
3. Default neighbourhood radius with a precise fix: 3 km or 5 km?
4. Ship "Just added" on the degraded client path first, or wait for D?
5. Should Surprise me prompt for location permission (Discover does), or
   stay prompt-free like the browse centre?
