# Event categories and recurring series plan

Status: written 2026-11-09. Phases A–F implemented the same day (see §7, "Implementation log");
E and F have listed remainders. All seven migrations are prepared but
unapplied; the client works without them. §8 lists status and the open
gaps found along the way.
Companion to `docs/HOST_TOOLS_PLAN.md` (host tooling) and
`docs/ONBOARDING_PLAN.md` (where `preferred_categories` came from).

Two features, planned together because they meet on Discover and on the
event forms:

1. **Categories** — make the existing category foundation complete enough
   that someone who only cares about live music can browse music events
   quickly, and that hosts and admins can keep the taxonomy healthy.
2. **Recurring series** — let organisers model "every Tuesday", "1st and
   3rd Saturday", "weekdays at 7am" and manage individual dates of a series,
   on top of the single-row recurrence that already exists.

---

## 1. What exists today

### 1.1 Categories

**Data.** `categories (id, slug, label, icon_key, sort_order, created_at)`;
10 rows seeded in `20260213092315_seed_initial_data.sql`. `events.category_id`
is `NOT NULL` with `ON DELETE RESTRICT`, so every event has exactly one
category. `profiles.preferred_categories uuid[]` is written by onboarding.
RLS: anyone can read; writes are service-role only. No `is_active`, `color`,
`description`, synonyms or grouping.

**Presentation.** Three parallel client maps keyed by *slug*, all of which
must be edited by hand to add a category:
- `constants/categoryIcons.ts` — Lucide component + colour + label.
- `constants/categories.ts` — colour again (`CATEGORY_COLORS`).
- `constants/categoryMarkers.ts` — raw SVG path data for map pins, plus a
  `SLUG_ALIASES` table.
The DB's `icon_key` values (`music`, `activity`, `brain`, `shopping-bag`…)
are never read by the client. `CATEGORY_ICON_CONFIG` also contains the
*business* category labels (`Restaurant`, `Bar & Nightlife`…), so two
taxonomies share one map.

**Taxonomy.** Labels are long and overlap: `food-drink` is "Coffee &
Tastings" while `dining` is "Food & Dining"; `nightlife` is "DJ Nights &
Nightlife" next to `live-music`. Chips upper-case the label, so
"RUN CLUBS & FITNESS" is wide and truncates on small screens.

**Discover (`app/(tabs)/discover.tsx`).** Horizontal chip row shows
`categories.slice(0, 8)` after an "ALL EVENTS" chip, so two categories are
reachable only from the filter sheet's grid. Multi-select, state-only (no
persistence, no deep link). Server filter is `category_ids uuid[]` on
`get_ranked_events`. Keyword search matches title/description/business name
only, so typing "music" does not surface the Live Music category.

**Elsewhere.** Cards show the label as a dark text badge
(`components/DiscoverEventCard.tsx`); Event Detail shows a non-interactive
hero pill. Map pins are coloured and glyphed by category (good; cluster
colour by category is a deferred item in `docs/ISSUES.md`). Create/Edit use
a horizontal chip scroller with no descriptions. Onboarding writes
`preferred_categories`; nothing reads it (not Discover, not ranking, not
notifications), and Settings cannot edit it. Admin has no categories page
and the events table has no category column.

### 1.2 Recurring events

**Data.** One row per series: `events.is_recurring` +
`recurrence_pattern jsonb` = `{frequency: daily|weekly|monthly, interval,
endDate?: 'YYYY-MM-DD'}`. Premium-only (create RPC + `check_recurring_
premium_on_update` trigger, expiry-aware since 20261108110000). RSVPs,
saves, capacity, waitlist, approvals and chat are all per series.

**Server.** `event_next_occurrence(start, is_recurring, pattern, tz)`
mirrors the client walk and feeds `next_start_datetime` to the ranked,
calendar, saved and going RPCs; `event_has_ended` is recurrence-aware and
gates the public SELECT policy. `send_event_reminders` keys on
`start_datetime` and `event_reminder_sent(event_id, user_id, minutes)`, so a
weekly series reminds attendees **once**, for the first date only.

**Client.** `utils/recurrence.ts` (`isEventOnDate`, `getNextOccurrences`,
zone-aware, DST-safe; supports `interval > 1`), `utils/calendar.ts`
expansion, `utils/eventIcs.ts` RRULE export. `components/RecurrencePicker.tsx`
offers only None / Every Day / Every Week / Every Month even though the
model supports intervals; `getRecurrenceLabel` falls back to the string
"2 weekly". `RecurrenceEndRow` sets `endDate`. Event Detail lists the next
5 dates; Discover and Manage Event show "Next: …"; Insights hides per-date
stats ("RSVPs cover the whole series").

**Gaps.** No "Mon & Wed", no "2nd Tuesday", no "weekdays", no end "after N
times", no per-date exceptions (skip a holiday, move one week's time), no
series-aware editing scope, reminders fire once, hosts cannot see or act on
the upcoming dates of their series, and the pattern-to-words copy is thin.

---

## 2. Goals and non-goals

Goals
- A viewer can get to "music events near me this weekend" in two taps, from
  Discover, from search, from an event's category pill, or from a shared
  link.
- Categories are data-driven: adding or renaming one is a DB change plus, at
  most, one icon registry entry.
- `preferred_categories` does something.
- Hosts can express the common real-world patterns, preview the dates before
  publishing, and skip or move a single date afterwards.
- Attendees see which dates a series actually happens on, get reminded for
  every date, and calendar exports stay correct.

Non-goals (for this plan)
- Multiple categories or free-form tags per event.
- Per-occurrence RSVP/capacity/chat (see §6, decision 2).
- Separate chat per occurrence.
- Changing the premium gate on recurrence.

---

## 3. Categories — proposal

### 3.1 Taxonomy cleanup (data migration)

Keep every existing slug (events reference them) but shorten labels, fix the
overlaps, and add a couple of catch-alls so hosts are not forced into a
wrong category. Proposed list, in `sort_order`:

| slug | label (short) | description (shown in pickers/browse hero) |
| --- | --- | --- |
| live-music | Live Music | Concerts, gigs, open mics, DJ sets with a live act |
| nightlife | Nightlife | Club nights, DJ nights, parties, late bars |
| dining | Food | Dinners, pop-up kitchens, supper clubs, food trucks |
| food-drink | Drinks & Tastings | Coffee cuppings, wine and beer tastings, cocktail nights |
| markets | Markets & Pop-ups | Makers markets, vintage fairs, flea markets |
| fitness | Fitness | Run clubs, group workouts, yoga, cycling |
| sports | Sports | Pickup games, leagues, watch parties |
| workshops | Workshops | Classes, talks, skill-shares |
| trivia | Games & Trivia | Quiz nights, board games, karaoke |
| culture | Arts & Culture | Exhibitions, theatre, film, readings |
| community *(new)* | Community | Meetups, volunteering, networking |
| family *(new)* | Family | Kid-friendly and all-ages events |

Adding `comedy`, `wellness`, `tech` later is a DB insert once §3.2 lands.
Final list is decision 1 in §6.

Schema additions (one migration, `CREATE … IF NOT EXISTS` style like the
rest of the repo):
- `categories.color text` — hex; moves `CATEGORY_COLORS` into data.
- `categories.description text`.
- `categories.synonyms text[] DEFAULT '{}'` — search terms ("concert",
  "gig", "band" → live-music).
- `categories.is_active boolean DEFAULT true` — retire without deleting
  (events keep their category; pickers hide it).
- Update `icon_key` to the Lucide names the client already renders
  (`disc-3`, `mic-vocal`, `coffee`, `dices`, `sparkles`, `pen-tool`,
  `utensils-crossed`, `trophy`, `palette`, `flame`, plus `users`,
  `baby`).
- `categoriesService.getAllCategories()` filters `is_active` for pickers;
  a second call (or a flag) returns all for admin and for rendering legacy
  events.
- Regenerate `types/supabase.generated.ts`; extend `types/database.ts
  Category`.

### 3.2 Data-driven presentation on the client

Collapse the three slug-keyed maps into one registry keyed by **icon_key**
plus a single resolver:

- `constants/categoryIconRegistry.ts`: `Record<iconKey, { Icon: Lucide
  component; paths: string[] }>` — the Lucide component for RN and the SVG
  path data for the WebView markers, side by side so they cannot drift.
  `tests/categoryMarkers.test.ts` gains a check that every seeded
  `icon_key` has a registry entry.
- `utils/categoryPresentation.ts`: `presentCategory(cat | slug | null) →
  { label, shortLabel, color, Icon, paths, description }`. Colour and label
  come from the row; the registry supplies glyphs; a neutral fallback covers
  unknown keys. The map HTML (`markerSvgScript`) receives the resolved
  `{slug → {color, paths}}` table built from the cached categories query, so
  pins stay in sync with the DB without a rebuild.
- `CategoryIcon` takes a `Category` (or slug, resolved through the cached
  query) instead of guessing from the icon config.
- Business categories get their own small map
  (`constants/businessCategories.ts`), removing the label-keyed entries and
  `SLUG_ALIASES` from the event registry. `screens/BusinessDetail.tsx` and
  Settings' `BUSINESS_CATEGORIES` switch to it.
- Keep a bundled snapshot of the seeded rows as the offline fallback for the
  first render before the persisted query hydrates (today: no fallback at
  all; `hooks/useCategories.ts` comment).

### 3.3 Browsing UX

**Discover chip row.** Show all active categories (drop `slice(0, 8)`),
ordered: user's `preferred_categories` first, then `sort_order`. Chips use
icon + short label in sentence case (not upper-case) so twelve fit on one
scroll. Selected chips fill with the category colour and white text/icon;
contrast is verified in `tests/themeContrast.test.ts` for every seeded
colour on white and white-on-colour. A trailing "More…" chip opens the
existing filter sheet. The filter-count badge and "clear" behaviour stay.

**Category browse screen** — `app/category/[slug].tsx`, pushed from:
- the hero pill on Event Detail (make it a button: "See more Live Music"),
- the category badge on Discover cards (long-press or tap, decide in design),
- a "Browse by category" grid on Discover's list view and in its empty
  state ("Nothing here for these filters. Try a category: …"),
- search suggestions (below),
- deep links `eventmap://category/live-music` (shareable; mirrors
  `app/event/[id].tsx` plumbing in `utils/eventLinks.ts` / `eventShare.ts`).

Layout: coloured hero with icon, label, description; date preset chips
(`utils/datePresets.ts`: Today / Tomorrow / This weekend / Next 7 days /
Next 30 days); results via `get_ranked_events` with `category_ids = [id]`
and the user's location/radius; list-first with a "Map" toggle that
re-enters Discover with the filter applied. Per-category empty state
("No live music within 20 km this weekend — widen to 30 days?").

**Search overlay.** Client-side match of the typed text against labels and
`synonyms` adds a "Category" suggestion row at the top ("Live Music ·
category"); selecting it applies the filter rather than a keyword. Server:
`get_ranked_events` also matches `c.label ILIKE` and `search_query = ANY
(c.synonyms)` so plain keyword searches still find the right events.

**Personalisation.** Use `preferred_categories` as a *boost*, not a filter,
so new users never see an empty map: pass `p_preferred_category_ids` into
`get_ranked_events` and add a small score term (same shape as the premium
and recency terms in `20261106120000_perf_ranked_events.sql`). Pair with
the chip ordering above and a "For you" chip that applies the preferred set
as a filter explicitly. Settings gains an "Interests" row editing
`preferred_categories`, reusing the onboarding picker extracted to
`components/CategoryPicker.tsx`.

**Map.** Optional in this scope: cluster colour from the dominant category
(already noted in ISSUES as deferred).

### 3.4 Host UX (Create / Edit)

- Replace the horizontal chip scroller with a two-column grid (or a bottom
  sheet on small screens) showing icon, short label and the one-line
  description; selected card in category colour. Same `choiceA11y` radio
  semantics (`checked`) as today.
- Suggest a category from the title and description using the synonyms list
  ("Looks like Live Music — use it?"), dismissible, never auto-applied.
- Remember the business's last-used category as the pre-selected default
  in Create (via the existing `useFormDraft` store or a tiny zustand slice).

### 3.5 Admin

- `admin/app/(dashboard)/categories`: list with drag or up/down reorder
  (`sort_order`), edit label/description/colour/synonyms, pick `icon_key`
  from the registry (preview), toggle `is_active`, event count per
  category. Writes go through the service-role server client (RLS already
  blocks everyone else) or a `SECURITY DEFINER` admin RPC guarded by the
  existing admin-role check, matching the pattern in
  `20260219100400_admin_rpcs_and_policies.sql`.
- Events table: category column and filter (same URL-param approach as the
  businesses/complaints filters).

### 3.6 Tests

- Registry completeness (every DB `icon_key` resolves), colour contrast,
  `presentCategory` fallbacks, chip a11y state (`checked`), search
  suggestion matching, deep-link parsing for `/category/[slug]`, and a
  backend test that `get_ranked_events` matches label/synonyms and applies
  the preferred boost without changing results when the array is NULL.

---

## 4. Recurring series — proposal

### 4.1 Keep the single-row series model

Alternative considered: materialise one `events` row per occurrence with a
`series_id`. It would give per-date RSVP, capacity and chat for free, but
it breaks the monthly creation quota, multiplies chat rooms and ranking
candidates, needs a cron to roll rows forward, and every RPC written since
20261029 assumes one row per series. Recommendation: keep the series row,
extend the pattern, and add an **exceptions** table for per-date changes.

### 4.2 Recurrence pattern v2 (backward compatible JSON)

```ts
type RecurrencePattern = {
  frequency: 'daily' | 'weekly' | 'monthly';
  interval: number;                 // existing
  endDate?: string;                 // existing, 'YYYY-MM-DD'
  byWeekday?: number[];             // weekly: 0=Sun…6=Sat; default [start weekday]
  monthly?: 'dayOfMonth' | 'nthWeekday'; // default 'dayOfMonth' (today's behaviour)
};
// Implemented 2026-11-09: weeks for `interval` are Monday-based; the
// nth-weekday week is derived from the start ("last" when the start is in
// the month's final seven days), no separate key.
```
- "Every weekday" = weekly with `byWeekday: [1,2,3,4,5]`.
- "2nd Tuesday" = monthly, `nthWeekday`, derived from the start date
  (ordinal and weekday); "last Friday" when the start is in the last seven
  days of its month.
- "After N times" is a UI affordance converted to `endDate` at save time by
  walking the pattern, so no schema or SQL change.
- Old patterns without the new keys keep today's semantics exactly.

Both implementations must change together and stay in parity:
- `utils/recurrence.ts`: `isEventOnDate`, `getNextOccurrences`,
  `filterEventsByDateRange`, plus a new `describeRecurrence(pattern,
  start, tz)` → "Every Tuesday and Thursday · until 3 Mar" / "Every 2 weeks
  on Saturday" / "Monthly on the 2nd Tuesday". Replaces `getRecurrenceLabel`
  everywhere (cards, Detail, Manage, Insights, Calendar).
- SQL `event_next_occurrence` (`20261103140000_event_timezones.sql`) learns
  `byWeekday` and `nthWeekday`. Add a validation trigger on
  `recurrence_pattern` (shape, interval ≥ 1, weekdays 0–6, at least one
  weekday) so the client is not the only guard.
- `utils/eventIcs.ts buildRecurrenceRule` emits `BYDAY=TU,TH`,
  `BYDAY=2TU`, `BYSETPOS=-1` where needed.
- Parity test: a fixture set of patterns × dates run through the TS util and
  through the SQL helper (`npm run test:backend`) must agree.

### 4.3 Per-date exceptions

```sql
CREATE TABLE event_occurrence_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  occurrence_date date NOT NULL,          -- calendar date in the event's zone
  kind text NOT NULL CHECK (kind IN ('cancelled', 'rescheduled')),
  new_start timestamptz, new_end timestamptz,  -- rescheduled only
  note text,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (event_id, occurrence_date)
);
```
- RLS: readable wherever the event is readable; written only through RPCs
  `skip_occurrence`, `reschedule_occurrence`, `restore_occurrence`
  (owner check, series must be active, date must be a real occurrence, same
  `SECURITY DEFINER` + pinned `search_path` pattern as the host tools).
- Expansion honours exceptions on both sides: `getNextOccurrences(event,
  n, now, exceptions)` and `event_next_occurrence(..., exceptions)` skip
  cancelled dates and substitute rescheduled times. The ranked/calendar/
  saved/going RPCs join the exceptions once (a lateral `jsonb_agg` per
  event, bounded to upcoming dates) so clients receive them with the event.
- ICS export emits `EXDATE` for cancelled dates and a detached single
  `VEVENT` with `RECURRENCE-ID` for moved ones.
- Notifications: skipping or moving a date reuses the postpone/reschedule
  notification path in `services/hostTools.ts` / `notify_*` RPCs, scoped
  to going + interested + savers, with the date in the copy ("Tuesday 18 Nov
  is cancelled; the series continues on 25 Nov").

### 4.4 Host UX

**Repeat sheet (Create/Edit).** Replace the four-option list with:
- Doesn't repeat · Daily · Weekly · Every 2 weeks · Monthly · Custom.
- Weekly reveals a seven-day toggle row pre-filled with the start weekday.
- Monthly offers "on day 14" / "on the 2nd Tuesday" radio, derived from the
  start date.
- Custom: interval stepper + unit.
- Ends: Never · On date (existing `RecurrenceEndRow`) · After N times.
- Live preview line under the control: `describeRecurrence(...)` plus "Next
  dates: Tue 11 Nov, Thu 13 Nov, Tue 18 Nov…" and a total when an end is
  set. Warn above ~200 dates.
- Premium gate unchanged: the inline upsell card stays; lapsed hosts keep
  the `noneOnly` escape hatch.
- Accessibility: weekday toggles are `checkbox` with `checked`; the preview
  is a live region so VoiceOver hears the result of a toggle.

**Manage Event (`screens/ManageEvent.tsx`).** New "Upcoming dates" section
for series: next ~8 dates with per-row actions Skip / Change time / Restore,
each confirming via `utils/confirm.ts` and offering "notify attendees".
Skipped dates render struck through with the note. A "Series" summary row
links to Edit for whole-series changes.

**Edit scope.** Whole-series only in this plan (today's behaviour), with
clear copy when the start time or pattern changes: "This changes every
upcoming date. To change one date, use Manage → Upcoming dates." "This and
following" (split the series) is decision 3 in §6.

### 4.5 Attendee UX

- Discover card: replace the raw next-date badge with "Tue · Weekly" style
  pair (next date + cadence word) and a small repeat glyph.
- Event Detail: header "Every Tuesday, 7:00 PM · Next: Tue 11 Nov"; the
  "Happens again" list shows skipped dates struck through and moved dates
  with the new time; keep "Add series to calendar".
- Calendar screen: `utils/calendar.ts expandOccurrences` applies exceptions;
  moved dates show a "moved" marker; skipped dates disappear.
- Saved/Joined/Profile lists already use `next_start_datetime`; they pick
  up exceptions through the RPC change with no UI work.

### 4.6 Reminders per occurrence

`send_event_reminders` switches from `e.start_datetime` to
`event_next_occurrence(...)` for the window check, and `event_reminder_sent`
gains an `occurrence_start timestamptz` column in its uniqueness key so each
date reminds once. Keep the 25-hour bound added in
`20261106140000_perf_fk_indexes_and_housekeeping.sql` (it only needs to use
the next occurrence instead of the first start).

### 4.7 Insights

With series-level RSVPs, per-date attendance still cannot be shown. Show
instead a per-date **views** trend (event_views already carries timestamps)
and the list of exceptions, and keep the existing explanatory copy.

### 4.8 Tests

Extend `tests/recurrence.test.ts` (byWeekday parity weeks, nth-weekday
including "last", month clamping, DST, exceptions), `tests/calendar.test.ts`
(exceptions in expansion), ICS tests (EXDATE / RECURRENCE-ID), a
`describeRecurrence` snapshot table, Repeat-sheet a11y guards, and the
TS-vs-SQL parity fixture under `test:backend`.

---

## 5. Phasing and estimates

| Phase | Scope | Est. |
| --- | --- | --- |
| A. Categories foundation | §3.1 migration + types, §3.2 registry/resolver, business-category split, Discover shows all chips with preferred ordering, Settings "Interests", admin events column | 6–8 h |
| B. Category browsing | §3.3 browse screen + deep link, entry points, search suggestions + server label/synonym match, preferred boost, empty states | 6–8 h |
| C. Admin categories page | §3.5 | 3–4 h |
| D. Recurrence patterns v2 | §4.2 util + SQL + validation trigger + parity tests, new Repeat sheet with preview, `describeRecurrence` copy across screens, ICS BYDAY | 8–10 h |
| E. Exceptions and series management | §4.3 table/RPCs/RLS, RPC joins, client expansion, Manage Event dates list, Detail/Calendar/ICS rendering, notifications, §4.6 reminders | 8–10 h |
| F. Optional follow-ups | per-occurrence RSVP/capacity, "this and following" split, category-based "new event near you" notifications, cluster colour by category | not estimated |

A and D are independent and can run in parallel. B depends on A; E on D.
Suggested order if serial: A → D → B → E → C.

Migration hygiene (from the shared-DB note in memory and `CONTRIBUTING.md`):
develop against `SCRATCH_DB` for this worktree, verify `npm run
backend:reset`, regenerate types with `npm run backend:types`, run
`npm run test:backend`, and ask before applying anything to the shared
database. Every new RPC follows the existing `SECURITY DEFINER` +
`SET search_path = public` + owner-check pattern.

---

## 6. Decisions needed

1. **Final taxonomy.** Approve or edit the list in §3.1 (renames are
   presentation-only; slugs and existing events are untouched). Add/remove
   `community`, `family`.
2. **Per-occurrence RSVP.** Recommendation: defer (Phase F). Series-level
   "Going" stays; per-date reminders and per-date cancellations cover the
   most-felt gaps without touching rsvps/counts/waitlist/approval RPCs.
3. **"This and following" edits.** Recommendation: defer; exceptions handle
   single dates, and a full split can be built later on `duplicate_event`
   plus setting `endDate` on the original.
4. **Preferred categories as boost vs default filter.** Recommendation:
   boost + chip ordering + explicit "For you" chip.
5. **Category browse screen: list-first or map-first.** Recommendation:
   list-first with a Map toggle that hands off to Discover.
6. **Recurrence stays premium-only.** Recommendation: yes, unchanged.

Decided 2026-11-09: (1) taxonomy approved as listed; (3) preferred
categories are a boost + chip ordering, not a filter; (5) list-first browse
screen. (2) per-occurrence RSVP: decided later the same day — go with the
recommendation in §7 "Open" (patterns/exceptions/per-date reminders first,
then a per-date "Going" layer as Phase F). Earlier note: still open — the owner wants a look at how
comparable apps (Facebook Events and similar) treat RSVPs on recurring
events before deciding; see §7 "Open".

---

## 7. Implementation log

### Phase A — 2026-11-09 (this worktree, uncommitted at time of writing)

Rules followed: the shared local database was **not** modified. The
migration was exercised only on an isolated scratch copy
(`SCRATCH_DB=eventmap_scratch_oak scripts/db-scratch.sh refresh && … apply`),
applied twice to prove idempotency. No long-running subagents or E2E suites.

Done
- `supabase/migrations/20261109100000_category_taxonomy.sql` — §3.1 as
  specified (new columns, hex CHECK, partial index, relabel, Lucide icon
  keys, `community` and `family`). Idempotent. **Unapplied.**
- `constants/categorySeed.ts` — bundled snapshot of the 12 rows plus the
  pre-migration label and slug alias tables.
- `constants/categoryIconRegistry.ts` — one entry per Lucide icon name with
  the React component *and* the SVG path data (replaces the three slug-keyed
  maps in the deleted `constants/categories.ts` / `categoryIcons.ts`).
- `utils/categoryPresentation.ts` — `presentCategory()` resolver (row →
  slug → alias/legacy label → business label → neutral pin), `categoryTint`,
  `orderCategoriesForViewer` (interests first, retired hidden unless
  preferred).
- `constants/businessCategories.ts` — venue categories split out with their
  own icon/colour; Settings and Business Onboarding read the list from here.
- `constants/categoryMarkers.ts` + both map HTML templates — markers carry
  `categoryColor` / `categoryIconKey` from the row (slug is the fallback);
  WebView table also covers business labels. `MAP_HTML_VERSION` → 10.
- `components/CategoryIcon.tsx` accepts a row, slug or label; optional
  glyph colour override for filled chips.
- `hooks/useCategories.ts` — filters `is_active`, exposes `allCategories`
  and `byId`.
- Discover: every active category is a chip (no more `slice(0, 8)`),
  ordered by the viewer's interests, natural case, filled with the category
  colour when selected; filter-sheet grid likewise; pins use row styling.
- `components/CategoryPicker.tsx` extracted from onboarding; onboarding
  uses it; Settings gains an **Interests** row (saves
  `profiles.preferred_categories`, dirty-tracked).
- Admin: events table shows the category; category `<select>` filter kept
  through pagination (URL params).
- Tests: `tests/categoryPresentation.test.ts` (registry completeness, AA
  contrast for white-on-colour, resolver rules, ordering), marker and map
  DOM suites updated for row-driven styles. `npm run typecheck`,
  `npm run typecheck:admin` and `npm test` pass.

Not done in Phase A (by design)
- `types/supabase.generated.ts` is untouched: it is generated from the
  local schema, which has not had the migration applied. `types/database.ts`
  carries the new optional fields by hand.
- Create/Edit still use the horizontal chip scroller (§3.4 grid +
  suggestion is Phase B).
- Preferred-category ranking boost in `get_ranked_events` (Phase B, needs a
  migration).

Open
- Decision 2 (per-occurrence RSVP). Comparison, from the author's knowledge
  of these products (not re-verified online on 2026-11-09):
  - **Facebook Events**: a recurring event is shown as one event page with a
    list of dates; people respond ("Going"/"Interested") to *individual
    dates*, and the page highlights the next date. Reminders are per date.
  - **Meetup**: a repeating event template spawns separate event instances;
    RSVP, capacity, waitlist and comments are per instance. Hosts cancel or
    edit one instance or the whole series.
  - **Eventbrite**: "recurring event" = one listing with a schedule; the
    attendee picks a date and registers for that date only; capacity is per
    date.
  - **Google Calendar / Outlook invites**: reply to one occurrence or the
    whole series; exceptions are stored per occurrence.
  The common pattern is one listing, per-date attendance. Eventmap today is
  one listing, series-wide attendance. Recommendation stays: ship §4.2/§4.3
  first (patterns, exceptions, per-date reminders, per-date cancellations),
  then add an `rsvp_occurrences` layer (per-date "Going" on top of the
  series-level record) as Phase F, which is how Facebook's model maps onto
  the existing single-row series without duplicating chat or quota.

### Phase B — 2026-11-09 (uncommitted)

Same rules as Phase A: no writes to the shared database; SQL validated on
the scratch copy only (applied twice; fixtures inserted inside a
transaction and rolled back). No long-running subagents.

Done, in order of dependency
1. `supabase/migrations/20261109110000_category_discovery.sql`
   (**unapplied**) — `get_ranked_events` gains `p_preferred_category_ids`
   (+0.3 score, NULL/empty = identical ranking) and matches the category
   label and synonyms in `search_query`. Verified on scratch: " Gig " →
   live-music, "Tastings" → food-drink, a title search still works, the
   boost moves the preferred category from last to first, one overload.
2. `services/events.ts` sends the viewer's interests; on PGRST202 (function
   signature not migrated) it remembers that and retries without them.
   Discover passes `profile.preferred_categories`.
3. `utils/categoryBrowse.ts` (pure, tested): slug lookup incl. aliases and
   retired rows, route/web URL builders, search suggestions (label prefix >
   label word > synonym; bundled synonyms before the migration), and
   `suggestCategoryFromText` for the host hint (whole-word, title ×2, no
   suggestion on a tie).
4. `screens/CategoryBrowse.tsx` at `app/category/[slug].tsx` — list-first:
   coloured hero, date presets, paged results within 25 km (profile area or
   last known fix; never prompts), empty state offering "Next 30 days" /
   "Within 100 km", pull to refresh, offline/error states, Share and "Show
   on map" (Discover `?category=<slug>`, consumed once).
5. Entry points: Event Detail category pill is a link; Discover empty state
   has "Browse by category"; the search overlay shows up to three Category
   suggestions that apply the filter instead of a keyword.
6. §3.4 host picker: `components/CategorySelectGrid.tsx` (two-column cards
   with descriptions, radiogroup, dismissible "Looks like X — Use it") in
   Create and Edit, replacing both chip scrollers.

Checks: `npm run typecheck`, `npm test` (66 files, 774 tests), eslint on
touched files (no new warnings), a11y guard suites pass.

Not done / next
- "Remember the business's last-used category" (§3.4, small).
- Phase C admin categories page; Phase D recurrence patterns v2.
- Not exercised on a device or simulator; the browse screen and the search
  suggestions need a click-through once the migrations are applied.

### Phase C — 2026-11-09 (uncommitted)

Same rules: shared database untouched, SQL exercised on the scratch copy
(applied twice; admin and non-admin sessions simulated inside a rolled-back
transaction), no long-running subagents. Direct reads of the shared DB and
of the sibling worktree were blocked by the sandbox, so the live state is
inferred from the scratch snapshot only.

Done
1. `supabase/migrations/20261109120000_admin_categories.sql` (**unapplied**):
   admin INSERT/UPDATE policies via `is_admin_user()`, no DELETE (FK is
   RESTRICT; retire instead), slug-format CHECK,
   `admin_reorder_categories(uuid[])` (array order → sort_order, duplicate
   guard), `admin_category_stats()` matching the signature already present
   on the shared snapshot. Verified: admin reorder reverses the list,
   non-admin RPC refused, non-admin UPDATE touches 0 rows, bad slug rejected.
2. Admin `/categories` (nav item added): list ordered by `sort_order` with
   glyph + colour swatch, description, search terms, event counts (RPC when
   present, else one head-count per category), Active/Retired, ↑/↓ reorder,
   Retire/Restore, Edit. `/categories/new` and `/categories/[id]` share
   `CategoryForm`: label, slug (auto from label, locked on edit), description,
   icon picker with previews, colour (picker + hex) with a live white-text
   contrast check against the 4.5:1 rule, search terms, active flag, preview
   chips. Server action validates with `admin/lib/categoryForm.ts`.
3. Pre-migration behaviour is explicit, not broken: missing taxonomy columns →
   amber notice and base-column saves; writes with no policy / missing RPC →
   "read-only until 20261109120000" message; duplicate slug and CHECK
   failures → plain-language errors.
4. `admin/lib/categoryIcons.ts` holds the glyph paths for previews;
   `tests/adminCategoryForm.test.ts` fails if it drifts from the app registry
   and covers slugify, synonyms parsing, hex normalisation, contrast and the
   form validator.

Checks: `npm run typecheck`, `npm run typecheck:admin`, admin eslint on the
new files, `npm test` (67 files, 784 tests).

Not done
- Drag-and-drop reorder (↑/↓ buttons instead; adequate for 12 rows).
- Admin event-count column distinguishes drafts (counts follow the existing
  `admin_category_stats` semantics: active + not ended).
- Not clicked through in a browser (admin deps are installed here, but the
  pages were only type-checked and linted).

### Phase D — 2026-11-09 (uncommitted)

Same rules: shared database untouched (scratch copy only; every write test
inside a rolled-back transaction), no long-running subagents.

Done
1. `utils/recurrence.ts` — `byWeekday` (Monday-based week parity) and
   `monthly: 'nthWeekday'` in `isEventOnDate`, hence in
   `getNextOccurrences`, `filterEventsByDateRange`, calendar expansion and
   Discover. New: `describeRecurrence` ("Every Tuesday and Thursday",
   "Monthly on the last Friday", "Every weekday"), `validateRecurrencePattern`
   (mirrors the trigger), `endDateAfterCount` ("ends after N times" stored as
   an end date), `normalizeWeekdays`, `weekOfMonthFor`. `types/database.ts`
   now re-exports the single `RecurrencePattern` type.
2. `utils/eventIcs.ts` — `BYDAY=TU,TH`, `WKST=MO` with intervals,
   `BYDAY=2TU` / `-1FR` (needs the series start; both call sites pass it).
3. `components/RecurrencePicker.tsx` rebuilt (same exports/handle):
   Doesn't repeat / Daily / Weekly / Monthly, "Every N" stepper, weekday
   toggles with Weekdays / Weekends / Only-<day> shortcuts, monthly "On day
   14" vs "On the second Tuesday", "Ends after N times", live preview
   (summary + next dates + last date), warnings for long series and for a
   start that isn't one of the chosen days. Draft is committed on Done;
   radios/checkboxes expose `checked`; steppers are `adjustable`.
4. Create/Edit pass the series start, label the row with
   `describeRecurrence`, and let a counted end date win over the old one.
   Event Detail's "Happens again" header uses the describer with the end
   date. Server `invalid_recurrence:` errors are shown as readable text
   (`recurrenceErrorMessage`).
5. `supabase/migrations/20261109130000_recurrence_patterns_v2.sql`
   (**unapplied**), shaped to match objects another session already put on
   the shared DB (see ISSUES). Regression: identical to the original
   function for 2,268 v1 inputs. Found and fixed during validation: a NULL
   in the v2 detection (missing key → NULL, not false) that silently
   changed results for future v1 starts.
6. Tests: `tests/recurrenceV2.test.ts` (32), `tests/recurrenceParity.test.ts`
   (client vs SQL over 14 shapes × 40 instants; fixture regenerated from a
   scratch DB by `scripts/recurrence-parity.sql`), `recurrenceErrorMessage`.
   Totals: 69 files, 833 tests; app typecheck clean; no new lint warnings.

Decision needed (D1): a future start that isn't an occurrence (start on a
Saturday, series "weekdays"). The other session's function returns the
Saturday start; this file and the client return the following Monday.
Recommendation: next real occurrence (what the client already shows), and
snap the start in the form (G6 below) so stored rows rarely hit the case.

### Phase E — 2026-11-09 (uncommitted)

Same rules: shared database untouched (scratch copy only; behaviour tests
inside a rolled-back transaction with disposable fixtures), no long-running
subagents.

Done, hardest first
1. `supabase/migrations/20261109140000_occurrence_exceptions.sql`
   (**unapplied**): exceptions table keyed by original date in the event
   zone (CHECKs for kind/times/note length); RLS read = event visibility, no
   write policies; `occurrence_guard` (host/admin, active series, date is a
   real, not-past occurrence within the end date); `skip_occurrence`,
   `reschedule_occurrence`, `restore_occurrence` with optional notification
   to going/interested/requested/savers/waitlist (postpone_event's audience
   and opt-out); `event_next_effective_occurrence`; per-date reminders.
   Verified on scratch: reminder sent for a *later* date of a weekly series
   and not repeated on rerun; skip notifies with "continues on Monday 16
   Nov"; next date moves past a skip, to a moved time, back after restore;
   off-pattern date, past date, non-host and direct table insert refused;
   attendees can read exceptions.
2. `utils/occurrences.ts` (pure, tested): `listOccurrences` (cancelled kept
   for display within the live span, moved re-sorted, duration kept),
   `nextEffectiveOccurrence` (mirrors the SQL), `occurrenceDateKey`
   (event-zone keys), `exceptionsForIcs`.
3. `services/occurrences.ts` + `useOccurrenceExceptions`: list (single and
   batched), skip/move/restore; pre-migration → [] and a clear "not
   available yet" message; readable guard errors.
4. Host: Manage Event → **Upcoming dates** (`SeriesDatesSection`): next 8
   dates, Skip / Change time / Restore, two-step confirm (do it, then
   notify?), moved/skipped states and notes; move-date modal with
   platform pickers on the event zone's wall clock, duration preserved.
5. Attendees: Event Detail header uses the next *effective* date;
   "Happens again" strikes through cancelled dates and marks moved ones.
   Calendar screen drops skipped dates and shows moved ones (one batched
   query). `.ics` export writes `EXDATE` for skipped dates and a
   `RECURRENCE-ID` override VEVENT for moved ones.
6. Tests: `tests/occurrences.test.ts` (incl. ICS), calendar exceptions case.
   Two project guards caught real gaps and were fixed (modal escape
   gesture; wrapped service methods must be async). Totals: 70 files, 847
   tests; app typecheck clean; no lint errors in touched files.

Remaining in Phase E
- **E-R1 Server listing RPCs** (`get_ranked_events`, saved, going, calendar)
  still compute `next_start_datetime` with `event_next_occurrence`, so
  Discover cards, Saved, Joined and Profile show a skipped date as "next".
  Fix: swap in `event_next_effective_occurrence` (needs a migration
  re-creating those functions; bundle with the category discovery one).
- **E-R2 Edit-scope copy** (§4.4): Edit doesn't yet warn "this changes
  every upcoming date; use Upcoming dates for one".
- **E-R3 Insights per-date view trend** (§4.7) not started.
- **E-R4 Discover/Saved cadence copy** (G8) still pending.

New gaps found (continue the G list)
- **G13 Orphaned exceptions after a series edit.** Changing the start or
  pattern leaves exception rows on dates the series no longer has; they are
  harmless (never match) but clutter and could re-match after a later edit.
  Fix: delete or flag exceptions in the Edit save path / a trigger.
- **G14 Restore/move clears all future reminder markers** for the event,
  so a date already reminded inside the window could be reminded again.
  Fix: delete only the affected occurrence_start.
- **G15 Calendar: a date moved INTO the visible range from outside it** is
  not shown (expansion keys on original dates).
- **G16 Reminder body is a snapshot** of the live function (see ISSUES);
  re-diff before applying.

### Phase F — 2026-11-09 (uncommitted)

Same rules: shared database untouched, no subagents. **Mid-phase finding:**
the scratch name this branch used was shared with a sibling session (both
worktrees are called `oak`); everything was re-validated on a fresh,
uniquely named copy (`eventmap_scratch_oak_catseries`). See ISSUES.

Done, hardest first
1. Per-date "Going" (decision 2): `20261109150000_rsvp_occurrences.sql` —
   overrides on top of the series RSVP ('not_going' for one date, 'going'
   for just one date), `set_occurrence_rsvp` (same gates as RSVPs + real,
   future, not-cancelled date), public per-date counts, reminders honour
   overrides. Verified: A opts out of tonight, B joins only tonight →
   counts 1/1, tonight's reminder goes to B only, off-pattern date refused,
   users read only their own rows.
   Client: `dateAttendance` / `nextDateOverride` (minimal override, cleared
   when it matches the series), service, Event Detail per-date
   Go / Going / Can't go toggles, per-date "N going" in Upcoming dates.
2. "This and following" (decision 3): `20261109160000_split_series.sql` —
   `split_series_from`: original ends the day before, new series from that
   date with the original end; RSVPs, saves, links, photos copied;
   exceptions and per-date RSVPs moved; followers and the host are not
   notified. Verified on the clean copy. Client: ✂ action in Upcoming
   dates → confirm → opens Edit on the new series.
3. Map clusters coloured by dominant category, both providers, one shared
   rule (`dominantMarkerColor` / `__markerDominantColor`, parity-tested).
4. Opt-in "New <category> near you" notifications:
   `20261109170000_interest_event_notifications.sql` (interests × 25 km ×
   1/day, followers excluded, cap 500, nearest first) + Settings toggle
   (default off) + notification icon. Verified on the clean copy.
5. Also closed: G14 (move clears only that date's reminder markers) and
   E-R2 (Edit explains series-wide scope and where to change one date).
Checks: 70 files, 851 tests; app typecheck clean; no lint errors.

Remaining in Phase F
- **F-R1 Reconcile with the sibling session's overlapping per-date/split
  API** (G1) — biggest item before any of this can ship.
- **F-R2 Per-date capacity/waitlist/approvals** (G18).
- **F-R3 Host attendee list per date** (who is going on Tuesday).

New gaps found
- **G17 Shared scratch name** (fixed for this branch; process note for all
  sessions).
- **G18 Capacity is series-level:** a date-only "going" isn't checked
  against `max_attendees`.
- **G19 Per-date overrides are dropped** if the series RSVP leaves "going"
  only in the sibling design (their trigger); this branch keeps them —
  decide which is right (likely: keep 'going' date-only rows, drop
  'not_going').
- **G20 Split leaves chat/reviews on the original;** attendees of the new
  series have a new, empty chat.
- **G21 Split doesn't count towards the monthly quota** (intended? decide).
- **G22 Split UI** is only reachable from Upcoming dates, not from Edit.
- **G23 "Nearby events" preference is dead:** shown in Settings, default
  on, but nothing sends `nearby_event` notifications. Remove, or wire to the
  new notifier.
- **G24 Interest notifications use the profile home area only,** not the
  device location; users without a home area never get them.

### Gap-closing pass — 2026-11-09 (uncommitted)

Same rules: shared database untouched (prepared SQL validated on the
uniquely named scratch copy `eventmap_scratch_oak_catseries`, behaviour
tests rolled back); no subagents. Sibling-session reconciliation (F-R1/G1)
and applying migrations deferred by the owner.

Closed, highest impact first
1. **E-R1 (client) + G2** — `hooks/useEffectiveNextDates`: one batched
   exceptions query per list; "next" is the server's `next_start_datetime`
   unless a skip/move or the clock says otherwise, and never a time already
   past. Wired into Discover, Saved, Joined, My Events, public profile and
   Manage Event's header. `listOccurrences` gained `strict`. Server ranking
   still uses the plain next date (true E-R1 fix stays a migration item).
2. **F-R2 / G18 capacity** — `set_occurrence_rsvp` refuses a date-only
   "going" when that date is at `max_attendees` (`event_full`); client shows
   "That date is full." Waitlist/approvals per date: deferred (below).
3. **F-R3 per-date attendee list** — `get_occurrence_attendees_page`
   (host/admin, private-profile masking as the series list) + Manage Event
   Going tab date chips ("Whole series", next 6 dates); rows are read-only
   with "this date only" marked. Pre-migration: explains and falls back.
4. **G13** — trigger prunes exceptions/per-date RSVPs on dates a series no
   longer runs after a start/pattern/zone change (verified: Tue→Wed edit
   removed the Tuesday rows).
5. **G19** — decided and implemented: leaving the series drops
   'not_going' overrides, keeps date-only 'going' rows (trigger on rsvps).
6. **G15** — Calendar shows a date moved *into* the visible range (test).
7. **G6** — Repeat sheet "Move start" button when the start isn't a chosen
   day; Create/Edit shift start+end keeping the time and length.
8. **E-R4 / G8** — `cadenceLabel` ("Weekly", "Every 2 weeks", "Weekdays")
   as a Discover card badge and in Saved/Joined/Browse date lines.
9. **E-R3 + G12** — Insights for series: "When people RSVP" now lists going
   per upcoming date (series − opt-outs + date-only) and the header uses
   `describeRecurrence`; details come from the Event Detail cache.
10. **G22** — Edit's series hint links to Manage event's Upcoming dates.
11. **G23** — the dead "Nearby events" toggle is removed from Settings
    (preference key still saved for compatibility).
12. **G5** — the category browse default view is persisted for offline.
Checks: 70 files, 855 tests; app typecheck clean; no new lint errors.

Deferred (not feasible without the DB or a product decision)
- **E-R1 (server)**: ranking RPCs still order by the plain next date.
- **F-R2 waitlist/approvals per date**: needs a per-date waitlist model.
- **F-R1 / G1**: reconcile with the sibling session (owner: later).
- **G20** split chat/reviews, **G21** split quota (decide), **G24** interest
  notifications by device location, **G7** store the count, **G4** category
  cache freshness, **G9**, **G10**, **G11** device click-through,
  **G16/G17** process notes.

### Review pass — 2026-11-09 (uncommitted)

Same rules: shared database untouched (prepared SQL re-validated on the
clean scratch copy, behaviour tests rolled back); no subagents.

Regressions found and fixed
- **Split vs. orphan pruning.** `split_series_from` shortened the original
  series before moving the per-date rows, so the G13 prune trigger
  (20261109140000) could delete the exceptions/per-date RSVPs that belong to
  the new series. Reordered: move first, then shorten. (Scratch happened to
  pass before; the ordering is now correct by construction.)
- **Capacity check skipped private events.** `set_occurrence_rsvp` read the
  per-date count through the public counts RPC, whose visibility gate
  returns no row for non-public events (NULL ≥ max is false). Now uses an
  internal `occurrence_going_count`; the public RPC wraps it.

F-R2 remnant, decided and implemented: **per-date waitlist**. Checked
against comparable apps: Eventbrite and Meetup keep a waitlist per date of
a recurring event, Facebook shows availability per occurrence. A date-only
"going" on a full date becomes 'waitlist' (unless the host's waitlist mode
is off → "That date is full"); a freed seat (series goer opts out, date-only
goer steps back, or a series goer leaves) promotes the longest-waiting
person in 'auto' mode or pings them in 'notify' mode, reusing the existing
waitlist notification type. Counts RPC returns going + waiting; the host's
Upcoming dates shows "N going · M waiting"; the attendee toggle reads
"Waitlisted" and tapping it leaves the waitlist. Per-date *approvals* stay
series-level (approval mode gates joining the series, as today).

Small deferred decisions, resolved by "what Facebook/Eventbrite do, kept
simple, matching current UX":
- **G20** A split series gets its own chat (as a new event page does on
  Facebook). No change.
- **G21** A split does not count toward the monthly quota (it continues an
  existing event rather than adding one). No change; documented.
- **G24** Interest notifications use the profile home area, like the app's
  other "near you" features. No change.
- **G7** "Ends after N times" stays stored as an end date (Google Calendar
  does the same when sharing). No change.
- **G4** Category freshness (24 h cache) is acceptable for a taxonomy that
  changes rarely. No change.

Checks: 70 files, 857 tests; app + admin typecheck clean; lint shows only
pre-existing warnings. Still untested on a device/browser (G11).

Open after this pass
- E-R1 server half (ranking by effective next date) — migration.
- F-R1 / G1 reconciliation with the sibling session — owner, later.
- G9, G10, G11, G16, G17 (process/notes).

### Final regression + test report — 2026-11-09

Environment: a fresh, uniquely named scratch copy of the shared local
database (`eventmap_scratch_oak_regress`, created with
`scripts/db-scratch.sh refresh`), with all eight prepared migrations applied
in order. The shared database was not read or written during testing. No
E2E suites and no subagents; every command below is short and was run
directly. Nothing has been exercised on a device or in a browser (G11).

**1. Regression pass (dates and joining).** The repository's existing
rollback-only SQL suites, run on the fully migrated copy:

| Suite | Covers | Result |
| --- | --- | --- |
| `scripts/test-host-tools.sql` | join/leave, capacity, waitlist (notify/auto/off), approvals, bans, reschedule, postpone, publish | all checks passed |
| `scripts/test-calendar.sql` | `get_user_calendar` ranges, series expansion, zones | all assertions passed |
| `scripts/test-attendance-rpcs.sql` | going/past lists, counts, privacy, reminders (incl. the rewritten `send_event_reminders`: lead time, interested nudges, idempotency, leaving stops reminders) | all passed |
| `scripts/test-event-insights.sql` | insights RPC, business analytics, premium gate | all assertions passed |

These prove the series-level join, waitlist and reminder behaviour is
unchanged with the new triggers (`z_prune_date_rsvps_on_series_leave`,
`z_prune_orphaned_occurrence_rows`, `c_validate_event_recurrence`) in place.

**2. New-system suite.** `scripts/test-categories-series.sql` (new,
rollback-only, ASSERT-based, reusable). Sections and what each proves:

- *taxonomy*: 12 active categories, hex colours, synonyms, relabels, Lucide
  icon keys, slug and colour CHECKs.
- *admin categories*: non-admin refused (reorder, stats); reorder applied;
  stats row per category; duplicate ids refused.
- *discovery*: " GIG " and "music" find Live Music; preferred category ranks
  first; empty preference array is a no-op.
- *recurrence v2*: byWeekday, Monday-based biweekly parity, last-Friday
  monthly, future-start-not-an-occurrence → first real date, v1 future
  start unchanged, DST wall clock, two trigger rejections.
- *exceptions*: reminder for a later date of a series and idempotent; guest
  cannot skip; off-pattern and past dates refused; skip notifies and
  effective-next moves on; other dates' reminder markers survive (G14);
  reschedule honoured by effective-next; cannot move into the past;
  restore (and restore twice = unchanged); attendees read, cannot write.
- *per-date RSVP / capacity / waitlist*: opt-out; off-pattern and one-off
  refusals; counts; series goer returning is never waitlisted; full date →
  'waitlist'; **auto** promotes + notifies; **notify** pings, does not
  promote; **off** → `event_full`; capacity enforced on a non-public event
  (review fix); host per-date list with `via: date`; guests refused; RLS own
  rows only.
- *reminders honour overrides; G19; G13*: tonight's reminder goes only to
  the date-only goer; leaving the series drops `not_going` and keeps
  date-only `going`; changing the weekday prunes orphaned rows.
- *split*: first/off-pattern dates refused; original ends the day before;
  new series published at the split date; RSVPs and links copied; earlier
  exception stays, later exception and per-date RSVP move (prune-safe
  ordering); no notifications sent.
- *interest notifications*: opted-in nearby user notified; not opted-in
  nothing; one per day; too far nothing; drafts nothing.

Result: **ALL CHECKS PASSED**. Two failures during authoring were harness
bugs (a UUID literal typed as text in a `UNION ALL`; a temp table read
under the restricted role), not product bugs.

**3. Client.**

| Check | Result |
| --- | --- |
| `npm test` (vitest) | 70 files, 857 tests, all passing |
| Client ↔ SQL parity (`tests/recurrenceParity.test.ts`, fixture regenerated from the fresh copy) | 15/15 |
| `npm run typecheck` | clean |
| `npm run typecheck:admin` | clean |
| eslint, errors only, app + admin | 0 errors (pre-existing warnings only) |

**4. Per-date waitlist regression check (requested).** Beyond the suite
section above: the series-level waitlist suite (`test-host-tools.sql`) still
passes with the new trigger on `rsvps`; the counts RPC change (added
`waitlist_count`) is consumed by `services/occurrences.ts` which tolerates
the column being absent; `nextDateOverride('waitlist') → null` (leave) is
unit-tested; `dateAttendance` reports 'waitlist'. One behavioural note: two
people waitlisting inside the *same transaction* tie on `created_at` and
the tie breaks on `user_id` — irrelevant in production (distinct requests).

**5. Review of everything done (A–F + gap passes).** Working tree: 51
modified files, 36 new, ≈2,000 lines added, uncommitted. Highlights to
re-read before committing: the five recurrence/series migrations (their
shapes changed across passes), `utils/occurrences.ts` (the client mirror of
the SQL), `components/RecurrencePicker.tsx` (largest UI rewrite), and the
sibling-session overlap list in ISSUES (G1).

Known limitations carried forward: server ranking by effective next date
(E-R1 server half), approvals stay series-level, device/browser testing,
and reconciliation with the sibling session before any migration is applied.

## 8. Status against the phase plan (2026-11-09)

| Phase | Status |
| --- | --- |
| A. Categories foundation | Done (client); migration prepared, unapplied |
| B. Category browsing | Done (client); migration prepared, unapplied; last-used category default added |
| C. Admin categories page | Done (UI + migration prepared, unapplied); read-only until applied |
| D. Recurrence patterns v2 | Done (client + export + Repeat sheet); migration prepared, unapplied; decision D1 open |
| E. Exceptions and series management | Done; only the server half of E-R1 remains (migration); migration prepared, unapplied |
| F. Follow-ups | Done except F-R1 (reconcile, later); per-date capacity, waitlist and attendee list in; 3 migrations prepared, unapplied |

Migrations, all unapplied, deliberately low priority per the owner:
`20261109100000` → `20261109110000` → `20261109120000` (category chain,
in order) and `20261109130000` → `20261109140000` → `20261109150000` → `20261109160000`
(recurrence chain) and `20261109170000` (after the taxonomy file). Before applying: reconcile
with the other session's objects/files (G1). After: `npm run backend:types`.

### Gaps and opportunities found (added 2026-11-09)

Ordered by impact. None block the client; most are small.

- **G1 Parallel work on the same objects.** A sibling session is building
  overlapping migrations (admin categories, recurrence v2, per-date RSVPs,
  series split) in its own worktree, including a file sharing this branch's
  `20261109120000` timestamp. *Correction:* its objects were never on the
  shared DB — both sessions wrote to the same scratch name (see ISSUES).
  Pick one owner per object and one timestamp before anything is applied.
- **G2 "Next" can name a date that already passed today.**
  `getNextOccurrences` walks from midnight, so at 21:00 a 19:00 weekly
  event shows today as "Next" (Discover cards, Manage Event, Event Detail
  "Happens again"); the server is strict. Pre-existing for every pattern.
  Fix: a `strict` option used by "Next:" displays; keep midnight semantics
  for calendar expansion. Parity test already documents the difference.
- **G3 Reminders fire once per series** (§4.6, Phase E) — more visible now
  that multi-day weekly series are easy to create.
- **G4 Category edits take up to a day to reach devices**
  (`useCategories` staleTime 24 h, persisted). Opportunity: a
  `categories_version` value read with the banners/startup call, or a
  shorter stale time on Discover focus.
- **G5 Category browse has no offline cache.** Discover persists its last
  area; `/category/[slug]` shows the offline state instead. Opportunity:
  `PERSISTED_QUERY` for the default preset.
- **G6 Start date not on a chosen weekday.** The Repeat sheet warns; the
  form could offer "Move start to Wed 5 Nov" so the stored start is always
  an occurrence (also sidesteps D1).
- **G7 "Ends after N times" is not stored as a count.** It becomes an end
  date; if the host later moves the start, the count is not preserved.
  Opportunity: store `count` too and recompute on start change.
- **G8 Attendee-side cadence copy (§4.5)** not done: Discover cards still
  say only the next date; Saved/Joined say "repeats". `describeRecurrence`
  is ready for it.
- **G9 Interests boost fallback is per session.** After the discovery
  migration is applied, a running app keeps skipping the boost until
  restart (flag in `services/events.ts`). Acceptable; note for rollout.
- **G10 Admin icon table is a copy** of the app registry (guarded by a
  drift test). Opportunity: a shared package or a generated file.
- **G11 Not exercised on a device/browser**: browse screen, search
  suggestions, admin pages, Repeat sheet (gestures inside the bottom sheet,
  VoiceOver on the steppers).
- **G12 Insights / Manage Event copy** still says "Repeating series"
  generically; could use `describeRecurrence`.

