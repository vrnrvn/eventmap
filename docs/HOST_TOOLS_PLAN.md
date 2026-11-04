# Host organisation tools plan

Status: written 2026-11-03. Phase 1 foundations started the same day (see
"Implementation log" at the end). The rest is a proposal. This is
a review of what hosts can do today and a proposal for a coherent set of
organisation tools covering attendance, details, time zones, moderation and
communication, sized for small meetups through large venue events.

## 1. What exists today

### Data model (`supabase/migrations/`)
- `events`: title, description, category, `start_datetime`/`end_datetime`
  (`timestamptz`), lat/lng/address, cover image, `is_recurring` +
  `recurrence_pattern` jsonb (daily/weekly/monthly, interval 1, optional end
  date), `status` (`active` | `cancelled`), `max_attendees` (NULL = unlimited).
- No timezone column, no visibility/draft flag, no price or ticket fields, no
  per-occurrence exceptions. RSVPs are per series, not per occurrence.
- `rsvps` (`going` | `interested`, unique per user+event), `event_waitlist`
  (notify-only, no auto-promote), `event_rsvp_counts` (realtime counts),
  `event_chat_settings` (`locked`, `slow_mode_seconds`), `event_chat_blocks`,
  moderation audit log, `event_views`.
- Creation goes only through `create_event_with_limit_check` (INSERT policy was
  dropped). It does not accept `max_attendees`; the client writes capacity in a
  second, non-fatal UPDATE (`app/(tabs)/create.tsx:340-353`).
- UPDATE policy is owner-only with **no column restriction**. The only guard is
  the lifecycle trigger: status can change only via `cancel_event`, and a
  cancelled event is read-only. A host can still move the start time, lower
  capacity below the going count, or change `business_id` freely.
- Free: 2 events/month, no recurrence. Premium: 30/month, recurrence, ranking
  boost. Analytics and photo count are gated client-side only.

### Host-facing UI
- `app/(tabs)/create.tsx` (1332 lines) and `screens/EditEvent.tsx` (1041 lines)
  are near-duplicate forms: basics, category, date/time, repeat, location,
  capacity, links, photos. Each defines its own section/card styles.
- `screens/MyEvents.tsx`: Upcoming/Past list with Edit, Notify followers,
  Insights, Cancel. No per-row stats (no going/interested/waitlist counts).
- `screens/EventDetail.tsx` (2239 lines): owner sees Edit, Cancel, Manage chat,
  Insights banner. Capacity shown as "X / max going". Waitlist is attendee-side
  only; the host has no waitlist view.
- `components/AttendeesBottomSheet.tsx`: identical for host and attendee. No
  remove, message, export or check-in.
- `components/ChatModerationSheet.tsx`: lock, slow mode, blocked list, report
  queue, log. This is the most complete host tool in the app.
- `app/business/event-insights/[id].tsx`: live save/RSVP counts plus simulated
  charts.
- `host_remove_attendee` RPC exists (`20261102150000`) but **no client calls
  it** (also `docs/ISSUES.md:439`).

### Time handling
- Everything is a UTC instant rendered in the device zone. `timeZoneLabel()` in
  `utils/formatEventWhen.ts` only labels the viewer's zone.
- Server `event_has_ended` and `event_next_occurrence` use the session zone
  (UTC on Supabase), so recurring events drift an hour across DST and "ended"
  for recurring series is judged on the UTC calendar day.
- ICS export writes UTC with no TZID; a weekly RRULE shifts across DST.
- Several screens hard-code `'en-US'` (`EventDetail.tsx:627-641`,
  `create.tsx:455`, `EditEvent.tsx:538`, `utils/relativeTime.ts:25`).

### Communication
- All notifications are produced by DB triggers/RPCs: event updated (time or
  place change), cancelled, reminders, new-event-to-followers, waitlist spot,
  chat messages/mentions, moderation.
- Hosts have **no way to send a custom message** to attendees. Chat requires two
  going attendees; host posting without RSVP arrives only with the pending
  `20261102120000` migration.

### Pending state
Several `20261102*` migrations (host posting, live counts, waitlist, moderation
feedback, `host_remove_attendee`) are marked "validated on a scratch copy, not
applied to the shared DB". The plan below assumes they are applied first.

### Shared UI primitives available
`Button` (4 variants), `TextField`, `Input`, `ScreenHeader`, `ErrorState`,
`EventListItem`, gorhom `BottomSheetModal` pattern, `notify.*` toasts,
`notifyConfirm`/`confirmAction`. **Missing**: shared Switch row, SegmentedControl,
Chip, Stepper, SettingsSection/Card. Each screen hand-rolls these today.

## 2. Design principles

1. **Progressive disclosure by event size.** A 10-person run club must not see
   approval queues and check-in. Defaults come from an event type preset; every
   setting stays overridable.
2. **Server enforces, client explains.** Every new option is a column + RLS/
   trigger/RPC first, then UI. Nothing gated only client-side.
3. **One "Manage event" hub** instead of actions scattered across MyEvents,
   EventDetail, the chat screen and the attendee sheet.
4. **Edit the event, not the attendees' expectations.** Material changes
   (time, place, capacity down, cancel) go through explicit flows that notify.
5. **Reuse what exists.** Chat moderation, cancel, waitlist and remove-attendee
   are already server-side; the first phases are mostly wiring and UI.

## 3. Event size tiers and presets

| Preset | Typical size | Default settings |
| --- | --- | --- |
| Casual meetup | < 20 | Unlimited or small cap, open RSVP, chat on, no waitlist, reminder 1 h |
| Class / workshop | 10–50 | Cap required, waitlist on, approval off, chat announcements-only until day of, reminder 24 h + 1 h |
| Venue show / party | 50–300 | Cap, waitlist, ticket link, chat slow mode 30 s, host announcements, check-in optional |
| Large / festival | 300+ or multi-day | Cap, waitlist with auto-promote, chat off or announcements-only, agenda/sections, check-in, co-hosts (later) |

Preset selection is a chip row at the top of Create. It only prefills; the
`event_type` is stored for analytics and copy, not for enforcement. "Recurring
series" is orthogonal: any preset can repeat (premium).

## 4. Feature areas

### A. Manage event hub (UI architecture)
New route `app/business/manage-event/[id].tsx` with a `ScreenHeader` and a
segmented control: **Overview · Attendees · Settings · Chat**.
- Overview: status badge, next occurrence, going / interested / waitlist /
  views counts (from `event_rsvp_counts` + details RPC), quick actions
  (Edit details, Announce, Share, Duplicate, Reschedule, Cancel).
- Attendees: host variant of the attendee list (see B).
- Settings: the toggles and pickers from B, C, D, F grouped in
  `SettingsSection` cards (reuse the `Settings.tsx` privacyRow pattern).
- Chat: embeds the existing `ChatModerationSheet` content inline.
Entry points: MyEvents row tap for owners, EventDetail owner banner
("You're hosting · Manage"), notification deep links for RSVP/waitlist events.
Edit Event stays a separate screen for content fields only.

Shared components to build first (also fixes the local `Palette` and
duplicated row styles): `SwitchRow`, `SegmentedControl`, `Chip`/`ChipGroup`,
`Stepper`, `SettingsSection`.

### B. Attendance
Data / server:
- Move `max_attendees` into `create_event_with_limit_check` (remove the
  second write).
- `rsvp_mode text CHECK IN ('open','approval','invite','closed')` default
  `open`. `approval`: RSVP inserts as `status='requested'`; host approves via
  `host_review_rsvp(p_event_id, p_user_id, p_decision)`. `invite`: only users
  with an `event_invites` row may join. `closed`: no new RSVPs (door closed /
  sold out externally).
- Extend `rsvps.status` CHECK to add `requested` and `checked_in`. Capacity
  trigger counts `going` + `checked_in` only.
- `waitlist_mode text CHECK IN ('off','notify','auto')` default `notify`.
  `auto` promotes the earliest waitlisted user into `going` inside the existing
  `sync_event_waitlist` trigger and notifies them.
- `event_bans (event_id, user_id, reason, created_by)`: `host_remove_attendee`
  gains `p_ban boolean`; `join_event_with_capacity` and waitlist join check it.
  Closes the gap where removed users can rejoin.
- `host_checkin_attendee(p_event_id, p_user_id)` and an `event_checkin_code`
  (rotating per event, premium) for QR scan at the door with `expo-camera`,
  which is already a dependency.
- Trigger: block lowering `max_attendees` below current going unless the
  request sets `eventmap.allow_capacity_shrink` (set by a confirming RPC that
  also notifies the host of waitlist implications).
- Block the host's own business owner from RSVPing to their own event
  (`ISSUES.md:489`).
- `export_event_attendees(p_event_id) → text` CSV (name, status, joined at,
  checked in) for hosts, premium.

UI (Attendees tab):
- Segments: Going · Requested (approval mode) · Waitlist · Removed.
- Row actions sheet: Check in, Approve/Decline, Promote from waitlist, Remove
  (with "also block from rejoining"), View profile.
- Header: capacity stepper, RSVP mode chip row, waitlist mode, "Close RSVPs"
  switch, Export button.
- Small events hide Requested/Waitlist segments when the mode is off.

### C. Details and publishing
Data / server:
- `visibility text CHECK IN ('public','unlisted')`: unlisted excludes from
  `get_ranked_events` and search but allows share-link access via
  `get_event_details`.
- `publish_state text CHECK IN ('draft','published')`: drafts are owner-only in
  RLS, do not count toward the monthly limit until published (move the counter
  increment to a `publish_event` RPC), and never fire the followers trigger.
- `ticket_url text`, `price_label text` (free text like "Free" or "€12 at the
  door"; no payment processing, consistent with README), `age_restriction text`
  (`none`, `18+`, `21+`), `accessibility_notes text`, `what_to_bring text`.
- `event_sections (event_id, title, body, sort_order)` for agenda / line-up /
  FAQ on larger events (premium, max 10).
- Column-level UPDATE guard trigger: after publish, `business_id` and
  `category_id` are frozen; `start_datetime`/`end_datetime`/location changes
  must come through `reschedule_event` (below) once anyone is going.

UI:
- Create form gets a **"More options"** accordion below Capacity holding
  visibility, ticket/price, age, accessibility, notes. Presets prefill which
  ones are expanded.
- Draft: "Save draft" secondary button next to Publish. MyEvents gains a Drafts
  segment.
- EventDetail renders ticket/price pill, age badge, sections list.

### D. Time zones
Data / server:
- `events.timezone text NOT NULL DEFAULT 'UTC'` (IANA). Backfill existing rows
  from the business location via a static lat/lng → zone lookup or default to
  the single demo zone; new rows default from the device at create time.
- Rewrite `event_has_ended` and `event_next_occurrence` to compute in
  `timezone` (`start_datetime AT TIME ZONE events.timezone`), fixing DST drift
  and the UTC-calendar-day "ended" check. Same for the date filter in
  `get_ranked_events`.
- Validate the zone against `pg_timezone_names` in the create/update path.

Client:
- Create/Edit: a "Time zone" row defaulting to the device zone, with a searchable
  picker (grouped by region, `Intl.supportedValuesOf('timeZone')` where
  available, static list fallback). Hint text: "Times you enter are in this
  zone."
- Display rule everywhere (`formatEventWhen.ts` becomes the single formatter):
  show the event-zone time; when viewer zone ≠ event zone append the viewer's
  local time in a smaller line ("7:00 PM PST · 4:00 AM your time").
- Remove hard-coded `'en-US'`; use device locale.
- ICS: emit `TZID` + `VTIMEZONE` (or at minimum `DTSTART;TZID=…` floating
  local with RRULE in local time). Google Calendar link gets `ctz=`.
- Reminders cron uses the stored zone for the daily "interested" nudge window.
- Add `all_day boolean` and multi-day support as a follow-on (end date on a
  later day already works; all-day needs display changes only).

### E. Recurrence
- Pattern gains `byWeekday: number[]` (weekly) and `count` as an alternative to
  `endDate`; picker gets weekday chips and interval 1–4.
- `event_occurrence_overrides (event_id, occurrence_date, status
  'cancelled'|'moved', new_start, new_end, note)`: lets a host skip or move one
  date without cancelling the series. `event_next_occurrence` and the client
  `getNextOccurrences` skip cancelled overrides.
- Per-occurrence RSVP is **out of scope** for this plan; it changes the
  identity of `rsvps`, chat and reminders. Flag as a later decision.
- Reminders should key off the next occurrence (`FOLLOW_UPS.md:109`).

### F. Moderation and communication
Data / server:
- Replace `event_chat_settings.locked` semantics with `chat_mode text CHECK IN
  ('open','announcements','off')`; keep `locked` as a generated compatibility
  column for one release. `off` hides the chat entry entirely.
- `chat_open_policy text CHECK IN ('two_going','host_opens','always')`: lets
  hosts of larger events open chat before two attendees exist, or keep the
  current default for small ones.
- `host_announcements (id, event_id, body, created_by, created_at)` plus RPC
  `send_event_announcement(p_event_id, p_body, p_audience 'going'|'all')`.
  Inserts a `notification` of new type `host_announcement` per recipient,
  honouring a new `host_announcement` preference, rate-limited to 3 per event
  per day server-side. Also posts a pinned system message into the chat.
- `event_chat_pins (event_id, message_id)`: one pinned message per event.
- Reuse `event_bans` (B) so a chat block can escalate to an event ban.

UI:
- Chat tab in the hub: mode segmented control, open policy, slow mode (existing),
  blocked list and report queue (existing), pinned message.
- "Announce" quick action on Overview opens a sheet with body (≤ 500 chars),
  audience, and a preview of recipient count.
- Chat screen: pinned message banner; copy fixes for host-only posting
  (`app/event-chat/[id].tsx:1443` contradicts `:1276`).
- Attendee-side: new notification type icon and a per-event "mute
  announcements" entry in the existing chat mute sheet.

### G. Lifecycle actions
- `reschedule_event(p_event_id, p_start, p_end, p_note)`: the only path to
  change times once someone is going. Sends "Event rescheduled" with the note,
  resets reminders, clears `notified_at` on the waitlist. Edit Event's current
  "Notify attendees?" confirm becomes this flow.
- `status` gains `postponed`: visible, RSVPs kept, join disabled, banner "New
  date coming". Host converts to active via reschedule or to cancelled.
- `duplicate_event(p_event_id) → uuid`: copies content, links, photos, settings
  into a new **draft** with cleared dates. Big time-saver for venues.
- `event_templates` are not needed if duplicate exists; skip.

### H. Insights
- Wire `event_views` into the insights screen (the table and `track_event_view`
  exist; charts are simulated today). Add waitlist count, requested count,
  check-in rate, announcement open count (via notification `read`).
- Server-gate `get_business_analytics` and a new `get_event_insights` on tier,
  since analytics is currently client-gated only.

## 5. Premium placement (proposal)

| Free | Premium |
| --- | --- |
| Capacity, waitlist notify, open/closed RSVP, chat open/announcements/off, remove attendee, announcements (1/day), duplicate, time zone, visibility | Approval and invite modes, waitlist auto-promote, check-in + QR, CSV export, event sections, recurrence (existing), overrides, announcements (3/day), real insights |

All gates enforced in RPCs/triggers via `businesses.subscription_tier`.

## 6. Migrations and server work (ordered)

1. Apply the pending `20261102*` set to the shared DB (needs explicit go-ahead;
   sessions share one DB, so validate on `SCRATCH_DB` first, no resets).
2. `events_organizer_fields`: `timezone`, `visibility`, `publish_state`,
   `rsvp_mode`, `waitlist_mode`, `event_type`, `ticket_url`, `price_label`,
   `age_restriction`, `accessibility_notes`, `what_to_bring`; extend status and
   rsvp status CHECKs; `max_attendees` in create RPC; `publish_event` RPC with
   counter move.
3. `event_bans` + `host_remove_attendee(p_ban)` + join checks; owner self-RSVP
   block; capacity-shrink guard; `host_review_rsvp`; `host_checkin_attendee`.
4. `reschedule_event`, `postponed` status, `duplicate_event`, column-freeze
   trigger, RLS updates for drafts/unlisted (`get_ranked_events`, search index,
   public SELECT policy).
5. Timezone-aware `event_has_ended`, `event_next_occurrence`, ranked filter;
   backfill.
6. `chat_mode`, `chat_open_policy`, `host_announcements`, `event_chat_pins`,
   notification type + preference, rate limit.
7. `event_sections`, `event_occurrence_overrides`, recurrence pattern
   validation for `byWeekday`/`count`.
8. `export_event_attendees`, `get_event_insights`, tier checks on analytics.
Each step: regenerate `types/supabase.generated.ts`, extend `types/database.ts`,
add `scripts/test-local-backend.mjs` cases.

## 7. Phasing and estimates

| Phase | Scope | Estimate |
| --- | --- | --- |
| 0 | Apply pending migrations; shared `SwitchRow`, `SegmentedControl`, `Chip`, `Stepper`, `SettingsSection`; remove local `Palette`; single date formatter without `'en-US'` | 6–8 h |
| 1 | Manage hub (Overview + Attendees + Chat tabs); remove attendee + ban; host waitlist view with manual promote; capacity in create RPC; capacity-shrink guard; MyEvents row counts; Announce (free tier) | 14–18 h |
| 2 | Time zones end to end (column, picker, display rule, server functions, ICS) | 10–14 h |
| 3 | Draft/unlisted, More-options fields, reschedule/postpone/duplicate, RSVP modes (approval/invite/closed), waitlist auto-promote, chat mode + open policy, pinned message | 16–22 h |
| 4 | Presets by event size, check-in + QR, CSV export, event sections, recurrence weekdays + overrides, real insights with server-side tier gate | 16–22 h |

Total roughly 62–84 h. Phases 1 and 2 are independent and can run in parallel
worktrees; 3 depends on 1; 4 depends on 3.

## 8. Risks and constraints

- `businesses.owner_id` is UNIQUE: one business per user. Co-hosts and team
  moderation need a `business_members` table and touching every
  `user_is_event_host` check. Out of scope here; call it out as a future
  decision.
- The UPDATE policy on `events` has no column restrictions today. Phase 3's
  freeze trigger is the fix; until then any new setting column is host-writable
  with no validation, so validation goes in CHECK constraints and triggers, not
  only RPCs.
- Timezone backfill for existing events is a guess (business location). Mark
  backfilled rows and show the zone row prominently on first edit.
- Changing `rsvps.status` values affects `get_user_going_events`, counts
  triggers, chat access (`going` only) and reminders. Requested users must not
  unlock chat or count toward capacity.
- `create.tsx` and `EditEvent.tsx` duplicate ~2000 lines. Adding fields to both
  doubles the cost; extracting a shared `EventForm` is worth doing in Phase 3
  before the More-options accordion lands.
- Notifications fan out per recipient row; announcements for a 1000-person
  event insert 1000 rows and 1000 pushes. Acceptable at this scale, but the
  rate limit and audience filter are mandatory.

## 9. Open questions

1. Should drafts count toward the monthly limit at creation or at publish?
   (Plan assumes publish.)
2. Approval mode: do requested users see the chat or attendee list? (Plan
   assumes no.)
3. Announcements: in-app + push only, or also mirrored into chat as a pinned
   system message? (Plan assumes both.)
4. Time zone default for existing rows: business location lookup vs. single
   configured default.
   (Resolved 2026-11-03, see §10: hosts see private-profile attendees as
   first name + last initial; other attendees still see Anonymous.)
5. Is "closed" RSVP mode distinct enough from capacity 0 to justify a mode, or
   should "Close RSVPs" simply be a switch? (Plan keeps the mode for clarity in
   the UI; both map to the same server check.)
6. Per-occurrence RSVP for recurring events: defer, or plan now since it blocks
   accurate reminders and capacity per date?

## 10. Implementation log

**2026-11-03 — Phase 1 foundations (client shipped, DB prepared).**
Built: `/business/manage-event/[id]` hub with Overview, Attendees (going /
interested / waitlist, search, remove attendee) and Chat (lock, slow mode,
moderation sheet) tabs; entry points from My Events rows and Event Detail;
shared `SegmentedControl`, `SettingsSection`, `SettingsRow`; `services/hostTools.ts`
with fallbacks; `utils/hostEvent.ts` + tests. Prepared, not applied:
`20261103100000_host_event_tools.sql` (host overview + host attendee page RPCs),
validated on a scratch copy. Details and the remaining Phase 1 items are in
`docs/ISSUES.md` under "Host tools — Manage event hub".

**2026-11-03 (later) — Phase 1, second pass.** Privacy decision taken and
implemented (first name + last initial for hosts; copy updated). Prepared, not
applied: `20261103110000_event_bans_and_waitlist_promote.sql` (event bans on
removal, allow-back, ban enforcement on every join path, waitlist promote).
Hub attendee tab gained Removed segment, Move to going, Allow back. Remaining
Phase 1: capacity-shrink guard + capacity in the create RPC, My Events row
counts, private-name consistency in the RSVP notification.

**2026-11-03 (third pass) — capacity hardening, private-name guard, row
counts.** Discovered the other session's hand-applied capacity guard and RPC on
the shared DB; reproduced them verbatim in `20261103120000` and aligned the
client with `host_set_event_capacity`. Capacity now set in the create RPC;
raising the cap notifies the waitlist. Audit closed the `get_profiles_display`
full-name leak and the host-search surname probe; notifications use "First L."
for private profiles. My Events rows show going / waitlist counts. Remaining:
Settings tab + Announce, grant tightening, duplicate buttons on Event Detail.

**2026-11-03 (fourth pass) — Phase 1 complete.** Settings tab (capacity,
Accepting RSVPs, waitlist off/notify/auto), Announce to attendees (3/day,
preference-aware, mirrored into chat), Event Detail cleanup, grant tightening.
Prepared, not applied: `20261103130000_event_settings_and_announcements.sql`.

## 11. Status and what remains (as of 2026-11-03)

### Delivered in Phase 1 (client shipped; four migrations prepared, none applied)

| Area | Client | DB file (unapplied) |
| --- | --- | --- |
| Manage hub: Overview · Attendees · Settings · Chat | `screens/ManageEvent.tsx`, entry points from My Events and Event Detail | `20261103100000` (host overview + attendee page RPCs) |
| Attendees: remove + ban, allow back, waitlist promote, Removed segment | done | `20261103110000` |
| Private profiles: "First L." for hosts, no leaks via display RPC, notifications or search | done | `20261103100000`, `20261103110000`, `20261103120000` |
| Capacity: in create RPC, shrink guard + explicit RPC, waitlist told on raise | done | `20261103120000` |
| My Events row counts | done | `20261103120000` |
| Settings: Accepting RSVPs, waitlist mode (off/notify/auto), capacity editor | done | `20261103130000` |
| Announce to attendees | done | `20261103130000` |
| Shared primitives: `SegmentedControl`, `SettingsSection`, `SettingsRow` | done | — |

### Apply checklist (for whoever owns the shared DB)

1. Apply `20261103100000` → `110000` → `120000` → `130000` in order (each re-applies idempotently; validated on scratch after a fresh dump).
2. `npm run backend:types`; replace `untypedRpc` casts in `services/hostTools.ts` and `services/events.ts` with typed `supabase.rpc`.
3. Decide on `get_user_past_event_count()` (hand-applied, no file) and file it.
4. Push channels / icons for `host_announcement` on Android if a dedicated channel is wanted (currently `default`).

### Phase 2 — Time zones (plan §4D) — delivered 2026-11-03, see ISSUES.md "Phase 2"

- [x] `events.timezone` (IANA, nullable, **no backfill** — Q4 resolved: NULL = legacy, viewer-zone rendering).
- [x] Zone-aware `event_has_ended`, `event_next_occurrence`, callers re-created with `e.timezone` (prepared: `20261103140000`).
- [x] Picker in Create/Edit (`components/TimeZonePicker.tsx`); display rule in `utils/timezone.ts` (`describeEventTime`); Event Detail shows event zone + "your time"; `en-US` removed from event-time formatting.
- [x] ICS with `TZID` local times; RRULE UNTIL in the event zone; Google Calendar `ctz`.
- [ ] Reminder windows at a local hour; all-day / multi-day display (follow-on).

### Phase 3 — Details, publishing, lifecycle, RSVP modes (plan §4B–C, §4F–G) — mostly delivered 2026-11-03, see ISSUES.md "Phase 3"

- [x] Columns: `visibility`, `publish_state` (counter moves to `publish_event`), `ticket_url`, `price_label`, `age_restriction`, `accessibility_notes`, `what_to_bring`, `status_note` (prepared: `20261103150000`). `event_type` deferred to Phase 4 presets.
- [x] RSVP `approval` mode (prepared: `20261103170000`); `closed` shipped in Phase 1; `invite` deferred (§9).
- [x] `reschedule_event` as the only time/place path once anyone is going; `postponed`; `duplicate_event` into a draft; publish/business freeze trigger.
- [x] Chat: `chat_mode` (open/announcements/off), `open_policy` (two_going/any_going), pinned message + announcement auto-pin (prepared: `20261103160000`).
- [x] Drafts segment in My Events; "More options" shared through `components/EventExtrasFields.tsx` (full `EventForm` extraction still open).

### Phase 4 — Presets, check-in, export, sections, recurrence, insights (plan §3, §4B, §4E, §4H; 16–22 h)

- Event-size presets at creation (prefill only).
- Check-in (`checked_in` RSVP status, `host_checkin_attendee`, rotating QR via `expo-camera`), CSV export (`export_event_attendees`), both premium.
- `event_sections` (agenda / line-up / FAQ), premium, max 10.
- Recurrence: `byWeekday`, `count`, per-occurrence overrides (skip / move one date); reminders keyed off the next occurrence. Per-occurrence RSVP stays a separate decision (plan §9 Q6).
- Real insights from `event_views`; server-side tier gate on analytics RPCs.

### Cross-cutting, any phase

- Co-hosts need a `business_members` table and touching every `user_is_event_host` check (plan §8); out of scope so far.
- Notification fan-out cost for 1000-person announcements is acceptable today; revisit batching if events grow.

**2026-11-03 (fifth pass) — Phase 2 time zones.** Pure zone utilities and
display rule, picker component, create/edit integration with wall-clock
conversion, Event Detail event-zone rendering with a "your time" line,
TZID-based ICS and `ctz` Google links, and the prepared migration
`20261103140000_event_timezones.sql` (nullable zone, zone-aware server
helpers, callers patched). Left: local-hour reminder nudges, all-day display.

**2026-11-03 (sixth pass) — Phase 3 core.** Prepared `20261103150000`
(drafts/publish with allowance at publish, unlisted, detail fields, postponed,
reschedule as the sanctioned time/place path, duplicate, guards), converging on
hand-applied objects found on the shared DB. Client: More options on both
forms, Save as draft, Drafts segment, Event Detail notices and detail rows, hub
Publish / Postpone / Reschedule / Duplicate / Unlisted. Time-zone follow-ups
(zone-aware recurrence and ended checks) closed. Left: RSVP approval/invite
modes, chat mode + pins, EventForm extraction.

**2026-11-03 (seventh pass) — Phase 3 completed (minus invite mode and the
EventForm refactor).** Prepared `20261103160000` (chat mode, open policy,
pins) and `20261103170000` (RSVP approval mode). Client: hub chat-mode chips +
open-policy switch, pinned banner + pin actions in chat, Requests segment with
approve/decline, "Approve new attendees" switch, request-to-join flow on Event
Detail. Discovered and fixed a scratch-name collision with the other session
(`eventmap_scratch_oak` → `eventmap_scratch_elm_host3`); earlier "shared DB
drift" notes were that session's scratch work — the shared DB is clean at
20261102160000 and all eight 20261103 files apply in order on it.

**2026-11-03 (eighth pass) — final regression round.** Two review agents +
two durable test artifacts (`scripts/test-host-tools.sql`, 90+ assertions;
`scripts/regress-host-tools.mjs`, 19 PostgREST-shape checks). Ten server and
six client defects found and fixed — headline items: RSVP event-move bypass,
waitlist bypassing approval mode, postponed events stranding attendees (both
directions), stale pinned banner after moderation, attendee-list race, DST-gap
times resolving an hour early. All suites green on a clean isolated slate;
remaining/unfinished work consolidated in ISSUES.md.
