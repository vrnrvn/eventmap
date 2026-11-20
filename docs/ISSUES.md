# EventMap — Issue Tracker

Rebuilt 2026-11-08 from a full re-verification of every open item against the
code. The previous tracker (review passes 2026-10-30 → 2026-11-07, all the
"done in this pass" notes, design rationale and test-environment notes) is kept
verbatim in [`docs/archive/ISSUES-history-2026-10-30_to_11-07.md`](archive/ISSUES-history-2026-10-30_to_11-07.md).
Code comments that cite `docs/ISSUES.md:<line>` or a section name refer to that
archive.

## Ground rules

- **The shared local database is read-only (owner, 2026-11-14).** Do not apply
  migrations, write test data, or reset it — not even a scratch copy made
  inside the shared cluster, because a crash in one backend restarts every
  connection in the cluster (see the segfault rule below). `SELECT`s to check
  state are fine. All SQL testing happens in a **throwaway isolated
  environment**; the owner applies migrations.
- **In a superuser psql session, never provoke `permission denied for
  function` after `SET ROLE anon` / `authenticated` / `service_role`.** On the
  Supabase Postgres image (`17.6.1.106`, `supautils.hint_roles`) that error
  segfaults the backend and crash-restarts the whole cluster. Assert
  `has_function_privilege(...)` instead of calling the function. Root-caused
  2026-11-14 (it had crashed the cluster four times since Nov 4); minimal repro
  in [`docs/REVIEW_AND_ROADMAP_2026-11-14.md`](REVIEW_AND_ROADMAP_2026-11-14.md)
  finding C1.
  **Scope (measured 2026-11-14, isolated stack): superuser sessions only.** The
  crash needs the session's *original* role to be a superuser, which is why it
  only ever bit through psql suites. The same call as the non-superuser
  `authenticator` role returns a normal error, and an anonymous
  `POST /rpc/get_user_collections` through PostgREST returns a clean
  `401 / 42501` with no crash. **Not reachable over HTTP** — an earlier note
  here said it was; that was wrong.
- **DB state (re-verified 2026-11-20):** the local DB records **140**
  migrations through `20261120100000_get_live_events.sql`, one-to-one with
  `supabase/migrations/`. Verify with:
  `select count(*), max(version) from supabase_migrations.schema_migrations;`
  → expected 140 / `20261120100000`. One prepared file is not applied:
  `supabase/prepared/2026-11-19_series_reviews/20261119110000_series_reviews.sql`
  (`docs/MIGRATIONS_PENDING.md`). This worktree is `supabase link`ed to a
  hosted project, so **always pass `--local`** to `supabase migration`
  commands, because `migration list` defaults to `--linked`. *(2026-11-15
  value was 123 / `20261115100000`.)* Any hosted/production project must be checked
  separately — in particular the Oct 30 security set (`20261030100000` admin
  self-grant, `…101000` premium self-grant, `…102000` storage ownership,
  `…107000` search_path). No hosted project has ever been checked.
- **Client/schema compatibility (policy, 2026-11-14).** The client targets the
  migration set in `supabase/migrations/`; applying migrations is a
  prerequisite of deploying a build, not something the client negotiates at
  runtime. Concretely:
  - **Do not add probe-and-retry fallbacks** — calling an RPC, catching
    PGRST202/42883 because an *argument* or function is missing, retrying in
    the old shape, and remembering it for the session. They cost a failed
    round trip, they are only exercised in the window before a migration is
    applied, and when they fire they silently downgrade behaviour. The two
    that existed (`createKeyParamUnsupported`, `preferredBoostUnsupported` in
    `services/events.ts`) were removed on 2026-11-14; losing the idempotency
    key to a silent retry is exactly how duplicate events happened.
  - **Error-path degradation is fine and is kept** where a missing object has
    a genuine user-facing answer and costs nothing on the happy path: the
    `MISSING` sets in `services/collections.ts` and `services/eventPlaybook.ts`
    ("coming soon" / device-local ticks) and the "function missing → degraded"
    branches in calendar and host tools. These also cover a hosted project
    that is behind, which the README supports as a deployment option.
  - The practical difference: a fallback that *changes what is written* is a
    correctness hazard; one that *changes what is shown* when the server
    genuinely lacks a feature is a feature.
- **Pending database work** is listed precisely in
  [`docs/MIGRATIONS_PENDING.md`](MIGRATIONS_PENDING.md): E-R1 is decided but
  still needs a migration. The prepared orphan-function migration was applied
  locally on 2026-11-14 with owner authorization.
- **Previously unfiled object:**
  `get_user_past_event_count()` (hand-applied; `docs/HOST_TOOLS_PLAN.md` §11
  item 3). **Resolved locally 2026-11-14:**
  `20261114100000_drop_unfiled_past_event_count.sql` drops it. It is an orphan
  from a sibling worktree's unmerged `20261029100000`; verified unreferenced by
  the repo, by every other DB function, and by every policy/view/trigger before
  the file was written. The local migration is recorded and the function is
  absent; hosted databases remain unchecked.
- **Test environments (the default is `scripts/pg17-isolated.sh`).** It builds
  a throwaway container from the *same image the stack runs* (Postgres 17.6,
  auto-detected from the running stack), applies every migration and the seed
  via the shared `scripts/db-shim.sql`, publishes no host port (nothing to
  collide with other sessions), and `suites` runs all twelve
  `scripts/test-*.sql` with a one-line summary that distinguishes a failed
  assertion from a crashed backend. **12/12 pass there as of 2026-11-14** —
  the first all-green run on the real engine. `scripts/db-isolated.sh` (native
  Postgres, 14.15 here) remains for machines without Docker; it shares the
  shim and also passes 12/12, but cannot reproduce PG17-only behaviour such as
  the segfault above. The old shim masking bug — a second `GRANT ALL ON ALL
  TABLES` pass after the migrations that undid their `REVOKE`s — is fixed in
  both: the shim's `ALTER DEFAULT PRIVILEGES` already covers tables the
  migrations create, so the second pass was redundant as well as harmful.
  `scripts/db-scratch.sh` (a copy *inside* the shared cluster) now refuses to
  run without `ALLOW_SHARED_CLUSTER=1`; every suite header says so.
- **Scratch names must be unique per session** (include the branch id). Two
  worktrees named `oak` once defaulted to the same `SCRATCH_DB` and wrote into
  the same copy, which produced false "already on the shared DB" reports.
- **Shared ports:** other sessions run isolated stacks on 3997/54397,
  3981/54381 and similar. Check `lsof` right before starting a private
  PostgREST, proxy or container; the scripts accept `STATIC_PORT` / `CDP_PORT`
  / `PROXY`.
- **Headless-Chrome harness:** always a fresh `--user-data-dir` (`mktemp -d`)
  and random ports — Chrome hands a second launch on the same profile to the
  running instance, so two sessions can silently share a browser. The local
  shell exports `EXPO_NO_DOTENV=1`, so `expo export` ignores `.env.local`
  unless the script sources it (`set -a; source .env.local`).
- **Seed note:** the demo host (`host@example.test`) is also an admin, and
  admins get premium analytics payloads. Clear `is_admin` inside a test
  transaction to exercise the free tier.
- Other users' profile data: never embed `profiles:user_id(...)` in a select —
  RLS returns null for anyone but the owner. Use `get_public_profile` /
  `get_profiles_display`.
- Tags: **[DB]** needs a migration · **[device]** needs a phone/simulator ·
  **[decision]** needs product input.

---

## Owner to-do (updated 2026-11-17, in order)

The work of 2026-11-17 is the event-journey review (R1–R5) and the "Preview
as attendee" feature (rehearsal Phases 1–5). Everything agent-doable is done
and verified (Done log, top entry). What is left needs you:

1. **Review and commit the working tree.** About 45 changed or new files,
   nothing committed. The Done log entries of 2026-11-17 are a natural commit
   map: review fixes (Batch A), prepared migrations, rehearsal Phases 1–5,
   and the harness viewport fix.
2. **Database:** follow `docs/MIGRATIONS_PENDING.md` → "OWNER — database
   actions remaining". Step 1 applies the 7 approved event-journey migrations
   (commands and verification included); then ask for Batch C.
3. **Two answers** that unblock the last designed features:
   - the post-event chat window (7 days recommended);
   - whether series reviews count toward the venue rating (yes recommended).

   See `docs/EVENT_JOURNEY_REVIEW_PLAN_2026-11-17.md` §5a "Batch D".
4. **Narrow-screen layout issues, newly visible** (see "Narrow widths and
   large text" under Low). They predate this work. They need a screen-by-screen
   visual pass, not a blind edit.
5. **Device pass**, now including the preview:
   - on a phone, open a **draft** as "Preview as attendee";
   - walk join / leave / waitlist and the Scenario panel;
   - open the chat preview with VoiceOver / TalkBack;
   - and the existing device list below.
6. **`npm install --save-dev axe-core`.** The WCAG engine pass in the A11y,
   HostUi and HostDashboard suites is still skipped without it.

## Owner to-do after the 2026-11-15 roadmap (in order)

Everything agent-doable is done and verified (see the Done log entry "final
regression pass"). What is left needs you:

1. **Review and commit** the working tree (44 changed or new files, nothing
   committed by the sessions — your call on how to split it; the Done log
   entries for phases 0-8 are a natural commit map).
2. **Hosted-database inventory** — `docs/MIGRATIONS_PENDING.md` item 0, the
   three read-only queries per hosted project. Prerequisite for any hosted
   apply; never done.
3. **Local comparison migration applied** — `20261115100000_get_events_compare.sql`
   is recorded locally, types regenerated, and isolated SQL suites pass 13/13.
   Nothing in the client depends on it yet (D7).
4. **Install `axe-core` as a dev dependency** (`npm install --save-dev axe-core`)
   so `suiteA11y` and `suiteHostUi` regain automated contrast and ARIA
   coverage; the agent environment cannot install packages.
5. **Device pass** — the list under "Device & manual testing", now including
   the font-scaling caps at 200 % and the compare tray / table on a phone
   (horizontal scroll vs. the Discover sheet's pan gesture, long-press
   selection on iOS and Android, VoiceOver / TalkBack reading order in table
   and cards mode).
6. **Decisions still open:** D3 (numeric price columns — nothing waits on it),
   J2 (optimistic RSVP), and the older product decisions listed below.

## Status at a glance (updated 2026-11-17)

**Final regression pass, 2026-11-17.** Everything ran in the foreground; no
database was touched except throwaway containers.

| Check | Result |
| --- | --- |
| Typecheck, app and admin | clean |
| Lint | 0 errors / 7 warnings (baseline) |
| Unit tests | **1,256 in 100 files** |
| Browser suites (all 20), fake backend | **1,277/1,285 checks pass** |
| SQL suites, throwaway PG17 container | **14/14**, both before and after applying the 7 prepared migrations |

**The 8 browser failures are pre-existing layout issues, not regressions.**
They became visible because the harness now renders at real 320 / 390 px
(see EJ-26):
- **HostUi, 7:** clipped category chip, Create's "Still needed" line, Manage
  event's tab labels, a checklist row.
- **HostDashboard, 1:** agenda rows at 1.6× text.

`suiteRehearsal` is **108/108**.

## Status at a glance (previous, 2026-11-15)

**Final regression pass, 2026-11-15** (all foreground, no database touched):
app + admin typecheck clean; app lint 0 errors / 7 warnings and admin lint 0 /
2 (both the pre-existing baselines); **1,124 unit tests in 92 files**; admin
`next build` 21 pages; **all 18 fake-backend browser suites green — 1,054
checks, 0 failures** against one shared export (`suiteA11y` without axe);
**13/13 SQL suites** on the isolated Postgres 17 engine (from the phase-8
validation the same day). Design-token audit: **1,034 literals in 91 files**
(was 1,025 — the nine new ones are in the compare and price components;
tracked under Low). No application defects were found in the pass itself;
one harness-process slip is recorded in the Done log.

### Earlier snapshot (2026-11-14)

A full documentation review ran on 2026-11-14; its findings, ranked, and the
step-by-step plan to close them are in
[`docs/REVIEW_AND_ROADMAP_2026-11-14.md`](REVIEW_AND_ROADMAP_2026-11-14.md).
Headlines, all verified against the code and the database:

- **Local migrations are applied.** All 123 migrations are recorded on the
  local DB, including the Nov 10 host-onboarding set, collections
  (`20261112100000`) and both playbook files (`20261113100000`,
  `20261113110000`) that this tracker previously listed as "prepared, NOT
  applied". Hosted databases remain unchecked — see Database migrations.
- **Generated types match the local schema.** On 2026-11-14 the output of
  `supabase gen types typescript --local` was compared byte-for-byte after the
  orphan-function migration; the removed function was the only difference.
- **Code health (final check 2026-11-14):** app + admin typecheck clean;
  **1,048 unit tests** in 86 files; app lint 0 errors / 7 warnings, admin 0
  errors / 2 warnings; admin `next build` 21 pages / 25 routes; `npm audit`
  34 (1 critical, 5 high) — unchanged since Nov 8. **Browser harness: 17
  suites, 1,009 checks, 0 failures.** SQL suites 12/12 on the Supabase image.
- **SQL suites:** **12/12** on the Supabase engine via
  `scripts/pg17-isolated.sh suites`, no crashes (the shim's blanket-grant bug
  that masked the twelfth was fixed on 2026-11-14).
- **Still the release blocker:** production map tiles (deferred by decision).

### Earlier snapshot (final review 2026-11-08)

- **Release blocker:** production map tiles (deferred by decision — no new
  map APIs for now).
- **UI/UX flow passes: all nine are done on web** (flows 1–9; see the list
  below and the Done log). What remains needs a device, an admin login, or a
  human comparing screenshots.
- **Waiting on you:** the device & manual testing list (offline on
  iOS/Android first); two product decisions left (approval mode with closed
  RSVPs; the not-started features backlog).
- **Collections (Phases A–F built 2026-11-12; migration applied, confirmed
  2026-11-14):** open items live in `docs/EVENT_COLLECTIONS_PLAN.md` §6 (Phase
  F defaults with alternatives), §7 (remaining decisions: rule editor vs.
  single column, full Interests merge) and §8 (the Phase G runbook — steps 1-2
  are done by the apply; 3-6 remain). **[decision]**
- **Test flake — FIXED 2026-11-14** (now `AT TIME ZONE 'UTC'` in the suite's
  `d` table). Original note: `scripts/test-categories-series.sql`
  builds its series dates with `(now() + interval '60 minutes')::date`, which
  uses the *session* timezone, while the fixture event is zoned `UTC`. On a
  cluster whose session zone is not UTC (a native Postgres, `America/New_York`
  here) the suite fails after ~19:00 local with `invalid_occurrence` at the
  `restore_occurrence` step. Reproduced without the collections migration.
  Supabase's container runs in UTC, so `scripts/db-scratch.sh` never sees it;
  `scripts/db-isolated.sh` now sets the database timezone to UTC. A durable
  fix is `(now() AT TIME ZONE 'UTC')::date` in the suite's `d` table.
- **Database:** `20261112100000_event_collections.sql` was validated on an
  isolated copy and has since been **applied** to the shared local database
  (recorded in `schema_migrations`; objects `collections`, `collection_items`
  and the nine collection RPCs verified present 2026-11-14). No session
  applies migrations to the shared database; the owner does. See
  `docs/EVENT_COLLECTIONS_PLAN.md` §8.
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
3. [~] **Notification → right screen** — **in-app half done 2026-11-14**
   (Done log → "flow 3"): `scripts/fake-backend-e2e/suiteNotifications.mjs`
   taps one notification of each of the 18 types and asserts the URL, 55/55.
   Found and fixed: the **push** path had its own older copy of the routing
   rule, so a tapped push for a host notice opened the attendee page instead
   of the hub; both paths now resolve through `utils/notificationRoute`.
   **Device** half still open: tapping a real push (warm + cold start) and
   per-channel delivery.
4. [~] **Report → moderation → outcome** — **app side done 2026-11-14**
   (Done log → "flow 4"): `scripts/fake-backend-e2e/suiteModeration.mjs`,
   34/34 — reporting an event and a chat message (one `complaints` row each,
   repeat shown as "already reported"), the reporter's `report_update`
   notification opening the event, and the outcomes a moderated user sees
   (suspended account refused on write but still reading; removed from a
   chat, told up front; suspended told so in chat). The **admin half still
   needs a manual login session**: acting on a complaint in the Next.js app
   and confirming the reporter's `report_update` actually arrives from a real
   trigger. The admin *build* is covered and was broken — see the Done log.
   *Trust & safety: a broken loop is invisible until someone needs it.*
5. [x] **Attendee journey on a busy event** — **done 2026-11-14**,
   `scripts/fake-backend-e2e/suiteAttendee.mjs` 14/14. The gap (after the
   event) is covered: an attended event that is over says so, points at the
   attendance history, credits "You attended", drops the RSVP controls and
   offers a review. Also the waitlist on a full event and the request flow on
   an approval event. No defects found.
6. [x] **Premium lifecycle as the host sees it** — **done 2026-11-14**,
   `scripts/fake-backend-e2e/suitePremium.mjs` 19/19, including the lapse
   that was never walked: a free host at the cap is told and offered the
   upgrade, one with slots left gets the form, an active premium host past
   the free cap is not blocked, a **lapsed** premium host is back on the free
   cap, and manage/plans render for active, lapsed and free (a lapsed plan
   reads "No Active Subscription"). No defects found.
7. [x] **Privacy as other people see you** — **done 2026-11-14**,
   `scripts/fake-backend-e2e/suitePrivacy.mjs` 15/15: a private profile
   reveals nothing; a public profile with "share future events" off hides the
   section entirely **and makes no request for it**, while turning it on
   shows it; a private attendee is never listed under their full name; a
   signed-out visitor can read an event without seeing personal state. No
   defects found.
8. [x] **Account management** — **done 2026-11-14**,
   `scripts/fake-backend-e2e/suiteAccount.mjs` 10/10: a notification
   preference toggle saves (one PATCH), the blocked list names who is blocked
   and unblocks through its confirm, and Delete account asks for confirmation
   and sends nothing until confirmed. Sign-out clearing stays covered by
   B9/F2. No defects found.
9. [~] **Visual consistency sweep** — **automatable half done 2026-11-14**,
   `scripts/fake-backend-e2e/suiteVisual.mjs` 68/68: 11 screens at **390 px
   and 1280 px**, asserting no horizontal overflow, a heading, real content
   (not blank/error) and brand-coloured switches, with 22 screenshots written
   for the side-by-side comparison. **What remains is the human half**:
   actually comparing those screenshots as a set for spacing, radii and type
   scale. Known items: the "teal switch" one is **stale — already fixed**
   (every `Switch` in the app sets a brand `trackColor`, now pinned by the
   suite); the onboarding toast overlap is still open and needs a design
   call — see "Needs a product decision". The design-token cleanup now has an
   inventory: `node scripts/design-token-audit.mjs`.

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
- [ ] **"More <type> near you" rail is always empty against the real DB (found
  2026-11-20, not fixed — outside Plan B's scope).** `components/MoreOfTypeRail.tsx:56,66`
  keeps only rows with `e.status === 'active'`, but `get_ranked_events` returns
  no `status` column (verified read-only on the local DB: 27 output columns,
  no `status`, no `timezone`), so every real row is `undefined` and dropped.
  The fake backend's ranked rows DO carry `status`, which is why `suiteCollections`
  passes. Fix (client, one line each): treat a missing status as active —
  the RPC only returns active, published, public events — as `utils/planB.ts`
  already does; then drop `status`/`timezone` from the fake's ranked rows so
  the suites stop masking it. `RankedEvent` (`types/database.ts`) also
  inherits `timezone` from `Event`, which the RPC does not return.
- [ ] **No component/e2e test layer** (logic-only vitest). Long-term.
- [ ] **[DB] Server-side "next date" ignores per-date exceptions (E-R1, the
  server half).** `get_ranked_events`, the saved/going lists, `get_user_calendar`
  and the three collection RPCs (`20261112100000:405,548,1019`) all compute
  `next_start` with `event_next_occurrence`, not
  `event_next_effective_occurrence`, so a skipped or moved date still ranks and
  renders as the next date unless the client's `useEffectiveNextDates`
  corrects it. Open since 2026-11-09
  (`docs/CATEGORIES_AND_SERIES_PLAN.md` l.704-708, l.827); the collections
  migration reused the plain helper and widened it.
- [ ] **[DB] `event_next_occurrence` S1 + S2 (found 2026-11-16).** S1: the v1
  monthly path adds `+N months` to an already-clamped candidate
  (`20261109130000:173-176`), so a 29th-31st series names e.g. 28 Mar instead
  of 31 Mar for the hours between a short month's occurrence and that month's
  end. S2: the v2 (`byWeekday` / `nthWeekday`) walk is capped at 800 days
  (`:145`) and returns the series start for very long intervals. Both low
  severity; client is correct. Plan: Roadmap B2 in
  [`docs/HOST_DASHBOARD_AND_RECURRENCE_REVIEW_2026-11-16.md`](HOST_DASHBOARD_AND_RECURRENCE_REVIEW_2026-11-16.md).
- [x] **Client recurrence walk truncated long series (R1-R3) — fixed
  2026-11-16.** `getNextOccurrences` stepped one day at a time with a 731-day
  cap: long intervals returned short lists, far-future starts returned `[]`,
  and "Ends after N times" failed past ~2 years. Now steps whole occurrences
  from `max(today, start)`; `tests/recurrenceHorizon.test.ts` adds
  regressions and an equivalence suite against the old day-by-day rule.
- [x] ~~**Runtime exposure of the `supautils` segfault**~~ — **closed
  2026-11-14, it does not exist.** Tested on an isolated Postgres + PostgREST
  stack: an anonymous `POST /rpc/get_user_collections` (anon has no EXECUTE)
  returns `401 / 42501` with no crash, and the same call as the
  `authenticator` role errors normally. The crash needs a superuser session,
  so it is confined to psql suites. No decision needed; no change to grants.

### Create & join UX review (2026-11-15)

Full review with file:line evidence in
[`docs/CREATE_AND_JOIN_UX_REVIEW_2026-11-15.md`](CREATE_AND_JOIN_UX_REVIEW_2026-11-15.md);
sequencing in `ROADMAP.md` → "Planned: event comparison + create/join UX".
Items already listed elsewhere in this tracker (font scaling, publish-preview
height, no bookmark on Discover cards) are not duplicated here.

**Phase 0 — done 2026-11-15** (see the Done log):

- [x] **J1** Join button had no in-flight state — no spinner, no `busy`, label
  unchanged for the whole round trip.
- [x] **J3 / C9** `utils/haptics.ts` was imported by two files, neither of
  them join or publish.
- [x] **J4** A successful "going" RSVP notified nothing and offered no next
  step.
- [x] **J7 / C5** Sub-44 px targets: the calendar / collection chips (~34 px,
  no hitSlop) and the age chips (36 px).
- [x] **J9** Approval mode gave no expectation of when the host replies.

**Phase 2 — done 2026-11-15** (see the Done log):

- [x] **C1** Publish / Preview / Save-as-draft were three stacked full-width
  buttons at the end of a nine-section scroll, inside the ScrollView. Now a
  sticky action bar with one primary.
- [x] **C2** No signal of which required fields remained until Publish was
  pressed. Now a live "Still needed: …" / "Ready to publish" line in the bar.
- [x] **C7** The three-line time-zone row led the Date & Time section. Now
  under Starts/Ends.
- [x] **C8** The first-event card repeated the three inline hints as a list.
  Now one sentence.

**Phase 3 — done 2026-11-15** (see the Done log):

- [x] **C3 / C4** Price and the tickets link sat behind the collapsed "More
  options" row with no "Free" shortcut. Now their own section on Create and
  Edit with a Free / Paid chip pair (`components/EventPriceFields.tsx`). The
  column stays free text; the structured version is decision D3 below.

**Open:**

- [x] **J2 — DECIDED 2026-11-17: keep Join non-optimistic** (many outcomes —
  going / requested / full / closed / waitlisted — would often roll back; J1's
  in-flight state covers the wait). Original note: Joining is not optimistic while saving is — two adjacent controls
  on the same screen behave differently under latency. Needs a decision
  (optimistic RSVP vs. accept the wait) rather than a fix. **[decision]**
**Phase 7 — done 2026-11-15** (see the Done log):

- [x] **J5 / J6** "You're going" replaces "Event Joined"; Interested is a
  labelled pill.
- [x] **J8** Save from Discover cards (also closes the Low item "Discover/search
  cards have no bookmark" below).
- [x] **C6 withdrawn** — the Cover badge and "Make cover" action already
  existed in `components/ImagePickerButton.tsx`; only Create's hint was
  misleading, and it now names the control.
- [x] **C10, targeted:** `FontScaleCaps` applied to single-line controls,
  chips, list rows, the compare surfaces, Create's action bar and the join
  bar. Device verification still pending (web reports `fontScale` 1).

### Event-journey review (2026-11-17)

Findings with file:line evidence and repro output in
[`docs/EVENT_JOURNEY_REVIEW_2026-11-17.md`](EVENT_JOURNEY_REVIEW_2026-11-17.md);
phases and status in
[`docs/EVENT_JOURNEY_REVIEW_PLAN_2026-11-17.md`](EVENT_JOURNEY_REVIEW_PLAN_2026-11-17.md)
§0. **All review phases done 2026-11-17.** Batch A is fixed. Batch B is **7 prepared migrations, NOT applied**, in `supabase/prepared/2026-11-17_event_journey/` (README = apply runbook; #5 and #6's notice wait for an OK). Batch C, the client follow-ups, comes after the apply.

- [~] **EJ-1 [DB] Suspended accounts can RSVP to single series dates.** *Client half fixed 2026-11-17 (Batch A2): the per-date chips now have `handleRsvp`'s guards. Server guard = Batch B1.*
  `set_occurrence_rsvp` (`20261109150000:117`) checks `user_is_banned_from_event`
  but not `user_is_banned`; its siblings `join_event_with_capacity` and
  `join_event_waitlist` refuse suspended accounts. Reproduced in isolation: the
  row is written and counts toward the date's capacity. Contradicts the
  2026-11-08 "suspended lose all writes, server-side" decision. Client half:
  `toggleDateRsvp` (`screens/EventDetail.tsx:192`) lacks `handleRsvp`'s
  preview/offline/ban guards.
- [x] **EJ-2 Recurring series are never "Happening now".** *Fixed 2026-11-17 (Batch A1): `occurrenceInProgress` (exceptions applied, midnight-crossing dates found); `isEventInProgress`, the host phase, the playbook stage and Calendar rows use it; a live series keeps Postpone/Reschedule/Notify. Tests: `tests/seriesInProgress.test.ts`.* `isEventInProgress`
  is one-off only (`utils/eventStatus.ts:44`), so the event page, My Events,
  Joined, Profile, Calendar and the host phase model never show a series as
  live, while Host Dashboard does (`utils/hostDashboard.ts:142,165`). The host
  checklist drops from "day of" to "lead-up" mid-session, because the next start
  has moved to the following date. No unit test covers `isEventInProgress`.
- [x] **EJ-3 "Write a review" is shown to people the server refuses.** *Fixed 2026-11-17 (Batch A4): eligibility asked with the reviews load; ineligible viewers see "Reviews open once you've attended one of this host's events."; a late RLS refusal shows the same copy and keeps the draft. Browser: `suiteAttendee` A1 (now strict) + new A5. Series nuance stays [DB].*
  `EventDetail.tsx:1881` offers it to every signed-in non-owner;
  `user_can_review_business` requires a started "going" RSVP; the person sees
  "Failed to submit review" after writing it. Client-only fix: the function is
  callable as an RPC. Series nuance (L, [DB]): joining a series whose first date
  is past makes you eligible at once.
- [x] **EJ-4 Chat screen re-implements the access rule.** *Fixed 2026-11-17 (Batch A5): all three sites use `eventChatAccess`; off mode says "Chat is off". Browser: new `suiteModeration` R6.*
  `app/event-chat/[id].tsx:212,495,671` hard-code `rsvp_count >= 2`; in **off**
  mode an attendee reached via an old chat notification sees "Waiting for one
  more attendee before the chat opens". Use `utils/eventChatAccess.ts`.
- [x] **EJ-5 Host with a "going" RSVP gets no chat row** *Fixed 2026-11-17 (Batch A6): "Manage chat" gated on ownership alone.* on their event page
  (`EventDetail.tsx:1513` hides by `isOwner`, `:1578` by `user_rsvp`).
- [ ] **EJ-6 / EJ-8 (latent, note only):** an owner's own join in approval mode
  becomes a `requested` row (reproduced); reminders/cancel notices don't exclude
  a host's own RSVP. No UI path reaches either today.
- [~] **EJ-10** *Interim copy fixed 2026-11-17 (A8): the row now reads "Open your event's page (you'll see it as its host)"; the real fix is the rehearsal feature.* ManageEvent "Preview page" said "See the event the way attendees
  do" but opens the owner view (`screens/ManageEvent.tsx:1258-1263`). Fixed by
  `docs/EVENT_REHEARSAL_PLAN.md`; else change the copy.
- [~] **EJ-12 [DB] Leaving after the event ended is allowed.** *Client half fixed 2026-11-17 (A3): Leave re-checks "ended" at tap time for a going RSVP. Server half = Batch B2.* The `rsvps` DELETE
  policy is ownership-only (`20261106160000:501-506`); UI freezes but a stale
  page or API call deletes. Reproduced: attendance erased, host told "Someone
  left your event", the waitlisted person told **"A spot opened up"** for a
  finished event.
- [~] **EJ-13 Today's finished series session stays joinable.** *Client fixed 2026-11-17 (A1): `upcomingDateRows` drops finished dates and flags the running one ("· happening now"). Server half (compare the occurrence end) = Batch B10.* Non-strict
  `listOccurrences` + `canToggle` without an end check (`EventDetail.tsx:1704`);
  server accepts `p_date >= today`. Reproduced an hour after the session ended.
  Fix together with EJ-2.
- [~] **EJ-14 [DB] Moving a series' final date past `endDate`** *Interim client guard 2026-11-17 (A7): the move picker refuses any date past the series end and explains why. Server extend-or-refuse = Batch B5 (recommendation awaiting owner OK).* (allowed by
  `reschedule_occurrence` and `MoveDateModal`) makes the series read ended on
  the moved session's day: RSVPs closed, ended notice, no chat row, no reminder.
  Reproduced. Extend `endDate` with the move (recommended) or refuse.
- [~] **EJ-15 "Running late" notice.** *Dialog audience copy fixed 2026-11-17 (A8); notice wording = Batch B9.* Extending only the end with people going
  sends "Event rescheduled — … now starts <unchanged time>" (reproduced). Edit's
  dialog also names savers (not notified) and omits the waitlist (notified).
- [x] **EJ-17 Host day-of / post-event notices skip series — DONE 2026-11-20.** Per-occurrence notices applied (`20261119120000`); Settings copy restored to cover series ("…each event starts, including every date of a series" / "After each event or series date…"). *Earlier: copy fixed 2026-11-17 (A8): Settings said "one-off event … (not yet for series)"; per-occurrence notices later [DB].* (`is_recurring = false`,
  `20261113110000:47,80`) while Settings says "each event".
- [ ] **EJ-19 [DB] Date-only attendees get no lifecycle notice and no chat.**
  Cancel, postpone, reschedule, per-date cancel/move/restore and announcements
  all build audiences from `rsvps` only; chat access needs a series RSVP.
  Reproduced: the host cancelled the one date sam signed up for — sam was not
  told and her row stays "going". Reminders do include them. Fix with one
  shared audience helper (also closes EJ-21).
- [ ] **EJ-20 [DB] Changing a series pattern is silent.** The time-change guard
  and the update notice compare only start/end/place; Edit sends the pattern as
  a plain update without its confirm dialog. Reproduced: dates dropped, nobody
  notified, a date-only RSVP pruned.
- [ ] **EJ-21 Notice audiences disagree** — savers hear cancel and per-date
  changes but not postpone/reschedule; the waitlist cancel trigger ignores the
  `event_update` opt-out.
- [ ] **EJ-22 [DB] Chat notices ignore chat access.** Every `going` row is
  notified; an announcement produced both `host_announcement` and `chat_message`
  for an attendee who couldn't open the locked chat (reproduced).
- [ ] **EJ-23 External calendar entries go stale after a reschedule** — nothing
  on the event page offers re-adding. *Server half prepared (migration 3,
  `events.rescheduled_at`); the banner is Batch C5.*
- [x] **EJ-25 Waitlist offered where the server refuses it** (found 2026-11-17,
  rehearsal Phase 3). *Fixed 2026-11-17:* a full event whose host switched the
  waitlist off (`waitlist_off`) or that takes requests (`approval_required`)
  showed "Join the waitlist", then the refusal. `deriveEventViewer` now requires
  an open waitlist to join (leaving still works). Tests: `tests/eventViewer.test.ts`,
  `suiteAttendee` A8.
- [x] **Opportunity — BUILT 2026-11-17** (owner agreed): the event page has no same-day cue ("Today · starts in
  2 h") — "Day of" and "Days before" look identical to an attendee. Small
  product improvement, surfaced by the rehearsal preview. **[decision]**, optional.
- [ ] **EJ-24 [DB] Events attended only by date appear in no Joined list**
  (found 2026-11-17): `get_user_going_events` reads `rsvps` only. Not in the
  prepared set.
- **Prepared, NOT applied (2026-11-17), the server halves of:** EJ-1 + EJ-13
  (migration 1), EJ-12 (2), EJ-19/20/21 + EJ-15/23 (3), EJ-19 chat + EJ-22 (4),
  EJ-14 (5, **needs your OK**), EJ-18 (6, **notice needs your OK**), EJ-16 (7).
  The checkboxes above stay open until these are applied and Batch C ships.

### Test tooling (2026-11-17)

- [x] **EJ-26 The browser harness never rendered narrower than 500 px.**
  Headless Chrome clamps `--window-size` to a minimum width of 500, so every
  "320 px" and "390 px" check in every suite (HostUi, HostDashboard, Visual,
  A11y, Compare, …) actually ran at 500 px. Measured: `innerWidth` was 500 for
  both. **Fixed:** `harness.mjs` now sets the viewport with
  `Emulation.setDeviceMetricsOverride`, which isn't clamped. Re-measured at
  320 / 390 / 1280. Earlier "passes at 320 / 390 px" in this file and in the
  2026-11-14 review should be read as 500 px.

### Narrow widths and large text — newly visible 2026-11-17 (pre-existing)

Found by the first real 320 / 390 px runs, after EJ-26. None of these
components changed in the 2026-11-17 work. They need a screen-by-screen
visual pass with screenshots (`scripts/fake-backend-e2e/suiteHostUi.mjs`,
`suiteHostDashboard.mjs` H15).

- [ ] **Category chip:** "Markets & Pop-ups" is clipped on the publish preview
  card and the published sheet, at 390 and 320 px.
- [ ] **Create's sticky bar:** "Still needed: Title, Description, Catego…" is
  truncated at 320 px. The list of missing fields is the useful part.
- [ ] **Manage event's tab labels:** "Overview", "Attendees" and "Settings"
  are clipped at 320 px.
- [ ] **Publish preview checklist:** "Add a cover photo" is clipped at 320 px.
- [ ] **Host dashboard agenda rows at 1.6× text, 390 px:** the time line ("12:00
  PM UTC 7:00 AM your time…") and "4 people on the waitlist" clip sideways.
- [x] **Fixed while finding them:**
  - the event page's locked-chat reason ("Join the event to unlock the chat")
    was cut to one line at 320 px; it may now wrap to two;
  - the preview banner squeezed its title to one word per line at 320 px; its
    controls now wrap as a group.

### Low (worth doing when nearby)
- [ ] **Design tokens:** measured 2026-11-15 with
  `node scripts/design-token-audit.mjs` — **1,034 literals in 91 files**:
  spacing 275 on-scale + 579 off-scale, radius 45 on-scale + 135 off-scale.
  (2026-11-14: 1,025 in 87 files; the nine added since are in the new
  compare and price components — `components/compare/*`, `CompareTray`,
  `EventPriceFields` — mostly `paddingHorizontal: 18` and `gap: 6`.)
  On-scale values are a mechanical swap to the token; off-scale ones need a
  judgement call. Worst files: `app/(tabs)/profile.tsx` (87),
  `app/(onboarding)/index.tsx` (85), `screens/EventDetail.tsx` (58),
  `screens/Settings.tsx` (52). Still to be done screen by screen with
  before/after screenshots — a blind codemod would shift layouts. The audit
  script exists so the number can only go down.
- [ ] **Offline leftovers (minor):** chat `markRead` isn't queued offline
  (badge clears on the next open); discarding a "waiting" chat message is
  local-only; edit drafts are keyed to `updated_at`; picked image paths can
  be purged by the OS before an offline publish retries.
- [ ] **`axe-core` is not installed**, so the WCAG A/AA pass in
  `suiteHostUi` (`AXE=<path>`) and `suiteA11y` cannot run. Everything else in
  those suites runs: labels, 24 px floor, 44 px targets, headings, overflow,
  clipped labels, runtime errors. `npm install --save-dev axe-core` was
  refused by the agent environment's permission policy on 2026-11-13 — it
  needs to be run by the owner. Until then, no automated colour-contrast or
  ARIA-semantics coverage.
- [ ] **The publish preview is inherently tall on a phone.** Reduced in
  playbook P7+ (one-line checklist, two-up secondary actions, scroll
  indicator restored — ~155 px reclaimed, measured), but card + details +
  actions still exceed a 320 px-wide phone's 425 px viewport, so the detail
  card stays below the fold. A real fix is a redesign (segmented view, or a
  smaller preview card), not another reorder.
- [x] ~~Discover/search cards have no bookmark~~ — **done 2026-11-15**
  (roadmap phase 7, J8): a bookmark on every Discover card; search results
  reuse the same card.

#### Re-opened 2026-11-14 — still open in code, dropped by the Nov 8 rebuild

Found by re-reading `docs/archive/ISSUES-history-2026-10-30_to_11-07.md`
against the current code. Archive line numbers in brackets.

- [x] **Offline gate covers one screen** — **fixed 2026-11-14.** `blockedOffline`
  now guards all 15 host actions in `screens/ManageEvent.tsx` (before any
  confirm dialog, so nobody confirms something that cannot happen), the 8
  Settings saves/toggles, the 3 chat-moderation actions, and review responses
  via `components/ReviewCard.tsx` (one place, covers both the event and venue
  pages; the draft stays in the editor instead of an early resolve reading as
  saved). Queued kinds (save, follow, notification read, collection pin) are
  untouched. Original note: `runOrQueue` is used only in
  `screens/BusinessDetail.tsx:54,184`; ManageEvent, Settings saves, review
  responses and chat moderation had no offline pre-check. [A:1019]
- [x] **Discover reloads everything on any profile change** — **fixed
  2026-11-14.** The effect now keys on `profile?.id`, `profile?.lat`,
  `profile?.lng` — the only fields `loadInitialData` reads — so a focus
  refresh, a Settings save or an onboarding flag no longer refetches
  categories + events, re-requests location permission and recentres the map.
  Original: `app/(tabs)/discover.tsx:219-220` ran it from a `[profile]`
  effect. [A:604]
- [ ] **`get_event_host_overview.chat` lacks `chat_mode` / `open_policy` /
  `pinned_message_id`**, so the host hub makes a second call. [A:886] **[DB]**
- [x] **Admin Users search needs a full UUID** — **fixed 2026-11-14.** A pasted
  id prefix (4+ hex digits, dashes optional) becomes a uuid range
  (`uuidPrefixRange` in `SearchForm.tsx`, `.gte/.lte` on `id`) — Postgres has
  no LIKE on uuid, so this avoids a cast PostgREST would reject. Unit-tested
  (`tests/adminSearch.test.ts`); not clicked through against a real admin
  login (owner). [A:1116]
- [x] **FAQ "Last updated" is hardcoded** — **fixed 2026-11-14.** Now a
  `FAQ_LAST_UPDATED` constant at the top of the file (set to the file's last
  content change, 2026-11-08) formatted in the device locale; bump it when the
  content changes. [A:146]
- [x] **"Change password" shown to OAuth-only accounts** — **fixed 2026-11-14.**
  Settings loads `authService.hasPasswordIdentity()` and the row reads "Set a
  password" with a one-line explanation when the account has no email
  identity; the reset screen already skipped the current-password step for
  those users, so only the label was wrong. [A:285, A:333]
- [x] **Venue page has no "Create event" CTA for the owner** — **fixed
  2026-11-14.** An owner with nothing upcoming now sees the Upcoming Events
  section with a short note and a "Create an event" row to the Create tab;
  visitors still see no section, as before. [A:481]
- [ ] **Contrast / scaling leftovers from the theme audit:** `Colors.success`
  used as text (`components/DiscoverEventCard.tsx:225`, `screens/EventInsights.tsx`),
  `Colors.warning` stars, `text.disabled` placeholders, `border.light` as a
  sole input boundary; **zero** `maxFontSizeMultiplier` / `allowFontScaling`
  anywhere (large-font never tested); reduce-motion honoured in 2 of 9
  animated files. The Nov 8 pass fixed three *other* contrast items.
  [A:1408-1429]
- [ ] **`useScreenReaderEnabled()` is always true on web** — react-native-web's
  `AccessibilityInfo.isScreenReaderEnabled()` resolves `true` unconditionally.
  Harmless for its timing use in `components/AppToast.tsx`; anything that
  would change *layout* on it must also check `Platform.OS !== 'web'` (done in
  `screens/CompareEvents.tsx`). Documented on the hook 2026-11-15.
- [ ] **Realtime still carries the anon key while a session is stale** —
  `utils/sessionGate.ts:52` never blocks realtime by design. [A:1007]
- [ ] **Maestro airplane-mode flows were never written** (OFFLINE_PLAN §7);
  `.maestro/` has only `calendar.yaml` and `smoke.yaml`. [A:1271-1275]
- [x] **Venue "Upcoming" count included finished recurring series — fixed
  2026-11-16 (Roadmap B5).** `getBusinessEventsCount` kept every
  `is_recurring` row forever, so the stat disagreed with the list under it,
  which drops ended series with `hasEventEnded`. The count now fetches the
  recurring rows' timing fields (bounded at 200) and subtracts the finished
  ones using that same helper, so the end date is judged on the event's own
  calendar day. **Also fixed in the same place:** the stat filtered
  `status = 'active'` with no `publish_state` filter, counting unpublished
  drafts and omitting postponed events; it now mirrors the list (published,
  active or postponed). Tests: `tests/businessEventsCount.test.ts`.
- [ ] Profile "Created" count (`app/(tabs)/profile.tsx:136`) still counts
  every event ever — scope `'all'`, including drafts, past and cancelled.
  Left as is: the label is "Created", not "Upcoming". Giving it an
  upcoming/past split is the small feature already listed below under
  business-mode profile.
- [ ] Nitpicks: stale error text "status can only be changed through
  cancel_event" (`20261102110000:161`); `allow_capacity_shrink` uses `'on'`
  where sibling flags use `'true'` (`20261103120000:182,224`); `refetchAll`
  identity churn (`screens/ManageEvent.tsx:378-386`). [A:888]
- [ ] Reviews and Followers lists have never been exercised in a browser run
  (needs a host account); Followers rows offer no actions. [F:108-109, F:127]
- [ ] Going-reminder window is ±5 min, so two missed pg_cron runs lose the
  reminder; widening to ±10 was suggested. [F:118-119] **[DB]**
- [ ] Public "attended" count as an opt-in profile setting (today
  `attended_count` is owner-only). [F:48] **[decision]**
- [ ] Business mode profile: "Created" counts every event ever (no
  upcoming/past split), no rating card (the analytics screen already
  computes the venue average). Small features.
- [x] **Edit event does not scroll to a failing field.** Fixed 2026-11-13 in
  playbook P7: `sectionY` anchors, `EDIT_FIELD_SECTION` and
  `scrollToFirstError` ported from Create, so a refused Save scrolls to the
  first failing group instead of leaving the screen unchanged. The screen
  reader announcement it already had is kept.
- [x] **`formToPreviewEvent` hardcoded `publish_state: 'published'`.** Fixed
  2026-11-13 in playbook P7 by removing the lie rather than documenting it:
  nothing in the preview path reads the field (the doc comment's claim about
  the Event Detail header was stale — that screen uses
  `utils/eventPreview.ts`), so an unsaved event is now `'draft'`, which is
  what it actually is. The override in `create.tsx` is gone with it.
- [x] **`previewGaps` folded into the checklist.** Done 2026-11-13 (playbook
  P7): the helper, its call site and its tests are deleted; the publish
  preview shows the checklist only. The Create form is unreachable without a
  host profile, so the fallback was dead. Original note: with a host profile loaded,
  the publish preview shows the checklist instead; the gaps line renders only
  when no profile is available. **Assigned to playbook P7**
  (`docs/HOST_EVENT_PLAYBOOK_PLAN.md` §8): fold it into the checklist and
  delete the helper if nothing else needs it.

Moved elsewhere: reminder time zone → Deferred DB (needs a migration);
Google-provider items → under the release blocker (same decision); WebView
`originWhitelist` → device list.

---

## Database migrations

### Database state (verified read-only, 2026-11-14)

**All 121 migration files are applied and recorded on the shared local
database**, and nothing is recorded that is not a file. Reproduce with:

```sql
select count(*) as applied, max(version) as latest
  from supabase_migrations.schema_migrations;   -- 121 | 20261113110000
```

Spot-verified objects from the most recent sets: `collections`,
`collection_items`, the nine collection RPCs, `event_host_playbook`,
`businesses.host_day_of_notice` / `host_post_event_notice`, an opt-in
`send_host_event_notices()`, `profiles.intent`, `events.event_type`,
`businesses.archived_at` + `archive_business()` / `reopen_business()`,
`categories.synonyms`, and a single `create_event_with_limit_check` overload
carrying `p_client_request_id`. Cron jobs `event_reminders` (*/5) and
`host_event_notices` (*/15) are active.

| Hosted / production | **Never checked.** No record exists of which migrations any hosted project has. Treat as unknown until someone runs the query above against it. |
| --- | --- |

**The post-apply follow-ups were never done** and are the substance of Step 2
in the review doc:

- [ ] `npm run backend:types` — not run since Nov 9; the file is ~510 lines
  behind the live schema and carries three HAND-EDITED headers.
- [ ] Drop the pre-migration client fallbacks that the applies made dead:
  the `p_client_request_id` ladder and `createKeyParamUnsupported`
  (`services/events.ts:26-32,352-370`), `preferredBoostUnsupported`. Decide
  one consistent rule for the `MISSING`-set degradations in
  `services/collections.ts:33`, `services/eventPlaybook.ts:24`, calendar and
  host tools (they also cover a hosted project behind on migrations).
- [ ] `npm run test:backend` — its collections block has printed SKIP until
  now and has never executed.
- [ ] The manual passes the plans deferred "until after apply":
  `docs/EVENT_COLLECTIONS_PLAN.md` §8 steps 3-6 and
  `docs/HOST_EVENT_PLAYBOOK_PLAN.md` P8.

### Applied 2026-11-13 (playbook P5/P6)

- [x] `supabase/migrations/20261113100000_event_host_playbook.sql` —
  per-event host checklist state (`event_host_playbook` + two merge RPCs;
  playbook P5). Validated on a throwaway cluster with
  `scripts/test-event-playbook.sql` before it was applied; idempotent on
  re-apply. The app works with or without it — without the table, ticks stay
  on the device.
- [x] `supabase/migrations/20261113110000_host_notice_optin.sql` — makes the
  two host cron notices **opt-in** (playbook P6). 20261110160000 gates them
  on `businesses.notifications_enabled`, which defaults TRUE, so applying
  that file alone would have started pushing to every existing host unasked.
  This adds `host_day_of_notice` / `host_post_event_notice` (both DEFAULT
  false) and re-creates `send_host_event_notices()` to require them. Applied
  after 20261110160000, as required. Validated with
  `scripts/test-host-notice-optin.sql`. **Live consequence:** the Settings
  switches are now visible and the `host_event_notices` cron is active, but
  no host has opted in (0 of 1 businesses), so nothing is being sent. The
  switches have never been exercised against a real backend.

### Applied 2026-11-10 (host onboarding Stages 1–7)

Eight files, `20261110100000` … `20261110170000`, recorded on the shared DB.
This tracker never mentioned them in any state — the gap is closed here.
Details per stage in `docs/HOST_ONBOARDING_PLAN.md` §10-§20.

- [x] `…100000_profile_intent` · `…110000_host_setup_foundations`
  (`host_type`, `location_kind`, `host_terms_current_version`,
  `onboarding_completed_at`) · `…120000_event_type_presets`
  (`events.event_type`) · `…130000_host_onboarding_status`
- [x] `…140000_host_trust_foundations` (`standing`,
  `host_verification_requests`, `admin_set_host_standing`) ·
  `…150000_publish_requires_guidelines` · `…160000_host_lifecycle_notifications`
  · `…170000_stop_hosting` (`archived_at`, `archive_business`,
  `reopen_business`)
- **Behaviour changes now live:** publishing requires the host to have
  accepted the current guidelines (the client catches `guidelines_required`
  and retries after Accept), and archived hosts cannot publish. Two
  regression suites broke on exactly this and were repaired 2026-11-14
  (`scripts/test-attendance-rpcs.sql`, `scripts/test-host-lifecycle.sql`).

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
`scripts/test-categories-series.sql` (rollback-only, ASSERT-based); see the
header. Run it in a throwaway isolated environment, never against the shared
cluster (Ground rules).

### SQL suite status (2026-11-14)

All twelve `scripts/test-*.sql` suites were run against the stack's own
Postgres image in a throwaway container loaded with all 121 migrations + seed.
**11 pass, no crashes.** Three were repaired in that pass:

- `scripts/test-collections.sql` — asserted an anon refusal by *calling* the
  function, which segfaulted the cluster (Ground rules); now checks
  `has_function_privilege`. First time this suite has ever completed on the
  Supabase engine: 15/15 blocks.
- `scripts/test-attendance-rpcs.sql` — accepts the host guidelines
  (`20261110150000`) inside its rolled-back transaction; back to 49/49.
- `scripts/test-host-lifecycle.sql` — opts its fixture host into the notices
  that `20261113110000` made opt-in.

The twelfth, `scripts/test-event-insights.sql` `[5.2]`, fails **only** in a
shim-built isolated environment, whose blanket `GRANT ALL` undoes the
migration's `REVOKE`; it passes against the real schema. Not a defect — the
shim is the thing to fix (Ground rules).

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

- [x] **[decision]** **EJ-7 Chat after an event ends — DONE 2026-11-20.** Server
  half `20261118150000` (applied; 7 days, owner-confirmed 2026-11-18); client half
  built 2026-11-20: `chatPostingWindow` / `CHAT_AFTER_END_DAYS` in
  `utils/eventChatAccess.ts`, the event page keeps the chat row after the end
  ("Chat open until <day>" → "Chat closed — you can read the history"), the chat
  screen says "This chat closed on <day>". Verified: unit tests, `suiteLifecycle`
  L4/L6. The original entry follows. **DECIDED 2026-11-17:** open
  for a while after the end, not forever. Proposed: 7 days of posting, then
  read-only history (design D1 in `docs/EVENT_JOURNEY_REVIEW_PLAN_2026-11-17.md`
  §5a; window length to confirm). Original note: **EJ-7 Chat after an event ends.** Open on the server
  indefinitely (`user_can_access_event_chat` has no time condition), but the event
  page removes the entry row once ended (`EventDetail.tsx:1513`), so only old
  notifications reach it. Cancelled events state the chat stays open. Options: keep
  open and show the row (recommended, client-only), read-only after N days [DB], or
  close at the end. See `docs/EVENT_JOURNEY_REVIEW_2026-11-17.md` EJ-7.
- [x] **[decision]** **EJ-9 — DECIDED 2026-11-17:** reviews per venue; per event
  only for recurring series (design D2, same doc; whether series reviews also
  count toward the venue rating to confirm — recommended yes). Original note:
  **EJ-9 Reviews are per business, not per event.** Confirmed
  as the design (one row per user × business; a second event's review edits the
  first). Is that the product, or is event-level feedback wanted (new feature)?
- [ ] **[decision]** **EJ-16 What "attended" means for a series.** Today it is
  series-level and only once the series has ended, so an open-ended weekly series
  is never credited, and per-date "Can't go" is ignored. Recommendation: count per
  occurrence (each past date a goer didn't opt out of). Check-in would supersede it.
- [ ] **[decision]** **EJ-18 Pending requests after the event ends** — part of the
  existing approval-mode decision below: `host_review_rsvp` refuses after the
  end and the requester is never told (reproduced). Suggested: auto-decline with
  a notice when the event ends.
- [ ] **[decision]** **EJ-19 chat for date-only attendees** — should someone going
  to one date of a series read/post in its chat? Recommendation: yes, on the
  date(s) they're going.
- [ ] **[decision]** **Toasts over the onboarding progress label.** An error
  toast is positioned at `insets.top + 16` and can cover the "Step N of 6"
  label during the onboarding flow (flow 9). Fixing it is a design call, not
  a bug fix: either move toasts to the bottom inside full-screen flows, or
  shift the toast band down globally, or move the step label. Changing it
  blind would contradict the reviewed onboarding behaviour (a failed step
  save deliberately shows an error toast, pinned by 57 onboarding checks).
- [ ] **[decision]** Approval-mode events when RSVPs are closed (same trigger
  in `20261103170000`): should pending requests still be approvable after
  the host closes RSVPs? Genuinely product-specific — left open.
- [ ] **[decision]** Features not started: invite-only events
  (`event_invites`), all-day/multi-day events, "My reports" screen, dark
  mode, real billing periods, real view/share analytics.
- [ ] **[decision]** Host tools Phase 4, never started and previously missing
  from this list (`docs/HOST_TOOLS_PLAN.md` §11): attendee **check-in + QR**
  (`checked_in`, `host_checkin_attendee`), **CSV export**
  (`export_event_attendees`), **`event_sections`**, and **co-hosts**
  (`business_members`, also blocking "transfer of ownership" in host
  onboarding Stage 7). The rest of that phase shipped elsewhere: event-type
  presets in `20261110120000`, insights in `20261104100000`, weekday
  recurrence and occurrence exceptions in the Nov 9 set.
- [ ] **[decision]** Collections, before any further work there
  (`docs/EVENT_COLLECTIONS_PLAN.md` §6-§7): rule editor vs. collapsing
  `category_ids[]` to a single column, the full Interests merge, and the four
  Phase F defaults. These were meant to be settled *before* the migration was
  applied; it is applied, so they are now overdue rather than blocking.
- [ ] **[decision]** Discovery modes: all six choices in
  `docs/DISCOVERY_MODES_PLAN.md` §6 (names, novelty weighting, default
  radius, whether to ship "Just added" degraded or wait for the server sort,
  Surprise-me location prompt). Nothing is built.
- [ ] **[decision]** Event comparison, the six choices in
  `docs/EVENT_COMPARISON_PLAN.md` §7. Foundations (phase 1) are built and are
  decision-free. By the roadmap phase that needs each: phase 4 wants **D1**
  (session-only tray) and **D5** (cap of 4); phase 5 wants **D4** (large
  font forces cards mode); phase 6 wants **D2** (is `/compare?ids=…`
  shareable, given unlisted events) and **D6** (a third control in the
  Discover header). **All five were decided by the owner on 2026-11-15:** D1
  session-only, D5 cap of 4, D4 yes (toggle stays), D2 yes (minus unlisted
  events the opener could not see), D6 long-press only. **D3** (numeric
  `price_min` / `currency` / `is_free` columns, **[DB]**) decides whether the
  free-text price parser and phase 3's Free chip are permanent or interim;
  nothing waits on it.
- [x] **[decision]** Categories D1 (`docs/CATEGORIES_AND_SERIES_PLAN.md` §7
  Phase D): whether a future start date that is not itself an occurrence
  should be returned as the next date. **Decided 2026-11-16 (owner): the next
  real occurrence** — never a date the event does not happen on. Ratifies the
  shipped client and local-migration behaviour; pinned by
  `tests/recurrenceHorizon.test.ts` and by the empty `KNOWN_START_DIVERGENCE`
  in `tests/recurrenceParity.test.ts`.

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
never exposed, so the hash isn't reversible in practice); rewriting the
"prepared, NOT applied" status headers in the 32 applied migration files
(EJ-11, 2026-11-17 — history comments only; the Ground rules' verify query is
the authority on applied state).

---

# Done log

## 2026-11-17 — rehearsal Phase 5 + final regression pass

Client and test code only. No database except throwaway containers, and no
background processes. One batch did overrun the tool's time limit and was
auto-moved to the background; it was stopped at once and the rest ran one
suite per command. No orphaned processes of this session remained. A running
suite seen at the time belonged to another session's `oak` worktree and was
left alone.

**Phase 5 (the agent-doable part):** `suiteRehearsal` V20–V22 check the
banner, the open Scenario panel and the chat preview at real 320 / 390 px and
at 1.3× / 1.6× text:
- no horizontal overflow and no clipped text;
- every control named, at least 44 px, and inside the screen.

Writing them exposed **EJ-26**: the harness clamped every viewport to
500 px. It is fixed in `harness.mjs`. At true widths, two things were fixed:
- the preview banner's cramped title (its controls now wrap as a group);
- the event page's truncated locked-chat reason.

Seven HostUi failures and one HostDashboard failure were flagged as
pre-existing (above). Left for the owner: the axe engine pass (`axe-core`
not installed) and the device pass with a draft.

**Final regression:** see "Status at a glance". Typecheck (app and admin)
clean, lint at baseline, 1,256 unit tests. Browser: 20 suites, 1,277/1,285
(the 8 are the flagged layout issues). SQL: 14/14 before and after the 7
prepared migrations, re-validated after their header edits.

**Docs:**
- `docs/MIGRATIONS_PENDING.md` now opens with the owner's ordered database
  runbook.
- Plan, rehearsal plan and this tracker are updated.

Nothing is committed.

## 2026-11-17 — rehearsal Phase 4 + the owner's decisions

Client code only; no database access; nothing in the background.

**Phase 4:**
- A read-only chat preview: the attendee's view, no moderation, nothing
  sent (no read marker, presence, typing or reports).
- Entry points: the checklist item "Walk through it as a guest" (ticks
  itself) and "Preview as a guest" on the published sheet.

**Closed in passing:**
- A preview gap where "Add to collection" opened the real, writing,
  collections sheet.
- My banner's direct `lucide-react-native` import, against the repo's icon
  rule.

**Decisions:**
- **Applied in the docs:** #5 and #6's notice are marked approved in the
  prepared folder; J2 is closed (keep Join non-optimistic).
- **Built:** the same-day cue (`startsSoonLabel`, 4 tests).
- **Designed as Batch D:** EJ-7 (chat open 7 days after the end, then
  read-only) and EJ-9 (series reviews), each with one sub-question for the
  owner. See plan §5a.

**Verification:**

| Check | Result |
| --- | --- |
| Typecheck | clean |
| Lint | 0 errors / 7 warnings (baseline) |
| Unit tests | **1,256 in 100 files** |
| `suiteRehearsal` | **76/76** (V14–V19 new) |
| Regression | Attendee 27/27 · B 46/46 · Privacy 15/15 · Moderation 38/38 · Host 92/92 (new H4 check) · HostUi 174/174 |

Nothing is committed.

## 2026-11-17 — rehearsal Phase 3: scenarios

Client code only; no database access; nothing in the background. The preview
gains a collapsible Scenario panel:
- **When:** right now / days before / day of / happening now / ended.
- **Spots:** as it is / spots left / full.

**When** is a virtual clock that every time-based decision on the page reads;
the event's own dates never change. The collapsed banner names any simulated
moment, and a going guest appears as "You (preview)" in the faces and in
"Who's going". Details are in `docs/EVENT_REHEARSAL_PLAN.md` §10.

Fixed in passing:
- **EJ-25** (a waitlist offered where the server refuses it).
- A "Y(" avatar initial on the guest's face.

**Verification:**

| Check | Result |
| --- | --- |
| Typecheck | clean |
| Lint | 0 errors / 7 warnings (baseline) |
| Unit tests | **1,250** (rehearsal 17, viewer 14) |
| `suiteRehearsal` | **58/58** (V9–V13 new; zero-write checks throughout) |
| Regression | Attendee 27/27 (A8 new) · B 46/46 · Privacy 15/15 |

Two first-run failures, both resolved:
- **V12** was a test-side date edge: after 21:00 UTC a date "in 3 h" is
  tomorrow, and the app was right.
- **V13** found the "Y(" defect.

Nothing is committed.

## 2026-11-17 — rehearsal Phase 2: "Preview as attendee"

Client code only; no database access; nothing in the background. A host can
open their own event as a guest would and try joining, with nothing saved.
- **Gating:** `?rehearse=1`, honoured only for the owner.
- **Data and transitions:** simulated page data and pure transitions in
  `utils/rehearsal.ts`.
- **UI:** a banner (`components/RehearsalBanner.tsx`; announced to screen
  readers; Exit is 64×44).
- **Entry:** ManageEvent's row is now "Preview as attendee", with "View as
  owner" below it.

Details and the gaps noted are in `docs/EVENT_REHEARSAL_PLAN.md` §9.

Fixed in passing:
- The fake backend's details RPC never returned the `waitlist` key, so no
  browser suite could reach waitlist UI. It now passes the key through when a
  test sets it on the row.
- Harness gotcha, noted in the suite: `click()` matches `aria-label` before
  visible text, so the waitlist button is "Event full. Join the waitlist".

**Verification:**

| Check | Result |
| --- | --- |
| Typecheck | clean |
| Lint | 0 errors / 7 warnings (baseline) |
| Unit tests | **1,243 in 99 files** (11 new in `tests/rehearsal.test.ts`) |
| New `suiteRehearsal` | **36/36**, a zero-write assertion after every tapping scenario |
| Regression | Attendee 24/24 · B 46/46 · Privacy 15/15 · HostUi 174/174 |

The first suite run had 16 failures, all from my fixture: fake events carry a
small default capacity, so every scenario started full. The fixture now
starts with room. Nothing is committed.

## 2026-11-17 — rehearsal Phase 1: the event page's viewer seam

Client code only; no database access; nothing in the background. Phase 1 of
`docs/EVENT_REHEARSAL_PLAN.md`: the ~16 role/state flags the event page
derived inline (and `isOwner`) moved into one pure function,
`deriveEventViewer` (`utils/eventViewer.ts`), which `screens/EventDetail.tsx`
calls once and destructures under the same local names — a refactor with no
behaviour change, and the seam rehearsal Phase 2 overrides. The owner
delegated the four scope decisions to the recommendations (plan §6): Phases
1–3 ship together, read-only dressed chat, "Preview as attendee", rehearsal
as the ManageEvent row's primary action.

Verified: typecheck clean; lint 0 errors / 7 warnings (baseline); **1,232
unit tests in 98 files** (13 new in `tests/eventViewer.test.ts`); browser on
a fresh dead-address export — **Attendee 24/24, B 46/46, Privacy 15/15**
(owner, attendee and signed-out visitor states all unchanged). Nothing is
committed.

## 2026-11-17 — event-journey review: Batch B (prepared) + R5

**Batch B is 7 prepared migrations, NOT applied.** They are staged in
`supabase/prepared/2026-11-17_event_journey/`, outside the folder the CLI and
`pg17-isolated.sh init` read, so nothing can apply them by accident. Each was
written from the live definition dumped out of a throwaway container. All
validation ran in throwaway PG17 containers (`eventmap_pg17_elm_b_1117`,
`…_b2_1117`), each destroyed afterwards:

| Check | Result |
| --- | --- |
| SQL suites before applying | 14/14 |
| Apply all 7 | clean |
| SQL suites after applying | 14/14 |
| Re-apply all 7 (idempotency) | clean, 14/14 |
| Without #5 and #6 | 14/14 |

The shared DB was never connected to, and the local DB is unchanged
(123 / `20261115100000`). Nothing ran in the background.

**Found by the first post-apply run, fixed before the results above:**
- `split_series_from` would have sent the new "Schedule changed" notice.
- `test-attendance-rpcs` encoded per-event "attended"; it now checks either
  meaning.

**R5:**
- New `scripts/test-event-journey.sql`: 7 blocks, each skipping when its
  migration is absent.
- Its role-switched block first asserts the policy's functions are executable
  (the segfault guard). My first version also demanded EXECUTE on trigger
  functions, which Postgres doesn't check when a trigger fires; it was
  narrowed, with a comment explaining why.
- `suiteAttendee` A6/A7 cover "during the event". **A6 found a defect in my
  Batch A1:** the header showed next week's date beside "Happening now". It is
  fixed in `screens/EventDetail.tsx`.

**Corrections to my own earlier review:**
- R3's audience matrix said postpone skips savers; it doesn't (the table is
  `saves`, my grep searched `saved_events`).
- New finding **EJ-24**.

**Verification (app):**

| Check | Result |
| --- | --- |
| Typecheck | clean |
| Lint | 0 errors / 7 warnings (baseline) |
| Unit tests | 1,219 |
| Browser, fresh dead-address export | Attendee 24/24 · B 46/46 |

Nothing is committed.

## 2026-11-17 — event-journey review: R4 + Batch A (app-only fixes)

**R4:** sequencing and the owner's decisions are recorded in
`docs/EVENT_JOURNEY_REVIEW_PLAN_2026-11-17.md` §5a:
- EJ-16: attendance counts per session.
- EJ-18: requests go away at the end (a short notice is recommended).
- EJ-19: date-only goers get chat.
- EJ-14: extend-or-refuse is recommended and awaiting your OK.

**Batch A, all eight items, client code only:**
- **A1, EJ-2 + EJ-13:** a single occurrence-aware "in progress" rule.
- **A2, EJ-1:** chip guards.
- **A3, EJ-12:** Leave re-checks at tap time.
- **A4, EJ-3:** review eligibility.
- **A5, EJ-4:** chat access rule and the off copy.
- **A6, EJ-5:** Manage chat row.
- **A7, EJ-14 interim:** move-picker guard.
- **A8, copy:** EJ-15/21 dialog, EJ-17 Settings, EJ-10 row.

New tests:
- **Unit:** `tests/seriesInProgress.test.ts`, 12 tests. The first version of
  `occurrenceInProgress` missed a date moved to a later day. The test caught
  it, and the function now looks moved dates up from their original day.
- **Browser:**
  - `suiteAttendee` A1's review check was `/review/i`, which the rating
    summary always met. It is now strict, and new A5 covers the ineligible
    case.
  - `suiteModeration` gains R6 (chat switched off, 3 going).
  - The fake backend answers `user_can_review_business`.

**Verification, all foreground, no database:**

| Check | Result |
| --- | --- |
| Typecheck | clean |
| Lint | 0 errors / 7 warnings (baseline; none in touched files) |
| Unit tests | **1,219 in 97 files** (baseline 1,207 / 96) |
| Browser suites, one fresh web export (dead-address bundle, safety greps passed) | Attendee 17/17 · Moderation 38/38 · B 46/46 · HostUi 174/174 · HostDashboard 105/105 (axe passes skipped: `axe-core` still not installed) · Notifications 55/55, the first browser run since routing changed in `aafa2f9` |
| Total | **435 checks, 0 failures** |

Nothing is committed.

## 2026-11-17 — event-journey review, R2 + R3

Review only; nothing fixed. **R2** covered during and after the event:
EJ-12…EJ-18. **R3** covered cross-cutting seams, lead-up and create: EJ-19…EJ-23.
Each phase was code walks plus one rolled-back batch in its own throwaway PG17
container (`eventmap_pg17_oak_r2_1117`, `…_r3_1117`), destroyed straight after.
Impersonation was via JWT claims only. The shared DB was never connected to and
nothing ran in the background; the one test run was `tests/notificationRoute.test.ts`
in the foreground (10/10).

Process notes, mine:
- Two fixtures needed correcting before results were recorded: RSVPs can't be
  inserted on an already-closed event, and the ids weren't hex.
- One draft claim was **retracted** after the repro: waitlisted people *are*
  told about cancellations, by `clear_event_waitlist_on_cancel`, which my code
  reading had missed.
- One pattern-change fixture ("every 2 weeks") still landed on the test date
  and was replaced with "every 3 weeks".

## 2026-11-17 — event-journey review, R1 (seed verification)

Review only; nothing fixed. Eleven seed findings from the journey mapping were
re-verified at `50a2a57`. Ten were confirmed and one became a "won't do"
(EJ-1…EJ-11, see `docs/EVENT_JOURNEY_REVIEW_2026-11-17.md`). Server-side claims
were reproduced in a throwaway PG17 container (`PG17_NAME=eventmap_pg17_oak_r1_1117`,
unique so it cannot collide with another `oak` worktree). The repro was one
rolled-back transaction, impersonating via JWT claims only. The container was
destroyed afterwards. The shared DB was never connected to; nothing ran in the
background. Headline: **EJ-1**, a server gap where suspended accounts can take
per-date series seats. One repro-script slip of mine: the first fixture date
was off by a day, which made the subject case look refused. Corrected and
re-run before recording.

## 2026-11-16 — review round 3 + full regression

Fixed: Discover's date filter drops series whose only date in the window was
skipped (O-1; a date moved *into* the window still needs the server, see
MIGRATIONS_PENDING 2b-7); the dashboard clock re-arms at midnight (O-3); the
schedule's time column grows with large text instead of wrapping (O-4).

O-2 **partly withdrawn**: the clipped tab-bar labels were an artifact of the
large-text harness, which overrides `tabBarAllowFontScaling: false`. The
detector now also finds text cut off from below, excluding intended
`numberOfLines` truncation (~30 false hits before that), with the caveat
documented on `layoutFacts`.

Regression, all foreground, no database: 1,207 unit tests; typecheck clean;
`npm run lint` 0 errors / 7 warnings (the documented baseline, none in
touched files); suiteHostDashboard 110/110 (axe), suiteA11y S,E,V 138/138
(axe) and T 34/34, suiteHostUi 174/174, suiteCollections 168/168,
suiteVisual 68/68, suiteCompare 45/45, suiteA 21/21, suiteB 46/46,
suiteD 30/30, suiteF 25/25. Not run: suiteC (stress), device passes.

**All outstanding database work from this programme is listed in
[`docs/MIGRATIONS_PENDING.md`](MIGRATIONS_PENDING.md) §2b (2b-1 … 2b-10).**

## 2026-11-16 — review round 2 (dashboard + recurrence)

Fixed: Discover/Category date filter now zone-correct for series (R2-1,
equivalence-tested against the old code for zone-less events); Profile
"Today" card ignores a cache older than 12 h (R2-2); stale-draft rule reads
50 drafts instead of 20 newest-first (R2-3); focus-on-open for
`CollectionActionsSheet` and `EventPublishedSheet` via shared
`useFocusOnOpen` (R2-4); first app-wide large-text pass, `suiteA11y` T,
34/34 (R2-5). Open items O-1…O-6 are in
`docs/HOST_DASHBOARD_AND_RECURRENCE_REVIEW_2026-11-16.md` §8 — notably the
date filter still ignores skipped dates (O-1) and the tab bar clips at 1.6×
text (O-2).

## 2026-11-16 — host dashboard C6, web half

`suiteHostDashboard.mjs` now runs 110 checks (foreground, no database):
axe WCAG A/AA on the schedule and with the date sheet and move picker open,
a keyboard walk (every stop named, focus ring present, none off-screen, not
stuck), focus moving into the date sheet, Escape closing both overlays,
1280 px and 640 px (200 % zoom) reflow, and large text at 1.3× and 1.6×.

Fixed: the date sheet did not move focus on open (keyboard users stayed
behind the modal). Sheets elsewhere get this from a field's `autoFocus`;
this one focuses its first action instead, guarding `findNodeHandle`, which
throws on web.

Also found, **not** fixed (pre-existing, outside this phase):
- `components/CollectionActionsSheet.tsx` and
  `components/EventPublishedSheet.tsx` have the same focus-on-open gap (no
  text field, no focus call). Verified by inspection, not covered by
  `suiteA11y`.
- Large text has still never been tested on the rest of the app; the scaling
  technique used here (scale every computed font size — Chrome's
  minimum-font-size does nothing to RN-web px text) is reusable in
  `suiteA11y`/`suiteHostUi`.
- `label-content-name-mismatch` stays a warning on row buttons, as
  elsewhere: clearing it would mean dropping the punctuation that gives a
  screen reader its pauses.

## 2026-11-16 — host dashboard C5 (per-date operations)

Series rows on `/hosting` now have a "Date options" button. It opens a sheet
to change one date's time, skip it, or restore it, and offers only what the
RPCs would accept for that date. Manage event's "Upcoming dates" was
refactored onto the same hook (`hooks/useOccurrenceActions.ts`) and picker
(`components/MoveDateModal.tsx`), lifted unchanged, so there is one code
path for both screens. No database changes.

Two accessibility defects were found by the browser pass and fixed:
- Identical button names on every row of a daily series; they now include
  the date.
- Visible text and accessible names that differed in the sheet (WCAG
  2.5.3); both now come from one constant.

Also found: `suiteCollections.mjs` silently runs nothing when given `all`
(it needs the scenario list). Noted in the harness README.

Evidence:
- `suiteHostDashboard.mjs` 74/74.
- Regression: suiteHostUi 174/174, suiteCollections 168/168, suiteVisual
  68/68.
- 1,199 unit tests; typecheck and lint clean.

## 2026-11-16 — host dashboard C2 ("Needs you")

Seven rules over the data the dashboard already holds, plus per-event facts
for the next 10 events only (DC5, owner-decided; approval-mode events
first): chat reports, join requests, postponed, promotable waitlist, stale
draft, starting soon with RSVPs off, and full with no waitlist. Each row
deep-links to the tool that answers it — `?tab=` / `?seg=` params were added
to Manage event for this. The fan-out goes through Manage event's own query
key, so the dashboard warms the screen it links to. Not persisted.

When more events exist than the cap, the screen says so ("Checked your next
10 events for requests and reports") — the note was initially rendered
inside the queue section and so vanished when the queue was empty, which is
exactly when unbounded-looking silence misleads; fixed and pinned by H7.

Evidence: 40 unit tests in `tests/hostDashboard.test.ts` (green in 5 zones),
`suiteHostDashboard.mjs` 49/49, suiteHostUi 174/174, suiteVisual 68/68,
1,195 unit tests, typecheck and lint clean.

## 2026-11-16 — host dashboard C1 (`/hosting` agenda)

Built per `docs/HOST_DASHBOARD_PLAN.md` (DC1-DC3 decided by the owner as
recommended). The agenda covers today plus six days across every event the
host runs, with series expanded into their real dates. Skipped dates are
struck through with the host's note, moved dates show at their new time,
and a series date uses its per-date going count where one exists, otherwise
"N going to the series". Entry points: a "Today" card on business-mode
Profile, which reads the cache only and makes zero requests, and a "This
week's schedule" button in the My Events header. No database changes.
Evidence:
- `tests/hostDashboard.test.ts`: 26 tests, green in 5 device zones.
- `suiteHostDashboard.mjs`: 33/33 on the fake backend, foreground.
- Regression: suiteHostUi 174/174, suiteB B7-B8, suiteVisual 68/68.
- 1,181 unit tests; typecheck and lint clean.

One defect was found and fixed during the browser pass: the Profile card
said "Next: 12:00 PM" for an item that was tomorrow. It now names the day.

## 2026-11-15 — final regression pass over the whole roadmap

One clean run over the finished tree rather than the per-phase runs.

- **Static:** app typecheck clean; `npm run typecheck:admin` clean; app lint
  0 errors / 7 warnings (the Nov 8 baseline, unchanged by eight phases of
  work); admin eslint 0 / 2 (baseline); **1,124 unit tests in 92 files**;
  admin `next build` 21 pages generated.
- **Browser, 18/18 suites green against one fake-backend export, 1,054
  checks:** A 21 · B 46 · C 13 · D 30 · F 25 · A11y 168 (no axe) · Host 92 ·
  HostUi 174 · Onboarding 57 · Collections 168 · Notifications 55 ·
  Moderation 34 · Attendee 14 · Premium 19 · Privacy 15 · Account 10 ·
  Visual 68 · Compare 45. The export was built once with run.sh's dead-backend
  safety checks and every suite ran in the foreground against it.
- **SQL:** 13/13 on the isolated PG17 container (phase 8, same day); not
  re-run — nothing changed in `supabase/` since.
- **Visual set (flow 9's human half):** the 22 captures were reviewed as a
  set for the screens this roadmap touched — Discover (chips are pills again at
  both widths), Create (sticky bar), event page, Saved. Nothing out of place.
- **Found:** no application defects. One **process slip**: the Visual suite,
  run concurrently with five other suites, exceeded the foreground limit and
  the harness backgrounded it; it was stopped at once, no orphaned Chrome was
  left, and it passed 68/68 re-run alone. Rule going forward: at most four
  browser suites at a time, Visual on its own.
- **Not run:** `npm audit` (no dependency changed since the Nov 8 count of
  34), axe-based checks (needs `axe-core`, owner item 4).

## 2026-11-15 — roadmap phase 8: the comparison RPC, applied locally

- [x] **`20261115100000_get_events_compare.sql`** written and validated on the
  isolated PG17 container (123 migrations + seed): clean apply, idempotent
  re-apply, **13/13 SQL suites** including the new
  `scripts/test-events-compare.sql` (5 blocks). Visibility mirrors
  `get_event_details`; up to 4 distinct ids; viewer state included (D9);
  callable by anon and authenticated. **Applied locally only** — listed as
  `docs/MIGRATIONS_PENDING.md` item 2 with the apply and cutover steps.
- [x] **Hosted-database inventory runbook** (D10) — `docs/MIGRATIONS_PENDING.md`
  item 0; owner work, prerequisite for any hosted apply.
- [ ] **Client cutover deferred (D7)** until the comparison has real usage; the
  `useCompareEvents` batch path is specified in item 2. No code change now, per
  the client/schema policy (no targeting an unapplied RPC, no fallbacks).
- [x] **[DB]** The local database records all **123** repository migrations.

## 2026-11-15 — roadmap phase 7: the remaining review items

- [x] **J8 bookmark on Discover cards**, with the card restructured so the
  host button and bookmark are siblings of the press area rather than
  touchables nested in a touchable (the custom-action workaround is gone).
- [x] **J5 / J6** "You're going"; labelled Interested pill.
- [x] **C6 withdrawn** — already implemented in `ImagePickerButton`
  (`handleMakeCover`, Cover badge, `makeCover` a11y action). Create's photo
  hint now says so. The review had not opened the picker.
- [x] **C10 targeted font-scaling pass** — `FontScaleCaps` in the theme,
  applied to the dense single-line surfaces. First `maxFontSizeMultiplier`
  in the app. **[device]** to verify at 200 %.
- [x] GOING badge on Discover cards now `Colors.successText` (contrast
  leftover from the theme audit).

**Verification:** typecheck clean, **1,124 unit tests in 92 files**, lint 0
errors / 7 warnings (baseline), and against one shared fake-backend export:
`suiteVisual` **68/68**, `suiteAttendee` **14/14**, `suiteCompare` **45/45**,
`suiteModeration` **34/34** (its R4 still taps "Mark as interested"), plus a
scripted walk: a card bookmark tap → exactly one `POST saves` and the label
flipping to "Remove … from saved events"; host buttons reachable as their own
elements; the Interested pill and "You're going" rendering; Create's new cover
hint present. No database touched.

## 2026-11-15 — roadmap phase 6: reach and verification

- [x] **Discover long-press** selects a card for comparison (D6): "COMPARING"
  badge, "selected for comparison" in the label, and the same toggle as a
  custom accessibility action for screen readers. Tray above the tab bar;
  bottom sheet and FAB lift by its height.
- [x] **Shareable `/compare?ids=` link** (D2): `utils/compareLink.ts` (9
  tests) keeps unlisted events out of a link and drops, on open, unlisted
  events the viewer never saw plus anything the server does not return, with
  one toast counting the drops. Share control on the compare screen.
- [x] **`suiteCompare.mjs`** — 45 checks across tray, table, actions, cards,
  Discover long-press, the shared link, and a11y/layout at 320 and 390 px.
  README row added.
- [x] Found by the suite and fixed: the header "Exit compare mode" left the
  tray and selection up; it now exits fully like the tray's ×.
- [x] **Pre-existing, web only, fixed while here:** the Discover filter chips
  rendered as ~100 px circles. react-native-web gives every ScrollView
  `flexGrow: 1`, so inside the fixed-height header the chip strip grew to the
  leftover space and stretched the pill-radius chips. `flexGrow: 0` on the
  strip and `alignItems: 'center'` on its row; native never grew it. Visible
  in the phase-2 `suiteVisual` capture, so not introduced by this work.

**Verification:** typecheck clean, **1,124 unit tests in 92 files**, lint 0
errors / 7 warnings (baseline), `suiteCompare` **45/45**. No database touched.

## 2026-11-15 — roadmap phase 5: the comparison screen

- [x] **Side-by-side table** (`components/compare/CompareTable.tsx`): sticky
  attribute column, pinned header and footer following the body's horizontal
  scroll, measured row heights, ★ best cells, per-cell spoken labels.
- [x] **Identical-row collapse** in both modes; **details fetch**
  (`hooks/useCompareEvents.ts`, same key as the event page, effective next
  dates for series); **per-column Join / Save**
  (`components/compare/CompareActions.tsx`) writing through the event page's
  own service calls and query keys. `joinActionFor` joins only the plain
  case and hands every second-step state to the event page.
- [x] **D4**: cards by default under a screen reader (native) or large text,
  toggle always available.
- [x] Found and fixed: react-native-web's `isScreenReaderEnabled()` always
  resolves true (now native-only for layout decisions; hook documented); a
  nested touchable in the table header (caught by the AST guard); a
  truncated mode toggle.

**Verification:** typecheck clean, **1,116 unit tests in 91 files**, lint 0
errors / 7 warnings (baseline), scripted headless walk of table → actions →
scroll sync → collapse → cards with zero runtime errors. No database touched.
A fake-backend suite for the comparison (`suiteCompare.mjs`) is phase 6.

## 2026-11-15 — roadmap phase 4: the compare tray

- [x] **Compare mode + tray** on Saved events, Collection detail and Category
  browse: header toggle, per-row 44 px checkbox in the `rightAction` slot
  (row tap still opens the event), dock with thumbnails / remove / exit / one
  CTA, refusal toast and announcement at the cap of 4, list padding by the
  tray's measured height. `stores/compareStore.ts` (mode added, 14 tests),
  `hooks/useCompareSelection.ts`, `components/CompareCheckbox.tsx`,
  `components/CompareTray.tsx`.
- [x] **`/compare` first cut** (`screens/CompareEvents.tsx`): cards mode on
  the tray's snapshots with ★ best marks, Open / Remove per card, Clear, and
  a two-events-minimum empty state. Table mode, identical-row collapse, the
  details fetch and per-column actions are phase 5.

**Verification:** typecheck clean, **1,112 unit tests in 91 files**, lint 0
errors / 7 warnings (baseline), `suiteCollections` **168/168**, `suiteB`
**46/46**, scripted headless walk of the tray (mode → tick → cap → compare)
with no runtime errors. No database touched. One process note: a combined
two-suite run exceeded the foreground limit and was backgrounded by the
harness; it was stopped at once and the second suite re-run alone in the
foreground — suites are now run one per command.

**Owner decisions recorded 2026-11-15:** D4 yes (toggle stays), D2 yes
(minus unlisted events the opener could not see), D6 long-press only.

## 2026-11-15 — roadmap phase 3: price out of hiding

- [x] **C3** "Price & tickets" is its own section on Create and Edit
  (`components/EventPriceFields.tsx`; `EventExtrasFields` hides the two
  fields via `hidePriceAndTickets`). Errors for the two fields route to the
  new section (`utils/eventPrice.splitExtrasErrors`) instead of expanding the
  collapsed row.
- [x] **C4** Free / Paid chips. Free writes the canonical `Free` label that the
  comparison parser reads with confidence; Paid opens the free-text amount.
  `utils/eventPrice.ts`, 7 tests. Column unchanged (D3 open).

**Verification:** typecheck clean, **1,110 unit tests in 91 files**, lint 0
errors / 7 warnings (baseline), `suiteHost` **92/92**, `suiteHostUi`
**174/174**. No database touched.

**Owner decisions recorded 2026-11-15:** D1 (session-only tray) and D5 (cap of
4) confirmed as built. Commits are the owner's; sessions leave the tree
uncommitted.

## 2026-11-15 — roadmap phase 2: Create form structure

- [x] **C1 sticky action bar.** Preview + Publish in one row below the
  ScrollView, "Save as draft · private and free" as a 44 px text action; the
  content pads by the bar's measured height. Blocked states (limit / paused)
  drop Preview so the status label never truncates at 320 px.
- [x] **C2 live required-field progress** — new `utils/eventFormProgress.ts`
  (7 tests): "Still needed: Title, Category" → "Ready to publish", tappable to
  the first gap. Upload progress moved here from the button label, where the
  spinner had been hiding it.
- [x] **C7** time-zone row under Starts/Ends; **C8** first-event card reduced
  to one sentence.

**Verification:** typecheck clean, **1,103 unit tests in 90 files**, lint 0
errors / 7 warnings (baseline), `suiteHost` **92/92**, `suiteHostUi`
**174/174** at 320 and 390 px (labels, 44 px targets, overflow, clipped text).
No database touched. The pinned strings the suites click on ("Publish Event",
"Save as draft", "Preview how your event will look", "Hide first event tips",
"Your first event: three things that matter", "Time zone") are unchanged.

## 2026-11-15 — create/join UX review + comparison roadmap, phases 0-1

Planning: `docs/EVENT_COMPARISON_PLAN.md` (design + decisions D1-D6) and
`docs/CREATE_AND_JOIN_UX_REVIEW_2026-11-15.md` (19 findings, J1-J9 / C1-C10),
sequenced into one eight-phase roadmap in `ROADMAP.md`.

**Phase 0 — UX quick wins (shipped):**

- [x] **J1 the Join button had no in-flight state.** `screens/EventDetail.tsx`:
  "Joining…" / "Joining waitlist…" / "Updating…", a spinner in place of the
  arrow, `aria-busy`, and a "Saving your RSVP" label while the request runs.
  The re-entry guard already made a second tap harmless; nothing said so.
- [x] **J3 / C9 haptics.** `utils/haptics.ts` had exactly two consumers
  (onboarding, HostSetup) and neither of the two actions that matter most.
  Now: success on a confirmed RSVP, a sent request, a waitlist join and a
  publish; selection on the interested toggle and on leaving. No-ops on web.
- [x] **J4 joining succeeded silently.** A confirmed "going" raises a toast
  with an **Add** action into the calendar flow (`notify.withAction`).
- [x] **J7 / C5 sub-44 px targets.** The event page's calendar/collection
  chips (~34 px, no hitSlop) and the age chips in `EventExtrasFields` (36 px).
- [x] **J9 approval mode said nothing about timing** — and a pending request
  fell through to "Not sure yet? Tap the star", which was found while fixing
  it. Pending requests now get their own line.

**Phase 1 — comparison foundations (shipped):** `utils/comparePrice.ts`,
`utils/compare.ts`, `stores/compareStore.ts`, all renderer-free and wired into
nothing yet, so the §7 decisions can still move the UX. Design notes and the
one bug found (uncapped events ranking below a nearly-full one, from an
`Number.isFinite` filter eating `-Infinity`) are in the plan's §8 log.

**Verification:** typecheck clean (app), **1,096 unit tests in 89 files**
(+48: 18 price, 18 rows, 12 store), lint 0 errors / 7 warnings — the same
seven as the Nov 14 baseline. Browser suites against the fake backend, run in
the foreground: `suiteAttendee` **14/14** and `suiteHost` **92/92**, covering
the two screens that changed. No database was touched.

**Deliberately not done:** J2 (optimistic RSVP vs. accepting the wait) is a
decision, filed above rather than guessed at; C1/C2 (Create's action bar and
progress) are layout work that wants screenshots, filed as roadmap phase 2.

## 2026-11-14 — flows 5–9 (the last agent-doable testing passes)

The UI/UX flow list is now finished on the web/fake-backend side. New suites,
all green on the first full run after their fixtures were corrected:

- [x] **Flow 5, attendee journey** — `suiteAttendee.mjs` 14/14.
- [x] **Flow 6, premium lifecycle** — `suitePremium.mjs` 19/19, including the
  lapse across Create and the premium screens.
- [x] **Flow 7, privacy from outside** — `suitePrivacy.mjs` 15/15. Worth
  noting: with "share future events" off the app does not even request the
  list, so the choice cannot leak through a loading state.
- [x] **Flow 8, account management** — `suiteAccount.mjs` 10/10.
- [x] **Flow 9, visual sweep (automatable half)** — `suiteVisual.mjs` 68/68
  across 11 screens × 390/1280 px, 22 screenshots for the human comparison,
  plus `scripts/design-token-audit.mjs` for the spacing/radius inventory
  (1,025 literals; the old "~550 + ~180" estimate was close).
- [x] **Two flow-9 "known items" resolved:** the teal switch is **stale**
  (every Switch already sets a brand `trackColor` — now pinned by a computed
  -style assertion); the onboarding toast overlap is a **design decision**,
  moved to "Needs a product decision" rather than guessed at.

**No application defects were found in flows 5–9.** Every failure in this
pass was in my own fixtures or assertions (a missing `waitlist_mode`, the
`waitlist` payload shape, "No **Active** Subscription" matching a naive
regex, the real section heading being "Events I'm Planning to Attend",
unblock sitting behind a confirm, and `/saved` not being the route — it is
`/saved-events`). Each was corrected and re-run.

**Full verification after the pass:** 17 browser suites, **1,009 checks**, 0
failures; 12/12 SQL suites on the Supabase image; 1,048 unit tests; app and
admin typecheck, lint (0 errors) and the admin build (21 pages) all clean.


## 2026-11-14 — flow 4 (report → moderation → outcome) + the admin build

- [x] **The admin app did not build.** `next build` failed on
  `/categories/new`: *"A 'use server' file can only export async functions,
  found object"* — `admin/app/(dashboard)/categories/actions.ts` exported the
  `INITIAL_CATEGORY_STATE` constant (and its type) from a `'use server'`
  module. Both moved to the plain `./shared.ts` the file already imports;
  `CategoryForm.tsx` imports them from there now. The build has been broken
  since the categories pages landed on **2026-11-09** — the "compiles all 21
  routes" check in the Nov 8 batch predates them, and nothing re-ran it.
  After the fix: **21 pages generated, 25 routes**, admin typecheck and lint
  clean. (Typecheck alone never caught this: it is a Next build-time rule.)
- [x] **Flow 4 suite** — `suiteModeration.mjs`, 34/34, five scenarios:
  R1 event report + duplicate, R2 chat-message report via long-press +
  duplicate (the harness now synthesises a long press), R3 the reporter's
  `report_update` notification opening the event, R4 a banned account refused
  on write with the suspension message while keeping read access (the
  "banned users can still browse" decision, now actually exercised), R5 the
  removed-from-chat and suspended-in-chat notices.
- [x] **Fake backend learned `complaints`** (POST, with the per-target unique
  violation) so every report path in the app can be driven without a database.
- Not covered, still open: the admin moderator actions themselves (manual
  login) and a real `report_update` arriving from the server trigger.


## 2026-11-14 — flow 3 (notification routing) + host-tools API regression

- [x] **Pushes routed host notices to the wrong screen.** `app/_layout.tsx`
  resolved a tapped push with its own copy of the pre-playbook inline rule
  (`eventId` → `/event/<id>`), so a host tapping "your event is today" or the
  post-event summary from a *push* landed on the public attendee page, and the
  verification / standing notices landed on the notification centre instead of
  Settings — the in-app list had been fixed on Nov 13 (P6) but the push path
  was not switched. Both now resolve through `utils/notificationRoute`:
  `notificationRoute` gained the push-only `kind: 'chat'` hint and a
  configurable fallback (in-app → Discover, push → the notification centre, or
  a promotion's `myapp://` deep link), and the pure push-payload→route step is
  `routeFromPushData`, unit-tested under node. `tests/notificationRoute.test.ts`
  now cross-checks every type between the two entry points (10 tests).
- [x] **Flow 3 suite** — `suiteNotifications.mjs`, N1 route per type, N2 tap
  marks read + destination renders: 55/55. Screenshots per type. Device half
  (real push taps, channels) stays on the device list.
- [x] **`scripts/regress-host-tools.mjs` run for the first time since the
  Nov 9–13 migrations**: 19/19 PostgREST-shape checks (named-arg overloads,
  undefined-key dropping, return decoding) against a private PostgREST bound
  to the isolated PG17 container (`scripts/pg17-isolated.sh init`, fixture via
  `apply`, container joined to a private docker network, PostgREST on a
  verified-free port). Recipe in the review doc.


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
