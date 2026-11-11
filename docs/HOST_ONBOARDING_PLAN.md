# Host onboarding plan

Status: written 2026-11-10. This is a proposal only; nothing here is built yet.
It ties together `docs/ONBOARDING_PLAN.md` (attendee onboarding),
`docs/HOST_TOOLS_PLAN.md` (Manage event hub, attendance, publishing, time
zones) and `docs/CATEGORIES_AND_SERIES_PLAN.md` (categories, series). Those
plans built the *tools*. This one covers the *journey*: how someone goes from
installing the app to running events well, and which systems they take part in
along the way.

---

## 1. What exists today

**Becoming a host.** No host intent is captured at signup or in attendee
onboarding (`app/(onboarding)/index.tsx`). The only way in is Profile →
mode toggle → `/business/onboarding` (`screens/BusinessOnboarding.tsx`, 2
steps: name/category/address, then description/logo). Submitting creates a
`businesses` row and routes back to Profile. There is no welcome, no next step
and no "create your first event" prompt.

**Visibility of hosting.** The Create tab is hidden until `hasBusiness`
(`app/(tabs)/_layout.tsx:18`). `create.tsx:578` has a no-business fallback,
but users can't reach it from the tab bar. Someone who wants to host has to
find a toggle on Profile first.

**Identity model.** `businesses.owner_id` is `UNIQUE` (one business per
user), and `address`/`lat`/`lng` are `NOT NULL`, so every host is treated as
a venue. A run club, a walking group or an individual who hosts in parks has
to invent an address. No co-hosts (`HOST_TOOLS_PLAN.md` §8). `userMode`
(`user` | `business`) is a client-only switch stored in AsyncStorage.

**Trust.** `businesses.verified` is set by hand in the admin dashboard
(`admin_set_business_verified`). There are no criteria, no request flow and no
host-facing status.

**Tier.** Free: 2 events/month, no recurrence. Premium: 30/month, recurrence,
ranking boost, insights, more photos. The user only finds out about the limit
when they hit it at publish time (`create.tsx:423-430`).

**Tools a host is expected to use** (all exist, mostly behind unapplied
migrations; see the other plans): Create/Edit, drafts and publish, More options,
time zone, recurring series and occurrence exceptions, Manage event hub
(Overview · Attendees · Settings · Chat), approval mode, waitlist modes,
capacity, announcements, chat moderation (mode, pins, slow mode, reports,
bans), reschedule/postpone/cancel, duplicate, insights, notify followers.
Nothing introduces these tools. A new host comes across them one at a time.

---

## 2. Goals and principles

1. **Hosting is discoverable from day one** but never forced on attendees.
2. **Time to first published event under 5 minutes** for a casual host.
3. **Teach in context, not up front.** Each tool is introduced when it first
   matters, for example the waitlist when an event first fills up, rather than
   in a long tutorial.
4. **Server enforces, client explains** (same rule as the host tools plan).
   Host status, checklist progress and verification are stored server-side.
5. **One host identity, any host shape.** It should work for venues,
   organisers without a fixed venue, and individuals.
6. **Reuse the existing patterns.** Swipe-page onboarding, per-step
   persistence, AsyncStorage draft resume, Skip pills, `SettingsSection`.

---

## 3. Host personas

| Persona | Example | Venue | Typical needs |
| --- | --- | --- | --- |
| Venue | Bar, café, gallery | Fixed | Recurring nights, capacity, ticket link, verification |
| Organiser | Run club, promoter, meetup group | Varies per event | Series, community chat, followers, announcements |
| Individual | Someone hosting a picnic or board game night | Varies | Fast create, small caps, approval mode, privacy |

Persona is asked once during host setup. It **only prefills** defaults (venue
required or not, suggested event preset, which checklist items show). It is
stored as `businesses.host_type` for copy and analytics, not for enforcement.

---

## 4. End-to-end journey

```
Install → Welcome/Signup → Attendee onboarding (+ "I want to host" fork)
   → Host setup (profile) → First event (guided) → Publish
   → Getting-started checklist → First RSVPs → Day of event → After event
   → Growth (followers, series, verification, premium)
```

### Stage 0 — Install and signup
- `(auth)/welcome.tsx`: add a secondary line, "Hosting events? You can set
  that up next." Signup itself stays the same, with no extra fields.
- Deep link `eventmap://host` / `?intent=host` (from a marketing site or a
  referral) sets a `host_intent` flag that is carried through signup.

### Stage 1 — Attendee onboarding fork
- Add one question to the existing Welcome or Interests page: **"What brings
  you here?"** with the options *Find events* · *Host events* · *Both*.
  Stored in `profiles.intent` (`attend` | `host` | `both`).
- `host`/`both`: after the Tutorial page, show a short "Set up hosting now /
  Later" card. "Later" goes to Discover and the checklist (Stage 4) starts
  nudging. A pure host can skip the Interests page (the Skip pill is already
  there).
- Every user sees the Create tab. Non-hosts get a **"Start hosting" landing**
  instead of the form: what hosting gives you, three steps, and a CTA into host
  setup. This replaces the hidden-tab gate (`_layout.tsx:18`).

### Stage 2 — Host setup (replaces `BusinessOnboarding`)
A swipe-page flow under `app/(host-onboarding)/`, built on the attendee
onboarding pattern (per-step write, local draft resume, Skip pills):

1. **Host type**: Venue / Organiser / Individual (persona cards).
2. **Identity**: name, logo/avatar (Individual: offer "use my profile
   photo and name"), short description, category (pick from `categories`;
   replaces the free-text `businesses.category` over time).
3. **Home location**:
   - Venue: required address with map pin (current behaviour).
   - Organiser/Individual: optional "home area" (city + approximate pin), used
     only as a default map centre. Requires making `businesses.address/lat/lng`
     nullable, or adding a `location_kind` column (see §6).
4. **Links and contact** (optional): website, Instagram, ticketing page.
   Reuses `business_links`.
5. **Host guidelines**: short community rules (honest listings, no
   paid-ticket bait, moderation responsibilities, safety). Acceptance is
   required and stored as `host_terms_accepted_at` + version.
6. **Done**: "You're set up as a host." Primary CTA: **Create your first
   event**. Secondary: "Explore host tools". Sets `userMode = 'business'`.

The existing `/business/onboarding` route redirects here. Editing all of these
details later happens on a "Host profile" screen in Settings.

### Stage 3 — First event (guided create)
- On the first visit to Create (zero events, no drafts), show a one-time
  **guided mode**: event preset chips (Casual / Class / Venue show / Large,
  from `HOST_TOOLS_PLAN.md` §3) prefill the form, and inline coach marks cover
  three things only: title + category, date/time + zone, location.
  "More options" stays collapsed.
- Show the tier before the host commits: "Free plan: 2 events this month ·
  1 left". This exists today only as an error at publish time.
- Before publishing, a **preview** step shows the card as attendees will see it
  on Discover and on Event Detail. Publish, or Save as draft.
- **Post-publish sheet**: share link, notify followers (zero followers →
  explain how followers work), "Open Manage event", and add to their own
  calendar.

### Stage 4 — Getting-started checklist
A persistent card at the top of Profile (business mode) and My Events. It
goes away when complete or when dismissed (it stays in Settings → Host profile).
Items are persona-filtered and computed from server state where possible:

| Item | Done when |
| --- | --- |
| Complete host profile (logo, description) | fields non-empty |
| Publish your first event | ≥1 published event |
| Share an event | share action logged (local) |
| Open Manage event | hub visited |
| Set capacity / waitlist | any event has `max_attendees` or waitlist ≠ off |
| Post an announcement | ≥1 `host_announcement` |
| Set up a recurring series (Organiser/Venue) | ≥1 series (premium-aware CTA) |
| Request verification (Venue/Organiser) | request submitted |
| Turn on host notifications | push permission + host prefs on |

Implemented as `get_host_onboarding_status()` RPC returning booleans, so it
works across devices and is the same check the admin dashboard uses.

### Stage 5 — Contextual introductions ("first time" tips)
One-shot tips triggered by events, recorded in `host_tips_seen text[]`:
- First RSVP: push + in-app "Your first attendee! Here's who's coming",
  linking to Attendees.
- First time capacity is reached: explains the waitlist modes, links to
  Settings.
- First chat open/message: explains chat modes, pins and moderation.
- First report received: explains the report queue and what's expected of
  the host (Stage 7).
- First attempt to change time/place with attendees: explains reschedule vs
  edit and that attendees are notified.
- 2nd event of the month on free: soft premium explainer before the limit.

### Stage 6 — Event lifecycle the host takes part in
For reference, what's expected of a host per event, and where each step lives:

| Phase | Host does | Tool |
| --- | --- | --- |
| Before | Create, publish, share, notify followers | Create, post-publish sheet |
| Lead-up | Review requests, manage capacity/waitlist, announce, moderate chat | Manage hub |
| Changes | Reschedule, postpone, cancel (with note) | Manage hub → Overview |
| Day of | Reminder to host ("starts in 2 h: open check-in / pin a message") | Notification → hub |
| During | Check-in (Phase 4 of host tools), chat moderation | Manage hub |
| After | Thank-you announcement, review insights, duplicate or make it a series | Post-event prompt |

New: a **host day-of reminder** and a **post-event summary** notification
("42 went, 8 on waitlist, 120 views — run it again?", with Duplicate / Make
recurring CTAs). Both reuse the existing notification triggers.

### Stage 7 — Ongoing responsibilities and trust
- **Moderation duty**: hosts are responsible for their event chat. Open
  reports older than N hours on their event surface in the checklist / hub
  badge. Admin can see host responsiveness.
- **Verification**: a "Request verification" form (proof link, socials,
  optional document photo to a private storage bucket). It creates a
  `host_verification_requests` row, which goes to a new admin queue in
  `admin/app/(dashboard)/businesses`. The host sees the status (pending /
  approved / needs info / rejected + reason). Criteria (suggested): complete
  profile, ≥1 past event with no upheld complaints, externally verifiable
  presence.
- **Standing**: complaints/upheld reports feed a simple host standing state
  (`good` | `warning` | `restricted`). `restricted` blocks publishing (server
  check in `publish_event`). Admin sets it; the host sees a banner with the
  reason and how to appeal.
- **Account changes**: leaving hosting (archive business, cancel future events
  with notification) and transferring ownership. Both are needed before
  co-hosts.

### Stage 8 — Growth
- Followers: explain them in the post-publish sheet and on the host profile.
- Recurring series and premium: offered at natural moments (2nd similar event,
  limit approaching), never as a blocker before the first event.
- Insights: weekly host digest (opt-in) once real insights land.
- Co-hosts (`business_members`) are a later phase. The journey reserves a
  "Team" checklist item behind a flag.

---

## 5. Mode and navigation changes

- The Create tab is always visible. Its content depends on host state (landing
  → setup → form).
- `userMode` stays, but becoming a host switches it automatically, and the
  toggle moves into the Profile header with clearer labels ("Attending" /
  "Hosting").
- Notification deep links for host events (RSVP, request, report) switch to
  hosting mode before navigating, so the hub opens in the right context.
- Settings gains a **Host profile** section: identity, location, links,
  verification status, standing, host notification preferences, guidelines,
  "Stop hosting".

---

## 6. Data and server changes (all as new migrations)

| Change | Purpose |
| --- | --- |
| `profiles.intent text CHECK IN ('attend','host','both')` | onboarding fork, nudges |
| `businesses.host_type text CHECK IN ('venue','organiser','individual')` | persona defaults |
| `businesses.address/lat/lng` nullable + `location_kind` (`fixed`/`area`/`none`); CHECK that venue ⇒ fixed | non-venue hosts |
| `businesses.category_id uuid REFERENCES categories` (keep text column during transition) | single taxonomy |
| `businesses.host_terms_version int`, `host_terms_accepted_at timestamptz`; `publish_event` requires current version | guidelines acceptance |
| `businesses.onboarding_completed_at`, `host_tips_seen text[]` | resume/skip, one-shot tips |
| `get_host_onboarding_status()` RPC | checklist, admin view |
| `host_verification_requests` table + `submit_verification_request`, `admin_review_verification` RPCs, private storage bucket | verification flow |
| `businesses.standing text` + `admin_set_host_standing`; check in `publish_event` | trust enforcement |
| Notification types: `host_first_rsvp`, `host_day_of`, `host_post_event_summary`, `host_verification_update` | lifecycle prompts |
| `archive_business()` RPC | stop hosting |

Every RLS/ownership check that assumes a non-null business location (map
queries, `get_ranked_events` distance, business map pins) needs auditing for
the nullable location. Events still carry their own location, so event
discovery is unaffected.

As with the other plans: validate on a per-worktree scratch DB and
ask before applying anything to the shared DB.

---

## 7. Phasing

| Phase | Scope | Estimate |
| --- | --- | --- |
| 1. Entry points | `profiles.intent` fork, always-visible Create tab with landing, auto mode switch | 4–6 h |
| 2. Host setup flow | New multi-step setup, host_type, nullable location, guidelines acceptance, Host profile in Settings, redirect old route | 8–12 h |
| 3. First event | Guided create, presets (overlaps host tools Phase 4), tier visibility, preview, post-publish sheet | 6–9 h |
| 4. Checklist + tips | Status RPC, checklist card, one-shot tips, first-RSVP / day-of / post-event notifications | 6–9 h |
| 5. Trust | Verification requests + admin queue, standing + publish guard, stop hosting | 8–12 h |
| 6. Growth | Weekly digest, premium touchpoints, co-host groundwork | later |

Phases 1–3 deliver the core journey (download → first published event).
Phases 4–5 cover the systems a host has to keep taking part in afterwards.

## 8. Testing

- E2E (isolated env, `scripts/e2e-isolated-env.sh`): signup with host intent →
  setup → first event published → checklist reflects it; resume host setup
  after reload; Individual host with no address.
- SQL assertions (extend `scripts/test-host-tools.sql`): guidelines required to
  publish, restricted standing blocks publish, verification RLS (host sees own
  requests only, documents private), nullable-location host doesn't break
  ranked events.
- Small-screen and screen-reader pass on every new page (same bar as attendee
  onboarding).

## 9. Open questions

1. Should Individual hosts get a separate lightweight identity (host as
   their own profile) instead of a `businesses` row? This plan keeps one table
   for simplicity. The cost is that "business" wording has to change in the UI.
2. Should guidelines acceptance block *drafts*, or only publishing? (Proposed:
   publishing only.)
3. Verification criteria and whether document upload is needed at all, given
   the privacy and storage obligations.
4. Do existing hosts get the checklist retroactively, or is it marked complete
   for anyone who already has a published event?
5. Should there be a minimum account age or phone verification before first
   publish, as a spam control?
6. Is `intent` editable later (Settings), and does it change anything beyond
   nudges?

---

## 10. Implementation log

**2026-11-10 — Stage 1 (entry points).** Client:
- `utils/hostIntent.ts`: intent type and parsing, a per-user local copy,
  and a pre-auth "pending host" flag. Also a server write that treats a
  missing column (`PGRST204`/`42703`) as local-only.
- Onboarding Welcome page: optional "What brings you here?" (Find events /
  Host events / Both), saved on Continue and kept in the resume draft.
  Hydration order: `profiles.intent` → local copy → draft → pending host flag.
- Onboarding final page: for host/both, "Set Up Hosting" (completes onboarding,
  then opens host setup on top of Discover) plus "Later, Start Exploring".
- `app/host.tsx` handles `eventmap://host`. Signed out → welcome with
  `?intent=host` (flag stored). Signed in → Create tab. Welcome and signup also
  accept `?intent=host`, and Welcome has a "Hosting events?" hint.
- Create tab is always visible. Non-hosts see `components/StartHostingLanding.tsx`
  (benefits, 3 steps, CTA into the existing `/business/onboarding`). The mode
  switch to hosting after setup already existed.
- Tests: `tests/hostIntent.test.ts`.

DB: `20261110100000_profile_intent.sql` (nullable `profiles.intent` + CHECK) is
**prepared, not applied** and not run against any database. The client works
without it. Not done yet: validating it on an isolated scratch DB,
`npm run backend:types`, and an E2E pass of the new flow.

**2026-11-10 — Stage 2 (host setup), foundations + new flow.**

DB, prepared and **not applied** to the shared DB: `20261110110000_host_setup_foundations.sql`.
- `businesses.host_type` (venue/organiser/individual) and `location_kind`
  (fixed/area/none). `address/lat/lng` become nullable, with CHECKs: fixed ⇒
  street address + pin, area ⇒ pin, none ⇒ no location, venue ⇒ fixed.
  Existing rows backfill to venue/fixed.
- `host_terms_version` / `host_terms_accepted_at` and `host_terms_current_version()` (= 1),
  plus `onboarding_completed_at`.
- `guard_business_host_columns` trigger: server-stamped acceptance and
  completion times; owners can't withdraw, downgrade or backdate them. It also
  **fixes a pre-existing hole**: owners could set `verified` on their own
  business (now forced false on insert and rejected on update unless admin).
- `get_user_business()` now `RETURNS SETOF businesses` (the old explicit list
  hid newer columns).
- Deviation from §6: `category_id` was dropped. `businesses.category` is a
  separate venue-type taxonomy that also fits organisers ("Community",
  "Fitness & Wellness"), so it stays.
- Validated both Stage 1 and 2 migrations on a throwaway local Postgres
  cluster with a minimal stub schema (not the Supabase stack, not a copy of
  the shared DB). They apply twice cleanly, and `scripts/test-host-setup.sql`
  passes. They have not yet run against the full migration history.

Client:
- `utils/hostSetup.ts`: host types, defaults, per-step validation,
  insert payload, legacy payload, `businessPin`, `effectiveHostType`
  (tests: `tests/hostSetup.test.ts`).
- `businessesService.createHost`: sends the new columns. On a missing column
  it retries with the original columns, which works when there is a pin. With
  no location it shows "add a home area" until the migration lands.
  `addBusinessLink` saves the website.
- `screens/HostSetup.tsx` replaces `BusinessOnboarding` (same route
  `/business/onboarding`): type → identity (logo, or "use my profile photo"
  for individuals) → location (street address / home area / none) → links →
  guidelines → done ("Create Your First Event"). Draft resumes per user;
  terms acceptance is never resumed.
- Null-safe business location: Create/Edit default venue (`businessPin`),
  EventDetail fallback, BusinessDetail (map only for fixed; "Based in" text for
  area; no Maps link otherwise), Settings (never writes the 0,0 placeholder;
  address row only for fixed-location hosts).

**2026-11-10 — Stage 2 completed and Stage 1 leftovers.**
- `components/HostProfileSection.tsx` in Settings (hosting mode): host type,
  home location (address / home area / none) with home-area search, guidelines
  status with View + Accept, and a links editor (add / remove, max 10). Saves
  separately from the Business Profile card. On a backend without the host
  columns, only links are shown, plus a note.
  Rules live in `utils/hostSetup.ts`: `changeHostShape`, `validateHostShape`,
  `buildHostShapeUpdate`. Switching to a street address always needs a fresh
  pick, so a home area is never silently saved as a venue address.
  Service: `updateHostShape`, `acceptHostTerms`, `deleteBusinessLink`.
  Guidelines text is shared (`HOST_GUIDELINES`).
- Admin businesses table: Host type (+ location kind) and Guidelines (version,
  accepted time on hover) columns. The query retries without them on 42703, so
  the page works before the migration.
- Types: `types/supabase.generated.ts` was **hand-edited** (header comment)
  for both migrations: host columns, nullable location, `profiles.intent`,
  `get_user_business` as businesses rows, `host_terms_current_version`.
  `npm run backend:types` was *not* run (it reads the shared local DB). The
  `as never` casts are gone.
- DB verification, isolated only: fresh throwaway Postgres 14 cluster in the
  session scratchpad, with Supabase stubs (roles, `auth`, `storage`, `cron`,
  `net`, `extensions`, realtime publication, default grants). **All 112
  migrations applied in order** (copies with the pg_cron/pg_net CREATE
  EXTENSION lines removed). Both new migrations re-apply cleanly.
  `scripts/test-host-setup.sql` is now self-contained (own users, real
  `authenticated` role + JWT claims, RLS, interaction with the subscription
  trigger, admin RPC) and passes. The older suites (`test-host-tools.sql`
  etc.) need demo data that only exists in a copy of the shared DB, so they
  were not run.
- Short client checks: `tsc` (app + admin), eslint on changed files,
  `vitest` 881/881, `expo export --platform web` bundles. Headless Chrome on a
  bundle pointed at a dead backend port showed `/welcome?intent=host` and the
  `eventmap://host` route (signed out → welcome with the hosting hint)
  rendering. Signed-in screens were not rendered (no backend).

### Stage 1–2 status: ready, pending migration apply

Before release, someone who owns the shared DB needs to:
1. Apply `20261110100000_profile_intent.sql` then
   `20261110110000_host_setup_foundations.sql`, and run
   `scripts/test-host-setup.sql` against the result.
2. Run `npm run backend:types` and check that the diff against the hand-edited
   `types/supabase.generated.ts` is only formatting.
3. Do a hands-on pass of the signed-in screens on web + one native device
   (small screen, screen reader): onboarding intent, Set Up Hosting, Create
   landing, host setup for all three host types, Settings → Host profile, and
   the admin table.

Known limits: no publish guard for guidelines acceptance (§9 Q2/Q4), and
existing hosts have `host_terms_version = NULL` until they accept in
Settings.

---

## 11. Stage 3 plan — first event (guided create)

Status: plan only (2026-11-10). Builds on Create (`app/(tabs)/create.tsx`),
the shared `EventExtrasFields`, drafts / `publish_event`, and the host tools
plan §3 presets.

### 11.1 What exists already
- The quota pill (`n/limit this month`) and an at-limit banner are already in
  the Create header, so §4 Stage 3's "show the tier first" is mostly done.
  Missing: the pill is not explained for first-time hosts.
- Save as draft + Publish, the idempotent create RPC, and a local form draft
  (`useFormDraft`).
- After publishing: a toast, then `router.push('/event/<id>')`. No share step,
  no follower prompt, no "what next".
- `notify_followers_about_event` RPC, `shareEventLink`, `shareEventIcs`.
- No presets and no `event_type` column (deferred in HOST_TOOLS_PLAN Phase 4).

### 11.2 Scope
1. **Presets** (client-only first). `utils/eventPresets.ts` defines Casual
   meetup / Class or workshop / Venue show / Large event, each a partial form:
   capacity, waitlist mode, chat mode, reminder, which "More options" fields
   open. A chip row at the top of Create; default chosen from host type
   (individual → Casual, organiser → Casual, venue → Venue show). It only
   prefills: picking a preset never overwrites a field the host already
   edited (track touched fields). Settings that live on the hub (waitlist,
   chat mode) are applied after create via the existing `host_set_event_settings`
   path, non-fatal like extras are today.
   *DB (optional, later):* `events.event_type text` CHECK, for analytics only.
   Preset ids are stable strings so the column can be added without a client
   change.
2. **Guided first event.** If the host has 0 events and no drafts (from the
   counts Profile already loads) and hasn't dismissed it (local flag
   `eventmap.firstEventGuide.<businessId>`):
   - A short header card: "Your first event: 3 things matter" with
     title + category, date/time + zone, place.
   - Inline hints under those three sections only (no overlay coach marks:
     better for screen readers and small screens).
   - "More options" stays collapsed.
   - Location defaults: venue → business address. Area hosts → map centred
     on the home area but **no** prefilled address (an area is not a venue).
     None → device location.
   - The quota pill gets a one-line explanation the first time.
3. **Preview before publish.** A "Preview" secondary button (and the
   default path in guided mode) opens a sheet rendering the real
   `DiscoverEventCard` plus a compact Event Detail header from the form state
   (pure mapper `formToPreviewEvent`, unit-tested). From the sheet:
   Publish / Save draft / Keep editing.
4. **Post-publish sheet** replaces the bare toast + push for published
   events. It offers: Share link (`shareEventLink`), Notify followers (hidden
   with an explanation at 0 followers; handles "RPC missing" as today), Add to
   my calendar (`shareEventIcs`), Open Manage event, View event. On the
   *first* published event it says what happens next (RSVP notifications,
   Manage hub, the free-plan count left). Dismissing it goes to the event
   page, as today.
5. **Host type copy.** Individuals see "Host name" wording and no venue
   language. Venues keep the current copy.

### 11.3 Out of scope (later stages)
Checklist (Stage 4), one-time tips beyond the first event (Stage 5),
server-side preset enforcement, ticketing.

### 11.4 Work breakdown and estimate
| Step | Work | Est. |
| --- | --- | --- |
| a | `utils/eventPresets.ts` + touched-field merge + tests | 1.5 h |
| b | Preset chip row in Create; apply hub settings after create (non-fatal) | 1.5–2 h |
| c | Guided mode detection, header card, three inline hints, area/none location defaults | 1.5–2 h |
| d | `formToPreviewEvent` + tests; preview sheet reusing `DiscoverEventCard` | 2 h |
| e | Post-publish sheet (share / notify / calendar / manage), first-event copy | 1.5–2 h |
| f | Optional migration `events.event_type` (prepared, not applied) + isolated test | 0.5–1 h |
| g | Short verification: tsc, lint, vitest, web export; screenshots of signed-out-safe pieces only | 0.5 h |

Total about 9–11 h. Steps a–e need no migration.

### 11.5 Open questions
1. Should presets also exist on Edit / Duplicate, or only on Create?
2. Should guided mode return for a host's first event after a long pause?
   (Proposed: no, first ever only.)
3. Should the preview step be mandatory in guided mode, or one tap away?
   (Proposed: default path, skippable.)
4. Does the post-publish sheet replace landing on Event Detail, or sit on top
   of it? (Proposed: on top, so back still works as today.)

---

## 12. Stage 3 implementation log

**2026-11-10 — Stage 3, foundations first.** Order was: pure logic + tests →
Create wiring → sheets → optional column.

Pure foundations (no UI, fully unit-tested):
- `utils/eventPresets.ts` — four presets (casual / class / venue_show /
  large) with stable ids, the suggested preset per host type, and the
  touched-field merge. A preset may replace **its own** earlier values but
  never a value the host typed; `kept` tells the UI to say so.
  `presetSettingsToApply` returns only what differs from the server defaults
  (`notify` / `open` / `open`), so `class` needs no RPC at all.
- `utils/eventFormPreview.ts` — `formToPreviewEvent` maps the unsaved form to
  a `RankedEvent` (picker wall-clock → instants in the event zone), plus
  `previewGaps` for "still missing" hints.
- `utils/firstEventGuide.ts` — the guided-mode decision (total events ever
  = 0, not dismissed), local dismissal per host profile, the three steps, and
  `initialEventLocation`.
- `utils/eventExtras.ts` — **extracted** the pure extras data/validation out
  of `components/EventExtrasFields.tsx` (which re-exports them) because the
  component pulls React Native and tests may not. Partial progress on the
  "EventForm extraction" left open in `HOST_TOOLS_PLAN.md`.
- Tests: `tests/eventPresets.test.ts`, `tests/eventFormPreview.test.ts`,
  `tests/firstEventGuide.test.ts`, `tests/eventPresetSettings.test.ts`
  (918 total, all passing).

Client:
- `components/EventPresetPicker.tsx` + an "Event size" card at the top of
  Create. **Deviation from §11.2:** the host-type preset is only *marked as
  suggested*, never auto-applied — auto-applying would silently cap a venue's
  first event at 100 attendees, exactly the surprise presets should avoid.
- `services/eventPresetSettings.ts` applies the non-default settings after the
  event row exists (`host_set_event_settings`, `set_event_chat_mode`) and
  records `events.event_type`. Every call is best-effort: failures become a
  "set them in Manage event" warning on the existing publish toast and never
  block publishing.
- Guided first event: a dismissible card ("three things that matter") plus one
  inline hint under Basic Information, Date & Time and Location, shown only to
  a host with no events at all.
- Location defaults by host type: a venue prefills its street address; a host
  with only a home area gets the map centred there with an **empty** address
  (an area is not an event address); `none` falls back to the device location.
- `components/EventPreviewSheet.tsx` renders the real `DiscoverEventCard` from
  the form, with when/where/capacity/price and the gap hints; Publish, Save as
  draft and Keep editing all live there. A "Preview" button is always
  available; in guided mode Publish opens the preview first (after validation,
  so a broken form still reports errors the old way).
- `components/EventPublishedSheet.tsx` after publishing: share link, notify
  followers (hidden with an explanation at 0 followers, and tolerant of the
  missing RPC), add to my calendar, open Manage event. First event gets extra
  copy about RSVP notifications and the remaining monthly allowance.
  **Deviation from §11.5 Q4:** the sheet shows *on Create* and navigates to
  the event when dismissed, rather than sitting on top of the event screen —
  a Modal owned by Create cannot reliably render above a screen pushed over
  it. Dismissing still lands on the event page, as before.

DB (prepared, **not applied** anywhere):
- `20261110120000_event_type_presets.sql` — nullable `events.event_type` with
  a CHECK on the four preset ids; analytics only, nothing enforced from it.
  Validated on a throwaway local Postgres with a stub `events` table (applies
  twice, legacy rows stay NULL, invalid values rejected); the cluster was
  deleted. Not run against the full history or any shared database.
- `types/supabase.generated.ts` hand-edited again for `events.event_type`
  (same header caveat as Stages 1–2).

Verification (short commands only, no E2E): `tsc` app + admin clean, eslint
clean on changed files, `vitest` 918/918, `expo export --platform web`
succeeds and the new strings are present in the bundle. The signed-in Create
screen was **not** rendered — that needs a backend.

### Stage 3 completed (second pass, 2026-11-10)

- **Host-type wording** (`utils/hostCopy.ts`): Create and Edit only use
  "venue / business address" language for venues; organisers and
  individuals see neutral copy. Tested so no non-venue string mentions venue
  or business.
- **Bug fixed — events published at the default pin.** A host without a
  street address who never chose a place was published at the map default
  (San Francisco) or with the home-area name as the address. Create now
  requires an explicit place for those hosts (`eventNeedsExplicitPlace`), and
  Edit only falls back to a *venue* address. The "Location set" label no
  longer appears for a map merely centred on the home area.
- **Bug fixed — guided Publish always failed.** The handler was memoised with
  a stale form (the dependency lint was silenced). Found by the browser pass,
  not by unit tests.
- **Bug fixed — gradient buttons rendered as thin bars on web**
  (`components/ui/Button.tsx`, pre-existing, all gradient buttons). The
  gradient fill now stretches to the button height.
- Polish: inline hints are short step tags instead of repeating the card;
  padding on the Event size card; the "Event created!" toast is skipped when
  the published sheet opens (warnings and drafts still toast).
- **Duplicate** (§11.5 Q1): `duplicate_event` already copies capacity,
  waitlist and RSVP mode; `carryOverToDuplicate` now also copies the chat
  mode and preset id (best-effort, host told if chat could not be copied).
  Edit deliberately gets no preset chips — see §14.
- **Hands-on pass, no database:** new `scripts/fake-backend-e2e/suiteHost.mjs`
  (H1–H4, 27 checks) drives the signed-in app in headless Chrome against
  the repo's in-memory fake backend. It covers: Start hosting for non-hosts;
  venue guided card, the suggestion not prefilling anything, preset merge
  (20 → 500), preview sheet; organiser wording, no home-area address, publish
  refused without a place; guided Publish → preview → Publish → published
  sheet, create payload, `event_type` write, casual preset's waitlist RPC,
  View Event navigation. The existing B7 (business mode / Manage event) and
  onboarding J (37 checks) scenarios still pass. Screens were also checked
  visually from screenshots.

### Stage 3 remaining
- Native device + screen-reader pass (web only so far; see §15).
- After `20261110120000` is applied: `npm run backend:types`.

---

## 13. Stage 4 foundations — getting-started checklist

Status: foundations built 2026-11-10; the card UI is not built yet.

- `utils/hostChecklist.ts` — pure model. `buildHostChecklist` turns server
  facts (`HostStatus`) + device signals into items, filtered by host type
  (individuals skip "recurring series"; series links free hosts to Plans).
  **Unknown ≠ not done:** an item whose fact could not be read is hidden, so
  hosts are never told to do something they may have done.
  `checklistVisibility` gives hidden / collapsed / expanded (hosts with
  published events when first seen start collapsed, see §14 Q4).
  `parseHostStatus` reads the RPC payload defensively.
- `utils/hostChecklistStore.ts` — per-host local state: shared an event,
  opened Manage event, dismissed, pre-existing host. Signals are one-way.
  Recorded today from the published sheet's Share and from Manage event
  (owner only, not admins).
- `services/hostChecklist.ts` — `get_host_onboarding_status`, with a fallback
  before the migration (profile fields + published count; the rest unknown).
- DB, prepared and **not applied** to the shared DB:
  `20261110130000_host_onboarding_status.sql`, a read-only, caller-scoped
  jsonb function (no new tables). Validated on a throwaway cluster with
  **all 114 migrations** applied in order; `scripts/test-host-setup.sql` and
  the new `scripts/test-host-onboarding-status.sql` both pass, and the
  cluster was deleted.
- "Request verification" is left out until verification requests exist
  (Stage 7); the model is built to add it as one more item.

### Stage 4 completed (2026-11-10)

- `components/HostChecklistCard.tsx` — progress bar, expand / collapse,
  dismiss, and a "Next" row when collapsed. Mounted at the top of Profile
  (hosting mode) and My Events, and permanently in Settings → Host profile
  via `forceVisible` (no dismiss there, shown even when complete).
- `hooks/useHostChecklist.ts` — joins the server facts, the device signals and
  the premium tier; refetches on focus through
  `queryKeys.hostChecklist(businessId)` (under the `events` prefix, so
  publishing refreshes it). Decides `preexistingHost` once, on the first
  evaluation; until then it assumes pre-existing, because collapsed is the
  quieter wrong answer for a host with a back catalogue.
- Signals recorded: Share from the published sheet, and opening Manage event
  as the owner (not admins).
- **Push item fixed during review:** "Turn on host notifications" could never
  be completed on web / builds without push. When `pushEnabled` is false the
  permission stays unknown, so the item is hidden rather than permanently
  unticked.
- Scenarios H5–H7 in `suiteHost.mjs`: fresh host expanded with progress and
  dismissal persisting across screens; established host collapsed showing only
  the next step, then expanded with ticked items; and the missing-RPC fallback
  showing only what it can actually know.

Stage 5 one-time tips can reuse `utils/hostChecklistStore.ts`.

---

## 14. Recommendations on the open questions (2026-11-10)

Based on how comparable apps behave (Eventbrite, Meetup, Partiful, Luma,
Facebook Events): they are generalisations, not checked against current
versions of those apps.

1. **Presets on Edit / Duplicate.** *Standard:* the size is chosen when
   creating; editing exposes the individual settings; "copy event" keeps
   all settings. *Recommendation:* no presets on Edit — changing a preset
   under people who already RSVPed would silently switch waitlist or chat
   behaviour. Waitlist, chat and capacity stay in Manage event. Duplicate
   keeps the source's setup (now implemented).
2. **Guided first event coming back after a pause.** *Standard:*
   first-run guidance shows once per account; returning users get
   "pick up where you left off" (drafts) and occasional tips, not the
   beginner tour again. *Recommendation:* first event ever, once
   (as built). For dormant hosts, an occasional nudge belongs in Stage 5
   tips, not this card.
3. **Preview mandatory or optional.** *Standard:* preview is always
   available and is the default path the first time, but never blocks
   experienced hosts. *Recommendation:* as built — default in guided
   mode, a single button otherwise.
4. **Published sheet on top of the event page or before it.**
   *Standard:* a post-publish "share it" moment, then the event page.
   *Recommendation:* keep the current behaviour (sheet first, dismiss lands
   on the event). Same outcome without the Modal-over-navigation problems.
5. **Existing hosts and the checklist (§9 Q4).** *Standard:* don't greet
   established users with "publish your first event"; show progress
   quietly or not at all. *Recommendation:* hosts with published events when
   first seen start collapsed (built into `checklistVisibility`), and the
   facts are computed, so their list is mostly ticked already.
6. **Guidelines acceptance before publishing (§9 Q2).** *Standard:*
   accept terms once, at signup or when first hosting; when the terms
   change materially, ask on the next publish. Drafts are not blocked.
   *Recommendation:* guard `publish_event` only, and existing hosts accept on
   their next publish rather than all at once.

---

## 15. Stage 4.5 — host UI/UX review (added 2026-11-10)

Requested mid-Stage-4 and added to the roadmap: a standing review pass over
the host workflow screens, not a one-off.

`scripts/fake-backend-e2e/suiteHostUi.mjs` (104 checks) walks six host
screens — Start hosting, host setup, guided Create, My Events with the
checklist, Settings → Host profile, and the preview / published sheets — at
**390 px and 320 px**, asserting per screen: every control is labelled, no
target under 24 px, targets at least 44 px, a heading exists, no horizontal
overflow, no clipped labels, no runtime errors. Screenshots are written for a
visual pass.

Findings fixed in this round:
1. **Touch targets below the 44 px guideline** (`hitSlop` does not enlarge the
   box on web, so these were real on web and borderline on native): the
   guide card's "Hide" (30×18), the checklist header buttons (32×32), both
   sheet close buttons (20×20), the host-guidelines "View" link (32×18), and
   My Events' back button (40×40).
2. **"Business" wording shown to non-venue hosts** — the Settings title
   ("Business Settings"), the profile section label, the name field, the
   description placeholder and the photos hint are now host-type aware via
   `utils/hostCopy.ts`; Profile's "Post a new event for your venue" likewise.
   A scenario check asserts an organiser sees no business/venue wording.
3. **The guided card filled the whole first screen at 320 px.** Step
   descriptions in the card are now one short line each (`short`), and the
   fuller sentence (`hint`) moved to the inline hint beside the section it is
   about — closer to where the host needs it, and the Title field is now
   visible without scrolling.

Not changed (noted): the published sheet scrolls at 320 px with the CTA
pinned, which is intended; `ScreenHeader`'s own back button is already 44 px.

### Stage 4.5 completed (2026-11-10, second pass)

`suiteHostUi.mjs` now takes `HOST_UI_WIDTHS` and `AXE=<axe.min.js>`.
axe-core 4.14 was installed into a scratch directory only (not added to
`package.json`) and its path passed in.

- **1280 px and 640 px** (a 1280 px window at 200 % zoom, WCAG 1.4.4 /
  1.4.10): all checks pass. Visual finding fixed: the preview and published
  sheets stretched edge to edge on desktop (a 1,250 px button, very long
  lines); they are now capped at 560 px and centred — no change on phones.
- **axe WCAG A/AA** over every host screen, four findings fixed:
  1. checklist rows exposed `aria-checked` on a button (not allowed; state is
     in the label now);
  2. both sheet backdrops had a label but no role — they are now hidden from
     assistive tech (the Close button is the accessible way out);
  3. the guide footnote failed contrast on the pink card;
  4. the category badge on the shared Discover card (white on 45 % black,
     ~3.4:1) failed contrast — darkened to 62 % (~5.5:1). This one predates
     the host work and also changes Discover slightly.
  Remaining axe output is the two rules the repo already classifies as
  React-Native-Web artefacts (`label-content-name-mismatch`,
  `nested-interactive`).
- Copy: "42 follower(s)" / "27 more event(s)" now pluralise properly.

**Still open:** a native device pass with VoiceOver / TalkBack — it cannot be
done from this environment.

---

---

## 16. Stage 5 implementation log — one-time tips (2026-11-10)

Pure foundations first, then wiring, as in Stages 3–4.

- `utils/hostTips.ts` — six tips and `nextHostTip`, which picks **at most one**
  in priority order: something needing attention (a report waiting, a
  time/place change with attendees going, a full event) before an
  introduction (first attendee, chat moderation, last free event). Unknown
  facts (`null`) never trigger a tip, and a tip the host has seen never
  returns. Tips never block an action.
- `utils/hostTipsStore.ts` — seen tips per host profile, device-local for
  now. `businesses.host_tips_seen text[]` (plan §6) can back this later with
  the same shape; no migration was written for it, since nothing needs it yet.
- `hooks/useHostTip.ts` — reads the store, picks the tip once the facts
  settle, and holds it (a count changing mid-read does not swap the tip under
  the host). Records dismissal.
- `components/HostTipCard.tsx` — dismissible card with an optional action.
  Using the action also dismisses, so engaging with a tip consumes it.

Wired in:
| Tip | Where | Trigger |
| --- | --- | --- |
| First attendee | Manage event → Overview | first `going` |
| Event is full | Manage event → Overview | `going >= max_attendees` |
| Report waiting | Manage event → Overview | `chat.open_reports > 0` |
| You run this chat | Event chat | host opens their own chat |
| People are already going | Edit event | time/place edited with attendees |
| One event left | Create | free plan, one slot remaining |

Owner-scoped: an admin viewing someone else's event or chat never consumes
that host's tips.

**Bugs found and fixed during this round**
1. **"Your event is full" for an event that was not.** The hub tip was
   deciding from whichever count rendered first, and the public `rsvp_count`
   in event details can differ from the host count. It now waits for the host
   overview to settle and uses only its numbers. Caught by the browser
   scenario, not by unit tests.
2. **Acting on a tip did not consume it** — it came back on the next visit.
   The action now dismisses as well.
3. **Two stacked advisory cards on Create** for a brand-new free host (the
   first-event guide *and* the free-plan tip), re-creating the clutter fixed
   in Stage 4.5. The tip now waits until the guide is gone; the quota pill
   carries the count meanwhile.

Scenarios H8–H12 in `suiteHost.mjs` (66 checks total) and U7 in
`suiteHostUi.mjs` (120 checks total) cover the above, including priority
order, dismissal persisting across navigation, and one-guidance-at-a-time.

### Stage 5 remaining
- A push notification for the first RSVP (plan §4 Stage 5 wanted push + in-app).
  Push is produced by DB triggers, so it belongs with the Stage 6
  notification work rather than here.
- Syncing seen tips across devices (`host_tips_seen`), if repeats annoy.

---

## 17. Where the UI/UX review findings live (2026-11-10)

The §15 review is a standing pass, so its findings are assigned to stages
rather than left in one list:

| Finding | Status / stage |
| --- | --- |
| Touch targets under 44 px (6 controls) | Fixed in Stage 4.5; `suiteHostUi` guards every host screen, and new host UI (the tip card) ships at 44 px |
| "Business" wording for non-venue hosts | Fixed in Stage 4.5 via `utils/hostCopy.ts`; a scenario asserts it |
| Guided card filled the first screen | Fixed in Stage 4.5 (short card copy, detail moved inline); the one-guidance rule above extends it |
| Large width (1280 px) + 200 % zoom | Done in Stage 4.5 second pass (sheets capped at 560 px) |
| axe-core accessibility pass over host screens | Done in Stage 4.5 second pass (4 findings fixed) |
| Native device + VoiceOver / TalkBack | **Stage 4.5 remaining**, also listed under Stage 3 |

### Other issues found in this work, assigned to later stages
1. **Verification is unenforced until the Stage 2 migration is applied** —
   a host can still mark their own business verified. Stage 6 (trust) depends
   on it; it is also in the apply checklist (§10).
2. **No "Request verification" item on the checklist** — deliberate: the model
   takes one more item, to be added with the Stage 6 request flow.
3. **Guidelines acceptance is not required to publish** — recommended guard in
   §14 Q6; belongs to Stage 6, as existing hosts accept on their next publish.
4. **Announcement and chat settings are not carried by every copy path** —
   `duplicate_event` copies capacity/waitlist/RSVP, and Stage 3 added chat
   mode and the preset id; announcements intentionally are not copied. Worth
   re-checking when Stage 6 adds more per-event settings.
5. **`host_tips_seen` / checklist signals are device-local** — fine for now,
   but if hosts commonly use two devices, Stage 8 should sync them.

---

## 18. Stage 6 — trust: foundations (2026-11-10)

Built foundations first; notifications (which need DB triggers and cron)
come next.

DB, prepared and **not applied** anywhere except a throwaway cluster:
- `20261110140000_host_trust_foundations.sql`
  - `businesses.standing` (good / warning / restricted) + reason + time;
    only admins change it (`admin_set_host_standing`, reason required unless
    good). A trigger on `events` refuses publishing for a restricted host —
    both new published events and draft → published — while drafts stay
    allowed, so the big create / publish functions were not redefined.
  - `host_verification_requests` with RLS (hosts read their own, admins all,
    writes only via RPC), one open request per host,
    `submit_verification_request` (eligibility: a description and one
    published event; a `needs_info` request is answered in place) and
    `admin_review_verification` (approve / needs info / reject, note required
    unless approving; approval is the only way `verified` becomes true).
    **Link-based evidence only — no document upload** (§9 Q3).
- `20261110150000_publish_requires_guidelines.sql` — **separate on purpose**:
  it changes behaviour for every existing host (they accept on their next
  publish). Regression suites that publish as an authenticated demo host must
  accept the guidelines for that host first.
- Validation: throwaway Postgres in the scratchpad, **116 of 116 migrations**
  applied in order; new `scripts/test-host-trust.sql` passes, as do
  `test-host-setup.sql` and `test-host-onboarding-status.sql`; both new files
  re-apply cleanly; cluster deleted.

Client:
- `utils/hostTrust.ts` (tested): verification state, who can request,
  eligibility mirroring the server, link normalising, standing notices, and
  mapping the guard / RPC errors to plain messages.
- `services/hostTrust.ts`: latest request (reports `unavailable` before the
  migration) and submit.
- **Create**: a restricted host sees "Publishing is paused" with the reason;
  Publish is disabled with a label that says why, Save as draft still works,
  and the preview cannot publish either. A `guidelines_required` refusal
  shows the guidelines with "Accept and publish", saves the acceptance and
  retries — nothing is lost, because the guard rejects the insert.
- **Settings → Host profile**: `HostVerificationRow` shows standing and
  verification status (with EventMap's note on needs-info / rejected) and a
  request form.
- **Checklist**: the "Request verification" step (venues and organisers),
  ticked once requested or verified, hidden when unknown.
- **Admin**: new Verification queue (oldest pending first, evidence link
  rendered only if it is http(s), note required to ask for more or reject),
  and a Host standing control on the business detail page.
- Scenarios H13–H15 (17 checks): restricted host, guidelines accept-and-retry,
  verification request.

### Stage 6 second pass (2026-11-10) — notifications, badge, appeal

- `20261110160000_host_lifecycle_notifications.sql` (prepared, not applied):
  `host_day_of` and `host_post_event_summary` from a 15-minute pg_cron job
  (deduped in `host_notifications_sent`, silenced by
  `businesses.notifications_enabled`, wrapped so it cannot break the cron
  worker), plus triggers for `host_verification_update` and
  `host_standing_update`. **One-off events only** — "the event ended" is not
  meaningful for a series, and per-occurrence notices need the occurrence work
  in `CATEGORIES_AND_SERIES_PLAN`.
  The **first-RSVP push asked for in Stage 5 already exists**:
  `notify_business_on_rsvp` (20260227000000) notifies the host on every RSVP
  through the push pipeline, so Stage 5 only needed the in-app explanation.
- **Verified badge** now also appears next to the organiser on Event Detail,
  matching the host page. **Discover cards still do not show it** — the ranked
  payload has no `verified` field, so that needs a server change (listed below).
- **Appeal**: a restricted host gets an "Appeal to support" button that
  pre-fills an email with the host id and the reason given. A real in-app
  appeal record is still open (below).
- Standing from complaints is deliberately still manual.

### Stage 6 remaining
1. **In-app appeal records** (a table + admin queue) instead of email.
2. **Verified badge on Discover cards** — needs `verified` in the ranked
   events payload (`get_ranked_events`), i.e. a server change.
3. **Standing suggestions from complaints / upheld reports** — any automation
   should only suggest a change to an admin, never apply one.
4. **Per-occurrence host notices** for recurring series.
5. After applying: regenerate types (hand edits flagged at the top of
   `types/supabase.generated.ts`) and run `test-host-trust.sql` and
   `test-host-lifecycle.sql`.

---

## 19. Stage 7 — stop hosting (2026-11-10)

- `20261110170000_stop_hosting.sql` (prepared, not applied):
  `businesses.archived_at`, `archive_business()` (cancels every upcoming
  published event through `cancel_event`, so attendees get the normal
  cancellation notice, then archives; returns the count), `reopen_business()`
  (cancelled events stay cancelled), a trigger blocking publishing while
  archived, and a guard so owners cannot set `archived_at` directly — the
  RPCs announce themselves with a transaction-local flag, the same pattern
  `cancel_event` uses.
  **Nothing is deleted**: events, RSVPs, chat history and past attendance all
  reference the host, and `businesses.owner_id` cascades, so deleting the row
  would take real history with it.
- Client: "Stop hosting" / "Reopen hosting" in Settings → Host profile, with a
  confirmation that states the consequence and a result message naming how
  many events were cancelled. An archived host sees the same publishing-paused
  treatment on Create as a restricted one.

### Stage 7 remaining
- **Transfer of ownership** — needs co-hosts / member roles first (plan §8)
  and a way for the receiving account to accept. Not started.
- Admin visibility of archived hosts (the businesses table does not show it).

---

## 20. Status and verification (final pass, 2026-11-10)

Verification vocabulary used below:
- **unit** — `vitest` (970 tests, pure logic, no renderer or backend).
- **browser** — headless Chrome against the repo's in-memory fake backend
  (`scripts/fake-backend-e2e`), no database.
- **isolated SQL** — a throwaway local Postgres created in a scratch
  directory with Supabase stand-ins, **all 118 migrations applied in order**,
  then deleted. Never the shared database.
- **types/lint** — `tsc` (app and admin) and eslint.
- **not run here** — needs a real backend, a device, or applied migrations.

### Fully implemented and verified (client complete; DB prepared, not applied)

| Item | Stage | Verification |
| --- | --- | --- |
| Intent fork ("what brings you here") + `eventmap://host` link | 1 | unit, browser, types/lint |
| Always-visible Create tab + Start hosting landing | 1 | browser (H1), UI review (U1) |
| Host setup flow (type / identity / location / links / guidelines) | 2 | browser (U2), isolated SQL for its guards |
| Nullable host location (venue / area / none) everywhere it is read | 2 | unit, isolated SQL, browser (H3) |
| Host profile in Settings (type, location, guidelines, links) | 2 | browser (U5), unit |
| Admin: host type + guidelines columns | 2 | types/lint only — **not exercised in a browser** |
| Event size presets + touched-field merge | 3 | unit, browser (H2, H4) |
| Guided first event + inline hints | 3 | unit, browser (H2, U3) |
| Preview sheet (real Discover card) | 3 | unit, browser (H2, U6) |
| Post-publish sheet (share / followers / calendar / manage) | 3 | browser (H4, U6) |
| Host-type wording on Create / Edit / Settings / Profile | 3, 4.5 | unit, browser (H3, U5) |
| Getting-started checklist (card, server status, local signals) | 4 | unit, browser (H5–H7) |
| One-time tips (6 tips, priority, dismissal) | 5 | unit, browser (H8–H12) |
| Host standing: restriction blocks publishing, host told why | 6 | isolated SQL, browser (H13) |
| Guidelines required to publish + accept-and-retry | 6 | isolated SQL, browser (H14) |
| Verification requests (host side) + admin queue RPCs | 6 | isolated SQL, browser (H15) |
| Stop hosting / reopen | 7 | isolated SQL, browser (H16) |
| Host UI review harness (labels, 44 px, 320/390/640/1280 px, axe) | 4.5 | browser, 120 checks |

### Partially implemented

| Item | What is done | What is missing |
| --- | --- | --- |
| Host notifications | Day-of, post-event, verification and standing notices written and tested in isolated SQL | Never delivered end to end (needs applied migrations + the push pipeline); one-off events only |
| Verified badge consistency | Host page, own Profile, Event Detail | Discover cards (needs `verified` in the ranked payload) |
| Appeal for restricted hosts | Pre-filled support email | No in-app appeal record or admin queue |
| Host standing inputs | Admin sets it by hand | No suggestions from complaints / upheld reports |
| Admin trust surfaces | Verification queue + standing control | Not exercised in a browser; archived hosts not shown in the businesses table |
| Checklist / tips storage | Works per device | Not synced across devices (`host_tips_seen` column not written) |

### Not implemented

| Item | Stage | Note |
| --- | --- | --- |
| Transfer of host ownership | 7 | Needs co-hosts / member roles (plan §8) |
| Co-hosts (`business_members`) | 8 | Out of scope throughout |
| Weekly host digest, premium touchpoints | 8 | Not started |
| Per-occurrence host notices for series | 6 | Needs the occurrence work in `CATEGORIES_AND_SERIES_PLAN` |
| Native device + VoiceOver / TalkBack pass | 4.5 | Cannot be done from this environment |

### Known gaps that are not bugs in this work
1. **Nothing is applied.** All seven migrations
   (`20261110100000`–`20261110170000`) are files only. Until
   `20261110110000` is applied a host can still set `verified` on their own
   business.
2. `types/supabase.generated.ts` is **hand-edited** (header comment lists
   exactly what); `npm run backend:types` reads the shared database, so it was
   never run.
3. The older SQL suites (`test-host-tools.sql` etc.) need demo data that only
   exists in a copy of the shared database and were not run; the four host
   suites are self-contained and were.
4. After `20261110150000` is applied, any regression suite that publishes as
   an authenticated demo host must accept the guidelines for that host first.

### Final regression pass (2026-11-10)
`tsc` app + admin clean; eslint clean on changed files (remaining warnings are
pre-existing); `vitest` 970/970; isolated SQL: 118/118 migrations plus
`test-host-setup`, `test-host-onboarding-status`, `test-host-trust`,
`test-host-lifecycle` all passing and all new migrations re-applying cleanly;
browser: suiteHost 92/92, suiteHostUi 120/120, and the pre-existing
suiteA 21/21, suiteB 46/46, suiteD 30/30, suiteOnboarding 57/57 — no
regressions.

Two test-only defects were found and fixed during this pass: both
`test-host-lifecycle` assertions about notifications were querying as the
wrong user, and `notifications` is RLS-scoped to its recipient, so an admin or
a host cannot see another user's rows. The triggers themselves were correct.

