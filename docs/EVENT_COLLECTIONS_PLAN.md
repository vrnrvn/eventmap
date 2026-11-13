# Private event collections plan

Status: written 2026-11-12. Phase A (data foundation) implemented the same
day; see §9. The migration is prepared but NOT applied to the shared local
database. Companion to
`docs/CATEGORIES_AND_SERIES_PLAN.md` (categories, recurring series) and
`docs/ANALYTICS_AND_CALENDAR_PLAN.md` Part 2 (personal calendar), which
this feature sits between. Picks up the "Event collections" idea from
`ROADMAP.md`.

Goal in one line: let a user favourite the kinds of events they care about
and keep private, browsable collections of events (saved, going, or
hand-picked), with recurring series shown as series rather than as single
dates.

---

## 1. What exists today

### 1.1 Saving ("favouriting") an event

**Data.** `saves (id, user_id, event_id, created_at, UNIQUE(user_id,
event_id))` from the initial schema. RLS: owner-only select / insert /
delete; insert also requires `NOT user_is_banned(auth.uid())`
(`20261030104000`, re-stated with the initplan pattern in `20261106160000`).
Composite index `(user_id, event_id)` since `20261029110000`. `ON DELETE
CASCADE` from both `profiles` and `events`, so account deletion and event
deletion clean up automatically (`20261030109000` relies on this).

**Server read.** `get_user_saved_events(p_limit, p_offset)`
(`20261029110000`, last re-created in `20261104130000`) returns the caller's
saves as a json array in the shared "list row" shape: event columns +
`business_name`, `business_logo_url`, `category_label`, `category_slug`,
`rsvp_count`, `save_count`, `next_start_datetime` (via
`event_next_occurrence`), `has_ended` (status ≠ active or
`event_has_ended`), `saved_at`, `timezone`, `status`. Ordered upcoming
soonest-first, then ended most-recent-first. `get_event_details` returns
`user_saved` and `save_count` for the detail page. `get_user_attendance_
counts` feeds the "Saved" stat on the Profile tab.

**Client write.** `socialService.saveEvent / unsaveEvent / isEventSaved`
(`services/social.ts:217–257`) are plain table writes; `saveEvent` treats a
unique violation as success so offline replays are idempotent. Both go
through the offline queue as `PendingWrite { kind: 'save', targetId, on,
label }` (`utils/pendingWrites.ts:19`, `services/pendingWrites.ts:30`), and
`usePendingWrite('save', id)` shows the cloud-off dot on the bookmark.

**Client read / UI.**
- `screens/SavedEvents.tsx` (`/saved-events`): `useInfiniteQuery` on
  `queryKeys.savedEvents()` = `['events','saved']`, persisted
  (`PERSISTED_QUERY`), page size 30, refetch on focus, optimistic unsave
  with an undo toast. Sections: upcoming, then "Already happened". Rows are
  `EventListItem` with a bookmark `rightAction`; recurring rows get a
  `Repeat` date icon and ` · weekly`-style cadence via `cadenceLabel`, and
  their displayed date comes from `useEffectiveNextDates` (exceptions
  applied) falling back to `next_start_datetime`.
- `screens/EventDetail.tsx:752` `handleToggleSave`: optimistic flip of
  `details.user_saved` / `save_count`, `runOrQueueWithNotice`, then
  `queryKeys.markAttendanceListsStale` (invalidates the whole `['events']`
  prefix without refetching; screens catch up on focus).
- Profile tab: "Saved" stat and quick link both route to `/saved-events`.
- Calendar: `get_user_calendar` tags rows `saved` as one of its sources.

There is exactly one bucket. No naming, grouping, ordering, notes or
filtering of saves; nothing ties a save to a category beyond the row's
`category_label`.

### 1.2 Attendance (RSVPs)

**Data.** `rsvps (user_id, event_id, status, created_at, UNIQUE(user_id,
event_id))`; `status` grew from `going | interested` to include
`requested` (approval mode, `20261103170000`) and waitlist handling lives
in its own tables (`20261102160000`). Per-date overrides for series live in
`rsvp_occurrences (event, user, occurrence_date, going | not_going |
waitlist)` written only via `set_occurrence_rsvp` (`20261109150000`).

**Server read.** `get_user_going_events(user_id, scope, limit, offset)`
with scopes `upcoming | past | interested | requested`; privacy gate
`can_view_user_events`. Same list-row shape as saves. `get_user_calendar`
(`20261104110000`) returns one row per series with the caller's
relationship tags (`going / requested / interested / saved / hosting`) and
leaves occurrence expansion to the client.

**Client.** `socialService.createOrUpdateRsvp / deleteRsvp / getUserRsvp`,
`screens/JoinedEvents.tsx` (tabs upcoming / requested / interested / past,
`queryKeys.joinedEvents(userId, scope)`), EventDetail's RSVP buttons and,
for series, a per-date list (`listOccurrences` + `dateAttendance`,
`EventDetail.tsx:1639–1665`) where the viewer can opt in/out of single
dates.

### 1.3 Event types

Two things could be called an "event type":
- **Categories** (`categories`: slug, label, icon_key, color, description,
  synonyms, is_active since `20261109100000`). Every event has exactly one.
  `profiles.preferred_categories uuid[]` ("Interests") is set in onboarding
  and editable in Settings; it reorders Discover chips, boosts ranking
  (`get_ranked_events p_preferred_category_ids`) and gates the opt-in
  "new event in your interests" notification (`20261109170000`).
  `screens/CategoryBrowse.tsx` (`/category/[slug]`) is a list-first browse
  of one category near the viewer. This is what users see as a "type".
- **`events.event_type`** (`20261110120000`): the size preset a host created
  from (`casual | class | venue_show | large`). Analytics only, never shown
  to attendees. Not what this feature means.

This plan treats *event type = category*.

### 1.4 Recurring series

One `events` row per series: `is_recurring`, `recurrence_pattern jsonb`
(v2 keys: `frequency`, `interval`, `byWeekday`, `monthly`, `endDate`),
`timezone`. Server helpers `event_next_occurrence`, `event_has_ended`,
`event_next_effective_occurrence` (honours exceptions). Client:
`utils/recurrence.ts` (`describeRecurrence`, `cadenceLabel`,
`getNextOccurrences`, `filterEventsByDateRange`), `utils/occurrences.ts`
(`listOccurrences`, `effectiveNextStartIso`, `dateAttendance`),
`hooks/useEffectiveNextDates` (one batched exceptions query per list),
`hooks/useOccurrenceExceptions` (one series). List rows today show a
`Repeat` icon + cadence word; only EventDetail lists actual upcoming dates.
"This and following" splits (`20261109160000`) move `saves` to the new
series; any new per-event table needs the same treatment.

### 1.5 Shared plumbing to reuse

- `components/EventListItem.tsx` (badge, dateIcon, metaLines, rightAction,
  actions, dimmed) — every list screen uses it.
- `hooks/queryKeys.ts`: anything under the `['events']` prefix is marked
  stale by every RSVP / save write; `useRefetchOnFocus` + `utils/
  eventDataVersion` decide when to actually refetch.
- `hooks/useScreenState` + `components/ui/QueryStates` (loading / offline /
  error / empty / freshness), `PERSISTED_QUERY` for offline reading
  (`docs/OFFLINE_PLAN.md`).
- `services/pendingWrites.ts` offline queue; add a kind, a `perform` case
  and a `pendingKey`, and `usePendingWrite` works.
- `@gorhom/bottom-sheet` is already used (`AttendeesBottomSheet`,
  `RecurrencePicker`) for pickers; `components/ui/ModalBackdrop` for simple
  modals; `CategorySelectGrid` / `CategoryPicker` for choosing categories;
  `CategoryIcon` + `utils/categoryPresentation` for colour and glyph.
- Migration hygiene: scratch DB only (`scripts/db-scratch.sh`, `SCRATCH_DB`
  per worktree), SQL tests as `scripts/test-*.sql`, API tests in
  `scripts/test-local-backend.mjs`, `npm run backend:types` after schema
  changes, and ask before applying anything to the shared local database.
- Premium is a *business* subscription (`premiumService`, `usePremium`).
  Collections are an attendee feature; nothing here should be gated.

---

## 2. Goals and non-goals

**Goals**
1. A user can create private, named collections and put events in them
   from the event page and from Saved Events.
2. A user can favourite event types (categories). Each favourite gives a
   "smart" collection that fills itself with the events the user has saved
   or RSVP'd to in that category, and offers more upcoming events of that
   type nearby.
3. A collections home and a collection screen that work offline for what
   was already loaded, like Saved Events do.
4. Recurring series are visible as such everywhere in collections: a
   series badge, the cadence, the next effective date, a per-series
   "upcoming dates" expansion, and grouping so a weekly class does not look
   like one Tuesday.
5. Everything is private to the owner. No sharing, no public lists, no
   counts shown to others.

**Non-goals (v1)**
- Shared or public collections, collaborative lists, following someone's
  collection.
- Collections as a Discover filter or map layer.
- Replacing the single "Saved" bucket. Saved stays as the one-tap
  bookmark; collections sit on top of it.
- A new calendar source (possible later, see §7).
- Host-side anything.

---

## 3. Design

### 3.1 Data model

```sql
collections (
  id uuid pk,
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,                       -- 1..40 chars after trim
  kind text not null check (kind in ('manual','smart')),
  category_ids uuid[] not null default '{}', -- smart: which types; manual: unused
  icon_key text, color text,                -- optional; smart ones default to the category's
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, lower(name))             -- via unique index on (user_id, lower(name))
);

collection_items (
  collection_id uuid references collections(id) on delete cascade,
  event_id uuid references events(id) on delete cascade,
  added_at timestamptz not null default now(),
  note text,                                 -- optional, <= 140 chars
  primary key (collection_id, event_id)
);
```

- **Manual** collections contain exactly their `collection_items`.
- **Smart** collections contain `collection_items` ∪ (the owner's `saves`
  and `rsvps` in `going | interested | requested`) whose
  `events.category_id = ANY(category_ids)`. Pinning an event into a smart
  collection is allowed (an item outside the rule still shows). A smart
  collection is what "favouriting an event type" creates; one per
  category, `category_ids` kept as an array so "Music + Nightlife" is
  possible later without a schema change.
- Caps enforced by trigger: 50 collections per user, 500 items per
  collection. Name validation (trim, length, uniqueness case-insensitive)
  in a `BEFORE INSERT OR UPDATE` trigger so direct table writes stay valid.
- RLS: owner-only on both tables, same four policies as `saves`, insert
  policies also require `NOT user_is_banned(...)`. Items additionally
  require the collection to be the caller's (`EXISTS` on `collections`).
- Cascades cover account deletion (`delete_account_rpc` deletes the
  profile) and event deletion. **`split_series` must move items** on or
  after the split date exactly as it moves `saves` (follow-up in §7 if not
  done in Phase A).

### 3.2 Server reads

Two RPCs, `SECURITY DEFINER`, `SET search_path = public`, `auth.uid()`
scoped, returning json like the existing attendance RPCs:

1. `get_user_collections()` → array of `{ id, name, kind, category_ids,
   icon_key, color, sort_order, item_count, recurring_count,
   next_start_datetime, cover_urls (up to 3), updated_at }`. One round
   trip for the collections home. Smart counts are computed with the rule
   above.
2. `get_collection_events(p_collection_id, p_limit, p_offset, p_sort,
   p_filter, p_category_ids)` → the standard list-row shape (copy
   `get_user_saved_events`' subquery) plus `sources text[]` (`pinned |
   going | requested | interested | saved`, fixed order), `added_at`,
   `note`, `has_ended`. Sorts (decided 2026-11-12): `next` (upcoming
   soonest-first then ended most-recent-first, default), `rsvp` (most
   going first, upcoming before ended), `added` (most recent relationship
   first), `title`. Filters: `all | upcoming | repeating | past | pinned |
   saved | going`, plus an optional category restriction. Must return `[]`
   (not an error) for a collection the caller does not own.
3. Small helper `get_event_collection_ids(p_event_id)` → `uuid[]` of the
   caller's collections that contain the event (pinned or by rule), for
   the sheet in §3.4 and the badge on EventDetail. Alternatively a
   direct select on `collection_items` under RLS for the pinned half and
   client-side rule matching for the smart half; the RPC is simpler.

Writes are direct table inserts/updates/deletes under RLS (like saves),
wrapped in `collectionsService` with the same "23505 means it already
landed" tolerance so offline replays are idempotent.

Row-shape note: `get_user_saved_events`, `get_user_going_events` and
`get_user_calendar` each repeat the list-row select. Phase A may extract
`event_list_row(e, viewer)` as a SQL helper and have the new RPC use it;
rewriting the existing three is out of scope.

### 3.3 Client data layer

- `services/collections.ts`: `list()`, `create(input)`, `rename/update`,
  `remove`, `reorder`, `addItem`, `removeItem`, `events(collectionId,
  page)`, `idsForEvent(eventId)`, `favouriteCategory(categoryId)` (creates
  or finds the smart collection), `unfavouriteCategory`.
- `types/database.ts`: `Collection`, `CollectionEvent = RankedEvent &
  { source: CollectionSource[]; added_at?: string; note?: string | null }`.
- `queryKeys`: `collections(userId)` = `['events','collections',userId]`,
  `collectionEvents(userId, id)` = `['events','collections',userId,'items',
  id]`, `eventCollectionIds(eventId)` = `['event','collections',eventId]`.
  Under the `['events']` prefix so RSVP / save writes mark them stale.
- Offline: new `PendingWrite` kind `collectionItem` with `targetId =
  `${collectionId}:${eventId}``, `on`, `label`. Collection create / rename
  / delete stay online-only (`requireOnline`) in v1.
- Persisted queries (`PERSISTED_QUERY`) for the home and for each
  collection's first page, like Saved Events.

### 3.4 UX

**Entry points**
- Profile tab: a "Collections" quick link next to "Saved"; the "Saved" stat
  keeps going to Saved Events.
- Saved Events header: a "Collections" pill, and a swipe/long-press or
  row action "Add to collection".
- EventDetail: long-press on the bookmark, or an "Add to collection" row
  under the RSVP buttons, opens the sheet. After a plain save, the success
  toast gets an "Add to collection" action.
- CategoryBrowse hero: a heart "Favourite this type" toggle that creates
  the smart collection and routes to it on first use.
- Settings → Interests: show which interests are favourited collections.

**Add-to-collection sheet** (`components/AddToCollectionSheet.tsx`,
`@gorhom/bottom-sheet`): list of the user's collections with checkmarks
(multi-select), "New collection" inline row (name + optional type), smart
collections shown with their category colour and a "by rule" note when
the event already matches. Toggling is optimistic and queue-able offline.

**Collections home** (`screens/Collections.tsx`, `/collections`): grid of
cards (cover mosaic from `cover_urls`, name, `n events · k repeating`,
next date). Smart cards carry the category icon/colour. Empty state
explains both ways to start (favourite a type, or add an event). Header
action: "New collection". Long-press: rename / delete (confirm) / reorder.

**Collection screen** (`screens/CollectionDetail.tsx`,
`/collections/[id]`): `ScreenHeader` with name + rule chips; segmented
control `Upcoming | Repeating | Past` (see §3.5); rows are
`EventListItem` with source chips (`Saved`, `Going`, `Pinned`) as
`metaLines`, and a remove `rightAction` for pinned items. Smart
collections end with a "More <type> near you" rail that reuses
`CategoryBrowse`'s query (`getRankedEventsPage` with `category_ids`) and
links to `/category/[slug]`.

### 3.5 Recurring series in collections

- **Series rows**: `Repeat` icon, cadence via `cadenceLabel`, next
  effective date via `useEffectiveNextDates` (exceptions applied), and a
  `Series` badge (`EventListItem.badge`, tone `primary`) so it is
  distinguishable from a one-off at a glance.
- **Repeating segment**: lists only series, sorted by next effective date,
  and each row expands to the next 5 dates using `listOccurrences` with
  cancelled / moved marks, mirroring EventDetail's section. If the viewer
  has per-date overrides (`dateRsvps`), the date rows show `Going` /
  `Not going` the way EventDetail does, read-only here (tap goes to the
  event).
- **Upcoming segment**: series appear once (next date), not once per
  occurrence, so a weekly class does not flood the list. A series whose
  `has_ended` is true (recurrence `endDate` passed or cancelled) moves to
  Past.
- **Collections home card**: `recurring_count` drives "k repeating" and a
  small `Repeat` glyph on the mosaic when the collection is all series.
- Export: "Add all to calendar" is deferred; `utils/eventIcs.ts` already
  handles series + exceptions if it is wanted later.

---

## 4. Testing

- **Vitest** (pure): collection name validation; smart-rule membership and
  source-chip derivation from `(saves, rsvps, items)`; grouping into
  Upcoming / Repeating / Past given `has_ended`, `is_recurring`, exception
  lists; pending-write key for `collectionItem`; offline replay in
  `tests/offlineWrites.test.ts` for the new kind.
- **SQL** (`scripts/test-collections.sql`, run on the scratch DB):
  RLS (owner can, other user cannot, banned cannot insert), caps and name
  triggers, `get_user_collections` counts for manual vs smart, `get_
  collection_events` ordering and `source` tags, cascade on event and
  account deletion, `split_series` moving items.
- **API** (`scripts/test-local-backend.mjs`): create → add → list → remove
  → delete round trip as `alex`; `sam` cannot read `alex`'s collection.
- **UI**: extend `scripts/fake-backend-e2e` with the sheet and the two
  screens (44 px targets, 320 px width, labels), plus web manual pass.

---

## 5. Phasing and estimates

| Phase | Scope | Est. |
| --- | --- | --- |
| 0. Decisions | §6 answered; naming ("Collections" vs "Lists"), smart-rule sources, caps | 0.5 h |
| A. Data foundation | Migration (§3.1 tables, RLS, triggers, `split_series` item move), RPCs (§3.2), `scripts/test-collections.sql`, `npm run backend:types`, `services/collections.ts`, types, query keys | 5–7 h |
| B. Collections home + collection screen | §3.4 screens and routes, persisted queries, screen states, source chips, remove-pinned with undo, rename / delete / reorder | 6–8 h |
| C. Adding events | Add-to-collection sheet, EventDetail and Saved Events entry points, post-save toast action, `collectionItem` pending write + replay tests, invalidation | 4–6 h |
| D. Favourite event types | Smart collections: CategoryBrowse heart, Settings → Interests hook-up, smart counts in RPCs, "More of this type near you" rail, empty states | 4–6 h |
| E. Recurring UI | §3.5: Series badge, Repeating segment with date expansion, per-date state read-through, home-card repeating count, grouping tests | 3–5 h |
| F. Polish and follow-ups (done 2026-11-12) | Accessibility pass, `docs/ISSUES.md` entries, event page `?date=` deep link, Discover "For you" chip (decision), one-shot retry for refused writes, Interests consolidation (decision), smart-rule UI vs. single column (decision), **G-prep SQL** on the isolated copy: batched membership RPC + notification deep link to the smart collection, calendar "collections" source, ICS "add all" | 6–9 h |
| G. Apply and verify (owner) | Apply `20261112100000` (with the F additions) to the shared / hosted database, `npm run backend:types`, `npm run test:backend`, run every `scripts/test-*.sql`, one manual pass of B–E against real data | 1–2 h |

A can start now. B and C depend on A and can run in parallel; D depends on
A and touches CategoryBrowse/Settings only; E depends on B. Serial order:
A → B → C → E → D → F → G. Total for A–E: roughly 22–32 h.

**Revised 2026-11-12 for "migrations apply last".** The owner will apply
the migration only after every phase is built, so B–F are client-only and
can never be exercised against a real database while they are written.
Two consequences are folded into the phases:

1. The fake backend (`scripts/fake-backend-e2e/fakebackend.mjs`) is the
   test double for the new tables and RPCs from Phase B on, and each phase
   ships its browser scenarios in `suiteCollections.mjs` rather than
   leaving e2e to Phase F. The fake mirrors the SQL (same sources order,
   same sort / filter semantics, 23505 on a duplicate pin); when the
   migration changes, both the SQL suite and the fake change together.
2. `types/supabase.generated.ts` is maintained by hand for the collections
   objects until Phase G regenerates it. Any RPC signature change in a later
   phase must update the migration, `scripts/test-collections.sql`, the
   hand-written types and the fake in one commit.

The "unavailable" path (`CollectionsUnavailableError`) is therefore a real
product state, not just a guard: every entry point must degrade to it
calmly, and it is covered by scenario K4.

---

## 6. Decisions needed

1. **"Event type" = category.** Confirm (the alternative, `events.
   event_type`, is a host-side size preset). Recommendation: yes.
2. **Smart collection sources.** Saves + going + interested + requested, or
   saves only? Recommendation: saves and all RSVP states, tagged with
   source chips; "requested" shown as `Pending approval`.
3. **One smart collection per category vs multi-category rules.**
   Recommendation: one per category in the UI, array in the schema.
4. **Does saving stay separate from collections?** Recommendation: yes;
   "Saved" remains the one-tap bucket and is itself shown as a system row
   on the collections home ("All saved").
5. **Manual-collection create offline?** Recommendation: online only in
   v1; adding/removing items is queueable.
6. **Caps.** 50 collections, 500 pinned items per collection, 40-char
   names. Adjust if needed.
7. **Repeating as a segment vs inline grouping.** Recommendation: segment
   (`Upcoming | Repeating | Past`) so the upcoming list stays short, with
   series also present once in Upcoming.

---

Decided 2026-11-12: (1) event type = category; (2) saves and all three
RSVP states, with source chips; (3) one per category in the UI, array in
the schema; (4) yes, Saved stays separate; (5) online only for create /
rename / delete, pins queueable; (6) caps as proposed; (7) segment. The
owner also asked for sorting by RSVP count and other filters on a
collection, which became `p_sort` / `p_filter` / `p_category_ids` in §3.2.
Working rule from the same day: no session touches the shared local
database any more; migrations are prepared and validated on isolated copies
only (`scripts/db-scratch.sh` with Docker, `scripts/db-isolated.sh`
without) and applied by the owner.

Phase F defaults (2026-11-12, chosen by the implementer; the owner asked
for defaults plus alternatives):
- **Discover "For you" chip — default: yes.** One chip after "All events",
  only when the signed-in user has at least one favourite type; it selects
  every favourited category at once and reads as active when the selection
  equals that set. Alternatives: (i) hide it and keep favourites to
  Collections; (ii) make it Discover's default filter for users who have
  favourites (changes what the map shows on launch); (iii) show it only in
  the filter sheet, not the chip row.
- **Interests vs. favourites — default: minimal consolidation.** The
  Settings → Interests picker now marks favourited types with a heart and
  keeps the cross-link to Collections; favouriting already adds to
  Interests (Phase E). Alternatives: (i) full merge — toggling an interest
  in Settings also creates / deletes the smart collection; (ii) retire
  "Interests" as a user-facing idea and derive the ranking boost from
  favourites alone (a data migration for existing `preferred_categories`).
- **Smart rules — default: one type per collection, keep the array.** No
  rule editor; `category_ids uuid[]` stays in the prepared schema because
  the server, the service and the fake already handle it and it costs
  nothing. Alternatives: (i) collapse to a single `category_id` column
  before G (simpler schema, drops the option forever without another
  migration); (ii) add a rule editor to the smart collection's options
  sheet (multi-type collections such as "Music + Nightlife").
- **Interest notification — default: unchanged routing.** The notice still
  opens the event; when the recipient has a favourite-type collection for
  the category, the body adds "Save it and it joins your <Type>
  collection." and `data.collectionId` is set for a future secondary
  action. Alternatives: (i) route to the collection instead; (ii) a "View
  collection" action on the notification row.

## 7. Follow-ups and known gaps

Added 2026-11-12 while building Phase D (not minor, so recorded here
rather than fixed in passing). **Placed into phases later the same day**
(owner asked for every item to land in a phase):

| Item | Phase | Why there |
| --- | --- | --- |
| Favouriting a type also adds it to Interests (option a) | **E — done** | One-way, client-only, needed before the notification item makes sense |
| Rail: widen to 100 km when the neighbourhood is sparse | **E — done** | Small, inside the rail's own query |
| Event page `?date=` deep link from a date row | **F — done** | The tapped date is highlighted on the event page |
| Discover "For you" chip (favourited types) | **F — done** (default: yes) | See §6 Phase F defaults |
| One-shot retry for a single refused write (all kinds) | **F — done** | 15 s debounced replay when the queue grows while 'online' |
| Settings → Interests as the single place for both ideas (option c) | **F — minimal** (hearts + link) | Full merge left as an alternative in §6 |
| Smart rule editing UI, or drop `category_ids[]` to a single column | **F — decided**: one type per collection, array kept | Alternatives in §6 |
| Batched `get_events_collection_membership(uuid[])` | **F — prepared** (G applies) | In the prepared migration, suite [12.x], fake, types; Saved rows show "In N collections" |
| Interest notification deep-links to the smart collection | **F — prepared** (G applies) | `data.collectionId` + body suffix; routing unchanged by default |
| Calendar "collections" source in `get_user_calendar` | **prepared** (G applies) | Re-created in the migration (section 8), suite [14.x], client chip with old-backend fallback (K12) |

Items marked G-prep are SQL written during F and validated on the isolated
copy only; nothing touches the shared database until G.

Original notes:

- **Interests vs. favourite types are two concepts the user may not
  distinguish.** `profiles.preferred_categories` boosts ranking and
  reorders chips; a favourite type collects events. Options: (a) favouriting
  a type also adds it to Interests (one-way, cheap, do it in E/F); (b)
  onboarding seeds smart collections from the chosen interests (needs
  decision: it creates collections nobody asked for); (c) Settings →
  Interests becomes the single place to manage both. Recommendation: (a)
  now, (c) later. **[decision]**
- **Notifications for favourite types.** `interest_event_notifications`
  (20261109170000) fires on `preferred_categories`, not on smart
  collections, and deep-links to the event. Once (a) above lands it fires
  for favourites too; the deep link should open the smart collection when
  the type is favourited. **[DB]** for the link payload.
- **Discover "Favourites" chip.** Discover could offer a "For you" chip
  that filters to favourited types (the data is one `category_ids = ANY`
  call away). Non-goal for v1 by decision; worth revisiting after D ships.
- **Rail freshness.** The rail reuses `get_ranked_events` with the default
  25 km radius and no date window; a user whose smart collection is empty
  near home sees nothing. A wider second try (100 km, as Category Browse
  does) or a "search a wider area" link would help sparse regions.
- **Smart collection rule editing.** The schema allows multi-category
  rules (`category_ids uuid[]`) and `update` accepts `categoryIds`, but no
  UI edits a rule; "Music + Nightlife" is reachable only by data. Decide
  whether to expose it (sheet on the smart collection's options) or keep
  one-type-per-collection as the product rule and drop the array in G.
  **[decision]**
- **Membership query fan-out.** Every event page and every Saved row sheet
  calls `get_event_collection_membership` once; fine today, but a Saved
  list with many sheets opened in a row makes one RPC each. A batched
  `get_events_collection_membership(uuid[])` would let Saved rows show a
  "in 2 collections" hint without per-row calls. **[DB]**

- `split_series` (`20261109160000`) moves `saves`; collection items must
  be added there, or re-created in Phase A's migration as a wrapper.
- `get_user_calendar` could gain a `collection:<id>` source so a
  collection can be viewed as a month. Deferred.
- The three list RPCs repeat the list-row select; a shared SQL helper
  would reduce drift when columns are added (e.g. `timezone` in
  `20261104130000` had to be added in several places).
- `interest_event_notifications` could deep-link to the matching smart
  collection instead of the event once Phase D exists.
- Admin: no admin surface is needed; per-user private data.

## 8. Phase G runbook (owner)

Everything below is for the day the owner applies the migration. Nothing in
it has been run against the shared database by the implementer.

1. **Pre-flight (read-only).** `git status` shows the branch clean or
   committed; `npm run typecheck`, `npm run test` green;
   `scripts/db-isolated.sh init && scripts/db-isolated.sh apply
   scripts/test-collections.sql` passes (native Postgres, no Docker).
2. **Apply.** With Docker up: `npm run backend:start`, then apply
   `supabase/migrations/20261112100000_event_collections.sql` the same way
   the 2026-11-09 chain was applied (one transaction; it is idempotent).
   Objects created / replaced: `collections`, `collection_items`, their
   policies and triggers, `collection_members`, `get_user_collections`,
   `get_collection_events`, `get_event_collection_membership`,
   `get_events_collection_membership`, `reorder_collections`,
   `split_series_from`, `notify_interested_for_event`, `get_user_calendar`.
3. **Types.** `npm run backend:types`, then `npm run typecheck`. The
   hand-written entries in `types/supabase.generated.ts` should be replaced
   by the generator's output with no other diff than ordering / the
   2026-11-09/10 objects that were already missing.
4. **Server suites.** `SCRATCH_DB=… scripts/db-scratch.sh refresh` then
   `apply scripts/test-collections.sql`, `scripts/test-calendar.sql`,
   `scripts/test-categories-series.sql`; and `npm run test:backend` (its
   collections block stops printing SKIP once the RPCs exist).
5. **Manual pass against real data** (10 min): Profile → Collections; new
   list; pin from an event page and from Saved; Category Browse → favourite
   a type → open; Repeating segment → expand a series; reorder; Add
   upcoming to calendar; Discover → For you chip; Calendar → Collections
   chip; sign out / in and confirm the lists persist; airplane mode: pin,
   reconnect, see it sync.
6. **Hosted databases** are separate decisions, as for every migration in
   `docs/ISSUES.md`.

## 9. Implementation log

### Phase A — 2026-11-12 (this worktree, uncommitted at time of writing)

**Environment.** Docker was not running, so neither `supabase start` nor
`scripts/db-scratch.sh` was available. Added `scripts/db-isolated.sh`: a
throwaway native Postgres cluster (Homebrew 14 here; Supabase runs 17) on
127.0.0.1:54329 with minimal shims for `auth`, `storage`, `net`, `cron`, the
API roles and the realtime publication. All 118 existing migrations plus
`supabase/seed.sql` apply cleanly on it, and the existing
`scripts/test-categories-series.sql` and `scripts/test-calendar.sql` suites
pass there, which is the regression baseline for the split-function change
below. The shared local database was not read, written or reset.

**Migration `20261112100000_event_collections.sql`** (prepared, NOT applied
to the shared database):
- `collections` (`kind` manual | smart, `category_ids uuid[]`, optional
  `icon_key` / `color`, `sort_order`) and `collection_items` (`note` ≤ 140).
  Unique manual name per user (case-insensitive) and one smart collection
  per `(user, category_ids)`; smart rows default name / colour / icon from
  the category when left blank, so favouriting a type is a plain insert.
- Triggers: name trim + 1..40 chars, category existence, kind and owner
  immutable, caps of 50 collections and 500 pins. Caps apply only when
  `auth.uid()` is the owner, so `split_series_from` (run by the host) and
  service-role maintenance are never blocked. Pinning / unpinning touches
  the collection's `updated_at`.
- RLS: owner-only, same shape as `saves` (insert also requires not banned);
  items check ownership through the parent collection.
- `collection_members(id)` helper: pinned ∪ (smart only) saves and
  going / interested / requested RSVPs in the rule's categories, with a
  fixed-order `sources` array and `added_at` = most recent relationship.
- RPCs `get_user_collections()`, `get_collection_events(...)` with the
  sorts and filters in §3.2, `get_event_collection_membership(event)`,
  `reorder_collections(ids)`; all `SECURITY DEFINER`, `search_path =
  public`, revoked from `anon`.
- `split_series_from` re-created with the 20261109160000 body plus one
  insert that copies pinned items to the new series (the plan's §7 gap).
  Diffed against the original: only the marked block differs.

**Tests.** `scripts/test-collections.sql` (rolled-back transaction, ASSERT
only, impersonates the API roles with `SET LOCAL ROLE` so RLS is really
exercised): grants, create / rename / validation, pinning and notes, bans,
membership helper, both list RPCs including every sort and filter and
paging, membership of one event, reorder, both caps, event and profile
cascades, series split. 12 blocks, all passing on the isolated copy.

**Client (no screens yet).**
- `types/database.ts`: `Collection`, `CollectionEvent`,
  `CollectionMembership`, `CollectionSource`, `CollectionSort`,
  `CollectionFilter`. `types/supabase.generated.ts`: the two tables and
  five functions were added by hand in the generator's format because
  `supabase gen types` runs postgres-meta in Docker even with `--db-url`.
  Re-run `npm run backend:types` once the migration is applied somewhere
  Docker can reach (the file already lagged the 2026-11-09/10 migrations).
- `services/collections.ts`: `list`, `events` (sort / filter / categories /
  paging), `membership`, `create`, `favouriteCategory` /
  `unfavouriteCategory` / `findSmartForCategory`, `update`, `remove`,
  `reorder`, `addItem` (23505 = success), `removeItem`, `setItemNote`.
  Missing-migration errors flip an "unavailable" flag: reads return `[]`,
  writes throw `CollectionsUnavailableError`. Writes bump
  `eventDataVersion` like the other services.
- `utils/collections.ts`: client mirrors of the limits and name / note
  validation, server-error → copy mapping, sort / filter option lists,
  source chip labels, the `collectionId:eventId` queue key and an
  optimistic membership helper. `tests/collections.test.ts` covers them.
- Offline queue: new `PendingWrite` kind `collectionItem` (target
  `collectionId:eventId`, `collectionName` for copy) in
  `utils/pendingWrites.ts`, replayed through `collectionsService` in
  `services/pendingWrites.ts`; parse / describe / queued-message copy and a
  replay test added to `tests/offlineWrites.test.ts`.
- `hooks/queryKeys.ts`: `collections`, `collectionEvents` (+ prefix) under
  the `['events']` prefix so RSVP / save writes mark them stale, and
  `eventCollections(eventId)`.

Checks: `npm run typecheck` clean, `npm run test` 83 files / 983 tests
passing, ESLint clean on the changed files.

**Left for later phases / the owner.** Apply the migration (owner), then
`npm run backend:types`. Phases B–E build the screens on this layer.

### Phase B foundations — 2026-11-12 (uncommitted)

Scope agreed: the two screens and their plumbing; finishing touches
(cover mosaic, drag reorder, deep links, the "More of this type" rail) and
Phase C (adding events) come later. No database was touched.

- `hooks/useCollections.ts`: `useCollectionsList` (persisted, refetch on
  focus), `useCollectionEvents(id, sort, filter)` (persisted, paged by 30),
  `useInvalidateCollections`.
- `screens/Collections.tsx` → `/collections` (`app/collections/index.tsx`):
  cards with first cover, category icon / folder glyph, name, "n events ·
  k repeating", next date, "Favourite type" tag; header "New collection";
  per-card "more" (and long-press) → rename / delete with confirm and
  optimistic removal; empty, loading, offline, error states and a
  "Collections are coming soon" state when the server lacks the migration.
- `screens/CollectionDetail.tsx` → `/collections/[id]`
  (`app/collections/[id].tsx`): hero with counts (and the smart rule's
  explanation), `Upcoming | Repeating | Past` segments mapped to the RPC
  filter, sort chips (Next up / Most popular / Recently added / A to Z)
  mapped to `p_sort`, rows in `EventListItem` with a `Series` badge,
  cadence, effective next date (`useEffectiveNextDates`), source chips and
  the pinned note; pinned rows get a remove action with an undo toast via
  the `collectionItem` pending write; rename / delete from the header.
- `components/CollectionNameSheet.tsx` (create / rename, validation from
  `utils/collections`), `components/CollectionActionsSheet.tsx`.
- Profile tab: "Collections" quick link next to Saved. Icons `FolderHeart`,
  `FolderPlus`, `Ellipsis` added (`node scripts/generate-icons.mjs`).
- Fake backend: `collections` / `collectionItems` fixtures, the four RPCs,
  table writes with the 23505 duplicate; `suiteCollections.mjs` scenarios
  K1–K5 (home CRUD and duplicate-name guard, detail segments / sorts /
  remove + undo, smart rows, missing-migration state, Profile entry and
  320 px). Run against a fresh web export: 53/53 checks pass (first run
  caught three test-side issues, toast copy leaking into body-text
  assertions, and one missing fake endpoint for series exceptions; no
  product bugs). Existing scenario B2 (Saved Events) still passes with the
  fake-backend changes. The repo's accessibility guard test caught that the
  two new modals lacked `onAccessibilityEscape`; fixed.

Checks: `npm run typecheck` clean, `npm run test` 83 files / 983 tests
passing, ESLint clean on the changed files.

Deferred from B to a later pass: three-image cover mosaic, drag-to-reorder
(the `reorder` service and RPC exist), long-press on web, deep links,
"More of this type near you" rail (Phase D). All but the rail were closed
the same day — see "Phase B completion" below.

### Phase B completion + Phase C foundations — 2026-11-12 (uncommitted)

Phase B is now complete except the "More of this type near you" rail,
which belongs with Phase D (it is the smart-collection discovery hook).

- **Cover mosaic**: collection tiles show up to three covers (one fills,
  two split, three = left half + stacked right quarters).
- **"All saved" system row** (§6 decision 4): pinned above the collections,
  with the saved count from `get_user_attendance_counts`, opens Saved.
- **Reorder**: an explicit reorder mode (header ⇅, hidden with one
  collection) with per-card up / down controls — chosen over a drag gesture
  so it works with screen readers and is drivable by the web e2e; the grid
  drag in `ImagePickerButton` stays the pattern for grids. Moves are local
  until Done, then one `reorder_collections` call persists them
  (optimistic, rolled back on failure, online-only).
- **Deep links**: the routes already resolve URLs / the `eventmap://`
  scheme; what was missing was cold-start back behaviour — both screens now
  use `goBackOr` (home → profile tab, detail → the collections home).
- **Saved Events header** links to Collections (the B entry point list).

Phase C foundations:
- `components/AddToCollectionSheet.tsx`: the viewer's collections with a
  check per collection containing the event; smart matches show "Included
  automatically" (unpinning never touches the rule); toggles are optimistic
  on the membership cache and queueable offline (`collectionItem`);
  "New collection" expands inline (no nested modal) and creates + pins.
- Event Detail entry points: a "Collections → Add to collection" row next
  to the calendar row, long-press on the bookmark, and a "Saved. · Add to
  collection" toast action after a successful save. All three are hidden
  when the server lacks the migration (`isCollectionsUnavailable`).
- Fake backend: list RPC now sorts by `sort_order` like the SQL;
  `rsvp_occurrences` / `event_occurrence_exceptions` stubs added.
- Browser scenarios K6 (mosaic, All saved row, reorder round trip,
  deep-link back fallback) and K7 (sheet from the event page: membership
  chips, unpin / re-pin, inline create-and-add, post-save toast action):
  87/87 checks pass on a fresh export; B2 / B3 regressions still pass.
  `npm run typecheck` clean, `npm run test` 83 files / 983 tests, ESLint
  clean on changed files.

Remaining for Phase C proper: an "Add to collection" row action on Saved
Events rows, and pending-write awareness in the sheet (shown synced-later
state per row). Then D (favourite types from Category Browse + the rail),
E (recurring expansion in the collection detail), F polish, G apply.

### Phase C completion — 2026-11-12 (uncommitted)

Phase C is complete. No database was touched; e2e and exports ran in the
foreground (owner's constraint: no background / subagent runs for them).

- **Saved Events row action**: an "Add … to a collection" button beside
  the bookmark on upcoming rows (hidden on ended / cancelled rows and when
  the server lacks the migration) opens the sheet for that event.
- **Pending-write awareness**: `usePendingCollectionItems(eventId)` reads
  the offline queue for this event; `overlayPendingMembership` (pure,
  unit-tested) lays queued intents over the server membership so a row
  shows what the user asked for even before the queue replays or after a
  restart while still offline. Pending rows read "Will sync when you're
  back online", carry a cloud-off glyph and a dashed box, and expose
  `aria-busy` + a hint for assistive tech.
- **Replay refresh**: `PendingWritesSync` invalidates the collections home,
  every collection page and the per-event membership after `collectionItem`
  writes replay, so counts and checks catch up without a manual refresh.
- Scenario K8 (Saved row → sheet, two pins refused on a weak connection →
  queued toast, pending row state, degraded banner → reconnect → both
  replay): 102/102 checks across K1–K8 on a fresh export; B2, B3 and D5
  regressions still pass. `npm run typecheck` clean, `npm run test` 83
  files / 986 tests, ESLint clean on changed files.

Observation (pre-existing, not collections-specific, left for F): a write
refused by a *single* connection error while the device still reports
online is queued but only replays on the next connectivity transition or
app foreground, because "degraded" needs two failures in the window. Saves
and follows behave the same way. A one-shot retry timer in
`PendingWritesSync` would close it for every kind.

### Post-F, G deferred — 2026-11-12 (uncommitted)

The owner moved G (apply) down the priority list, so the remaining
database-free work was done:

- **Security review** of the whole change set (read-only; sub-task on the
  migration and client). No finding above the >80% exploitability bar. All
  RPCs and the membership helper were confirmed `auth.uid()`-scoped, RLS
  owner-only with the ban check on insert, grants revoked from `anon`, no
  dynamic SQL, `split_series_from` and the notification subquery leak
  nothing across users. Two defence-in-depth notes, one acted on:
  - *Pinning a draft by uuid* could have made its row readable through
    `get_collection_events` (parity with `saves`, uuids unguessable). The
    items INSERT policy now also requires the event to be published; suite
    check [2.6]. `saves` was left as is (pre-existing).
  - *Host-driven pins via `split_series_from`* bypass the 500 cap by design
    and bump other users' `updated_at`; integrity-only, left as is.
- **Calendar "collections" source** (post-G backlog item, now prepared):
  `get_user_calendar` re-created in the migration with a sixth source,
  `collections` = every event in any of the caller's collections; suite
  block [14.x]; existing calendar suite unchanged. Client: a "Collections"
  chip in the Calendar (colour, label, priority), `toRpcSources` passes it
  through, and `calendarService` drops the source and retries once when an
  older function answers `invalid_source`, after which the chip hides for
  the session. Scenario K12 covers both the new backend and the old one.
- **Phase G runbook** (§8) and a guarded collections block in
  `scripts/test-local-backend.mjs` that prints SKIP until the migration
  exists and then exercises create / pin / list / membership / cross-user
  isolation through the real API.
- Unit test for the collection → .ics mapping (`toIcsInputs`, moved to
  `utils/collectionIcs.ts` so tests do not load the Supabase client).

Results: K1–K12 168/168 on a fresh export; B2 / B3 / D5 regressions pass;
collections, calendar and categories-and-series SQL suites pass on the
isolated UTC cluster with the extended migration (1,035 lines, 512-line
suite); `npm run typecheck` clean; `npm run test` 83 files / 987 tests;
ESLint clean on the changed files.

**What is left.** Only Phase G (owner: apply, regenerate types, run the
suites, manual pass) and the two decisions parked in §7 (rule editor vs.
single column — must be decided *before* G if the column is to change;
full Interests merge — can follow G). Everything else in the plan is built
and verified against the fake backend and the isolated database. The
branch has 49 changed or new files and nothing committed yet.

### Phase F — 2026-11-12 (uncommitted)

Polish + G-prep. No database touched; the extended migration was validated
on the isolated UTC cluster; export and e2e in the foreground. Decisions
taken with defaults, see §6 "Phase F defaults".

- **Prepared migration, section 7**: `get_events_collection_membership
  (uuid[])` (one call per list page) and `notify_interested_for_event`
  re-created with the recipient's favourite-type collection in
  `data.collectionId` plus a body suffix. Suite blocks [12.x] and [13.x];
  hand-written type; fake route. Client: Saved rows show "In N
  collections" from one batched call per loaded page.
- **Event page `?date=`**: series date rows in a collection open the event
  with the tapped date highlighted in its dates list.
- **Discover "For you" chip**: selects every favourited type at once;
  shown only when the user has favourites.
- **One-shot retry** (`PendingWritesSync`): when the queue grows while the
  device still reports online, one debounced replay 15 s later; closes the
  Phase C observation for saves, follows and pins alike.
- **Settings → Interests**: favourited types carry a heart in the picker
  (`CategoryPicker.markedIds`), label "…, favourite type".
- **Add upcoming to calendar** (`hooks/useCollectionCalendarExport.ts`):
  the collection options sheet exports every upcoming member as one .ics
  with series RRULEs and exceptions, through the existing share / download
  path; shown when the collection has upcoming members.
- **Accessibility sweep** (no axe in the repo): scenario K11 checks the
  three collection surfaces and the sheet for unnamed controls, a heading,
  targets under 24 px and checkbox state. Native screen-reader passes stay
  on the owner's device list.
- Scenario K11 covers the hint, the chip, the deep link, the export
  download and the sweep: 20/20 on the first run. K1–K10: 139/139 on the
  same export; B2 / B3 / D5 regressions pass. Collections and
  categories-and-series SQL suites pass on the isolated UTC cluster with
  the extended migration. `npm run typecheck` clean, `npm run test` 83
  files / 986 tests, ESLint clean on the changed files.

### Phase E — 2026-11-12 (uncommitted)

Recurring series inside collections (§3.5). Client-only; no database
touched; export and e2e in the foreground.

- `useOccurrenceExceptionsForEvents(rows)` split out of
  `useEffectiveNextDates` (same batched query key, so the Repeating
  segment's date lists cost no extra request).
- `components/SeriesDatesPreview.tsx`: the next five dates of a series with
  exceptions applied (cancelled struck through, moved marked, host note),
  and the viewer's per-date state as a chip — Going (series RSVP or
  override), Not going, Waitlist. Read-only; each date opens the event.
- Collection detail, Repeating segment: every series row gets a "Next dates
  / Hide dates" toggle (exposes `expanded` to assistive tech). The per-date
  overrides are fetched only for expanded rows. No toggle on Upcoming /
  Past, where a series stays one row.
- Collections home: a small repeat glyph on the tile when every upcoming
  member of a collection is a series.
- From §7, placed in E and done: favouriting a type also adds it to
  Interests (one-way, best effort, profile refreshed); the rail widens to
  100 km when fewer than three usable rows are found nearby and says so.
- Fake backend: `event_occurrence_exceptions` / `rsvp_occurrences` now
  serve fixtures (a cancelled and a moved date on the first series, one
  opt-out by the viewer) keyed in the event's zone, with `in.(…)` support.
- Scenario K10 (Repeating → expand → cancelled / moved / Not going / Going
  / five tappable date rows → collapse; no toggle on Upcoming).
- **Prepared-migration change found by K10** (SQL only, still unapplied,
  re-validated on the isolated cluster): `collection_members` tagged
  saves / RSVPs only for smart-rule members, so a pinned series in a manual
  collection had no "going" source and its dates could not show the
  viewer's state. Pinned events in any collection now carry the owner's
  save / RSVP tags ("Added · Going"), which also makes the `saved` /
  `going` filters meaningful on manual collections. `scripts/test-
  collections.sql` [4.3], [4.3b], [6.8b], [6.8c] cover it; the fake mirrors it.
- Found while re-validating: `scripts/test-categories-series.sql` flakes
  near UTC midnight on a non-UTC session zone (pre-existing, reproduced
  without the collections migration; logged in `docs/ISSUES.md`).
  `scripts/db-isolated.sh` now pins the database to UTC like Supabase.
- `SeriesDatesPreview` caps at exactly five rows: `listOccurrences` does not
  count cancelled dates towards its limit, which first produced six.

Results: K1–K10 139/139 on a fresh export; B2 / B3 / D5 regressions pass;
all three SQL suites pass on the UTC-pinned isolated cluster with the
changed migration; `npm run typecheck` clean; `npm run test` 83 files /
986 tests; ESLint clean on the collections files.

### Phase D — 2026-11-12 (uncommitted)

Favourite event types, client-only; no database touched; export and e2e
run in the foreground.

- `hooks/useBrowseCenter.ts`: the "near you" centre (device fix if already
  permitted → profile area → default) extracted from Category Browse so the
  rail below reads the same place. Category Browse now imports it.
- `useFavouriteCategories()` (hooks/useCollections.ts): category id →
  smart collection from the collections list, `favourite` / `unfavourite`
  (create-or-find / delete via the service), in-flight set for busy state.
- **Category Browse hero**: a "Favourite this type" pill (heart) that
  creates the smart collection and toasts "<Type> is now a collection ·
  Open"; when favourited it fills with the category colour and removes on
  tap (deletes the collection, pins included). Hidden when signed out or
  when the server lacks the migration.
- **Create sheet**: creating offers `List | Event type`; the type tab is the
  shared `CategoryPicker` (already-favourited types stay selected and
  cannot be unpicked there), one smart collection per picked category.
  The home's empty state gained "Favourite an event type".
- **"More <type> near you" rail** (`components/MoreOfTypeRail.tsx`): under
  a smart collection's Upcoming list once it has fully loaded — up to five
  active ranked events of the category within the default radius that are
  not already in the collection, "See all" → `/category/[slug]`. Renders
  nothing rather than an empty section.
- **Settings → Interests**: a one-line cross-link explaining that
  favourited types are collections, to keep the two ideas (ranking boost
  vs. auto-collecting) distinguishable.
- Fake backend: smart `POST collections` mirrors the trigger (name /
  colour / icon from the category, 23505 on a second smart collection for
  the same category) and `category_ids=cs.{…}` is honoured.
- Scenario K9 (favourite from browse → toast → collection page;
  unfavourite deletes; rail heading, ranked call for the category, extra
  rows, See all → category page; create sheet Event type mode → new smart
  collection on the home): 21/21 first run. Full K1–K9: 123/123 on a
  fresh export; B2 / B3 / D5 regressions pass. `npm run typecheck` clean,
  `npm run test` 83 files / 986 tests, ESLint clean on the collections
  files (Settings.tsx carries pre-existing warnings unrelated to this
  work). Minor fix in passing: Category Browse imported
  `utils/recurrence` twice.
