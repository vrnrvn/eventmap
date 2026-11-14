# Host event playbook plan

Status: updated 2026-11-13. The playbook was implemented and migrations
`20261113100000` and `20261113110000` were applied to the local Supabase
database and recorded in migration history. Hosted databases have not been
checked or changed. Earlier dated sections describe the state at that time.
The manual real-device pass and generated-type refresh remain to be done.

The original proposal extends
`docs/HOST_ONBOARDING_PLAN.md` (Stage 6 "Event lifecycle the host takes part
in") from a reference table into a product: a per-event, phase-aware,
interactive checklist that guides a host before publishing and after the
event ends.

---

## 1. What exists today

Three host-guidance systems already ship, all account-level or situational,
none per event:

| System | Scope | Where | Storage |
| --- | --- | --- | --- |
| Getting-started checklist (`utils/hostChecklist.ts`, `hooks/useHostChecklist.ts`, `components/HostChecklistCard.tsx`) | One list per host profile, 9 items (profile, publish, share, manage, capacity, announce, series, verify, notifications) | Profile (hosting mode), My Events, Settings → Host profile | Server facts via `get_host_onboarding_status` (20261110130000) + device-local signals (`utils/hostChecklistStore.ts`) |
| One-time tips (`utils/hostTips.ts`, `hooks/useHostTip.ts`) | 6 situational tips, shown once each (first RSVP, event full, chat opened, reports waiting, reschedule vs edit, last free event) | Create tab, Manage event | Device-local seen list (`utils/hostTipsStore.ts`) |
| First-event guide (`utils/firstEventGuide.ts`) | 3 inline hints while a host has zero events | Create tab | Device-local dismissal |

Also relevant:

- **Phase model.** `utils/hostEvent.ts` already classifies an event as
  `draft | upcoming | live | ended | postponed | cancelled` and derives
  per-phase capabilities (`canNotifyFollowers`, `canDuplicate`, …). The
  playbook keys off the same function.
- **Per-event facts** a host screen already loads: `get_event_host_overview`
  (going, waitlist, pending requests, views), `get_host_events_counts`
  (My Events), announcements, chat reports, capacity, approval and waitlist
  modes, event links and photos.
- **Post-publish sheet** (`components/EventPublishedSheet.tsx`): share and
  notify-followers CTAs, "first event" copy. This is the only "after you
  publish" guidance today.
- **Not built:** the Stage 6 "day-of host reminder" and "post-event summary"
  notifications; check-in (host tools Phase 4); any post-event prompt
  (thank-you, duplicate, make it a series).

Gaps the playbook fills: nothing tells a host what a *good* event page has
before publishing (beyond required-field validation), nothing follows up in
the lead-up, and after the event ends Manage event simply goes quiet.

---

## 2. Goals and non-goals

Goals

1. One place per event that answers "what should I do now?", in the host's
   current phase, with a tap taking them to the tool.
2. Items are mostly **derived** from facts the server already knows, so the
   list ticks itself as the host works. A few items are **manual** ticks for
   things the app cannot see (venue access confirmed, supplies packed).
3. Advice, never a gate: nothing here blocks publishing (server validation
   stays where it is).
4. Quiet for experienced hosts: collapsed by default after the host's third
   event, and dismissible per event.

Non-goals: check-in, co-hosts, task assignment, due dates and calendar
export of tasks, a generic to-do list.

---

## 3. Design

### 3.1 Phases and items

Phase comes from `getHostEventPhase`. Each item has `id`, `phase`, `title`,
`description`, `route` (or a local tab/sheet target, like `HostTipTarget`),
`kind: 'derived' | 'manual'`, and `done: boolean | null` (null = unknown,
hidden, same rule as `buildHostChecklist`).

**Before publishing** (`draft`)

| Item | Derived from |
| --- | --- |
| Clear title and the right type | `title` length, `category_id` set |
| A cover photo | `cover_image_url` or ≥1 photo |
| Description people can act on | `description` ≥ ~80 chars |
| Exact place | `lat`/`lng` plus `address` |
| Date, time and zone checked | `timezone` set, start in the future |
| Decide on a limit | `max_attendees` set, or manual "no limit, on purpose" tick |
| Ticket / info link, if any | ≥1 event link, or manual "none needed" |
| Publish | `publish_state = 'published'` |

**Lead-up** (`upcoming`, `postponed`)

| Item | Derived from |
| --- | --- |
| Share the event | device signal (same as the account checklist) |
| Notify your followers | `canNotifyFollowers` + notification row exists (or local signal) |
| Review pending requests | approval mode on and pending count = 0 |
| Pick a waitlist mode | capacity set and `waitlist_mode` chosen |
| Send a reminder announcement | announcement created within 72 h of start |
| Pin arrival details in chat | a pinned message exists, or manual tick |
| Clear chat reports | open reports = 0 |
| Confirm the venue / space (manual) | host tick |

**Day of** (`live`, or `upcoming` with start < 24 h)

Reminder announcement (as above), pinned arrival details, "Keep an eye on
chat" link. Check-in appears here once host tools Phase 4 ships.

**After** (`ended`)

| Item | Derived from |
| --- | --- |
| Thank everyone | announcement created after `end_datetime` |
| Look at how it went | opened Event insights (device signal) |
| Run it again | `duplicate_event` used or event made recurring |
| Reply to reviews (venues/organisers) | business reviews without a response = 0 |
| Note what to change next time (manual) | host tick |

Items can be filtered by host type like the account checklist (`forTypes`),
and by preset size (a 10-person meetup should not be told to pick a waitlist
mode).

### 3.2 Pure model

`utils/eventPlaybook.ts`, mirroring `utils/hostChecklist.ts`:

```ts
buildEventPlaybook({ event, phase, hostType, facts, manual, local }): EventPlaybook
// facts: PlaybookFacts (nullable counts from overview/announcements/reports)
// manual: Set<PlaybookItemId> ticked by the host
// local: { shared, openedInsights, notifiedFollowers }
// → { phase, items, doneCount, total, next, complete }
playbookVisibility({ playbook, dismissed, hostEventCount }) → 'hidden' | 'collapsed' | 'expanded'
```

Unit tests under `tests/eventPlaybook.test.ts` (node, no RN imports).

### 3.3 Storage

- **Derived items**: no storage; recomputed from the row and the overview.
- **Manual ticks and per-event dismissal**: server-side, so they survive
  reinstall and a second device. Smallest shape: `events.host_playbook jsonb`
  (`{ "ticked": ["venue_confirmed"], "dismissed": true }`) written through
  one RPC `set_event_playbook(p_event_id, p_patch)` that checks ownership.
  No new table, no new RLS policy, one migration.
- **Device signals** (shared, opened insights): `utils/eventPlaybookStore.ts`
  keyed by event id, same pattern as `hostChecklistStore`.
- Until the migration is applied, the service falls back to device-local
  ticks (`isMissingDbFunction`), following the house rule "migrations apply
  last" (`docs/EVENT_COLLECTIONS_PLAN.md` §5).

### 3.4 Surfaces

1. **Manage event → Overview**: a `EventPlaybookCard` at the top (progress,
   next item, expand for the list, dismiss). Replaces the quiet state after
   an event ends with the "After" list.
2. **Create / Edit tab**: the "Before publishing" list rendered as a
   readiness panel inside the existing preview sheet (`EventPreviewSheet`),
   so the host sees it right where they publish. Nothing blocks.
3. **My Events**: a small progress pill per upcoming/ended event ("2 to do")
   that deep-links into the Manage hub card. Counts come from a new light RPC
   or are folded into `get_host_events_counts`.
4. **Notifications** (server): day-of host reminder ("starts in 2 h") and a
   post-event summary ("42 went, 8 on waitlist · thank everyone / run it
   again"), both deep-linking to the hub. Reuse the reminder scheduler that
   sends attendee reminders (`event_reminder_minutes`); confirm it can target
   the owner.

### 3.5 Relationship to existing guidance

- The account checklist stays account-level ("publish your first event").
  Its `share`, `manage`, `capacity`, `announce` items should auto-tick from
  playbook progress, so a host is not asked twice.
- Tips stay situational and one-time; the playbook is persistent per event.
  Where both would show (e.g. event full), the tip wins and the playbook item
  appears already ticked.
- The post-publish sheet gains one line: "Next: your lead-up checklist" →
  hub.

---

## 4. Testing

- Unit: item derivation per phase, unknown-hides rule, host-type and preset
  filtering, visibility rules, store parsing. Property test: ticking never
  un-ticks a derived item.
- SQL: `scripts/test-event-playbook.sql` for the RPC (owner only, patch
  merge, rejects non-owner).
- E2E: extend `scripts/fake-backend-e2e/suiteHostUi.mjs` with the card in
  draft → published → ended states, 320 px layout, 44 px targets.
- Manual: one host, one event through all phases on the shared local DB
  (`SCRATCH_DB` per worktree; do not apply the migration without the owner).

---

## 5. Phasing and estimates

**Database constraint (2026-11-13).** The local Supabase instance is shared
with another dev session, so no phase here touches it. SQL is written as a
file and left unapplied; the owner applies it. Every client phase ships with
a working device-local path first, so nothing waits on a migration.

| Phase | Scope | Est. | Status |
| --- | --- | --- | --- |
| **P1. Foundations** | `utils/eventPlaybook.ts` (stages, items, unknown-hides rule, visibility, pill label), `utils/eventPlaybookStore.ts` (manual ticks, per-stage dismissal, device signals, pruning), unit tests | 3–4 h | **done 2026-11-13** |
| **P2. Manage hub card** | `components/EventPlaybookCard.tsx` + `hooks/useEventPlaybook.ts` joining the event row, `get_event_host_overview` and the local store; collapsed/expanded, tick, dismiss, target→route map | 5–7 h | **done 2026-11-13** |
| **P3. Pre-publish readiness** | The "before" list inside `EventPreviewSheet`, live as the host edits; Edit screen parity | 2–3 h | **done 2026-11-13** |
| **P4. My Events pill + cross-ticks** | `playbookPillLabel` per row, deep link into the hub card, auto-tick the account checklist's share/manage/capacity/announce items | 3–4 h | **done 2026-11-13** |
| **P5. Server persistence** (SQL prepared, not applied) | `events.host_playbook jsonb` + `set_event_playbook` RPC, `services/eventPlaybook.ts` with `isMissingDbFunction` fallback to P1's store, hand-written types, fake-backend double, `scripts/test-event-playbook.sql` | 3–4 h | **built 2026-11-13, migration unapplied** |
| **P6. Host notifications** (SQL prepared, not applied) | Day-of host reminder and post-event summary, deep links, Settings opt-in (owner: off by default, consent first) | 3–5 h | **built 2026-11-13, migration unapplied** |
| **P7. Polish + carried findings** | A11y pass, `suiteHostUi.mjs` scenarios, post-publish sheet hand-off line, plus the three findings in §8 (Edit scroll-to-field, `formToPreviewEvent` publish state, fold `previewGaps` into the checklist) | 3–5 h | **done 2026-11-13** |
| **P8. Apply and verify** (owner) | Apply P5/P6 SQL, `npm run backend:types`, `npm run test:backend`, manual pass | 1 h | |

Serial order P1 → P2 → P3 → P4 → P7, with P5 and P6 landing whenever the
owner is ready. **Total 22–31 h**, of which **10–14 h** (P1–P3) gives a host
a usable playbook with no database change at all.

---

## 6. Decisions

Answered by the owner on 2026-11-13:

1. **Name:** "Checklist" in the UI; "playbook" only in code and docs.
2. **Collapse threshold:** from EXPERIENCED_HOST_EVENTS (3) published events
   on, plus per-stage dismissal (implementer default, accepted).
3. **Manual items:** `venue_confirmed`, `lessons`, and the "on purpose" ticks
   on `capacity`, `links`, `reminder_announcement`, `thank_you`.
4. **Verification prompt in "After":** deferred to Stage 7 work.
5. **Server-side ticks:** ship device-local first (P1/P2), add the prepared
   migration in P5 with the fallback already in place.
6. **Premium:** everything here is free. No gating anywhere in the playbook.
7. **Host notifications (P6):** approved, on condition that hosts opt in
   first (a Settings switch, off by default, before any push is sent).
8. **Database:** never touched from this work; SQL is prepared as files.

---

## 7. Implementation log

### P1 — foundations, 2026-11-13 (this worktree, uncommitted)

**Database: untouched.** No migration written or applied in this phase; the
model needs none.

New files:

- `utils/eventPlaybook.ts` — pure model. `playbookStage()` maps the existing
  `getHostEventPhase` to `before | leadup | dayof | after | none`, with the
  final `DAY_OF_HOURS` (24 h) before the start switching the lead-up list to
  the day-of list, and `next_start_datetime` honoured so a series stages off
  its next occurrence rather than its first date. `buildEventPlaybook()`
  returns the items for the current stage from three sources: the event row,
  `PlaybookFacts` (nullable server facts) and `PlaybookLocalSignals`.
  `playbookVisibility()` and `playbookPillLabel()` own the card's state and
  the My Events label. Route-free: items carry a `PlaybookTarget`, mapped to
  routes by the screen in P2.
- `utils/eventPlaybookStore.ts` — AsyncStorage, one key per event. Manual
  ticks are two-way; signals are one-way; dismissal is per stage; a
  `prunePlaybookLocal(keepIds)` keeps keys from accumulating for the life of
  the install.
- `tests/eventPlaybook.test.ts` (26 cases), `tests/eventPlaybookStore.test.ts`
  (6 cases). Full suite 1019 passing, typecheck and lint clean.

Design decisions taken while building (all reversible in P2):

1. **Manual items are never hidden.** The unknown-hides rule from
   `buildHostChecklist` would have hidden "thank everyone" (the app cannot
   see announcements per event yet), which is the single most valuable
   after-item. Items the host can tick are therefore always listed; only
   derived-and-unknown items disappear.
2. **Some items are both.** `capacity` and `links` tick themselves from the
   row, *or* the host can tick them to mean "no limit / nothing to link, on
   purpose". Same for `reminder_announcement` and `thank_you` until P5 can
   read announcement timestamps.
3. **Attention items appear only when actionable.** `clear_reports` is listed
   only while `open_reports > 0`; a permanently ticked "no reports" is noise.
4. **Dismissal is per stage**, so dismissing the lead-up list does not also
   silence the after-event list days later.
5. **Unknown host event count collapses the card** — the quieter wrong
   answer, matching the account checklist's `preexistingHost` reasoning.

### P2 — Manage hub card, 2026-11-13 (this worktree, uncommitted)

**Database: untouched.**

- `hooks/useEventPlaybook.ts` — joins the event row, the hub's facts (passed
  in, nothing fetched twice), this device's ticks/signals and the published
  count. The count reuses `queryKeys.hostChecklist` and
  `hostChecklistService.getStatus`, so the two cards read one cached value.
  Owner-gated via `enabled`; an admin viewing someone else's event cannot
  tick or dismiss. Ticks are optimistic.
- `utils/eventPlaybook.ts` gained `playbookFactsFromHub()`: maps the
  overview, details and chat status into facts. Conservative by design: it
  infers `true` (an announcement today inside the final 24 h is the reminder;
  one on the day the event ended is the thank-you) or stays unknown, never
  `false`. 4 new unit tests.
- `components/EventPlaybookCard.tsx` — "Checklist · {stage}" header,
  progress bar, expand/collapse, dismiss. Manual items render a real
  checkbox (square corners, `aria-checked`); derived items are read-only
  ticks whose row opens the tool. Collapsed shows "Next". 44 px targets.
  Added the `ListChecks` icon via `scripts/generate-icons.mjs`.
- `screens/ManageEvent.tsx` — card mounted under the one-time tip on
  Overview; `handlePlaybookAction` maps each `PlaybookTarget` to a route,
  tab, or sheet. Feeds the series' next occurrence so a weekly event stages
  off its next date. New **Share** row in the Manage section (the hub had
  no share action; the playbook's first lead-up item needed one). Signals
  recorded on share, notify-followers success, duplicate success and opening
  Insights. `components/EventPublishedSheet.tsx` share also records it.
- Verified: typecheck, lint, 1023 unit tests. Browser scenarios for the
  card are P7 (`suiteHostUi.mjs`).

Known gaps carried to later phases: the `reviews` target opens the host's
public page rather than a reviews tab (none exists); `pin_details` and
`thank_you` only auto-tick from coarse signals until P5 reads announcement
timestamps; no focus-refetch of the local store (the card lives only on this
screen).

### P3 — pre-publish readiness, 2026-11-13 (this worktree, uncommitted)

**Database: untouched.**

- `utils/eventPlaybook.ts` gained `omitPlaybookItems()`: the same playbook
  minus named items, counts recomputed. Both new surfaces drop `publish` —
  in the preview sheet it is the sheet's own primary button, and in Edit it
  lives in the Manage hub.
- `hooks/useEventPlaybook.ts` gained an **unsaved-form mode**: `eventId:
  null` keeps ticks in memory. Deliberately *not* persisted under a shared
  "new event" key, which would carry a "no limit, on purpose" tick onto the
  host's next event and show it as done when it is not.
- `components/EventPlaybookCard.tsx`: `onAction` and `onDismiss` are now
  optional. Without `onAction` the rows are informational (no chevron, text
  role) rather than falsely tappable — that is the Edit case, where the
  screen already *is* the tool every item points at.
- `components/EventPreviewSheet.tsx` renders the checklist (always expanded:
  the host tapped Preview to check the event over) or, when complete, a
  one-line "Ready to publish". The old `gaps` line stays as the fallback for
  when no host profile is loaded.
- `app/(tabs)/create.tsx`: builds the checklist from the unsaved form,
  overriding `publish_state` to `'draft'` (`formToPreviewEvent` marks the
  preview published so the Discover card renders like a live one). Tapping
  an item closes the sheet and **scrolls to the matching form section**,
  reusing the existing `sectionY` anchors from validation.
- `screens/EditEvent.tsx`: the same list inline above Save, **drafts only** —
  a published event's checklist is the lead-up list in the hub, and
  repeating it inside the edit form would be noise. Ticks persist here
  (there is a real event id).
- Verified: typecheck, lint, 1025 unit tests (32 for the playbook model).

Three findings logged in `docs/ISSUES.md` (Low): Edit does not scroll to a
failing field though Create does; `formToPreviewEvent` hardcodes
`publish_state: 'published'`; `previewGaps` is now a fallback only.

### P4 — My Events pill and cross-ticks, 2026-11-13 (this worktree, uncommitted)

**Database: untouched.**

- `utils/eventPlaybookStore.ts` gained `readPlaybookLocalMany()`: one
  `multiGet` for a whole list instead of N reads.
- `utils/eventPlaybook.ts` gained `announcementItemForStage()`. The hub can
  only count announcements per day, not tell what they were for; when the
  host sends one *from the hub* we know their stage, so the exact item is
  ticked rather than inferred.
- `hooks/useEventPlaybookPills.ts` — "2 to do" labels for a list, from the
  event row and device state only. **No extra request is made for a list**,
  so unknown items stay hidden and the count is a floor, never inflated. A
  stage dismissed in the hub silences its pill here too.
- `screens/MyEvents.tsx` — the pill sits in the title row (the actions row
  already carries four buttons and would crowd at 320 px). With work left,
  the row opens `?checklist=1`; `screens/ManageEvent.tsx` reads that and
  opens the card expanded via the card's new `initialExpanded`.
- **Cross-ticks:** sending an announcement or changing capacity in the hub
  now invalidates `queryKeys.hostChecklist`, so the getting-started
  checklist's "Post an announcement" and "Set an attendee limit" steps tick
  immediately instead of lagging until the query goes stale. Share and
  "Open Manage event" were already wired in P1/P2.
- Verified in the foreground: typecheck, lint, 1028 unit tests. The four
  `exhaustive-deps` warnings in `MyEvents.tsx` are pre-existing (identical
  in `git show HEAD:screens/MyEvents.tsx`); the two this work introduced
  were fixed.

---

## 8. Carried findings — all fixed in P7 (2026-11-13)

Noticed while building P2–P4, none of them blocking. All three are now done;
the `docs/ISSUES.md` entries are ticked:

1. **Edit event does not scroll to a failing field.** `handleSubmit`
   announces `validationSummary` for screen readers
   (`screens/EditEvent.tsx`) but never scrolls, so on a long form Save can
   appear to do nothing. Create does this correctly with `sectionY`,
   `FIELD_SECTION` and `scrollViewRef.scrollTo`. Port those three pieces.
2. **`formToPreviewEvent` hardcodes `publish_state: 'published'`** so the
   Discover card renders like a live event. Any caller deriving host state
   from a preview must override it (P3 does). Add a named override or a
   comment at the call sites.
3. **`previewGaps` is a fallback only** now that the publish preview shows
   the checklist. Fold it in and delete the helper if nothing else needs it.

Also tracked in `docs/ISSUES.md` (Low), each pointing here.

### P5 — server persistence, 2026-11-13 (this worktree, uncommitted)

**The shared database was not touched.** The migration is written and left
unapplied; it was validated on a throwaway native cluster
(`scripts/db-isolated.sh init` → 120 migrations + seed, destroyed
afterwards), never on the shared instance.

- `supabase/migrations/20261113100000_event_host_playbook.sql` —
  `event_host_playbook` (one row per event: `ticked`, `dismissed_stages`)
  plus `set_event_playbook_item` and `dismiss_event_playbook_stage`.

  Two decisions worth keeping:

  1. **A table, not a column on `events`.** `get_event_details` returns the
     whole events row to every viewer, so a `host_playbook` column there
     would ship the host's private checklist state to attendees.
  2. **No insert/update policy and no write grant.** The table is readable
     by its host under RLS and writable *only* through the two SECURITY
     DEFINER RPCs. That is what keeps the stored vocabulary valid — a direct
     PostgREST write could otherwise put arbitrary text in the arrays — and
     the RPCs merge server-side, so two devices cannot clobber each other's
     ticks.

- `scripts/test-event-playbook.sql` — 17 ASSERTs in a rolled-back
  transaction: tick/un-tick, idempotency, append without replacing, stage
  dismissal, rejection of unknown stages and malformed item ids, non-host
  writes refused (`42501`), RLS invisibility to non-hosts, direct
  table writes refused, and cascade on event delete. **All pass**, and the
  migration is idempotent on re-apply.
- `services/eventPlaybook.ts` — batched `getMany` for lists, `get`,
  `setItem`, `dismissStage`. A backend without the table reports
  `unavailable` (not an exception) and the outage is latched for the
  session, so a list screen does not pay one failed round trip per render.
- `utils/eventPlaybook.ts` gained `resolvePlaybookState()`. The server is
  authoritative once it has anything, **except** for the hand-over: a host
  who ticked items in P1–P4 has a local copy and an empty server row, and
  taking the server's word there would silently throw their work away. The
  local copy wins once and is uploaded. 5 unit tests cover the rule.
- Both hooks now read the server copy and write through to both stores, so
  the device copy stays a usable fallback. Writes are best-effort: a failed
  server write leaves the local tick in place.
- `types/supabase.generated.ts` — hand-written entries for the table and
  both RPCs, with a dated header note, until `npm run backend:types` runs.
- `scripts/fake-backend-e2e/fakebackend.mjs` — mirrors the SQL (same merge,
  same validation, same error codes). `data.playbookUnavailable` makes the
  table look unapplied so the fallback path is exercised for real in P7.
- Verified in the foreground: typecheck, lint, 1033 unit tests, plus the SQL
  suite on the isolated cluster.

**For the owner, when you want it live:** apply
`supabase/migrations/20261113100000_event_host_playbook.sql`, run
`npm run backend:types`, then re-run `scripts/test-event-playbook.sql`.
Nothing in the app waits on this — without the migration every host keeps
their checklist on the device.

### P6 — host notifications, 2026-11-13 (this worktree, uncommitted)

**The shared database was not touched.** Both migrations below stay
unapplied; everything was validated on a throwaway native cluster
(`scripts/db-isolated.sh`, 121 migrations + seed, destroyed afterwards).

**What was already there.** Migration 20261110160000 (unapplied, from Stage
6 of the onboarding plan) already delivers both notices —
`send_host_event_notices()` on a 15-minute cron, deduped in
`host_notifications_sent`. P6 did not need to rebuild that. But it gates on
`businesses.notifications_enabled`, which **defaults to TRUE**: applying it
as-is would start pushing to every existing host without asking. That
contradicts the owner's decision (consent first), so:

- `supabase/migrations/20261113110000_host_notice_optin.sql` adds
  `host_day_of_notice` and `host_post_event_notice` (both `DEFAULT false`)
  and re-creates `send_host_event_notices()` to require them.
  `notifications_enabled` stays the master switch, so a host who wants
  nothing does not have to find three switches.
- `scripts/test-host-notice-optin.sql` — the suite exists to prove the
  consent rule: defaults are off; an opted-out host gets nothing; an
  opted-in host gets exactly one of each; a second cron pass sends no
  duplicates; one switch on does not enable the other; the master switch
  still silences both. **All pass**, and the file is idempotent.

**Client (works today, with or without the migrations):**

- `utils/notificationRoute.ts` + 5 tests — extracted from the notifications
  screen, which routed *any* notification carrying an `eventId` to
  `/event/{id}`. Host notices carry one too, so a host tapping "your event
  is today" would have landed on the public attendee page instead of the
  hub. Now day-of opens the hub, and the post-event summary opens
  `?checklist=1` — the after-the-event list from P4, which is exactly what
  that notification is telling them to do.
- `services/notifications.ts` — the four host notice types are in the
  union, so they render with their own icon instead of the unknown-type
  fallback (`host_verification_update` and `host_standing_update` ship in
  the same unapplied migration and were missing too).
- `app/(tabs)/notifications.tsx` — icons for the four, and the press
  handler now delegates to the pure helper.
- `screens/Settings.tsx` — two switches under host Notifications, off by
  default, each disabled while the master switch is off. They only render
  once the columns exist (`host_day_of_notice !== undefined`), so before
  the migration there is no switch that writes nowhere.
- `types/database.ts`, `types/supabase.generated.ts` (hand-written),
  `scripts/fake-backend-e2e/fakebackend.mjs` (business row carries both
  columns, off).
- Verified in the foreground: typecheck, lint (no new warnings), 1038 unit
  tests, both SQL suites on the isolated cluster.

**Still needs the owner, at the end of the roadmap:** apply
20261110160000 (if not already), then 20261113110000, then
`npm run backend:types`. Until then no host notice is sent at all, and the
Settings switches stay hidden — which is the safe state.

### P7 — polish, carried findings and a UI pass, 2026-11-13 (uncommitted)

**Carried findings, all three fixed:**

1. **Edit now scrolls to the failing field.** `sectionY` anchors,
   `EDIT_FIELD_SECTION` and `scrollToFirstError`, ported from Create. The
   anchors are zero-height `View`s rather than wrappers, so no existing
   layout moved.
2. **`formToPreviewEvent` no longer claims to be published.** The lie was
   removed instead of documented: nothing in the preview path reads the
   field (the comment's claim about the Event Detail header was stale — that
   screen uses `utils/eventPreview.ts`), so an unsaved event is `'draft'`,
   which is what it is. The override in `create.tsx` went with it.
3. **`previewGaps` deleted**, with its call site and tests. The publish
   preview shows the checklist only; the Create form is unreachable without
   a host profile, so the fallback was dead code.

**A UI problem the screenshots caught — and the fix.** The browser pass
showed the P3 checklist rendering *below the fold* in the publish preview:
the sheet is already at `maxHeight: 92%`, and the Discover card alone fills
the visible scroll area, so the checklist sat under it where nobody would
scroll. A feature nobody sees is not a feature. It now sits **above** the
card and **collapsed**, so the host gets one glance ("3 of 7 done · Next:
Add a cover photo") and the preview is still right beneath it. When the list
is complete it collapses further to a single "Ready to publish" line, and
the card is fully visible again.

**Other P7 work:**

- Post-publish sheet hands off to the checklist: "Open Manage event" now
  reads "Your lead-up checklist, attendees, capacity and chat" and routes to
  `?checklist=1`, so a host who just published lands on what to do next.
- `scripts/fake-backend-e2e/suiteHostUi.mjs` gained **U8, U9 and U10**:
  the hub card (stage, manual tick, progress, dismissal), the collapsed card
  for an established host plus the `?checklist=1` deep link, and ticks
  surviving a reload *and* working on a backend with no checklist table
  (`data.playbookUnavailable`). U4 now asserts the My Events pill.
- `scripts/fake-backend-e2e/harness.mjs`: `click()` now also matches
  `[role=checkbox]` and `[role=switch]`. Those were unreachable from any
  suite, which is why no test had ever driven a Settings switch.

**Verified in a real browser (fake backend, no database):**

| Suite | Result |
| --- | --- |
| `suiteHostUi` all scenarios, 390 px and 320 px | **168/168** |
| `suiteHost` all scenarios | **92/92** |
| Unit tests | **1038** |
| Typecheck / lint | clean (remaining warnings are all pre-existing, in files this work never touched) |

Screenshots were reviewed by eye at both widths: the manual-vs-derived tick
shapes (square vs round) read clearly, nothing clips or overflows at 320 px,
and every control meets 44 px.

### P7+ — flagged UI items and the full regression, 2026-11-13 (uncommitted)

**The cramped publish preview, measured and fixed.** Rather than guess, the
sheet was measured in the browser at both phone widths. At 320 px the
viewport is 425 px: the sheet's three stacked full-width buttons took ~170 px
and the collapsed checklist another 123 px, which left **nothing** for the
event preview — the card started below the fold. Three changes, ~155 px
reclaimed:

1. `EventPlaybookCard` gained a `compact` mode: one 44 px line
   ("Checklist 3/7 · Add a cover photo ›") that opens the full, tickable
   list on tap. Used only by the preview sheet.
2. The two secondary actions share a row instead of stacking. "Save as
   Draft" and "Keep Editing" are both still full labels and still 44 px.
3. `showsVerticalScrollIndicator` is back on. The sheet always has more
   content below the fold on a phone, and hiding the indicator left no hint
   that it scrolled at all.

At 390 px the whole preview card (image, title, date, chips, host) now fits
with the checklist line and every action visible; at 320 px the card's image
and the checklist both fit. Asserted in `suiteHostUi` U6 at both widths,
including that the summary opens the list.

**Lint debt cleared in the two files this work touched.**
`screens/MyEvents.tsx` now derives a `businessId` and depends on it, which
is what the four callbacks actually used — depending on the whole business
object would have re-created them on every AppContext refresh, which is why
the dependency arrays disagreed with the bodies in the first place.
`screens/Settings.tsx`: merged the duplicate `expo-router` imports, dropped
an unused gradient, and fixed five unused catch bindings (two of the catches
did use theirs and kept it). **Zero warnings remain in any file this work
touched** (47 remain elsewhere in the repo, untouched and pre-existing).

**`axe-core` is still not installed.** `npm install --save-dev axe-core` was
refused by this environment's permission policy, so the WCAG A/AA pass in
`suiteHostUi` / `suiteA11y` could not run. Every structural accessibility
check did run and pass (labels, 24 px floor, 44 px targets, headings,
horizontal overflow, clipped labels, runtime errors). **This is the one gap
in the testing story** — see `docs/ISSUES.md`.

#### Full regression, 2026-11-13 (foreground, fake backend, no database)

| Suite | Result |
| --- | --- |
| A — cold start, persisted cache, offline restart | **21/21** |
| B — notifications, saved, chat, business mode, 320/1280 px | **46/46** |
| C — stress (5,000 notifications, 400 events) | **13/13** |
| D — offline→online recovery, token refresh | **30/30** |
| F — the offline day, sign-out, second user | **25/25** |
| Host — onboarding stages 1–4, tips, trust | **92/92** |
| HostUi — host screens at 390 px and 320 px | **168/168** |
| Collections | **168/168** |
| Onboarding | **57/57** |
| A11y (axe) | **not run** — axe-core unavailable |
| Unit (vitest) | **1038/1038** |
| SQL on an isolated throwaway cluster | both suites pass |
| Typecheck · lint | clean · no warnings in touched files |

Totals: **620 browser checks** plus 1038 unit tests, all passing. The shared
database was never touched; the isolated cluster was destroyed after use.
