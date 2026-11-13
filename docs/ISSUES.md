# EventMap — Issue Tracker

Rebuilt 2026-11-08 from a full re-verification of every open item against the
code. The previous tracker (review passes 2026-10-30 → 2026-11-07, all the
"done in this pass" notes, design rationale and test-environment notes) is kept
verbatim in [`docs/archive/ISSUES-history-2026-10-30_to_11-07.md`](archive/ISSUES-history-2026-10-30_to_11-07.md).
Code comments that cite `docs/ISSUES.md:<line>` or a section name refer to that
archive.

## Ground rules

- **Database:** use isolated scratch databases for model testing; apply local
  migrations only when the owner authorizes them. Never reset without approval.
- **DB state (read-only check, 2026-11-08):** every file in
  `supabase/migrations/` up to `20261106170000` is recorded in the shared local
  DB's `schema_migrations`. Any hosted/production project must be checked
  separately — in particular the Oct 30 security set (`20261030100000` admin
  self-grant, `…101000` premium self-grant, `…102000` storage ownership,
  `…107000` search_path).
- Other users' profile data: never embed `profiles:user_id(...)` in a select —
  RLS returns null for anyone but the owner. Use `get_public_profile` /
  `get_profiles_display`.
- Tags: **[DB]** needs a migration · **[device]** needs a phone/simulator ·
  **[decision]** needs product input.

---

## Status at a glance (final review 2026-11-08)

- **Release blocker:** production map tiles (deferred by decision — no new
  map APIs for now).
- **Next work here (no device):** UI/UX flow passes — flow 1 (onboarding)
  done on web; **flow 2 (first event as a new host) is next.**
- **Waiting on you:** the device & manual testing list (offline on
  iOS/Android first); two product decisions left (approval mode with closed
  RSVPs; the not-started features backlog).
- **Collections (2026-11-12, Phases A–F built, migration unapplied):** open
  items live in `docs/EVENT_COLLECTIONS_PLAN.md` §6 (Phase F defaults with
  alternatives), §7 (remaining decisions: rule editor vs. single column,
  full Interests merge) and §8 (the Phase G runbook). **[decision]** **[DB]**
- **Test flake (2026-11-12, pre-existing):** `scripts/test-categories-series.sql`
  builds its series dates with `(now() + interval '60 minutes')::date`, which
  uses the *session* timezone, while the fixture event is zoned `UTC`. On a
  cluster whose session zone is not UTC (a native Postgres, `America/New_York`
  here) the suite fails after ~19:00 local with `invalid_occurrence` at the
  `restore_occurrence` step. Reproduced without the collections migration.
  Supabase's container runs in UTC, so `scripts/db-scratch.sh` never sees it;
  `scripts/db-isolated.sh` now sets the database timezone to UTC. A durable
  fix is `(now() AT TIME ZONE 'UTC')::date` in the suite's `d` table.
- **Database (2026-11-12):** `20261112100000_event_collections.sql` is
  prepared and validated on an isolated copy only (`scripts/db-isolated.sh`,
  `scripts/test-collections.sql`); it is NOT applied to the shared local
  database. No session applies migrations to the shared database any more;
  the owner does. See `docs/EVENT_COLLECTIONS_PLAN.md` §8.
- **Database:** the four 2026-11-08 migrations and eight 2026-11-09
  category/series migrations are recorded in the local DB. Hosted databases
  have not been checked or changed and must be handled separately.
- **Code health (verified at the final review):** typecheck clean (app +
  admin), 737 unit tests, lint 0 errors (app + admin), browser regression
  runs green: suite B 32/32, suite D 30/30, a11y 101/101, onboarding 57/57.
- Everything finished on 2026-11-08 is in the **Done log** at the end; the
  final review is its first entry.

## UI/UX flows to test next — ranked (2026-11-08)

Ordered by user impact × how little it has been tested. "Coverage" is what
exists today; "Here" = doable headless against the fake backend (no DB);
"Device" = needs your device session. A flow pass means: walk the journey
as a real user would, every branch and back-out, screenshot each step, fix
what's wrong, add a short regression check.

1. [~] **New user onboarding** — **web half done 2026-11-08** (Done log →
   "onboarding flow pass"); the device half is on the device list (image
   picker, location + notification permission prompts, Google sign-in).
2. [ ] **First event as a new host** — switch to business mode → business
   onboarding → first event (create → publish → event page → share).
   Coverage: create/edit reviewed in depth (Nov 2) and Create's duplicate
   guard tested; business onboarding never walked, nor the hand-off into
   the first event. **Here**, except photo picking (**Device**).
3. [ ] **Notification → right screen** for every type (RSVP, reminder,
   chat message/mention, waitlist, moderation, report update, event
   updated/rescheduled/cancelled), from the in-app list and from a push
   (warm + cold start). Coverage: notifications list paging/retry (suite
   B); routing per type never checked. **Here** for the in-app list;
   **Device** for pushes and per-channel delivery.
4. [ ] **Report → moderation → outcome** — report an event / review /
   chat message → admin acts (admin app) → reporter gets `report_update` →
   what the reported user sees (removed message, chat block, ban).
   Coverage: each piece built and reviewed separately; never end to end.
   **Here** with the fake backend for the app side + admin build; the
   admin side needs a manual login session. *Trust & safety: a broken
   loop is invisible until someone needs it.*
5. [ ] **Attendee journey on a busy event** — discover → event page →
   join / waitlist / request (approval) → chat → reminder → event ends →
   review the business. Coverage: best-covered area (tiers 0–3, regression
   pass, suites B/C); the "after the event" part (ended state, review
   prompt, past list) is the gap. **Here**.
6. [ ] **Premium lifecycle as the host sees it** — free quota → limit hit
   → upgrade → 30/month + recurring + boost → cancel/lapse → back to free
   (Create, Manage event, Insights, premium screens). Coverage: logic unit-
   tested, server rules prepared (pending migration); the screens were
   never walked across a lapse. **Here** (fake backend can flip the tier
   and expiry).
7. [ ] **Privacy as other people see you** — private profile, hide
   attendance, hide future events; checked as another attendee, as a host
   (attendee list, chat names) and signed out. Coverage: server-side rules
   reviewed (Nov 3 private-name audit); never checked from the outside in
   the UI. **Here**.
8. [ ] **Account management** — settings, notification preferences,
   blocked users, sign out on a shared device, delete account. Coverage:
   sign-out data clearing tested (suites B9/F2); delete account and
   blocked users never walked. **Here** (delete against the fake backend
   only).
9. [ ] **Visual consistency sweep** — every screen side by side at 390 px
   and 1280 px: spacing, radii, type scale, empty/loading/error states.
   Coverage: per-screen screenshots exist from the a11y pass; never
   compared as a set. **Here**; carries the design-token cleanup. Known
   items: an error toast can cover the onboarding "Step N of 6" label; the
   privacy switches use a teal "on" colour that isn't the brand red.

Already covered well enough to come after these: maps/Discover browsing,
event creation/editing details, host tools hub, calendar, insights,
offline behaviour on web, accessibility on web.

## Device & manual testing (for your device sessions)

In order of importance. Code is in place for all of these; they need a
phone or a logged-in browser session. Record results here.
Also device-only, from elsewhere in this file: pushes arriving per Android
channel; WebView `originWhitelist` on the Google map page; onboarding image
picker and permission prompts (flow 1); notification taps from a push
(flow 3).

0. [ ] **Onboarding on a phone** (flow 1's device half): avatar picker +
   crop, the location and notification permission prompts (grant / deny /
   "open settings" path), Google sign-in, killing the app mid-flow and
   reopening on the same step, and the swipe-back gesture being disabled
   inside the flow.

1. [~] **Accessibility pass** — web half DONE 2026-11-08 (Done log → "accessibility
   pass (web)"); the device half is still open:
   - [ ] VoiceOver (iOS) and TalkBack (Android) through Discover, event page,
     create, chat, profile/settings: labels/roles are verified on web, so
     this is about focus order, grouping and what the state reads as
     ("selected" vs "checked" on the category chips, now `checked`).
   - [ ] Toast spoken once on Android (live region + label); "Error:" prefix
     not doubled on VoiceOver (`components/AppToast.tsx`). Web: one alert
     region, label == text — verified.
   - [ ] `ImageViewer` keeps VoiceOver inside while open (no
     `accessibilityViewIsModal` on the backdrop; Escape works on web).
   - [ ] Map preview focus delay (150 ms) on a slow Android.
   - [ ] Connection banner announced once per change on iOS (announce) and
     Android (live region). Web: verified.
   - [x] Web keyboard pass, axe/Lighthouse-class scan — done (Done log).
2. [ ] **Offline work on iOS + Android** (Nov 5–7) — NetInfo detection, weak
   connection banner, stale-session flow, pending-write queue flush on
   reconnect, chat "waiting" messages. Only ever verified on web.
3. [ ] **Event creation end to end** on a device — live geocoding, photos,
   links, recurrence, draft vs publish; drop the connection mid-publish and
   mid-photo-upload to exercise the duplicate guards.
4. [ ] **Host tools click-through** (Phases 1–3; calls were retyped
   2026-11-08): remove/ban attendee, capacity, waitlist promote, approvals,
   announcements, postpone, reschedule, duplicate, chat mode + pin, premium
   activate/cancel.
5. [ ] **First EAS build with the fingerprint policy**, then one EAS Update
   to it, to confirm runtime versions match.
6. [ ] **Discover + event page behaviour**: pan, pull to refresh, scroll to
   load more (stays in the same area); event chat row with chat off /
   announcements / any-going; deep link `eventmap://event/<id>` cold start
   and Back → Discover.
7. [ ] Smaller device checks: photo drag-to-reorder (native + web), picker
   maps trapping scroll, marker tap keeping the bottom sheet, gradient
   buttons on web, Android fonts on first render, `expo-image` disk cache,
   relative-time labels ticking, throttled-network screenshots.
8. [ ] Storage cleanup (`20261106170000`) actually removes unused files.

## Open — by priority

### Release blockers
- [ ] **Production map tiles use the public OpenStreetMap server**, which its
  usage policy forbids for apps. **Deferred by decision (2026-11-08): no new
  map/tile APIs for now.** Must be resolved before a public release.
  Revisit together: the optional Google provider's Places calls (no
  `sessiontoken`, Geocoding instead of Place Details) and its unpkg-loaded
  clusterer — both unused in the default OpenStreetMap build.

### Medium
- [ ] **No component/e2e test layer** (logic-only vitest). Long-term.

### Low (worth doing when nearby)
- [ ] **Design tokens:** ~550 raw padding/margin and ~180 radius literals.
  Do it during the visual-consistency flow pass (flow 9 above), screen by
  screen with screenshots — a blind codemod would shift layouts.
- [ ] **Offline leftovers (minor):** chat `markRead` isn't queued offline
  (badge clears on the next open); discarding a "waiting" chat message is
  local-only; edit drafts are keyed to `updated_at`; picked image paths can
  be purged by the OS before an offline publish retries.
- [ ] Discover/search cards have no bookmark (save is on the event page
  only). Common in event apps; small feature, not a bug.
- [ ] Business mode profile: "Created" counts every event ever (no
  upcoming/past split), no rating card (the analytics screen already
  computes the venue average). Small features.

Moved elsewhere: reminder time zone → Deferred DB (needs a migration);
Google-provider items → under the release blocker (same decision); WebView
`originWhitelist` → device list.

---

## Database migrations

Owner authorized the following migrations for the local database on
2026-11-08. All four were applied in one transaction and recorded in migration
history. Hosted databases have not been checked or changed.

- [x] `supabase/migrations/20261108100000_event_create_idempotency.sql` —
  server-side dedupe of event creates (client already sends the key) +
  expiry-aware recurring check. Apply before the next file.
- [x] `supabase/migrations/20261108110000_premium_expiry_enforcement.sql` —
  lapsed premium loses 30/month, recurring and the Discover boost.
- [x] `supabase/migrations/20261108120000_rsvp_counts_concurrency.sql` —
  RSVP count drift (independent; any order).
- [x] `supabase/migrations/20261108130000_record_push_channel_routing.sql` —
  records hand-applied push channel routing (already live on the shared
  DB; needed for fresh/hosted databases).
- After applying: `npm run backend:types`, then drop the
  `p_client_request_id` cast/fallback in `services/events.ts`.

The following eight migrations were applied in order to the local Supabase
database in one transaction on 2026-11-10 and recorded in migration history.
The local PostgREST schema reload was requested. Hosted databases have not
been checked or changed. The notes below retain dependencies relevant to a
fresh or hosted database (see docs/CATEGORIES_AND_SERIES_PLAN.md §7):

- [x] `supabase/migrations/20261109100000_category_taxonomy.sql` — categories
  gain `color`, `description`, `synonyms`, `is_active`; labels shortened,
  `icon_key` switched to Lucide names, `community` + `family` added. The
  client presents pre-migration rows from a bundled seed, so the app works
  before and after. After applying: `npm run backend:types`.
- [x] `supabase/migrations/20261109110000_category_discovery.sql` — apply
  **after** the taxonomy file (needs `categories.synonyms`). Re-creates
  `get_ranked_events` with `p_preferred_category_ids` (interests boost +0.3)
  and category label/synonym search. Output columns unchanged; the 9-arg
  overload is dropped. The client retries without the boost argument on
  PGRST202, so it works before this is applied (no boost, no category-word
  search).
- [x] `supabase/migrations/20261109120000_admin_categories.sql` — apply
  after the taxonomy file. Admin INSERT/UPDATE policies on `categories` (no
  DELETE: retire via `is_active`), slug-format CHECK,
  `admin_reorder_categories(uuid[])`, `admin_category_stats()`. The admin
  /categories page is read-only before this migration. Historically, a sibling worktree had an unapplied
  `20261109120000_admin_category_management.sql` with the same timestamp and
  overlapping objects. The owner confirmed the trajectories were unified;
  the selected file above was applied locally.
  (Correction 2026-11-09: the `admin_category_stats` / `categories_validate`
  objects seen earlier were NOT on the shared DB; they came from the sibling
  session writing to the same scratch database name. See below.)
- [x] `supabase/migrations/20261109130000_recurrence_patterns_v2.sql` —
  independent of the category files. `byWeekday` / `monthly: nthWeekday`
  support in `event_next_occurrence` (5-arg with `p_now` + 4-arg wrapper),
  `event_recurrence_matches`, and the `c_validate_event_recurrence` trigger.
  **Heads-up:** the sibling session has its own version of these objects
  (seen in the shared scratch name, NOT on the shared DB — correction below).
  This file uses the same names, keys and Monday-based weeks and agreed with
  it on 559 of 560 sampled answers; the selected version was applied locally.
  Verified: no
  change for any existing (v1) pattern across 2,268 inputs vs the original.
- [x] `supabase/migrations/20261109140000_occurrence_exceptions.sql` — apply
  after `20261109130000`. `event_occurrence_exceptions` (read follows event
  visibility, writes RPC-only), `skip_occurrence` / `reschedule_occurrence` /
  `restore_occurrence` (host/admin, real future dates only, optional
  notify), `event_next_effective_occurrence`, and per-occurrence reminders
  (`event_reminder_sent.occurrence_start` joins the primary key;
  `send_event_reminders` "going" loop rewritten). The reminder body was
  captured from the shared-DB snapshot: diff it against the live function
  before applying in case another session changed it since.
- [x] `supabase/migrations/20261109150000_rsvp_occurrences.sql` — after
  140000. Per-date going/not-going overrides, `set_occurrence_rsvp` (now
  capacity-checked, `event_full`), `get_occurrence_going_counts`,
  `get_occurrence_attendees_page` (host per-date list), per-date waitlist
  (`occurrence_going_count`, `promote_occurrence_waitlist`, status
  'waitlist'), leave-series trigger, reminders honour overrides. The counts
  RPC's return type changed (adds `waitlist_count`): the file DROPs the old
  signature first. 140000 also gained the orphan-pruning
  trigger (`z_prune_orphaned_occurrence_rows`). **The sibling
  session built an overlapping design** (same table shape;
  `set_occurrence_going`, `get_occurrence_counts`, `occurrence_reminder_wanted`)
  — the selected API above was applied locally.
- [x] `supabase/migrations/20261109160000_split_series.sql` — after 150000.
  `split_series_from` ("this and following"); moves per-date rows before
  shortening the original (prune-trigger ordering). Sibling has `split_series`.
- [x] `supabase/migrations/20261109170000_interest_event_notifications.sql` —
  after the taxonomy file. Opt-in "new event in your interests near you".

**Regression suite for the categories/series stack:**
`scripts/test-categories-series.sql` (rollback-only, ASSERT-based). Run it
on a scratch copy after applying all 202611091* migrations; see the header.
On 2026-11-09 it and the four existing suites (host tools, calendar,
attendance, insights) all passed on a fresh copy with every prepared
migration applied.

**Scratch database name collision (found 2026-11-09).** This worktree and a
sibling are both named `oak`, so both sessions defaulted to
`SCRATCH_DB=eventmap_scratch_oak` and wrote into the same scratch copy.
Objects earlier reported as "already on the shared DB" came from that
collision. This branch now validates on `eventmap_scratch_oak_catseries`
(fresh copy): all seven migrations apply cleanly and idempotently in order,
and the shared DB has none of the categories/recurrence objects. Pick
unique scratch names per session (e.g. include the branch id).

Not written (low): reminder nudge at `now() + 25h` ignores the event's time
zone (should key off the event's local day); blanket `REVOKE EXECUTE ... FROM
PUBLIC` + explicit grants to `authenticated` for RPCs; require a session for
`get_event_attendees_public`; server length limits on event title/description (UI has
`maxLength`); banner `link_url` `^https?://` CHECK (admin input only).

## Needs a product decision

- [ ] **[decision]** Approval-mode events when RSVPs are closed (same trigger
  in `20261103170000`): should pending requests still be approvable after
  the host closes RSVPs? Genuinely product-specific — left open.
- [ ] **[decision]** Features not started: invite-only events
  (`event_invites`), all-day/multi-day events, "My reports" screen, dark
  mode, real billing periods, real view/share analytics.

### Decided 2026-11-08 (common practice for event/social apps)
- **Connection banner over headers:** keep. It ignores touches, and the same
  pill pattern is common in messaging apps; pushing every header down on each
  connectivity flip causes layout jumps.
- **Hosts RSVP to their own event:** keep as is. The UI hides the RSVP bar for
  owners, and a host's RSVP row on the server is harmless (hosts attend their
  own events); no server guard needed.
- **Banned users can still browse:** keep. Suspended accounts lose all write
  actions (enforced server-side) but keep read access, as on most community
  platforms; it also lets them see the suspension notice.
- **Private users posting in chat appear as "First L." to others:** keep.
  Posting in a shared room is a public act; a short name is the usual
  middle ground between full name and fully anonymous.

## Won't do / accepted as-is

Recorded so they don't get re-raised: splitting `EventDetail` (2.7k lines),
`discover`, `Settings`, onboarding, or a shared Create/Edit form (big
refactors, no user impact); PostGIS distance (bounding box is fine at current
scale); DST-gap picker round-trip; admin middleware DB query per request;
profile query key includes business id; insights cache never invalidated;
~25 s auth refresh stall (mitigated); offline sign-out drops queued writes
(privacy on shared devices); cached chat after losing access (fails cleanly);
cluster colour by category / selected pin inside a cluster; single marker
rebuilding the cluster group; redundant `LinkifiedText` memo; web jpeg resize
edge case; double fetch after RSVP; AST a11y guard can't see touchables in
child components; public profile has no focus refresh (pushed screen,
pull-to-refresh is enough); HMAC for anonymous attendee ids (row ids are
never exposed, so the hash isn't reversible in practice).

---

# Done log

## 2026-11-08 — final review of everything done today

Re-checked every item touched since the tracker was rebuilt, against the
current code, plus a regression sweep of the whole change set (70 files).

**Regression sweep:** typecheck (app + admin), 737 unit tests, lint (app +
admin) — all clean. Fresh web build against the fake backend (no database),
then: suite B scenarios B3–B8 (event page freshness, live count, chat
composer, following, business mode) 32/32; suite D (offline recovery, token
refresh, queued writes, session gate) 30/30; a11y S/L/E 101/101; onboarding
J/R/A 57/57. No regressions found in behaviour.

**Small issues found in review and fixed:**
- [x] The new live-count subscription used one realtime channel name per
  event; two open copies of the same event page (event → business → same
  event) would share it, and leaving either would silently unsubscribe the
  other. Channel names are now unique per subscriber (`services/events.ts`).
- [x] `screens/Calendar.tsx` kept a hand-added `aria-checked` next to the new
  `a11yState()` spread (redundant). Removed.

**Re-confirmed:**
- `reschedule_event` has no "someone must be going" precondition, so the
  widened Edit prompt (now for any published event) saves through it safely.
- At the time of review the four DB files were deferred; they were later
  applied to the local DB with owner approval (see Database migrations).
- The "Won't do" and "Moved elsewhere" calls still hold: the Google-provider
  items stay dormant (the default provider in `.env.example` is
  `openstreetmap`), and nothing done today touched the other accepted items.
- Four of the six "product decision" items were decided by common practice
  (see that section); two remain genuinely open.

**Larger items left for later (already tracked):** design-token cleanup and
the two visual nits (flow 9); offline leftovers (Low); the component test
layer (Medium); device checks (device list).

## 2026-11-08 — onboarding flow pass (flow 1, web)

Walked as a new user in headless Chrome against the fake backend (no
database): welcome → sign up → profile → interests → permissions → home area
→ privacy → tutorial → Discover, plus sign-in, wrong password, forgot
password, the "confirm your email" sign-up branch, back-outs, a failed save,
and killing/reopening mid-flow. `scripts/fake-backend-e2e/suiteOnboarding.mjs`
(scenarios J = journey, R = resume, A = auth paths); screenshots per step.
Result after fixes: **57/57 checks pass** (from 21/34 on the first run; the rest of the
first-run failures were harness mistakes — unscoped clicks landing on
inactive pages — which is exactly the gap the `inert` fix closes).

### Found and fixed
- [x] **Every onboarding page was reachable off screen.** The seven pages
  are one horizontal pager, all mounted side by side, so a screen reader
  (and Tab on web) walked straight through the inactive pages — "Skip",
  "Start Exploring", every interest chip of a later step. Inactive pages are
  now hidden from assistive tech on native and `inert` on web (`PageSlot`
  in `app/(onboarding)/index.tsx`, with a `testID` per page). The suite
  checks 6 pages are inert and only the active one is focusable.
- [x] **Forgot password → "Back to Sign In" stacked a second sign-in screen**
  on top of the first (which still held the typed password). Visible on
  web as two "Login" forms in the DOM and on native as a stale form behind
  the back gesture. It now goes back to the original sign-in
  (`goBackOr`, falling back to a replace when opened from a link).
- [x] **Sign-in ↔ sign-up footer links pushed screens** (welcome → sign up →
  sign in → sign up … left a stack of stale forms). They swap the screen
  now (`router.replace`), the common pattern.

### Verified working (no change needed)
- Sign-up validation (required fields, 8-char minimum, confirmation match);
  one POST per tap; lands on the onboarding welcome; name prefilled from
  sign-up; no Skip on the profile step for a new user; empty name disables
  Continue with an inline error.
- A failed step save keeps the user on the step with an error toast; the
  retry saves exactly the trimmed fields (handle stored without "@").
- Interests: button reads "Skip for now" until something is picked; picks
  survive back/forward; saved as ids.
- Home area: new user has no prefilled area; the map picker opens with
  Confirm; back returns to the same step.
- Privacy switch toggles and saves; the preview shows the entered name.
- Final write sets the completed flag with every field, clears the local
  draft, lands on Discover; a reload stays on Discover.
- Resume: reopening mid-flow lands on the same step with the same answers;
  a user with the completed flag never sees onboarding again.
- Wrong password shows "That email or password is not right…" and stays on
  sign-in; forgot password shows the "sent" confirmation; a sign-up that
  needs email confirmation routes to sign-in with the email prefilled and a
  toast.
- No uncaught exceptions in any scenario; no unknown backend calls.

### Observations, not changed
- Permission prompts and the avatar picker are OS dialogs — device list.
- The home-area step is optional and most new users will skip it; Discover
  then centres on the device location or the default city. Fine.
- `Dimensions.get('window')` is read once for the pager width; the app is
  portrait-locked so rotation can't break paging. A split-screen resize on
  a tablet would — not a target today.

## 2026-11-08 — batch 5: Low list

- [x] **Admin lint clean** — `promotions/MapPicker.tsx` typed with Leaflet's
  own types (`Map`, `CircleMarker`); `npx eslint` in `admin/` → 0 errors;
  `typecheck:admin` clean.
- [x] **Accessibility long tail** — a TypeScript-AST scan of every `.tsx` in
  app/screens/components finds **no** touchable without a label and without
  text (the chat moderation / message-actions / report sheets included).
  Map HTML: zoom controls are off, markers carry `title`/`alt`, the iframe is
  out of the Tab order. Form errors: Create and Edit now announce
  "N fields need attention. <first message>" when Publish/Save is refused
  (`utils/validationSummary.ts`, tested) — before, a screen-reader user heard
  nothing.
- [x] **Oct 29 follow-ups re-triaged** (`docs/archive/FOLLOW_UPS-2026-10-29.md`):
  - Joining an event already in progress — allowed on purpose (common
    practice; the page says "Happening now"). Closed.
  - Leaving doesn't reset chat unread — stale: the unread RPC only counts
    events you're going to and can access. Closed.
  - Following has no unfollow — stale (it has one, with a11y action). Closed.
  - Public profile focus refresh, anonymous-id HMAC — accepted (Won't do).
  - Card bookmark on Discover, business "Created" split, rating card →
    Low (features).
  - RPC `EXECUTE` granted to PUBLIC by default; `get_event_attendees_public`
    callable signed-out → Deferred DB (security hardening, low risk: the
    functions check `auth.uid()` / return public data only).
  - Native onboarding image picker / permission prompts → device list.
  - Profiles lockdown note (embeds of `profiles:user_id(...)` return null
    for other users; use `get_public_profile` / `get_profiles_display`) is
    standing developer guidance — kept in Ground rules.

## 2026-11-08 — batch 4: Medium + Low list

- [x] **Toasts "Couldn't refresh…" during a stale session** —
  `notify.backgroundError(message, err?)` now skips connection-class errors,
  which includes the session gate's `SessionNotReadyError`; the three call
  sites pass the error. Tests: `tests/notifyBackground.test.ts`.
- [x] **Chat moderation errors styled as success** — notices under the chat
  composer carry a tone; failures (moderation sheet ×5, pin, mute, not sent,
  jump-to-message) are red (`ChatComposer` `statusTone`), info stays grey.
- [x] **Hard-coded `en-US`** removed from Followers, ReviewCard, premium
  manage and profile-analytics number formatting (device locale, like the
  rest of the app). The `en-US` left in `utils/timezone.ts` is internal
  parsing, not display.
- [x] **EventDetail subscribes to `event_rsvp_counts`** (public table, in the
  realtime publication): join/leave anywhere updates the count within a
  second; the 20 s poll stays as fallback. `getEventLiveStatus` now uses the
  typed table (cast removed).
- [x] **Discover recurring cards** use the RPC's `next_start_datetime`
  (same rule as the ranking); the client walk is only the fallback.
- [x] **Edit "notify attendees?" prompt** now fires for any published event
  whose time/place changes (reschedule notifies going, interested and savers,
  not just going) and says so; drafts save silently.
- [x] **Pending-write marker on Follow** (`screens/BusinessDetail.tsx`:
  "Follow · syncing", busy state + hint, like the EventDetail bookmark).
  Following and Saved lists remove the row optimistically and the toast says
  "will sync", so a per-row marker there has nothing to attach to — closed.
- [x] **BusinessDetail review responses** also update the cached page
  (returning to the screen or opening it offline showed the old response).
- [x] **Client monthly limit** (`businessesService.checkEventLimit`) is
  expiry-aware like the server's `business_has_premium()` (a lapsed premium
  host saw 30/month client-side; the server would have refused at 2).
- [x] Unused `searchLocation` in `discover.tsx` removed.
- [x] Stale entries closed after re-checking the code: admin pagination
  already redirects when the count is null; Create already shows the quota
  pill before the form.

### Decisions (following common practice for consumer apps)
- **`secure_password_change` stays off.** Re-verifying the current password
  in-app (what `verifyCurrentPassword` does) is the usual pattern; GoTrue's
  option adds an email-OTP step to every password change. Revisit only if
  email re-auth becomes a product requirement. The extra session created by
  the re-verify replaces the client's current one and the old refresh token
  simply ages out — accepted.
- **WebView `originWhitelist={['*']}`** on the Google map page: tightening
  it must be tested on a device (the HTML is loaded from a string and an
  over-strict list blanks the map), so it stays on the device list.
- **Connection banner over headers**: keep as is (see "Needs a product
  decision"); nothing is blocked since it ignores touches.


### Also done in that batch (moved from Open)
- [x] **`npm audit` triaged (2026-11-08): 51 → 34** (critical 2 → 1, high
  16 → 5) with `npm audit fix` (no `--force`): lockfile only, Expo SDK 54
  patch bumps (`expo` 54.0.38, `expo-router` 6.0.24, `expo-notifications`,
  `expo-updates`…) plus build-tool transitive updates. Verified: typecheck,
  730 unit tests, lint 0 errors, web export, and a 60 s headless boot of
  Discover + event page with 0 exceptions. These are native module patch
  bumps, so with the fingerprint policy the next device build gets a new
  runtime version (expected). Remaining, not fixable without breaking
  upgrades:
  - Ships in the app: `decode-uri-component` / `query-string` (deep-link
    URL parsing, via `expo-router`). Worst case a crafted link hangs the
    app for whoever opens it. Fix = Expo SDK upgrade (expo-router 58). Low.
  - Build/dev tooling only, never in the bundle: `tar` (critical, via the
    `supabase` CLI — bumping the CLI also changes the local stack's images,
    so leave it to whoever owns the stack), `postcss`, `image-size`, the
    Expo config/CLI chain, `@typescript-eslint` via `eslint-config-expo`.
  - Pre-existing (not from this fix): `npx expo install --check` wants
    `react-native` 0.81.5, `expo-image-picker` ~17.0.11,
    `@react-native-community/datetimepicker` 8.4.4,
    `react-native-worklets` 0.5.1. Native changes — do it together with the
    next device build.
- [x] **Android notification channels** (2026-11-08) — validated
  differently from the old entry: the shared DB already routes pushes to
  `chat` / `moderation` / `events` (`push_channel_for_type`, hand-applied,
  no migration file), but the app only created `default`, so on Android 8+
  pushes on the other channels may not show at all. The app now creates all
  four channels with names/descriptions (users can mute chat separately in
  system settings). `supabase/migrations/20261108130000_record_push_channel_routing.sql`
  records the live definitions (no-op on the shared DB);
  `tests/pushChannels.test.ts` fails if the server can route to a channel
  the app doesn't create. Needs a device to confirm pushes appear per
  channel (add to device session).

- [x] **Admin dashboard** — done 2026-11-08 without a database:
   `npm ci` in `admin/`, `npm run typecheck:admin` clean, `next build`
   (pointed at a dead URL) compiles all 21 routes, the new search/filter
   builder is unit-tested (`tests/adminSearch.test.ts`). Lint: the files
   changed here are clean; 5 pre-existing `no-explicit-any` errors remain in
   `promotions/MapPicker.tsx` (untouched, Low). Clicking through with a real
   admin login is left for a manual session.

## 2026-11-08 — accessibility pass (web)

Run against the fake-backend web build (no database; headless Chrome +
axe-core 4.14 + simulated Tab/Escape), 17 screens at 390 px plus three at
320 px and 1280 px:

```sh
# build once: EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 npx expo export --platform web --output-dir <dist>
# axe-core is not a dependency: npm pack axe-core && tar xzf axe-core-*.tgz
node scripts/fake-backend-e2e/suiteA11y.mjs "$PWD" <dist> S,A,E,L,K,V <path/to/axe.min.js> <outDir>
```

Result after fixes: **168/168 checks pass** (from 51/79 on the first run);
screenshots + `a11y-report.json` in the out dir. What it covers per screen:
axe WCAG A/AA violations, every visible control has a name, no control under
24 px, a heading exists, images have alt, Tab reaches named controls with a
visible focus ring; plus Escape on overlays, toast/banner live regions, the
map in the Tab order, horizontal overflow at 320/1280.

### Found and fixed
- [x] **`accessibilityState` never reached the web DOM.** react-native-web
  0.19+ drops it (only `aria-*` props are rendered), so all 55 selected /
  checked / disabled / expanded / busy states in the app were invisible to
  web assistive tech (two components had hand-added `aria-selected`). New
  `a11yState()` in `utils/accessibility.ts` emits the native state plus the
  matching `aria-*` prop; every call site converted (codemod), toggle
  buttons get `aria-pressed` on web (`aria-selected` is invalid on a
  button). Tests: `tests/a11yState.test.ts`; the AST guard accepts the helper.
- [x] Category chips (`choiceA11y` radio) exposed `selected`; a radio needs
  `checked` (axe critical ×10 on Create; also the "selected vs checked"
  wording item for VoiceOver).
- [x] Calendar day cells put `aria-selected` on a button (critical ×35); web
  now says ", selected" in the label, native keeps the state.
- [x] No screen had a heading. `ScreenHeader` titles and the main titles of
  Discover, Notifications, Create, chat, Saved, My Events, Joined, event page,
  host hub, profile, user profile and the three auth screens are
  `accessibilityRole="header"` now.
- [x] Contrast: notification timestamps on read rows (2.5:1 → 4.65:1, an
  opacity was stacked on the tertiary colour), own chat bubble time
  (4.3 → 5.6:1), premium "Active" chip (3.6 → 5.3:1).
- [x] Tiny targets on web (hitSlop is native-only): "Dismiss notification"
  16×16 → 44×44, Discover "See all" 51×21 → 44 tall, Profile "View All"
  54×18 → 44 tall, login "Forgot password" / "Sign Up" → 44 tall. Layout
  unchanged (padding + negative margins).
- [x] Keyboard: Tab entered the Leaflet map iframe (8 stops: zoom,
  attribution, one per marker) before reaching Search. The iframe is
  `tabIndex={-1}` on web; the list below carries the same events.
- [x] Unnamed spinners / progress bar: chat "loading older", "Loading chat",
  "Connecting"; host hub capacity bar (label + value).
- [x] Labels that didn't contain the visible text where the visible text is
  the label: "See all events", "All categories", "Mark all read, N unread",
  "Drafts" tab.
- [x] Harness checks Escape on: search overlay, filters sheet, time-zone
  picker, image viewer, announce modal, report sheet — all close and all
  move focus inside. Toast: one `role="alert"` region, label == text.
  Connection banner: one polite live region, "Back online" once.

### Reviewed, left as-is (reported as WARN by the suite)
- `nested-interactive` (event cards contain "View business"; notification
  rows contain Dismiss). Native exposes the inner action through
  `accessibilityActions`; on web Tab reaches the inner button (verified in
  the Tab sequence). Restructuring the cards isn't worth it.
- `label-content-name-mismatch` on composite buttons (saved/event cards,
  chat messages, "Manage <event>", profile stat tiles, "Change profile
  photo", the Notifications tab's "N unread"): the visible text is content,
  not a label. Worth a glance on device: host hub "Edit details" /
  "Announce to attendees" / "Notify followers" — check the visible text
  matches what's spoken.
- `@gorhom/bottom-sheet` marks the sheet and handle `role="slider"` with no
  value (library; "See all" is the keyboard path to expand).
- Controls between 24 and 44 px remain (back buttons 40, chat avatars 32,
  Saved "Remove" 32, segmented tabs 34–36): native has hitSlop; web keyboard
  users are unaffected. Listed, not fixed.

## 2026-11-08 — batch 3

Each item was validated against the code (and, for the DB, reproduced on the
scratch copy) before implementing.

- [x] **Event photos shown twice after a lost response** — validated
  differently from the old entry: every upload gets a unique URL, so a
  unique `(event_id, url)` constraint would never fire, and nothing retries
  the insert automatically. The real path was: insert commits, response
  lost, host is told "1 photo failed — add it by editing", re-adds it →
  duplicate. `eventsService.addEventPhoto` now checks, after a connection
  error, whether the row with that URL exists and treats it as success; on
  a real failure it frees the uploaded file (`releaseEventImages`, which
  only deletes files nothing references). No DB change needed. Tests in
  `tests/createEventIdempotency.test.ts`.
- [x] **`rsvp_count` drift under concurrent RSVPs — reproduced, fix
  prepared.** On scratch: join + concurrent leave → stored 1 / actual 2;
  leave + concurrent leave → stored 1 / actual 0 (stays wrong until the
  next RSVP on that event; feeds Discover, ranking and the event page).
  `supabase/migrations/20261108120000_rsvp_counts_concurrency.sql` adds a
  per-event advisory lock in `sync_event_rsvp_counts` and repairs drifted
  rows. After applying on scratch all four orderings are correct, the
  attendance suite is 49/49 and the 5,000-RSVP stress insert shows no
  measurable cost (2.4–3.3 s with and without; that time is the existing
  per-row recount).
- [x] **Discover "load more" after pull-to-refresh** — confirmed: page 1
  loaded at the live map centre, later pages at the `center` state, which
  can lag a pan, so page 2 came from another area at the wrong offset.
  `pagedCenterRef` now records the centre each first page used (also set by
  the saved-area fallback) and `loadMoreEvents` pages from it.
- [x] **Connection banner over the branded splash** — the banner is now
  mounted only after the startup splash lifts (`app/_layout.tsx`). The
  other half (pill covers header titles while up) is a design choice, not
  a bug — see "Needs a product decision".
- [x] Test fixtures: `scripts/stress-attendance.sql` broke on the approval
  trigger like the attendance suite; it now sets `eventmap.allow_approval`
  for its rolled-back run.
- Not implemented after validation: Google Places session tokens and
  vendoring the Google clusterer (Google provider only — moved to Low).

## 2026-11-08 — batch 2

- [x] **OTA release hazard** — `app.json` `runtimeVersion` is now
  `{ "policy": "fingerprint" }` (Expo 54, resolves in `expo config`). The
  runtime version changes automatically whenever native code/config
  changes, so an EAS Update can never reach a binary it's incompatible
  with. Chosen over bumping `version` because nothing is in stores yet and
  native deps are still changing; revisit (`appVersion`) once releases are
  versioned for real. Every native change now needs a new build before
  updates reach it.
- [x] **Supabase types regenerated** (`npm run backend:types`, schema read
  only) and the untyped RPC helpers removed from `hostTools`, `analytics`,
  `calendar`, `eventChat`, `social`, `reviews`, `storageCleanup`. Explicit
  NULL arguments go through `services/rpcArgs.ts` (the generator never
  marks args nullable). Pre-migration fallbacks removed: the create-RPC
  ladder, the `42703` retry in `getBusinessEvents`, and the direct-update
  premium fallbacks in `services/premium.ts` (the trigger blocks them).
  Left in place on purpose: the "function missing → degraded" branches in
  calendar/hostTools (harmless, cover a hosted project behind on
  migrations).
- [x] **`scripts/test-attendance-rpcs.sql` runs again** — 49/49 PASS on
  scratch. Fixture RSVPs now set `eventmap.allow_approval` per statement
  (approval/closed-event trigger), and the seed's demo events are moved
  into the future inside the rolled-back transaction (they had aged out;
  `eventmap.allow_reschedule` for that one UPDATE).
- [x] **Premium expiry enforced server-side (prepared)** —
  `supabase/migrations/20261108110000_premium_expiry_enforcement.sql` switches
  the monthly allowance, the recurring-event trigger and the Discover
  ranking boost/`is_premium` to the existing expiry-aware
  `business_has_premium()`; the create RPC's recurring check is updated in
  the idempotency file. Validated on scratch: active premium → 30/month,
  boost, recurring allowed; lapsed → free limit, no boost, recurring create
  and update refused. Re-applies cleanly. Client already treated lapsed as
  free (`utils/premiumState.ts`).
- [x] **Admin search/filters cover all pages** — businesses search
  (name/category) and complaints status filter moved into the page query
  (URL params, kept by pagination); event search now matches title,
  description or address. `orIlike()` in `admin/app/(dashboard)/SearchForm.tsx`
  neutralises `, ( ) "`. Filter syntax checked read-only against the local
  API; **not clicked through** (admin deps not installed in this worktree,
  so `typecheck:admin` can't run here).

## 2026-11-08 — batch 1

- [x] **Publishing twice creates a duplicate event (and uses a second monthly
  slot).** `app/(tabs)/create.tsx` keeps one request key per event being
  written (new key after a successful publish/draft). `services/events.ts`
  `createEvent`:
  - sends it as `p_client_request_id`; the pending migration
    `supabase/migrations/20261108100000_event_create_idempotency.sql` makes the RPC
    return the existing event for a repeated key (no new row, no slot). Until
    it's applied the call falls back to the current signature (remembered per
    session, one extra round trip at most);
  - **works today without the migration:** when an attempt ends without an
    answer (connection error), the next attempt with the same key first looks
    for the event this business created in the last 30 min with the same title
    and start, and returns it (`recovered: true`, "your earlier attempt had
    already gone through"); the client-side monthly-limit pre-check is skipped
    for that retry so a used-up last slot can't block the recovery.
  - Tests: `tests/createEventIdempotency.test.ts`. SQL validated on scratch
    `eventmap_scratch_elm_idem`: same key → same id, 0 extra slots; no key →
    new event, 1 slot; one function overload left.
  - Known limit (pre-migration fallback): if the host edits the title or start
    between the lost attempt and the retry, the lookup misses and a second
    event is created. With the migration applied the key wins regardless.
- [x] **Event page chat row ignored the host's chat settings**
  (`screens/EventDetail.tsx`). It now loads `chat_mode` / `open_policy` on
  focus and uses `utils/eventChatAccess.ts`, which mirrors the server's
  `user_can_access_event_chat`: "off" shows "The host turned the chat off",
  `any_going` opens it for the first attendee, announcements mode says
  "Announcements from the host". Tests: `tests/eventChatAccess.test.ts`.
- [x] **Host chat notice was wrong** (`app/event-chat/[id].tsx`): said only
  going attendees can post; hosts can post unless chat is off
  (20261102120000/20261103160000). Attendees in announcements mode now read
  "Only the host can post here" instead of "locked".
- [x] **Back did nothing after opening an event from a link on a cold start**
  (`screens/EventDetail.tsx`, three back buttons). New `utils/navigation.ts`
  `goBackOr(router)` falls back to Discover. Tests: `tests/navigation.test.ts`.

- [x] **Duplicate-event fix re-checked (2026-11-08, second pass) — one
  regression found and fixed:** draft and publish shared one key, so a lost
  "Save as draft" followed by Publish returned the *draft* as "Event
  created" (and, once the migration is applied, the server would have done
  the same). Now one key per mode (`requestKeyRef.current.draft/published`)
  and the recovery lookup also matches `publish_state`. The create call is
  now a single typed RPC with capacity/time zone/publish state (old
  pre-migration attempt ladder and follow-up UPDATE removed). Tests added.
  Remaining by design: the pre-migration recovery only lives in memory, so
  killing the app between the lost attempt and the retry can still
  duplicate until the server migration is applied.

## Verified fixed on 2026-11-08 (were still unchecked in the old tracker)

About 75 old open boxes were already fixed in code, among them: business
description editing, avatar cache-busting, scroll-to-first-error, unsaved
changes guard on Edit, price/capacity/ticket fields, Discover mount race,
recurring card dates, chat relock explanation, FAQ mailto, Leave confirm,
reviews/bans/RSVP-lifecycle server enforcement, password length 8, the whole
Tier 0–3 and host-tools migration sets (applied), host "Remove attendee",
notification icons, photo reorder, React Query on MyEvents/BusinessDetail/
Profile, requested tab in Joined lists, RSVP approval mode, chat mode + pins,
pending-write queue fixes (degraded→online flush, flush race,
`sessionVerified`), chat retry dedupe, degraded cold-start taps, anon-key
requests on a flaky session. Evidence for each is in the archive's sections
and the 2026-11-08 review.
