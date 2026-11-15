# Documentation review and roadmap — 2026-11-14

Review-only pass over every document in the repository (`docs/`, `ROADMAP.md`,
`README.md`, `CONTRIBUTING.md`, `admin/README.md`, `scripts/*/README.md`, the
two archives) against the code at `b4e63f9` (= `main` = `origin/main`), the
shared local database (read-only queries) and the test tooling. Nothing was
implemented or changed outside this file. The roadmap in §4 is the proposal
for closing what is open.

How claims were checked:

- Code: every file, function, migration, test and script named as "done" in a
  plan doc was looked up (grep/ls). Named vitest files were run.
- Database: `supabase_migrations.schema_migrations` and `pg_proc` /
  `information_schema` on the shared local DB (`SELECT` only). Hosted or
  production databases were **not** checked; nothing in the repo records
  their state.
- Tooling: `npm run typecheck`, `npm run typecheck:admin`, `npm run lint`,
  admin `eslint`, `npx vitest run`, `npm audit`, type generation from the live
  schema into a scratch file, and every `scripts/test-*.sql` suite on a fresh
  scratch copy (`SCRATCH_DB=eventmap_scratch_elm_docreview`, rollback-only).

---

## 0. Progress log

### Status board (as of the last pass, 2026-11-14)

| Step | Status | What is left |
| --- | --- | --- |
| 0 Stop the bleeding | **Done** | — |
| 1 Make the docs true | **Done** | three cosmetic stale lines, noted |
| 2 Post-migration follow-ups | **Done except one** | E-R1 migration (option A decided, measured) — **deferred: migration work** |
| 3 Test the untested | **Done where possible** | `npm run test:backend`, manual passes, host notices end to end, axe pass — **owner** |
| Foundations (isolated workflow) | **Done** | — |
| Client fixes (items 1–3) | **Done** | — |
| Flow passes + API regression | **ALL DONE** — flows 3–9 + host-tools PostgREST | flow 4's admin half and flow 9's human side-by-side comparison need you |
| 4 Device sessions | Not started | **owner** |
| 5 Product decisions | Not started | **owner**, one sitting |
| 6 Hosted database | Not started | **owner**, only if a hosted project exists |
| 7 Release blockers + hygiene | Not started | map tiles decision (**owner**); audit leftovers need an Expo SDK bump |
| 8 Feature backlog | Not started | discovery modes, host tools Phase 4, onboarding leftovers — most need migrations |

**Prepared, unapplied, waiting for the migration window:** see
[`docs/MIGRATIONS_PENDING.md`](MIGRATIONS_PENDING.md) — the full handover:
`20261114100000_drop_unfiled_past_event_count.sql` (validated, with its
apply/verify commands and the one post-apply step), and E-R1 option A
(decided and measured, still to be written, with its nine call sites).

**Agent-doable work is complete.** What is left needs either you or a
migration window:

1. **Your login / device** — the admin moderator actions (flow 4's other
   half), `npm run test:backend`, host notices end to end, the manual
   collections and playbook passes, everything in Step 4, and the `axe-core`
   install that unblocks the WCAG pass.
2. **Your eyes** — flow 9's side-by-side comparison of the 22 screenshots the
   visual suite writes, and the design-token cleanup it feeds
   (`node scripts/design-token-audit.mjs`, 1,025 literals, screen by screen).
3. **Your decisions** — the list in "Needs a product decision", now including
   the onboarding toast overlap, plus map tiles (Step 7).
4. **Your migration window** — [`docs/MIGRATIONS_PENDING.md`](MIGRATIONS_PENDING.md).

The small re-opened items that remain are either client-only polish or need a
migration (host-overview chat fields, the reminder window).

### Step 0 — 2026-11-14 (this pass)

Constraints for this and later passes, set by the owner: **the shared local
database is read-only** — never reset, never used as a test target; all
testing happens in an isolated environment; no background processes.

**Test bed.** The native cluster `scripts/db-isolated.sh` builds is Postgres
**14.15**, while the stack runs **17.6** — so it cannot reproduce or clear a
PG17-specific crash. Instead a throwaway container was run from the *same
image the stack uses* (`public.ecr.aws/supabase/postgres:17.6.1.106`), on its
own port with ephemeral storage, and loaded with all 121 migrations + the
seed via the existing shim. The shared stack was never written to. The
container was removed afterwards; the build script is kept at
`<scratchpad>/pg17-isolated.sh` and is a candidate to land as
`scripts/pg17-isolated.sh` (see follow-ups).

**Done:**

- [x] **C1 root-caused** (see above) — crash reproduced in isolation, reduced
  to a four-line case with no app code, and attributed to
  `supautils.hint_roles`, not to the `GRANT`-on-temp-table pattern originally
  suspected. The earlier guess was wrong because the shared DB logs DDL only,
  so the `GRANT` was merely the last *logged* statement.
- [x] **Suites fixed to stop crashing the cluster** —
  `scripts/test-collections.sql` `[1.21]` and `[12.6]` now assert
  `has_function_privilege(...)` instead of calling the function as `anon`
  (both were already covered safely in the suite's block 0). A warning
  explaining the rule is in the file header.
- [x] **`scripts/test-attendance-rpcs.sql` repaired** — accepts the host
  guidelines (`20261110150000`) for the demo businesses inside its rolled-back
  transaction. Back to its historical **49 checks**.
- [x] **`scripts/test-host-lifecycle.sql` repaired** — opts the fixture host
  into the two notices, which `20261113110000` made opt-in.
- [x] **Timezone flake fixed** — `scripts/test-categories-series.sql` builds
  its fixture dates with `AT TIME ZONE 'UTC'`.
- Both repairs are guarded by an `information_schema` check, so the suites
  still run against a database that predates those migrations.

**Result on the Supabase engine: 11 of 12 suites pass, zero segfaults**
(previously the collections suite crashed the cluster and two suites failed).
The 12th is an environment artifact, not a defect — see follow-ups.

**Flagged for later (new information, needs your decision):**

1. **Runtime exposure of C1** — see C1 item 2. Needs a product/ops decision;
   nothing was changed in the migrations.
2. ~~**`scripts/db-isolated.sh` masks privilege-negative assertions.**~~
   **Resolved in the foundations pass below** — the second shim pass was
   redundant (default privileges already cover new tables) and is gone.
3. ~~**Adopt the PG17 harness?**~~ **Resolved in the foundations pass below** —
   `scripts/pg17-isolated.sh` landed; headers and `db-scratch.sh` updated.
4. **Suites were never run on the Supabase engine before today**, which is
   exactly why a PG17-only crash survived four occurrences.

**Not started in Step 0:** nothing else; Step 1 is next and is documentation
only.

### Step 1 — 2026-11-14 (this pass)

Documentation only: no migrations were applied, no database was modified, and
the only database access was the read-only verification below. Applied state
re-verified first — **121 files, 121 recorded, the two sets identical** (no
file unrecorded, nothing recorded without a file), so "applied" is recorded as
fact rather than inference.

**Done:**

- [x] `docs/ISSUES.md` — Ground rules rewritten: shared DB read-only, the
  segfault rule with its repro, the real DB state with the verifying query,
  the PG14-vs-17 test-bed gap and the shim's grant limitation, plus the
  scratch-name, shared-port, Chrome-harness and seed/admin notes recovered
  from the archive. "Status at a glance" now leads with the verified state
  (everything applied, types stale, 1038 tests); the Nov 8 snapshot is kept
  below it and its three false DB bullets corrected.
- [x] `docs/ISSUES.md` Database section — "Prepared, NOT applied" replaced by
  a **Database state** block, an applied record for the Nov 13 playbook files
  (with the live consequence: switches visible, cron active, nobody opted in)
  and a new applied record for the **eight Nov 10 host-onboarding
  migrations**, which this tracker had never mentioned in any state. The
  never-done post-apply follow-ups are listed as open checkboxes.
- [x] `docs/ISSUES.md` — new **SQL suite status** section (Step 0 results);
  **17 re-opened items** the Nov 8 rebuild dropped, each with its archive
  reference and a code location; E-R1's server half and the C1 runtime
  exposure added under Medium; host tools Phase 4, the collections decisions,
  the discovery-mode decisions and categories D1 added to the decision list.
- [x] `ROADMAP.md` — new "Shipped since this roadmap was written" section:
  host analytics, personal calendar, offline UX, collections, playbook and
  host onboarding, each with status and where its remaining work is tracked.
  Corrected the claim that offline queues joins (it deliberately does not).
  "Additional ideas" now holds only what is genuinely unbuilt.
- [x] Stale headers fixed in all six plan docs —
  `HOST_ONBOARDING_PLAN` ("nothing here is built yet" → Stages 1-7 built and
  applied), `ANALYTICS_AND_CALENDAR_PLAN` ("proposal only" → all built, five
  migrations applied), `EVENT_COLLECTIONS_PLAN` (Phase A → A-F, applied, G
  steps 3-6 remain), `CATEGORIES_AND_SERIES_PLAN` (seven unapplied → eight
  applied), `HOST_TOOLS_PLAN` (header, the Phase 1 heading, and the apply
  checklist now itemised done/outstanding), and `HOST_EVENT_PLAYBOOK_PLAN`
  (§5 table rows and the two §7 "shared database was not touched" passages
  now match its own header).
- [x] `HOST_TOOLS_PLAN` Phase 4 — split into what shipped elsewhere (presets,
  recurrence overrides, per-occurrence RSVP, insights + tier gate) and the
  real remainder (check-in + QR, CSV export, `event_sections`).
- [x] `OFFLINE_PLAN` — the moved `docs/ISSUES.md` cross-reference, the
  `supabase/pending/` directory that never existed, and the `expo-image`
  claim, each corrected in place with a dated note.
- [x] `types/supabase.generated.ts` — header now says STALE — REGENERATE with
  what is missing and the command, instead of describing applied migrations as
  unapplied. Typecheck and the 1038 unit tests still pass.
- [x] `.github/copilot-instructions.md` — "Realtime: not currently used" (it
  is: chat, live RSVP counts) and the claim that `types/database.ts` is
  auto-generated (it is hand-written; the generated file is the other one).

**Deliberately left (cosmetic, low value, flagged rather than done):** the
per-item gap list in `CATEGORIES_AND_SERIES_PLAN` §8 still shows items the
gap-closing pass already closed; `EVENT_COLLECTIONS_PLAN` §9 headings still
say "(uncommitted)" (noted in its header instead of editing nine headings);
`ANALYTICS_AND_CALENDAR_PLAN` §2.7's second-pass list still mentions the
Requests tab its third pass built. None of these assert a false DB state.

**Nothing new was discovered in Step 1** — no decisions are waiting on you
from this pass. The flags from Step 0 (runtime exposure of C1, the
`db-isolated.sh` grant masking, adopting the PG17 harness) are unchanged.

### Step 2 — 2026-11-14 (this pass)

No migration was applied and nothing was written to any database. Database
access was read-only: the type generator reads the local schema, and the
reference checks below are `SELECT`s. The new migration is **prepared and
unapplied**; it was validated in a throwaway PG17 container.

**Done:**

- [x] **Types regenerated** (`npm run backend:types`): 2,573 → 2,888 lines.
  All three HAND-EDITED headers are gone, replaced by generated definitions.
  Checked that nothing the hand edits had provided was lost — 28 symbols
  (`event_host_playbook`, the playbook RPCs, both `host_*_notice` columns, the
  collections tables and RPCs, `get_user_calendar`, the verification and
  archive RPCs, `event_type`, `intent`, `synonyms`, `is_active`,
  `split_series_from`, the occurrence RPCs, `admin_category_stats`,
  `send_host_event_notices`) all present. App and admin typecheck clean.
- [x] **Probe-and-retry fallbacks removed** (`services/events.ts`), per the
  policy now recorded in `docs/ISSUES.md` Ground rules:
  `createKeyParamUnsupported`, `preferredBoostUnsupported`, the
  `isMissingFunction` helper and the `as typeof args` cast on the boost
  argument. `getRankedEvents` now passes `p_preferred_category_ids` through
  `rpcArgs` (the generated types mark RPC arguments non-nullable, and the SQL
  default is NULL); `createEvent` is a single call that always sends the key.
- [x] **Test updated to the new contract** — the test that asserted the
  removed fallback was replaced by two: the key is always sent in one call,
  and it is omitted only when the caller supplies none. **1039 tests pass.**
- [x] **`get_user_past_event_count` resolved** —
  `supabase/migrations/20261114100000_drop_unfiled_past_event_count.sql`
  (prepared, **not applied**). Verified unreferenced first: no repo reference,
  no other DB function's source, no policy/view/trigger/default. Validated in
  isolation three ways: no-op on a fresh database, drops cleanly when present,
  idempotent on re-apply. All 12 SQL suites re-run with it in place — same
  11 pass, zero segfaults.

**E-R1 (server-side effective occurrence): scoped, deliberately NOT written.**
It is not the mechanical swap the earlier notes imply, and rushing it would
undo tuned performance work. Findings:

- Six live functions, nine call sites: `get_ranked_events` (×2),
  `get_user_saved_events` (×2), `get_user_going_events` (×2),
  `get_user_calendar`, `get_user_collections`, `get_collection_events`.
- The two helpers have **different shapes**:
  `event_next_occurrence(start, is_recurring, pattern, tz[, now])` is a pure
  function over columns, while
  `event_next_effective_occurrence(event_id, now)` re-reads the event row,
  queries `event_occurrence_exceptions`, and loops up to **400** iterations.
- `get_ranked_events` already guards the *lighter* call behind
  `CASE WHEN is_recurring AND start < now() AND pattern IS NOT NULL` with the
  comment "skip the (subtransaction-opening) plpgsql call in that common
  case" — a deliberate artifact of `20261106120000_perf_ranked_events`.
  Calling the heavy version per candidate row would reverse that.
- So the design question is how to pay for correctness only where it matters.
  Options, cheapest first: **(a)** guard each call site on
  `EXISTS (SELECT 1 FROM event_occurrence_exceptions x WHERE x.event_id = e.id)`
  (needs the existing `event_id` index; one extra probe per row); **(b)** a
  trigger-maintained `events.has_occurrence_exceptions` boolean, making the
  guard a column read — fastest, one more column and trigger to keep honest;
  **(c)** a cached `events.next_effective_start` column maintained by triggers
  on the event and its exceptions — fastest to read and sortable, most moving
  parts. **Recommendation: (b)**, then swap the nine call sites behind that
  guard.
- Local data cannot validate any of this (3 events, 0 exceptions), so it needs
  the perf fixtures in `scripts/perf/`. **Needs your go-ahead on the option
  before I write it.**

**Not done, blocked by environment:** `npm install --save-dev axe-core` is
still refused by the agent permission policy, so the WCAG passes remain
unavailable. Owner action.

### E-R1 decision — settled by measurement, 2026-11-14

Benchmarked on the stack's own image with the repo's perf fixture (120k
events, 12k recurring, 480k RSVPs; SF dense page; `scripts/perf/`). Baseline
is the current function; A is the `EXISTS` guard; B is the
column-plus-trigger. Median of repeated runs:

| Events with an exception (in box) | Baseline | A (EXISTS) | B (column) |
| --- | --- | --- | --- |
| 0 — today | 83 ms | 85.5 ms | 83.7 ms |
| 190 (5% of in-box recurring) | 81 ms | 88.5 ms | 88.3 ms |
| 1,900 (50%) | 83.5 ms | 125 ms | 123 ms |
| 3,771 (100%, worst case) | 85 ms | 163 ms | 160 ms |

Result fingerprints were identical for all three in every scenario.

**Decision: option A.** B's only advantage is the zero-exception case, and it
is ~2 ms (the `EXISTS` probe costs ~0.6 µs/row against the existing
`(event_id, occurrence_date)` unique index). As soon as exceptions exist the
two are within noise, because the cost is the `event_next_effective_occurrence`
calls themselves, not the guard. For that ~2 ms, B adds a column, a trigger, a
backfill and a derived-state invariant that can silently drift — if the
trigger is ever bypassed the ranking goes quietly stale, which is a
correctness risk rather than a performance one. A has no invariant to
maintain.

Cost of correctness, either way, scales only with the number of events that
actually have exceptions: +9% at 5% coverage, ~2× in the pathological case
where every recurring event in a dense area has one. If that ever becomes
real, option C (a cached `next_effective_start` column) is the escape hatch.

**Not yet implemented** — the nine call sites across six functions still need
the migration written. Next action.

### Step 3 — 2026-11-14 (this pass)

Nothing was written to the shared database; everything ran either with no
database at all (browser suites) or against throwaway containers on their own
docker network and verified-free ports. All runs were foreground.

**Browser harness — the whole fake-backend set, 794 checks, 0 failures.**
One web export was built and reused across suites (`npx expo export` pointed
at the dead address, with `run.sh`'s guard that the bundle references no real
backend):

| Suite | Result | Covers |
| --- | --- | --- |
| A | 21/21 | cold start, persisted cache, offline restart, thumbnails |
| B | 46/46 | notifications/saved paging, event freshness, chat composer, business mode, 320/1280 px, sign-out |
| C | 13/13 | stress: 5k notifications, 400 events, chat paging (0.44 ms/keystroke) |
| D | 30/30 | offline→online recovery, token refresh, queued writes, anon-key gate |
| F | 25/25 | the offline day, sign-out key removal, second user on a device |
| Onboarding | 57/57 | flow 1 end to end, resume, auth branches |
| Host | 92/92 | host onboarding stages 1–4, checklist, tips, trust, stop/reopen |
| HostUi | 174/174 | host workflow UI at 390 px and 320 px |
| Collections | 168/168 | K1–K12, the first full run since the migration was applied |
| A11y | 168/168 | names, 24/44 px targets, headings, Tab order, Escape, live regions, overflow — **minus the axe WCAG pass** |

**API layer — `scripts/regress-isolated.mjs`, 31/32.** Normally this wants a
scratch copy inside the shared cluster, which the current constraints forbid;
instead PostgREST was bound to a throwaway Postgres container on a private
docker network. This is the first PostgREST-layer run since the Nov 9–13
migrations. The one failure is an artefact of that stand-in environment, not a
regression: `send_event_reminders` is cron-only and the isolated stack does
not grant it to the token the script mints (`42501`).

- **Shared-port hazard, hit live:** the script's default REST port (3999) was
  already taken by another session's PostgREST, and a first smoke request
  returned *their* data. Recipe now pins a verified-free port. This is the
  hazard the archive warned about; it is in the Ground rules.

**Measured, and it corrected an earlier error of mine:** the C1 "runtime
exposure" above. Testing the real HTTP path showed no crash, and isolating the
variable showed the trigger is a superuser session, not the role in effect.

**Blocked under the current constraints — not attempted:**

- `npm run test:backend` — writes disposable events to the shared database via
  the demo accounts. Needs either the owner's go-ahead or a full isolated
  stack including GoTrue (the regress harness above only stands up PostgREST,
  and the backend test signs in for real). **Owner.**
- The manual passes: collections 10-minute walk, playbook one-host
  walk-through, admin verification queue / standing / categories with a real
  admin login. **Owner / human.**
- Host notices end to end (opt a host in, wait for the cron, see the
  notification route) — the SQL half is covered by
  `scripts/test-host-notice-optin.sql`; the delivery half needs a real stack
  and a device. **Owner.**
- The axe WCAG pass — `axe-core` install still refused. **Owner.**
- Device items (Step 4) are unchanged.

**Still open from Step 3's plan:** `scripts/regress-host-tools.mjs` was not
run (it needs its fixture loaded into the same isolated stack; the recipe
above makes it straightforward next time), and the ranked UI/UX flow passes
2–9 in `docs/ISSUES.md` remain, though flows 1 and 2 are now largely covered
by the Onboarding and Host suites passing in full.

### Foundations pass — 2026-11-14 (this pass)

Decision A for E-R1 is final; its migration is deferred with all other
migration work. Under "foundations only, one item at a time, most important
first", the item chosen was the one every later step runs through: **make the
isolated validation workflow the project's real default.** No database was
modified; nothing ran in the background; the shared cluster was never
connected to except for one read-only count at the end.

**Done (one item, five pieces):**

- [x] **`scripts/pg17-isolated.sh` landed.** Throwaway container from the
  stack's own image (auto-detected, pinned fallback), all migrations + seed,
  no published port by default, container name per worktree, `init | apply |
  suites | psql | destroy`. `suites` tells a crashed backend apart from a
  failed assertion and cannot report a pass when psql itself fails to run.
  Its detection regex is anchored on psql's `: ERROR: ` / `error: ` tokens —
  a first version matched the word anywhere and misread the attendance
  suite's "…without erroring" notice as a failure; fixed and unit-checked
  against six real and decoy lines.
- [x] **Shim factored out to `scripts/db-shim.sql`**, shared by both isolated
  scripts, and the **post-migration `GRANT ALL` pass removed** from
  `db-isolated.sh`. The shim's `ALTER DEFAULT PRIVILEGES` (set before the
  migrations) already grants new tables to the API roles, so the second pass
  only ever undid migration `REVOKE`s. Verified both ways: `event_interactions`
  is now *not* readable by `authenticated` (migration REVOKE preserved) while
  `collections` *is* (default privileges worked).
- [x] **Result: 12/12 SQL suites pass on Postgres 17 (Supabase image) and
  12/12 on native Postgres 14**, zero crashes. First all-green run on the real
  engine; `test-event-insights [5.2]` passes in isolation for the first time.
- [x] **All twelve suite headers** now open with the isolated recipe and mark
  the `db-scratch.sh` recipes below them as the pre-2026-11-14, disallowed way.
- [x] **`scripts/db-scratch.sh` refuses to run** without
  `ALLOW_SHARED_CLUSTER=1`, with a message pointing at the isolated script.
  The owner's override is deliberately explicit. Verified: refuses by default
  (exit 2), works with the flag.

**Flagged, no decision needed:** the container builds in ~8 s and the suites
run in ~2 s, so `init && suites` is cheap enough to be the pre-commit check
for any SQL change.

**What remains (in the order I would take them, all compatible with "no
migrations, no DB writes, foundations only"):**

1. **Offline gate coverage** — `runOrQueue` guards only `BusinessDetail`;
   ManageEvent, Settings saves, review responses and chat moderation still
   fire writes with no offline pre-check (re-opened item, `docs/ISSUES.md`
   Low). Client-only; the most user-visible correctness gap left that needs
   no migration.
2. **Discover reload on profile change** (`app/(tabs)/discover.tsx:219-220`)
   — client-only perf fix.
3. **Small client defects from the re-opened list**: admin Users partial-UUID
   search, FAQ hardcoded date, "Change password" for OAuth-only accounts,
   venue-page Create CTA, contrast / `maxFontSizeMultiplier` leftovers.
4. **Browser-harness flow passes 3–9** from `docs/ISSUES.md` (notification
   routing, report→moderation, attendee after-the-event, premium lapse,
   privacy from outside, account management, visual sweep). Flows 1–2 are
   effectively covered by the Onboarding and Host suites.
5. **`scripts/regress-host-tools.mjs`** on the isolated PostgREST recipe
   (Step 3 leftover).

**Deferred by your instruction (migration work):** the E-R1 option-A
migration across nine call sites; applying
`20261114100000_drop_unfiled_past_event_count.sql`.

**Owner-only, unchanged:** `axe-core` install, `npm run test:backend`, the
manual and device passes (Step 4), product decisions (Step 5), hosted DB
(Step 6), map tiles (Step 7).

### Client fixes pass — 2026-11-14 (this pass)

Items 1–3 of the list above. Client code only: no migration, no database
access at all, nothing in the background.

- [x] **Offline gate** — `blockedOffline` now guards every non-queued write
  that lacked it: 15 host actions in `screens/ManageEvent.tsx` (placed before
  any confirm dialog), 8 Settings saves/toggles, 3 chat-moderation actions,
  and review responses in one place (`components/ReviewCard.tsx`, which
  covers both the event and venue pages and keeps the draft in the editor).
  Queued kinds are untouched. 27 guards.
- [x] **Discover reload on profile change** — effect keyed on
  `profile?.id/lat/lng` instead of the object; no more refetch, permission
  re-prompt and recentre on every profile identity change.
- [x] **Admin Users partial-id search** — `uuidPrefixRange` turns a pasted
  prefix into a `gte/lte` uuid range (no LIKE on uuid, no cast PostgREST
  would reject); 4 unit tests. Not clicked through with a real admin login.
- [x] **FAQ date** — a dated `FAQ_LAST_UPDATED` constant beside the content,
  locale-formatted.
- [x] **"Set a password" for OAuth-only accounts** — Settings asks
  `hasPasswordIdentity()`; the reset screen already handled those users.
- [x] **Venue-page owner CTA** — an owner with nothing upcoming now sees the
  section with a "Create an event" row.

**Verification:** app + admin typecheck clean; **1,043 unit tests** (+4);
lint 0 errors (7 warnings, down from 8). Browser regression on a fresh web
export: suites B 46/46, D 30/30, F 25/25 (offline + business mode), Host
92/92, HostUi 174/174 (ManageEvent, Settings host rows) — **367 checks, 0
failures.**

**Left in item 3, deliberately:** the contrast / `maxFontSizeMultiplier` /
reduce-motion leftovers. They are a visual sweep (flow 9), screen by screen
with screenshots, not a batch edit — a blind codemod would shift layouts.

### Flow passes + API regression — 2026-11-14 (this pass)

Items 4 and 5 of the agent-doable list, in order; the visual sweep was
skipped by instruction. No database access except one read-only count;
nothing in the background; the isolated stack was removed afterwards.

- [x] **Flow 3 — notification → the right screen.** New
  `scripts/fake-backend-e2e/suiteNotifications.mjs`: one unread notification
  per type (all 18), tap each from the in-app list, assert the URL; tap marks
  read with exactly one PATCH; destination renders without runtime errors.
  **55/55.** Walking the flow found a real bug: the **push-tap path still
  used the pre-playbook inline rule**, so a push for a host notice opened the
  attendee page and verification/standing pushes opened the notification
  centre, while the in-app list had been fixed on Nov 13. `app/_layout.tsx`
  now delegates to `utils/notificationRoute` (`routeFromPushData`, node-pure,
  keeps the push-only `kind: 'chat'` hint and the promotion deep-link
  fallback). Cross-checked per type in `tests/notificationRoute.test.ts`.
  Device half (tapping a real push, channels) unchanged on the device list.
- [x] **`scripts/regress-host-tools.mjs` — 19/19**, first run since the
  Nov 9–13 migrations. Recipe, fully isolated: `scripts/pg17-isolated.sh init`
  → `apply scripts/regress-host-tools.fixture.sql` → `docker network create`
  + `connect` the PG17 container → PostgREST container on that network with
  `PGRST_DB_URI=postgres://authenticator:…@<container>:5432/eventmap`, a
  JWT secret, published on a `lsof`-verified free port → `REST=… JWT_K=<b64
  secret> node scripts/regress-host-tools.mjs`. The `authenticator` password
  must be set as `supabase_admin` (supautils reserves the role). Another
  session had 39981 taken this time — check the port every time.

**Verification:** typecheck clean, lint 0 errors, **1,048 unit tests** (+5);
suite re-run after the override fix 55/55.

**Next in the list:** flows 5–8, then the visual sweep (flow 9) when you
want it.

### Flow 4 + the admin build — 2026-11-14 (this pass)

No database access at all this pass (the fake backend and the admin build
both run against a dead address). Nothing in the background.

- [x] **The admin app did not build — found and fixed.** `next build` failed
  on `/categories/new`: a `'use server'` module may only export async
  functions, and `categories/actions.ts` exported the
  `INITIAL_CATEGORY_STATE` constant. Moved it (and its type) to the plain
  `./shared.ts`. **Broken since 2026-11-09**, when the categories pages
  landed — the Nov 8 "compiles all 21 routes" check predates them and nothing
  re-ran it. `typecheck:admin` never caught it: it is a Next build-time rule,
  which is why "the admin build" was listed as part of flow 4. After the fix:
  21 pages, 25 routes, typecheck and lint clean.
- [x] **Flow 4 app side — `suiteModeration.mjs`, 34/34.** R1 report an event
  (reason sheet → one `complaints` row → confirmation; repeat → "already
  reported", no extra row). R2 the same for a chat message via a real
  long-press (new helper: pointer down, hold 1.6 s, up). R3 the reporter's
  `report_update` notification opens the event. R4 a suspended account is
  refused on write with the suspension message and **keeps read access** —
  the "banned users can still browse" decision, exercised for the first time.
  R5 removal from one chat is explained up front ("The host removed you from
  this chat. You can still read along."), and a suspended account is told so
  in chat.
- [x] **Fake backend learned `complaints`** (POST + the per-target unique
  violation), so every report path in the app is drivable without a database.

**Still open in flow 4:** the admin moderator actions themselves (needs a real
admin login) and confirming a `report_update` arrives from the live trigger.

**Verification:** app typecheck + lint clean, 1,048 unit tests; admin
typecheck, lint and **build** clean.

**Migration handover:** all outstanding database work is now written up
precisely in [`docs/MIGRATIONS_PENDING.md`](MIGRATIONS_PENDING.md) — one file
ready to apply, the E-R1 design decided with its measurements and the exact
nine call sites, and the identified-but-unwritten list.

### Final pass — flows 5–9 and full re-verification, 2026-11-14

The last agent-doable items. No database was written to; the only database
work was the isolated container, removed afterwards.

- [x] **Flow 5 attendee journey** 14/14 · **Flow 6 premium lifecycle** 19/19
  (including the lapse) · **Flow 7 privacy from outside** 15/15 · **Flow 8
  account management** 10/10 · **Flow 9 visual sweep (automatable half)**
  68/68 over 11 screens × 390/1280 px with 22 screenshots.
- [x] **`scripts/design-token-audit.mjs`** — the cleanup now has a number:
  1,025 literals in 87 files (spacing 272 on-scale + 573 off, radius 45 + 135),
  worst files listed, so the work is countable and cannot quietly grow.
- [x] **Two flow-9 "known items" closed**: the teal switch was already fixed
  (now pinned by a computed-style check); the onboarding toast overlap is a
  design decision, recorded as one rather than guessed.

**No application defects in flows 5–9.** Every failure was in my own
fixtures or assertions — six of them, each named in the ISSUES Done log and
corrected. That is worth stating plainly: the value of this pass is the
regression coverage it leaves behind, not bugs found.

**Full re-verification (everything, current build):**

| Check | Result |
| --- | --- |
| Browser suites (17) | **1,009 checks, 0 failures** |
| SQL suites on the Supabase image | **12/12**, no crashes |
| Unit tests | **1,048** |
| Typecheck app / admin | clean / clean |
| Lint app / admin | 0 errors (7 warnings) / 0 errors (2 warnings) |
| Admin `next build` | 21 pages, 25 routes |
| Shared database | untouched — still 121 recorded, read-only checks only |

One process note: two batches of Chrome suites run in parallel raced and
suite B failed to launch. Re-run sequentially it passes 46/46. Browser suites
should be run one or two at a time, not more.


---

## 1. State of the project, verified

| Area | Docs say | Actually (verified 2026-11-14) |
| --- | --- | --- |
| Migrations applied to the shared local DB | Up to `20261106170000` + the Nov 8 and Nov 9 sets; `20261110*` undocumented; `20261112100000`, `20261113100000`, `20261113110000` "prepared, NOT applied" | **All 121 files are recorded and their objects exist** (`collections`, `collection_items`, `event_host_playbook`, `businesses.host_day_of_notice`, `profiles.intent`, `archive_business`, opt-in `send_host_event_notices`, `create_event_with_limit_check(p_client_request_id)` as the only overload). Cron jobs `event_reminders` (*/5) and `host_event_notices` (*/15) are active. |
| `types/supabase.generated.ts` | "Regenerate after applying" (every plan since Nov 9) | **Never regenerated after Nov 9.** Hand-edited three times. Diff against the live schema is 510 lines: the `categories` columns `color`, `description`, `is_active`, `synonyms` are missing; so are ~25 RPC/table entries (`event_occurrence_exceptions`, `rsvp_occurrences`, `set_occurrence_rsvp`, `split_series_from`, `admin_category_stats`, `send_host_event_notices`, `get_occurrence_*`, …). Hand-written entries for playbook/collections are in a different order but equivalent. |
| Unit tests / typecheck / lint | 737 tests, clean (ISSUES.md "Code health") | **1038 tests pass (86 files)**; app and admin typecheck clean; app lint 0 errors / 8 warnings; admin lint 0 errors / 2 warnings. |
| SQL regression suites | All green on an isolated copy (per plan) | Before Step 0: 9 of 12 passed; `test-attendance-rpcs` failed (`guidelines_required`, predicted in HOST_ONBOARDING_PLAN §20 gap 4), `test-host-lifecycle` failed ("day-of sent once, got 0": it predates the opt-in migration), and `test-collections` **crashed the Postgres backend** (finding C1). **After Step 0: 11 of 12 pass on the Supabase engine, no segfaults**; the 12th (`test-event-insights` `[5.2]`) fails only because the isolated shim re-grants what the migration revokes. |
| `npm audit` | 34 (1 critical, 5 high) after the Nov 8 triage | Unchanged: 34 total, 1 critical, 5 high, 27 moderate, 1 low. |
| `axe-core` | Not installed (owner must run the install) | Still not installed. |
| Fake-backend browser harness | Green on 2026-11-08 | Smoke-run today: fresh web export + `suiteB B3` 8/8 pass, no runtime errors. Full run (~15 min) not repeated. |
| Branch state | — | Clean worktree; `HEAD` = `main` = `origin/main`. Nothing uncommitted despite every plan log saying "(uncommitted)". |

Objects on the shared DB with **no migration file**: `get_user_past_event_count()` (HOST_TOOLS_PLAN §11 item 3, hand-applied, never filed). Every other public function traces to a file.

---

## 2. Findings, ranked

Severity: **C** = will bite users or other sessions now · **H** = blocks the
next step or hides real state · **M** = should be done soon · **L** = tidy-up.

### C1. "Permission denied for function" segfaults the Supabase Postgres image
**Root-caused 2026-11-14 in an isolated throwaway container (FIXED in the
suites — see the progress log).** Raising a `permission denied for function`
error while the current role is `anon`, `authenticated` or `service_role`
segfaults the backend (signal 11); Postgres then crash-restarts **every**
connection in the cluster, shared DB included.

Minimal reproduction, no application code involved:

```sql
BEGIN;
  CREATE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
  REVOKE ALL ON FUNCTION f() FROM PUBLIC;
  SET LOCAL ROLE anon;
  SELECT f();      -- backend segfault, cluster-wide crash-restart
ROLLBACK;
```

The trigger is the image's `supautils` extension:
`supautils.hint_roles = anon, authenticated, service_role` adds an error hint
for exactly those roles, and that hint path crashes on this error. Evidence:
a *plain* role gets a normal `ERROR: permission denied for function`; a
permission-denied on a **table** is fine; an unknown function is fine;
`pgaudit` is already `none`, so it is not the cause. Image:
`public.ecr.aws/supabase/postgres:17.6.1.106` (the one the local stack runs).

This is a **platform bug, not app code**. Two consequences:

1. **Test suites** (what bit us): `scripts/test-collections.sql` asserted the
   refusal by *calling* the function as `anon`, which crashed the cluster —
   4 times since Nov 4 per the container log. The Nov 4 archive note
   (`docs/archive/ISSUES-history-2026-10-30_to_11-07.md:918`) had already
   prescribed `has_function_privilege(...)`; it was never carried into
   `docs/ISSUES.md`. Fixed in this pass.
2. ~~**Runtime, needs a decision**~~ — **retracted 2026-11-14 after
   measurement; there is no runtime exposure.** I had reasoned that because
   PostgREST executes as `anon`/`authenticated`, an HTTP call to a forbidden
   RPC would hit the same crash. Tested directly on an isolated Postgres +
   PostgREST stack (Step 3): an anonymous `POST /rpc/get_user_collections`
   returns a clean `401 / 42501`, and the database does not crash. The
   deciding factor is the session's *original* role, not the role in effect:
   `postgres` (superuser) → `SET ROLE anon` → forbidden call crashes, while
   the non-superuser `authenticator` role PostgREST actually connects with
   returns a normal error. The bug is therefore confined to superuser psql
   sessions — our SQL suites and manual psql work — which is also why it only
   ever surfaced there. No grant changes, no decision needed.

### C2. Documentation says three migrations are unapplied; they are live
`docs/ISSUES.md:244-266`, `ROADMAP.md:35-36`, `EVENT_COLLECTIONS_PLAN.md:3-5`,
`HOST_EVENT_PLAYBOOK_PLAN.md` §5/§7 and `types/supabase.generated.ts:1-12` all say
`20261112100000`, `20261113100000`, `20261113110000` (and the eight
`20261110*` files) are not applied. They are. Only the playbook plan's header
(l.3-5) says so, contradicting its own body. Consequences today:
- The **post-apply steps were never run** for Nov 9, 10, 12, 13: type
  regeneration (finding H1), `npm run test:backend`, the manual passes in
  EVENT_COLLECTIONS_PLAN §8 and HOST_EVENT_PLAYBOOK_PLAN P8.
- Hosts are now subject to `guidelines_required` on publish and the archived
  guard; the host-notice cron runs every 15 min (opt-in, so it sends nothing
  until a host enables it: 0 of 1 businesses opted in).
- The Settings host-notice switches are now visible (gated on the column
  existing), untested against a real backend.

### H1. Generated types are stale (see table above)
The client compiles because the hand edits cover what the UI reads, but
`categories.synonyms/color/description/is_active` and ~25 RPC signatures are
typed wrongly or missing, so new code against those objects gets no type
checking (e.g. `services/occurrences.ts`, admin categories). Regenerating
will surface call sites that currently rely on casts.

### H2. Two SQL regression suites are broken by later migrations
- `scripts/test-attendance-rpcs.sql`: fixture publishes without accepting the
  host guidelines (`20261110150000`). Predicted in HOST_ONBOARDING_PLAN §20.
- `scripts/test-host-lifecycle.sql:57`: expects a day-of notice with default
  settings; `20261113110000` made notices opt-in. The suite never sets
  `host_day_of_notice`.
HOST_ONBOARDING_PLAN §20 gap 3 ("older suites not rerun after the new
migrations") is therefore confirmed, and `test-host-tools`, `test-calendar`,
`test-categories-series`, `test-event-insights` pass only because they do not
touch publishing or notices.

### H3. Pre-migration client fallbacks were never removed
`services/events.ts:26-32,352-370`: the `p_client_request_id` cast/retry
ladder that `docs/ISSUES.md:282-283` said to drop after `20261108100000` is
still there (migration applied Nov 8). Same for `preferredBoostUnsupported`
(Nov 9) and the `MISSING` sets in `services/collections.ts:33` /
`services/eventPlaybook.ts:24`. Each is harmless but adds a retry round trip
and a false "works without the migration" story. Decide per case: keep (for a
hosted project behind on migrations, as ISSUES.md argues for calendar/host
tools) or remove.

### H4. Hosted/production database state is unknown
Every doc says "hosted databases have not been checked or changed." Nothing in
the repo records which of the 121 migrations a hosted project has, in
particular the Oct 30 security set (`20261030100000` admin self-grant,
`…101000` premium self-grant, `…102000` storage ownership, `…107000`
search_path). If any hosted project exists, this is the first thing to verify.

### H5. Release blocker unchanged: OpenStreetMap tiles
`docs/ISSUES.md:179-185`: production builds still point at
`tile.openstreetmap.org`, forbidden for apps by the OSM policy. Deferred by
decision on Nov 8; nothing new. Must be decided before any public build.

### H6. The device/manual test list has not started
`docs/ISSUES.md:125-176` (9 groups) plus the per-plan device items: onboarding
on a phone, VoiceOver/TalkBack, offline on iOS/Android, event creation end to
end, host tools click-through, first EAS build with the fingerprint policy,
Discover/event-page gestures, storage cleanup, Android push channels,
`.maestro/calendar.yaml` (never run), native NetInfo detection. All code is in
place; none has been exercised on a device since the Nov 5–13 work landed.

### M1. Plan docs contradict themselves and each other
Headers never updated after the bodies were: `HOST_ONBOARDING_PLAN.md:3`
("nothing here is built yet" — Stages 1–7 are built), `ANALYTICS_AND_CALENDAR_PLAN.md:3`
("Proposal only; nothing implemented" — all of it is), `EVENT_COLLECTIONS_PLAN.md:3-4`
("Phase A" — A–F), `CATEGORIES_AND_SERIES_PLAN.md:3-6` ("unapplied" — applied),
`HOST_TOOLS_PLAN.md` §10-11 ("none applied", "`untypedRpc` to replace" — both
done; Phase 4 "not started" though presets, insights, weekday recurrence and
occurrence exceptions shipped elsewhere). `OFFLINE_PLAN.md:990` says
`expo-image` not installed (it is, 10 importers); `:413,:501` reference a
`supabase/pending/` directory that never existed. `ROADMAP.md` lists host
analytics, the calendar and offline UX as "not yet scoped" ideas; all three
shipped. Migration counts flip between seven and eight (Nov 9 and Nov 10
sets both have eight files). Test counts (737 / 857 / 970 / 1038) are each
right for their date; ISSUES.md's "Code health" is the stale one.

### M2. `docs/ISSUES.md` has gaps relative to the archive
Items still open in code that the Nov 8 rebuild dropped (archive refs in
`docs/archive/ISSUES-history-2026-10-30_to_11-07.md`): offline gate covers only
BusinessDetail, not ManageEvent / Settings saves / chat moderation (A:1019);
Discover reloads categories+events on any profile identity change (A:604);
`get_event_host_overview.chat` lacks `chat_mode`/`open_policy`/pin so the hub
makes a second call (A:886); admin Users search needs a full UUID (A:1116);
FAQ "Last updated" hardcoded to a future date (`app/settings/faq.tsx:209`);
"Change password" label for OAuth-only accounts (A:285); venue page has no
"Create event" CTA for an owner with no events (A:481); contrast leftovers
(`Colors.success`/`Colors.warning` as text, `text.disabled` placeholders), zero
`maxFontSizeMultiplier`, reduce-motion in 2/9 animated files (A:1408-1429);
realtime still carries the anon key while a session is stale (A:1007);
Maestro airplane-mode flows never written (A:1271). Also the Phase 4 host
tools (check-in + QR, CSV export, `event_sections`, co-hosts) are missing
from ISSUES.md's "Features not started" list.

### M3. Server ranking ignores per-date exceptions (E-R1 server half)
`get_ranked_events`, saved/going lists, the calendar and now the three
collection RPCs (`20261112100000:405,548,1019`) compute `next_start` with
`event_next_occurrence`, not `event_next_effective_occurrence`. A skipped or
moved date still ranks and displays as the next date server-side; the client
corrects it only where `useEffectiveNextDates` runs. Known since Nov 9
(CATEGORIES_AND_SERIES_PLAN l.704-708, l.827); the collections migration
widened it rather than closing it.

### M4. Hand-applied object with no migration file
`get_user_past_event_count()` exists on the shared DB but in no file
(HOST_TOOLS_PLAN §11 item 3). A fresh or hosted database will not have it.
Either file it or confirm nothing calls it and drop it.

### M5. Backend integration test never run against the applied stack
`npm run test:backend` (`scripts/test-local-backend.mjs`) has a collections
block that prints SKIP until the migration is applied. It is applied; the
block has never executed. The script writes disposable events to the shared
DB using the demo accounts, so it needs a quiet moment or the owner's go-ahead.

### M6. Open product decisions (unchanged, blocking small pieces of work)
- Approval-mode events after RSVPs close (`docs/ISSUES.md:375-377`).
- Collections: rule editor vs single-category column, full Interests merge,
  four Phase F defaults (EVENT_COLLECTIONS_PLAN §6-7) — "must be decided before
  G", and G has effectively happened.
- Categories D1: future start that is not an occurrence (CATEGORIES §7 D).
- Discovery modes: all six §6 decisions (names, weighting, radius, ship
  "Just added" degraded or wait for server sort, Surprise-me location prompt).
- Host onboarding §9 Q1/Q3/Q5/Q6; host tools §9 Q1-Q3/Q5-Q6.
- Features not started: invite-only events, all-day/multi-day, "My reports",
  dark mode, real billing, real view/share analytics; host tools Phase 4.

### L1. Small known defects and tidy-ups
- `scripts/test-categories-series.sql:125-127` timezone flake
  (`(now() + interval '60 minutes')::date`; fix is `AT TIME ZONE 'UTC'`).
- `axe-core` not installed → no automated WCAG contrast/ARIA coverage.
- Publish preview too tall on a 320 px phone (needs a redesign, not a reorder).
- Design tokens: ~550 raw padding/margin and ~180 radius literals (do during
  the visual sweep).
- Offline leftovers: chat `markRead` not queued; discarding a waiting chat
  message is local-only; edit drafts keyed to `updated_at`; OS may purge
  picked image paths before an offline publish retries.
- Dependency drift: `npx expo install --check` wants `react-native` 0.81.5,
  `expo-image-picker` ~17.0.11, datetimepicker 8.4.4, worklets 0.5.1 (do with
  the next native build). Remaining audit items need an Expo SDK upgrade or a
  Supabase CLI bump (CLI 2.98.2 installed, 3.1.0 available).
- Naming drift between HOST_TOOLS_PLAN and code (`event_chat_pins` →
  `set_event_chat_pin`, `chat_open_policy` → `open_policy`,
  `event_occurrence_overrides` → `occurrence_exceptions`).
- Discover/search cards have no bookmark; business profile "Created" count
  has no upcoming/past split and no rating card.
- Low-priority DB hardening never written: reminder nudge at `now()+25h`
  ignores the event time zone; `REVOKE EXECUTE … FROM PUBLIC` + explicit
  grants; require a session for `get_event_attendees_public`; server length
  limits on title/description; banner `link_url` CHECK.

---

## 3. What is already in good shape

- App and admin typecheck, lint and 1038 unit tests are green at `HEAD`.
- The fake-backend browser harness (`scripts/fake-backend-e2e/`) covers
  onboarding, host onboarding, host UI, collections, offline, a11y and stress
  without a database; suite README is current.
- Every migration file applies cleanly in order on a fresh cluster
  (`scripts/db-isolated.sh init`, 121 files + seed, per the playbook log) and
  the shared DB matches the file set one-to-one apart from
  `get_user_past_event_count`.
- The Nov 8 security/consistency work (idempotent create, premium expiry
  enforcement, RSVP count locking, push channel routing) is applied and the
  client-side halves are in place.

---

## 4. Roadmap

Steps are ordered so each unblocks the next. "Owner" marks actions that need
the repository owner (shared DB writes, installs, devices, product calls).
Estimates are rough working hours for the agent side.

### Step 0 — Stop the bleeding (DONE 2026-11-14, see §0; follow-ups flagged there)
1. **Fix the cluster-crash pattern in the SQL suites** (C1). In
   `scripts/test-collections.sql`, `scripts/test-event-playbook.sql`,
   `scripts/test-calendar.sql`, `scripts/test-categories-series.sql`: drop
   `GRANT … ON <temp table>` and the `SET LOCAL ROLE` helpers; impersonate via
   `set_config('request.jwt.claims', …)` + `has_function_privilege()` checks,
   or stage fixtures in a throwaway regular schema. Re-run all 12 suites on a
   scratch copy; the goal is 12/12 on the Supabase image, not just the native
   cluster. Add the safety note to `docs/ISSUES.md` Ground rules.
2. **Repair the two suites broken by later migrations** (H2): attendance
   fixture accepts the guidelines (`host_terms_accepted_version` or the
   `eventmap.allow_*` GUC pattern the suite already uses); lifecycle fixture
   sets `host_day_of_notice` / `host_post_event_notice`.
3. **Fix the timezone flake** in `test-categories-series.sql` (L1, one line).

### Step 1 — Make the docs true (DONE 2026-11-14, see §0)
1. `docs/ISSUES.md`: replace "Prepared, NOT applied" with an applied log for
   the `20261110*`, `20261112100000`, `20261113*` sets; update "Code health"
   (1038 tests); carry the C1 safety note, the scratch-name rule and the
   harness notes from the archive (A:918, A:921-925, A:1043-1051, A:1140);
   add the dropped items from M2 under Low/Medium; add Phase 4 host tools to
   "Features not started".
2. Fix every stale header/status line listed in M1 (one edit each), and point
   `ROADMAP.md` at the analytics/calendar/offline plans with their status.
3. Add a short **"Database state" section** (this file or ISSUES.md) with the
   one query that proves it: `select version from supabase_migrations.schema_migrations`
   and the expected count, plus a line for each hosted project once checked.
4. Record `get_user_past_event_count` as either to-be-filed or to-be-dropped (M4).

### Step 2 — Finish the post-migration work that was skipped (MOSTLY DONE 2026-11-14, see §0; E-R1 decided = option A, migration still to write)
1. **Regenerate types** (`npm run backend:types`), remove the three
   HAND-EDITED headers, fix whatever typecheck surfaces, and drop the
   hand-copied optional fields in `types/database.ts:136-138`. Commit the
   generated file separately so the diff is reviewable.
2. **Decide and act on the pre-migration fallbacks** (H3): remove the
   `p_client_request_id` ladder and `preferredBoostUnsupported`; keep or
   remove the `MISSING`-set degradations in collections/playbook/calendar/host
   tools consistently (one documented rule).
3. **File or drop `get_user_past_event_count`** (M4).
4. **E-R1 server half** (M3): one migration switching `get_ranked_events`,
   saved/going, `get_user_calendar` and the collection RPCs to
   `event_next_effective_occurrence`; extend `test-categories-series.sql` and
   `test-collections.sql` with a skipped-date ranking assertion. Prepared on
   scratch; **Owner** applies.
5. Owner: `npm install --save-dev axe-core` so the a11y and host-UI suites can
   run their WCAG pass.

### Step 3 — Test what has never been tested against the real stack (PARTLY DONE 2026-11-14, see §0; the rest needs the owner)
1. Owner (or with owner's go-ahead, since it writes demo rows):
   `npm run test:backend` — first run with the collections block live.
2. Run the complete fake-backend harness (`scripts/fake-backend-e2e/run.sh`,
   ~15 min) plus `suiteHost`, `suiteHostUi` (with `AXE=`), `suiteOnboarding`,
   `suiteCollections`, `suiteA11y`, and record the counts in ISSUES.md.
3. Run `scripts/regress-isolated.mjs` and `scripts/regress-host-tools.mjs`
   (PostgREST-shape checks) against a scratch PostgREST, following the
   archive recipe (A:607-614, A:844-854) once it is carried into ISSUES.md.
4. **Manual passes that the plans deferred to "after apply"**: collections
   10-minute pass (EVENT_COLLECTIONS_PLAN §8 step 5), playbook one-host
   walk-through (HOST_EVENT_PLAYBOOK_PLAN §4), host onboarding on web with a
   real backend (HOST_ONBOARDING_PLAN §10 item 3), admin verification queue /
   standing control / categories page with a real admin login
   (HOST_ONBOARDING_PLAN §20, ISSUES.md batch 2 "not clicked through").
5. **Host notices end to end**: opt a demo host in, create an event starting
   within 24 h, confirm `host_notifications_sent` gets one row per notice and
   the in-app notification routes to the right screen (push itself is a
   device item).
6. Continue the ranked UI/UX flow passes from `docs/ISSUES.md:64-123`, in
   order: flow 2 (first event as a new host) → 3 (notification routing) →
   4 (report → moderation) → 5 (attendee journey after the event) → 6
   (premium lapse) → 7 (privacy from the outside) → 8 (account management) →
   9 (visual sweep, carrying the design-token cleanup).

### Step 4 — Device sessions (Owner, several sittings)
Follow `docs/ISSUES.md:125-176` in its order, adding the newer items:
onboarding on a phone; VoiceOver/TalkBack incl. playbook card, collections
sheets, Repeat sheet and series dates; offline on iOS + Android (NetInfo
native detection, banner, queue flush, chat waiting messages); event creation
end to end with connection drops; host tools click-through; first EAS build
with the fingerprint policy + one EAS Update; Discover/event-page gestures and
the `eventmap://event/<id>` cold start; `.maestro/calendar.yaml` and
`smoke.yaml`; Android push per channel incl. the two host notices; storage
cleanup actually deleting; the `originWhitelist` tightening on the Google map
page. Record results in ISSUES.md as each is done.

### Step 5 — Product decisions (Owner, one sitting)
Resolve M6 in one pass so the dependent work can be scheduled: approval mode
after RSVPs close; collections rule editor vs single column and the Interests
merge; categories D1; the six discovery-mode choices; host onboarding Q1/Q3/
Q5/Q6; host tools Q1-Q3/Q5-Q6; map tile provider (H5) — the one decision that
gates any public build.

### Step 6 — Hosted database (Owner, only if a hosted project exists)
Run the migration-history query against it; apply the gap in file order,
security set first (`20261030100000`, `…101000`, `…102000`, `…107000`); run
`backend:types` against it to confirm parity; record the result in the
Database state section from Step 1.

### Step 7 — Release blockers and hygiene (½ day + decision)
Map tiles (H5) per the Step 5 decision; `npm audit` leftovers that need an
Expo SDK bump; `npx expo install --check` alignments together with the first
native build; Supabase CLI bump by whoever owns the local stack; the GitHub
Support request for PR refs #1-13 (`docs/HISTORY_CLEANUP.md`) if the
submission still matters.

### Step 8 — Feature backlog (after Steps 0–5)
In rough value order, each already planned: discovery modes
(`docs/DISCOVERY_MODES_PLAN.md`, 15–30 h); host tools Phase 4 (check-in + QR,
CSV export, sections, co-hosts; `docs/HOST_TOOLS_PLAN.md` §11); host
onboarding Stages 6-8 leftovers (appeals queue, verified badge on Discover
cards via `get_ranked_events`, standing suggestions, transfer of ownership,
weekly digest); collections follow-ups (per-collection calendar source,
`webcal://` feed); the M2 small defects; the low-priority DB hardening list.

---

## 5. Per-document correction list

For Step 1. Line numbers are at `b4e63f9`.

| Doc | Lines | Change |
| --- | --- | --- |
| `docs/ISSUES.md` | 14-19, 37-57, 244-266 | Record `20261110*`, `20261112100000`, `20261113*` as applied; remove "NOT applied" |
| `docs/ISSUES.md` | 58-60 | 1038 tests; lint 8/2 warnings |
| `docs/ISSUES.md` | Ground rules | Add C1 safety note; scratch-name rule; harness notes (archive A:918, 921-925, 1043-1051, 1140) |
| `docs/ISSUES.md` | 373-380 | Add Phase 4 host tools, collections decisions, categories D1, discovery §6 |
| `docs/ISSUES.md` | Low | Add M2 dropped items; `get_user_past_event_count` |
| `ROADMAP.md` | 18-25, 31, 35-36 | Status + links for analytics/calendar/offline; collections A–F built, applied; playbook applied |
| `docs/EVENT_COLLECTIONS_PLAN.md` | 3-4, §8, §9 headings | "Phases A–F built, migration applied 2026-11-13"; drop "(uncommitted)"; G steps 1-2 done, 3-6 open |
| `docs/HOST_EVENT_PLAYBOOK_PLAN.md` | §5 P5/P6/P8, §7 P5/P6 | Match the header: applied; P8 = types + backend test + manual pass open |
| `docs/HOST_ONBOARDING_PLAN.md` | 3, §10 items 1-2, §20 gaps 1-3 | Built; applied; "eight" files; types still pending |
| `docs/HOST_TOOLS_PLAN.md` | §1, §10, §11 | Create tab always visible; migrations applied; `untypedRpc` done; Phase 4 partially done elsewhere; name drift |
| `docs/CATEGORIES_AND_SERIES_PLAN.md` | 3-6, §8 gap list | Applied; close G2/G5/G6/G8/G12/G24/G20/G21/G7/G4; note E-R1 widened by collections; add timezone flake |
| `docs/ANALYTICS_AND_CALENDAR_PLAN.md` | 3, §1.9, §2.7, handoff | Implemented and applied; `untypedRpc` done; Requests tab done; open: `webcal://`, Maestro run, check-in rate |
| `docs/OFFLINE_PLAN.md` | 6, 413, 501-503, 990-993 | ISSUES section moved to archive; `supabase/pending/` never existed, idempotency applied Nov 8; `expo-image` installed; clusterer still unpkg |
| `types/supabase.generated.ts` | 1-12 | Remove HAND-EDITED headers once regenerated |
| `.github/copilot-instructions.md` | "Realtime: Not currently used" | Realtime is used (RSVP counts, chat); `types/database.ts` is hand-written, `types/supabase.generated.ts` is generated |
