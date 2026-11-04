# EventMap — Prioritized Issue Tracker

From the full workflow review (2026-10-30). Ordered by priority. Check items off as fixed.
Items marked **[DB]** require a migration — deferred until migrations can be applied safely
(shared local DB; do not reset or migrate without coordination).

## Suggested order of attack

1. [x] Rebrand reconciliation (style.md ↔ theme.ts, tokens, local palettes) — style.md rewritten for the red brand; `surface`/`primarySoft`/soft status tokens + `alpha()` added to theme.ts; terracotta/teal/amber remnants purged; local palettes dissolved or token-backed.
2. [x] Premium consolidation (single source of truth, client-side) — **done**: `businesses.subscription_tier` + `subscription_expires_at` are the single source of truth; mock in-memory state removed; one plan catalog (Free + Pro, $29.99/mo) in `services/premium.ts`.
3. [x] Event lifecycle (cancelled state, owner past-events policy, capacity) — **[DB]** [migration written — pending apply: 20261030105000 owner policy, 20261030106000 cancelled status + cancel_event RPC, 20261030108000 capacity + join_event_with_capacity RPC; client cancel + capacity flows wired with pre-apply fallbacks] **Applied locally 2026-11-02; client fallbacks removed.**
4. [x] Server-side enforcement sweep (reviews, bans, privacy) — **[DB]** [migration written — pending apply: 20261030103000 reviews, 20261030104000 bans + RSVP lifecycle; privacy already server-side since 20261029110000] **Applied locally 2026-11-02.**
5. [x] Quick wins (km/mi, search input, fake description, etc.) — done (see checked items below)

---

## P0 — Top issues by user impact

- [x] Forgot-password dead end: no reset-password screen; `services/auth.ts:141` has no `redirectTo`; `components/AuthRedirectHandler.tsx:29` just logs user in on recovery link — fixed: `app/(auth)/reset-password.tsx` added; resetPassword passes `redirectTo`; handler routes `type=recovery` callbacks to the reset screen (and now handles web-origin callbacks).
- [x] Keyword search unreachable: `searchQuery` in `app/(tabs)/discover.tsx:57` only written by `clearFilters()`; backend ILIKE support unused — fixed: keyword field added to SearchOverlay 'where' step, wired to `searchQuery`.
- [x] `Alert.alert` no-op on web: all auth/onboarding feedback invisible on web (`app/(auth)/signup.tsx:53`, `login.tsx:59`, onboarding saves) — fixed for auth/onboarding/settings: `utils/notify.ts` + `components/AppToast.tsx` toast/confirm system mounted in `app/_layout.tsx`; remaining call sites tracked in P1.
- [x] Past events publishable and instantly hidden: create validates only end>start (`app/(tabs)/create.tsx:166-176`); RLS hides ended events; burns monthly limit — client side fixed: future-start validation + `minimumDate` on pickers (Edit screen only enforces it when the start was changed).
- [x] **[DB]** Business owners lose past events: only SELECT policy is `end_datetime > now()` (`supabase/migrations/20260213092204:126-130`). Needs owner SELECT policy. [migration written — pending apply: 20261030105000; MyEvents needs no client change] **Applied on the shared local DB (verified 2026-11-02).**
- [x] **[DB]** Event deletion strands attendees: hard cascade, no DELETE notification trigger (`services/events.ts:95-99`). Needs "cancelled" soft state + notify. [migration written — pending apply: 20261030106000 adds events.status + cancel_event RPC (notifies going/interested); CLIENT WIRED: MyEvents/EventDetail now call `eventsService.cancelEvent` (cancel_event RPC) with a hard-delete fallback while 42883/PGRST202 (pre-apply); remove fallback in services/events.ts once applied] **Applied on the shared local DB (verified 2026-11-02). Hard-delete fallback removed from services/events.ts.**
- [x] **[DB]** RLS hole: business owners can rewrite customer reviews — UPDATE policy has no column restriction (`…20260217110000_create_reviews.sql:44-60`). [migration written — pending apply: 20261030103000 column-scoping trigger] **Applied on the shared local DB (verified 2026-11-02).**
- [x] Premium system three-way contradiction (see Premium section) — fixed: single DB-backed source of truth, one cancel flow (`/premium/manage`), one upsell route (`/premium/plans`).
- [x] Distance km shown as "mi" (`app/(tabs)/discover.tsx:369`) — fixed: km→mi conversion applied (also unified `screens/SavedEvents.tsx` to miles).
- [x] No account deletion (`screens/Settings.tsx`) — fixed: `delete_own_account()` RPC + Settings "Delete account" row with double confirm [migration written — pending apply: 20261030109000; client degrades gracefully via `services/account.ts` NOT_AVAILABLE on 42883/PGRST202]. Report user added to profile header (`screens/UserProfile.tsx`, complaintsService 'user'); global blocking still missing (see [DB] item below).
- [x] **[DB]** No global user-block table (only per-event `event_chat_blocks`) — [migration written — pending apply: 20261030111000 `user_blocks` table + blocker-scoped RLS; client wired: Block/Unblock on `screens/UserProfile.tsx` via `socialService.blockUser/unblockUser/isBlocked`, degrades to "Blocking isn't enabled on this server yet." pre-apply (42P01 → NOT_AVAILABLE)]. **Applied on the shared local DB (verified 2026-11-02).**
- [x] **[DB]** Enforce user_blocks in chat/content RPCs — hide blocked users' chat messages/events (and vice versa) once 20261030111000 is applied; blocking is storage-only today. [migration written — pending apply: 20261030116000 filters blocked senders from the attendee chat SELECT policy (viewer-side mute; sending stays allowed, host/admin moderation reads keep full transcript); known mismatch: `get_event_chat_unread_counts` is SECURITY DEFINER and still counts blocked senders' messages, so the unread badge can exceed rendered messages; events/content enforcement still open] **Applied on the shared local DB (verified 2026-11-02). Notification-side enforcement still open (see Events Tier 0 section).**

## P1 — High

### Auth / onboarding
- [x] Migrate remaining Alert.alert call sites to notify/toast system — done across events/profile/business/premium/review/picker surfaces; sole intentional holdout is the 4-option "Report this event" picker in `screens/EventDetail.tsx` (notifyConfirm is 2-button).
- [x] Transient profile-load failure bounces onboarded user into onboarding and overwrites prefs — fixed: AuthContext tracks `profileError`; `app/index.tsx` and the tabs guard show a Retry screen instead of routing to onboarding; onboarding only entered when the profile loaded and the flag isn't set.
- [x] Missing profile row loops onboarding forever — fixed: `app/(onboarding)/index.tsx` calls `profilesService.ensureProfileExists` at onboarding start (best-effort), no longer OAuth-only.
- [x] No auth guard on `(tabs)` / push deep-link handler — fixed: `app/(tabs)/_layout.tsx` redirects signed-out → welcome, un-onboarded → onboarding (profile-error → `/` retry screen); push navigation gated in `PushNavigationGate` (`app/_layout.tsx`): taps queue until auth resolves, then flush or drop.
- [x] `await` of Supabase queries inside `onAuthStateChange` — fixed: listener is now synchronous (sets session/user only); profile loads in a `useEffect` keyed on user id (deferred via setTimeout(0)); signIn/signUp/OAuth no longer double-fetch the profile.
- [x] Signup claims email verification even when a live session is returned (`app/(auth)/signup.tsx:53-57`); no `emailRedirectTo` — fixed: signup branches on returned session (route to '/' vs check-email toast + login prefilled), `emailRedirectTo` passed on signUp.

### Event creation
- [x] Partial-failure on submit: orphaned uploads / duplicate events, no rollback (`app/(tabs)/create.tsx:204-248`) — fixed: event is created first, photos uploaded/attached after with non-fatal per-photo failures (warning alert, successes kept); same ordering applied to `screens/EditEvent.tsx` (fields saved before photo work).
- [x] Form never resets after successful publish → duplicate events (`create.tsx:239-248`) — fixed: formData/errors/images reset to initial state before the success alert.
- [x] `getNextOccurrences` can infinite-loop UI on malformed recurrence (`utils/recurrence.ts:106-115`) — fixed: 731-day iteration cap, returns what was found.
- [x] Recurrence: monthly ignores `interval`, skips the 31st (`utils/recurrence.ts:80-81`) — fixed: monthly branch honors `interval` via year*12+month arithmetic and clamps to the last day of short months (a "31st" series fires Feb 28/29); `getNextOccurrences`/`filterEventsByDateRange` inherit via `isEventOnDate`. (~~`endDate` parsed as UTC midnight~~ fixed: `parseDateOnly` now parses local date components, matching `utils/eventStatus.ts`.) (Runtime-test fixes 2026-10-30: day-diff now `Math.round` not `Math.floor` — flooring flipped daily/weekly interval>1 parity after spring-forward DST; `getNextOccurrences` start guard now uses local midnight of the start — the UTC-date guard skipped the true first occurrence for evening starts west of UTC.)

### Discovery
- [x] Location permission denial silent → SF default, no banner/CTA (`app/(tabs)/discover.tsx:139-146`) — fixed: dismissible "Location is off — showing San Francisco" banner with Enable (opens settings), `userLocation` stays null on denial, permission re-checked on focus (banner clears + recenters once granted).
- [x] 100-event hard cap, no pagination (`services/events.ts:21`); no marker clustering; map WebView full-reloads on recenter (`components/GoogleMapView.tsx:245-257`) — pagination: **[DB]** [migration written — pending apply: 20261030110000 adds p_offset to get_ranked_events; client pages 50/append-on-scroll and falls back to the legacy single 100-event fetch pre-apply]; clustering added via @googlemaps/markerclusterer (CDN, plain markers if it fails); WebView now builds HTML once and pans via injected JS (no reload on recenter). **Applied on the shared local DB (verified 2026-11-02). Legacy single-fetch fallback removed.**
- [x] Signed-out "Join Event" silently no-ops (`screens/EventDetail.tsx:926-929`) — fixed: button shows "Sign in to join" and routes to login with a `redirect` return path back to the event.
- [x] Empty description renders fake marketing copy (`screens/EventDetail.tsx:729`) — fixed: neutral "No description provided." in tertiary text.

### Attendance / multi-user
- [x] **[DB]** No capacity model: no join cap, no waitlist (`services/social.ts:24-45`). [migration written — pending apply: 20261030108000 (events.max_attendees + join_event_with_capacity RPC); tolerant client wired: join tries RPC then falls back to upsert, EventDetail shows X / Y + "Event full", create/edit forms have optional Max attendees with missing-column retry; discovery (get_ranked_events) intentionally untouched — surface remaining capacity there post-apply; waitlist still open] **Applied on the shared local DB (verified 2026-11-02). Upsert fallback removed; waitlist still open.**
- [x] Hosts have no UI entry to their own event chat — gated on `user_rsvp === 'going'` (`screens/EventDetail.tsx:662-667`) — fixed: owner "Manage chat" row on EventDetail → `/event-chat/[id]`; chat screen already honors host read+moderation via `get_event_chat_post_status.can_read` and now shows a host-specific read-only notice (posting still requires a 'going' RSVP per the INSERT policy — no new grants).
- [x] **[DB]** Anyone can review a business they never attended, incl. the owner (policy only checks `auth.uid() = user_id`). [migration written — pending apply: 20261030103000 eligibility check (past 'going' RSVP, owner excluded)] **Applied on the shared local DB (verified 2026-11-02).**
- [x] Attendee count / chat unlock not realtime (`screens/EventDetail.tsx:128-157`) — mitigated: 20s focus-scoped poll of rsvp_count (rsvps is not in the realtime publication, so postgres_changes would never fire); true realtime tracked in the [DB] item below.
- [x] **[DB]** Add `rsvps` to the `supabase_realtime` publication (only `event_chat_messages` is published — 20260301000000) so EventDetail can replace its 20s attendance poll with a debounced postgres_changes subscription filtered by event_id. [client subscription pre-wired; fires once publication is added — the 20s poll stays as primary/fallback] [migration written — pending apply: 20261030115000 adds rsvps to the publication + REPLICA IDENTITY FULL so DELETE payloads carry event_id] **Applied on the shared local DB (verified 2026-11-02). Note: RLS on rsvps is self-scoped, so the subscription only sees the viewer's own rows; the 20s poll remains primary (Tier 1).**

### Business / premium (beyond consolidation)
- [x] Event insights blend real counts with `Math.random()` data, barely labeled — now premium-gated and every simulated card carries an explicit "Sample data" badge. TODO(schema): add an event_views/analytics table to replace `getSampleEventAnalytics`.
- [x] Photo limits hardcoded to 5 regardless of tier — now driven by the plan catalog (`max_photos_per_event`: free 5, pro 15).
- [x] Business onboarding: typed-but-unselected address silently pins business in SF (`screens/BusinessOnboarding.tsx:297-321`) — fixed: coords are tracked as geocode-backed (`locationSet` + committed-address ref); submit blocked with inline "Pick the address from suggestions or tap the map" until a suggestion/Set/map-tap sets the pin.
- [ ] Business description can never be edited — Settings form omits it (`screens/Settings.tsx:137-148`).

### Profile / settings
- [x] Validation errors never clear once shown (`screens/Settings.tsx`) — fixed: validators rebuild the errors object each run.
- [x] Event-reminder toggle re-enables itself after saving "off" (`screens/Settings.tsx`) — fixed: hydration respects `event_reminder_enabled === false`.
- [x] Dirty edits lost on back with no guard (`screens/Settings.tsx`) — fixed: ScreenHeader onBack shows a "Discard changes?" notifyConfirm when dirty.
- [ ] Stale avatar after change — fixed path + upsert + same URL (`services/profiles.ts:79-101`); add cache-busting version.
- [x] **[DB?]** `show_future_events` privacy enforced client-side only (`screens/UserProfile.tsx:94-99`) — verified: already enforced server-side; `get_user_going_events`/`get_user_upcoming_events` gate on `can_view_user_events` (checks `show_future_events` + `is_profile_private`, migration 20261029110000). No further migration needed.

## P2 — Medium

### Auth
- [x] Sign-out strands user if network call throws — fixed: `authService.signOut` never throws (server revoke best-effort, falls back to local-scope sign-out); AuthContext clears local state regardless and the tabs guard routes to welcome.
- [x] Weak password policy (6 chars), untrimmed email/name (`app/(auth)/signup.tsx:40-52`) — fixed: min 8 chars (signup + reset screen), email/name trimmed before submit.
- [x] Profile refetch + loading flash on every TOKEN_REFRESHED — fixed: profile load is keyed on the user id, so token refreshes (same id) no longer re-fetch or flash the loading screen.
- [x] Stale profile-load race: rapid sign-in→sign-out→sign-in let a slow superseded `loadProfile` resolve late, leaking the previous user's profile into state and stranding `loading` true forever — fixed: sequence guard in `contexts/AuthContext.tsx` (stale resolutions discarded; sign-out invalidates in-flight loads).
- [x] Web confirm clobber: a second `notifyConfirm` while one was open replaced it, so the first dialog's callbacks never fired (promise-based `confirmAction` callers hung forever) — fixed: `components/AppToast.tsx` queues confirms FIFO.
- [x] Cross-device PKCE recovery links fail silently (verifier is device-bound) — fixed: AuthRedirectHandler detects missing/mismatched-verifier exchange failures (bad_code_verifier / "code verifier" / "invalid request") and routes to login with a "request a new link on this device" toast; generic exchange/callback failures also land on login with an error toast instead of console-only.

### Event creation / editing
- [x] Edit screen address text and pin can diverge (`screens/EditEvent.tsx:431-445`) — fixed: EditEvent now uses the same select-only `/business-location` picker flow as create.tsx (via `eventLocationStore`); free-typed addresses can no longer save stale coordinates.
- [x] Changing start doesn't shift end; Android time-step cancel discards chosen date (`create.tsx:84-85,464-466`; `EditEvent.tsx:123-150`). **Already fixed in code: `withShiftedEnd` + Android date-first commit (verified 2026-11-02).**
- [ ] Submit-only validation, no scroll-to-first-error (`create.tsx:166-176`).
- [ ] No unsaved-changes guard on Edit (`screens/EditEvent.tsx:259-261`).
- [ ] No price/capacity/ticket-link fields; `event_links` schema+service unused (`services/events.ts:131-154`).
- [ ] Free-tier limit surfaces only after filling whole form (`create.tsx:185-194`); client reimplements DB reset logic (`services/businesses.ts:83-113`).
- [ ] Create vs Edit are two different form designs — converge.
- [ ] "No business" CTA routes inconsistently (`create.tsx:288` → profile vs `screens/MyEvents.tsx:342` → onboarding).
- [ ] No title/description length limits (UI or DB).

### Discovery
- [ ] Mount-time race / no request cancellation can show wrong-city results (`discover.tsx:114-116,174-194`).
- [ ] Pull-to-refresh mid-pan reloads page 1 at the live map center (`discover.tsx:328-336` uses `mapCenterRef`) without committing `center`, so later load-more pages (`discover.tsx:290-294`) query the old center — mixed-center pages can skip items (dupes are de-duped).
- [x] "Clear filters" misses date filter; empty-state Clear hidden when only date set (`discover.tsx:205-208,693`) — fixed: clearFilters resets date range; empty-state Clear shows for date filters too.
- [x] No pull-to-refresh / focus refresh on Discover — pull-to-refresh added on the bottom-sheet list (BottomSheetFlatList refreshing/onRefresh); focus refresh intentionally omitted (map region changes already drive reloads).
- [x] No joined/saved indication on cards (`types/database.ts:214-229` lacks viewer fields). **[DB]** [migration written — pending apply: 20261030114000 adds `user_rsvp`/`user_saved` to get_ranked_events; discover cards show a Going badge + saved bookmark and degrade gracefully pre-apply (fields undefined → nothing renders)] **Applied on the shared local DB (verified 2026-11-02).**
- [ ] Recurring events show original stale date + wrong badge in list (`discover.tsx:379,389`).
- [ ] Marker tap unmounts entire bottom sheet (`discover.tsx:656-720`).
- [x] Photo carousel missing page dots (`screens/EventDetail.tsx:528-550`; styles 1118-1133 unused) — fixed: dots rendered above the hero title when photo count > 1, active dot tracks onMomentumScrollEnd.
- [x] SearchOverlay Airbnb-template "guests" leftovers (`contexts/SearchContext.tsx:14-18`, `components/SearchOverlay.tsx:44`) — removed: 'who' step type, guests context state, and the collapsed-bar "Guests" segment; hasSelection/clearAll no longer reference guests.
- [x] Fixed 50 km radius regardless of zoom (`discover.tsx:179`) — radius now derived from the map viewport (half the bounds diagonal, clamped 5–150 km; falls back to 50 km until the map reports bounds).

### Attendance / notifications
- [x] **[DB]** Bans not enforced on rsvps/saves/reviews policies (chat does it right). [migration written — pending apply: 20261030104000 adds `user_is_banned()` to all three INSERT policies] **Applied on the shared local DB (verified 2026-11-02).**
- [x] **[DB]** RSVP to ended events blocked client-side only. [migration written — pending apply: 20261030104000 `event_is_open_for_rsvp()` on rsvps INSERT/UPDATE, recurrence-aware] **Applied on the shared local DB (verified 2026-11-02).**
- [x] Notifications UX: chevron deletes, fake Accept/Decline on FYI RSVPs, "View Past History" marks-all-read (`app/(tabs)/notifications.tsx`) — fixed: X dismiss with a11y label, RSVP rows informational, button relabeled "Mark all as read".
- [x] `new_follower` shows hardcoded Unsplash stranger avatar (`notifications.tsx`) — fixed: neutral UserPlus icon (notification row carries no follower id; real avatar needs a schema change to store it in `data`).
- [ ] Chat relock below 2 attendees hides history with no explanation (`app/event-chat/[id].tsx:1235-1252`).
- [x] `Following` N+1 serial fetches ×2 (`screens/Following.tsx:46-51,96-109`) — fixed: one batched `.in('id', …)` businesses query + one grouped follows query aggregated client-side (`socialService.getBusinessesByIds`/`getFollowerCountsByBusinessIds`); `screens/Followers.tsx` verified already batched (single follows select + one profiles RPC).
- [x] Badge unread count: use count:'exact' head query + refetch on app foreground — fixed: `getUnreadNotificationCount` (`count: 'exact', head: true` on `read=false`) in services/notifications.ts; hook refetches on realtime events and AppState 'active', '-badge' channel kept.

### Business
- [x] `verified` can never become true; badge unreachable; not shown on public page (`services/businesses.ts:52`) — fixed: `admin_set_business_verified` RPC + admin dashboard Verify/Unverify actions (businesses table + detail page); Verified badge now shown on the public business page (`screens/BusinessDetail.tsx`) [migration written — pending apply: 20261030113000].
- [x] `subscription_expires_at` never read/written by app — now written on subscribe (+1 month/year) and honored on read; lapsed subscriptions are downgraded to free.
- [x] Follower rows not tappable (`screens/Followers.tsx:166-182`) — fixed: rows navigate to `/user/[id]` with chevron + accessibilityRole (guarded when user_id missing); "notify followers" tool DONE: `notify_followers_about_event` RPC (owner-only, deduped per follower+event, respects notification prefs) + MyEvents megaphone row action [migration written — pending apply: 20261030112000; client shows "Not enabled on this server yet." on 42883/PGRST202].
- [x] No insights link on MyEvents rows; no "view public profile" link for hosts — fixed: MyEvents rows have an Insights icon action → `/business/event-insights/[id]`; business-mode profile has a "View public profile" quick link → `/business/[id]`.
- [x] Second business attempt hits raw DB UNIQUE error (`screens/BusinessOnboarding.tsx:122`) — fixed: onboarding shows a friendly "You already have a business — edit it in Settings" state when `hasBusiness`; 23505 on submit mapped to the same message as a backstop (+ refreshBusiness).
- [x] Recurring-upsell routes to profile tab instead of `/premium/plans` — fixed; Upgrade buttons now open `/premium/plans`.

### Profile / settings
- [x] No change-password / change-email in Settings (`authService.updatePassword` exists, unused) — fixed: Account section now has "Change password" (reset-password screen in change mode) and "Change email" (`authService.updateEmail`, confirmation email sent).
- [x] Network errors shown as "Profile not found", no retry (`screens/UserProfile.tsx:101-107`) — fixed: fetch failures now show an error state with a Retry button; "Profile not found" is reserved for a genuinely missing profile.
- [x] No input limits/format validation on bio/hobbies/socials (`screens/Settings.tsx`) — maxLength caps added (name 80, bio 500, hobbies 200, socials 80/200, business name 80); values trimmed on save.
- [ ] Personal-mode notification copy describes business features (`Settings.tsx:1119-1120,1175-1176`).
- [ ] FAQ email not tappable; copy references nonexistent navigation (`app/settings/faq.tsx:169-173`).
- [x] Broken border color: `Colors.border` object passed as borderColor (`app/settings/faq.tsx:8-12`, `disclaimers.tsx:9-13`) — now `Colors.border.light`.

## P3 — Low / UI polish

- [x] Onboarding interests: CTA requires ≥1 pick while Skip is offered; infinite spinner if categories fail — fixed: ≥1 requirement removed (CTA now "Continue"/"Continue without", matching other optional steps); category load failure shows an error + Retry instead of spinning forever.
- [ ] ~~Confirm Password lacks visibility toggle (`signup.tsx:130`)~~ fixed (own toggle + hitSlop on eye icons); email/Google buttons not cross-disabled during in-flight auth.
- [ ] ~~"TODAY" badge white-on-white~~ fixed (primarySoft bg + primary text); ~~empty state says "Event not found"~~ fixed ("No events nearby"); card bottom row shows date styled as business name (`discover.tsx:386-391`).
- [ ] `EventCardCarousel` width assumes 32px padding, discover uses 24 → clipped images (`components/EventCardCarousel.tsx:13`).
- [ ] `eventmap://event/<id>` not registered on Android (`app.json:50-62`); `router.back()` with no stack on deep-link cold start (`screens/EventDetail.tsx:489`).
- [ ] Recurring `endDate` off-by-one duplicate note — see P1 recurrence item.
- [ ] Host notified on every RSVP flap, never on leaves; saved events capped at 50 no pagination (`services/social.ts:255-258`).
- [x] Three divergent list-item designs (Joined/Saved/MyEvents) — unified via `components/EventListItem.tsx` (thumbnail, badge, meta lines, right accessory, actions row, shared `formatEventDate` using device locale); adopted in all three screens with per-screen actions preserved.
- [ ] "Leave event" no confirm, no chat-loss warning (`screens/EventDetail.tsx:949-960`).
- [x] Calendar export Google-only (`screens/EventDetail.tsx:370-380`) — fixed: Google / .ics chooser; `utils/eventShare.ts` builds a minimal RFC 5545 ICS (web Blob download; iOS share sheet via cached file; Android content:// ACTION_VIEW). (Runtime-test fix 2026-10-30: `foldIcsLine` now folds by UTF-8 octets and never splits a code point — the old UTF-16 slice emitted >75-octet lines and could split emoji surrogate pairs into invalid UTF-8.)
- [x] Event-page reviews are business reviews with no label (`EventDetail.tsx:849-856`) — fixed: section titled "Reviews of {businessName}" (fallback "Venue reviews") and the review form headed "Review {businessName}".
- [x] No unread badge on notifications tab — fixed: `hooks/useUnreadNotificationCount.ts` (one fetch + realtime subscription) drives `tabBarBadge` in `app/(tabs)/_layout.tsx`.
- [ ] Save button shows literal `'...'` while saving (`Settings.tsx:556,574`); own profile via `/user/[id]` lacks edit affordance; mixed date locales; FAQ "Last updated" hardcoded future date.
- [x] Edit header ignores safe area — fixed via shared `ScreenHeader` (useSafeAreaInsets).
- [ ] Silent no-op submit when business context not loaded (`create.tsx:179`).
- [x] Account deletion: success feedback + orphaned storage objects cleanup note — fixed: Settings shows `notify.success('Your account has been deleted')` on success; `delete_own_account()` now also deletes the caller's `avatars`/`event-images` objects under their uid folder (legacy non-uid `events/...` paths stay orphaned) [edit to pending migration 20261030109000].

### Design-system (addressed by attack item 1; residual cleanup)
- [ ] ~126 literal fontSizes (off-scale 11/13/15/17/20/22/26/28); auth hero sizes 54/50/36/28. (UI pass 2: auth hero titles normalized to `Typography.sizes.xxl`, auth screen padding 22→`Spacing.lg`, off-scale sizes snapped in edited files; pass 3: 11/13/15/17 snapped to tokens in create/profile/plans/EventDetail/ImagePickerButton; pass 4: flagged files done — event-chat/[id].tsx, ChatModerationSheet, BrandedSplashScreen, notifications.tsx snapped (off-scale 11/15/20 fontSizes → xs/md/lg tokens, paddings 10/14 → Spacing.sm/md, white/brand-red hex+rgba → Colors.surface/text.inverse/alpha(); splash warm-white rgba(250,248,245,…) left as brand tint, platform-tuned chat-input paddings left). Remaining scope: repo-wide 20/22/26/28 fontSizes and padding/radius literals outside these files.)
- [ ] ~552 raw padding/margin literals; 14 and 10 common non-token values; signup `marginTop: -8` hack.
- [ ] ~180 literal radii; card radius 14/16/18/20 varies; auth cards 40 vs 22.
- [x] Star-rating hexes → `Colors.warning`/`border.light`; `#0F172A`/`#1a1a1a` → `text.primary`; concat alpha (`Colors.primary + '80'` etc.) → `alpha()`/soft tokens; purple loading gradient → muted primary tones; old-brand rgba purged. (Remaining misc one-off hex/rgba tracked under normalization below.)
- [x] Shared `components/ui/Button.tsx` (primary/secondary/ghost/destructive, md 48/lg 56, loading/icon/gradient) adopted for main CTAs (auth, create Publish, premium, empty states, EventDetail owner actions); shared `components/ui/ScreenHeader.tsx` adopted in Settings, UserProfile, FAQ, Disclaimers, EditEvent (safe-area fixed), premium manage/plans, business-location. Remaining: EventDetail join bar + hero top bar, profile-analytics gradient header, count-subtitle headers (MyEvents/SavedEvents/JoinedEvents/Followers/Following) kept hand-rolled.
- [ ] Accessibility: 57 labels vs 232 touchables; sparse hitSlop; 44pt targets unverified. (UI pass 2: labels/hitSlop added to tab bar, back buttons across auth/list/detail screens, settings gear + avatar picker, SearchOverlay close/clear, discover filter/close/preview-close, notification dismiss, photo add/remove; Button/ScreenHeader bring built-in roles/labels/44pt. Remaining: long-tail icon touchables in chat moderation sheets, map HTML controls, misc cards.)
- [ ] No dark mode; `Colors.background.dark` unused. (Decision deferred — static light theme for now.)
- [x] Dead premium UI: `PremiumGate`, `UpgradeBanner`, `PremiumDebugPanel`, `constants/subscriptions.ts` deleted (all unreferenced).

### Premium — deferred (needs schema)
- [ ] **[DB]** No `cancel_at_period_end` / billing-period model — cancel is immediate by design for the simulated plan; real billing needs a subscriptions table or Stripe integration.
- [ ] **[DB]** No real view/share analytics — event insights use labeled sample data until an analytics table exists.

## Security backlog (to be extended after post-implementation security pass)

- [ ] **[DB]** Review-tampering RLS hole (owners can edit any review column). [migration written — pending apply: 20261030103000]
- [ ] **[DB]** Review eligibility not enforced server-side (never-attended / self-review). [migration written — pending apply: 20261030103000]
- [ ] **[DB]** Ban enforcement missing on rsvps/saves/reviews policies. [migration written — pending apply: 20261030104000]
- [ ] **[DB]** RSVP-to-ended-events client-only. [migration written — pending apply: 20261030104000]
- [x] **[DB?]** `show_future_events` privacy client-only — verified: enforced server-side via `can_view_user_events` in 20261029110000; no migration needed.
- [x] No auth guard on tabs/deep links — fixed (see P1 Auth/onboarding: tabs-layout Redirect guard + gated push navigation).
- [x] Weak password policy (6 chars) — client now enforces 8 chars on signup/reset; server-side `minimum_password_length` still 6 (config change deferred).
- [ ] **CRITICAL [DB]** Any user can grant themselves admin: profiles UPDATE policy is row-scoped only (supabase/migrations/20260213092204_enable_rls_and_policies.sql:70-73) and `is_admin` (20260219100000_add_admin_role.sql:2) has no column protection/trigger — `is_admin_user()` (20260219100400_admin_rpcs_and_policies.sql:5-12) and the admin dashboard trust it, so all admin RPCs/policies collapse. [migration written — pending apply: 20261030100000 BEFORE INSERT/UPDATE trigger protects `is_admin` (only service context or admins may change it)]
- [ ] **HIGH [DB]** Storage: any authenticated user can UPDATE/DELETE any object in `event-images` and `avatars` buckets (policies check only bucket_id — 20260213092328_create_storage_bucket.sql:52-62; 20260215110000_create_avatars_bucket.sql:7-11); combined with client-built upload paths (services/events.ts:179-199) others' images/avatars can be overwritten or wiped. [migration written — pending apply: 20261030102000 owner-folder-scoped INSERT/UPDATE/DELETE; client already uploads under `${uid}/…` (services/events.ts, works pre- and post-apply)]
- [ ] **HIGH [DB]** Business owners can set `subscription_tier`/`subscription_expires_at` directly via the businesses UPDATE policy (20260213092204_enable_rls_and_policies.sql:98-101); the new client-side premium flow depends on this (services/premium.ts:179-209), so any owner gets free premium with one API call and server gates (event limit, recurring trigger) honor it — move tier writes behind a SECURITY DEFINER RPC/billing hook. [migration written — pending apply: 20261030101000 column-protection trigger + `activate_premium_simulation`/`cancel_premium_simulation` RPCs; services/premium.ts now calls the RPCs first with a direct-update fallback until applied]
- [x] **MEDIUM** Deep-link session fixation: AuthRedirectHandler accepts any URL containing `access_token` and calls `setSession` with URL-supplied tokens, no PKCE/state (components/AuthRedirectHandler.tsx:14-31) — crafted link can log a victim into an attacker's account. *Partially hardened (client-only): URL allowlist now accepts only the dedicated `auth-callback` host/path on `eventmap://` and exp dev URLs; token values no longer logged. Full PKCE migration still pending. Update 2026-10-30: handler now also accepts same-origin web URLs (needed for email recovery/confirmation + web OAuth return, since `detectSessionInUrl` is off), routes `type=recovery` callbacks to `/(auth)/reset-password`, and scrubs the token fragment from web history. Fixed 2026-10-30: PKCE flow enabled (`flowType: 'pkce'` in services/supabase.ts); handler exchanges `?code=` via `exchangeCodeForSession` (verifier-bound, not attacker-usable) and routes recovery via the PASSWORD_RECOVERY auth event; legacy `#access_token=` fragment handling kept only as a TODO-remove fallback for in-flight links.*
- [x] **MEDIUM [DB]** `get_event_attendees_public` deanonymizes private attendees: anonymous entries use id `'anon-' || user_id`, exposing the real profile UUID (20260222000000_attendees_include_anonymous.sql:18-24). — verified already fixed: 20261029110000 re-created it (and `get_event_attendees_page`) with `'anon-' || left(md5(rsvp.id), 16)`; no client code parses the anon ids.
- [ ] **MEDIUM [DB]** Several SECURITY DEFINER functions lack `SET search_path` pinning (20260213092246, 20260213140000, 20260218120000, 20260219100400 incl. `is_admin_user`, 20260220000001, 20260221000000, 20260222000000). [migration written — pending apply: 20261030107000 pins all of them; the 20260220000001/20260222000000 functions were already re-created pinned in 20261029110000]
- [ ] **LOW [DB]** Premium expiry is lazily enforced client-side only: server gates check `subscription_tier='premium'` with no expiry check, downgrade happens only when the owner's app runs services/premium.ts:115-130 — lapsed subs keep premium server-side indefinitely if the owner never opens the app (or blocks the downgrade write).
- [ ] **LOW** GoogleMapView WebView hardening: `originWhitelist={['*']}`, `postMessage('*')` web fallback, `onMessage` without type validation; Maps API key embedded in WebView HTML needs API/referrer restriction. *(Coordinate interpolation resolved: the Google branch already coerced via `Number()`+`JSON.stringify`; the Leaflet branch now does too — see Maps & auth review P1 below.)*
- [ ] **LOW** Admin banner/promotion `link_url` accepts any scheme — restrict to https: before opening on clients.

---

# Maps & auth review (2026-10-31)

Focused review of the maps and auth systems. Items below are additional to the
2026-10-30 sweep above. None require a migration; the two `supabase/config.toml`
changes need a **coordinated Supabase restart** to take effect (shared local DB).

## Pass 1 — correctness (done 2026-10-31)

- [x] Location-picker pin never moves: `injectMarkers` deduped on the sorted marker-id set (`components/GoogleMapView.tsx:312`), but every picker renders one marker with a fixed id (`'business'`/`'profile'`/`'onboarding'`/`'event'`) and changes its lat/lng — so after the first injection the pin stayed put while the map panned away. Affected `components/AddressMapPicker.tsx:166`, `app/business-location.tsx:195`, `screens/BusinessOnboarding.tsx:296`. Fixed: key is now `id@lat,lng#categorySlug`, so position and category changes re-inject while repeat renders still dedupe and marker taps still take the cheap active-only path.
- [x] Event-page venue map trapped vertical scroll: rendered inside the page `ScrollView` with gestures defaulting to on → `gestureHandling:'greedy'` swallowed the pan (`screens/EventDetail.tsx:948`). Fixed with `mapGesturesEnabled={false}`, matching `screens/BusinessDetail.tsx:325`.
- [x] Sign-in and password-reset sent untrimmed emails while signup trimmed (`app/(auth)/login.tsx:63`, `forgot-password.tsx:54` vs `signup.tsx:52`); GoTrue does not strip whitespace, so a pasted/autofilled trailing space failed as "Invalid login credentials". Fixed: all four auth call sites trim.
- [x] Leaflet HTML interpolated coordinates raw (`utils/openMapHtml.ts:8`) where the Google branch coerced: `undefined`/`null`/`''` emitted broken JS (`.setView([,],15)`) that killed the whole map with no visible error, and non-numeric input reached the page script. Fixed with a `num()` finite-coercion helper plus boolean/numeric coercion on `gestures` and `attributionTop`; `MAP_HTML_VERSION` bumped 6→7.

## Pass 2 — auth hardening (done 2026-10-31)

- [x] **Change password required no reauthentication**: Settings routed straight to the reset screen (`screens/Settings.tsx:501`) and `updateUser({password})` does not ask for the current one — anyone with an unlocked, signed-in phone could take the account over. Fixed: `mode=change` now prompts for the current password and re-verifies it via `authService.verifyCurrentPassword` (a `signInWithPassword` round-trip against the session's own email) before `updatePassword`, and rejects reusing the same password. OAuth-only accounts are detected via `authService.hasPasswordIdentity()` and skip the prompt so they can still set a first password.
- [x] Sign-out revoked every device: `supabase.auth.signOut()` defaults to global scope, so signing out on a phone killed the user's tablet/web sessions. Now `{ scope: 'local' }` (`services/auth.ts`); the now-redundant local-scope retry in the catch was removed.
- [x] No autofill metadata on any auth input. Added across login / signup / reset-password / forgot-password: `autoComplete` + `textContentType` (`email`, `current-password`, `new-password`, `name`), `autoCorrect={false}`, and `returnKeyType` + `onSubmitEditing` so the keyboard advances field-to-field and submits on the last one. `signup.tsx`'s `Field` helper now forwards arbitrary `TextInputProps` instead of threading each one.
- [x] Server-side `minimum_password_length` raised 6 → 8 in `supabase/config.toml` to match the client. **Needs a coordinated Supabase restart to take effect.**
- [x] `isMissingVerifierError` matched any message containing `'invalid request'` — a generic GoTrue 400 prefix, so unrelated failures got the misleading "open this on the device where you requested it" advice. Narrowed to the verifier/challenge wording plus the `bad_code_verifier` code.
- [x] Native-dev OAuth redirect disagreed with the callback allow-list: `getAuthRedirectUrl` returned a bare `exp://host:8081` while `isAuthCallbackUrl` only accepts `exp://` URLs pathed at `auth-callback`. Now passes `{ path: 'auth-callback' }`, matching `getAuthEmailRedirectUrl`.
- [x] Raw Supabase error strings shown to users. Added `utils/authErrors.ts` (`authErrorMessage`) mapping the common GoTrue failures to actionable copy; unrecognised *Supabase* errors fall back to a generic message so server internals can't surface, while our own thrown `Error` copy is preserved. Adopted in all four auth screens.
- [x] Unconfirmed signup left `user` set with a null session, firing a profile fetch and push-token registration for an identity RLS rejects. `AuthContext.signUp` now only commits to state when a session came back.
- [x] Email/Google buttons not cross-disabled during in-flight auth (was open under P3) — both screens now disable each path while the other is running, with `accessibilityState` and a dimmed style.
- [ ] **`secure_password_change` deliberately NOT enabled.** GoTrue implements it as an email-OTP nonce flow: the client must call `supabase.auth.reauthenticate()` and pass the resulting `nonce` to `updateUser` (confirmed in `@supabase/auth-js` `UserAttributes.nonce` / `GoTrueClient.reauthenticate`). Turning it on without building that flow would make every password change fail. The client-side current-password check above is the protection shipping now; this remains the server-side half. **[config restart + client work]**
- [ ] `verifyCurrentPassword` issues a second `signInWithPassword`, creating an extra session row (the old refresh token stays valid until it expires). Harmless but untidy; the nonce flow above would replace it.

## Pass 3 / Stage 1 + 2 — Leaflet brought to parity (done 2026-10-31)

Decision: **Leaflet stays the default, Google stays optional.** OpenFreeMap was
evaluated and rejected — it serves *vector* tiles, so adopting it would mean
replacing Leaflet with MapLibre GL, which is the overhaul this pass was scoped
to avoid. The Leaflet raster architecture is unchanged; what changed is what it
draws and where the tiles come from.

- [x] **Tile source is now configurable** (`constants/mapTiles.ts`): `EXPO_PUBLIC_MAP_TILE_URL` / `_ATTRIBUTION` / `_MAX_ZOOM`, defaulting to the current OSM tiles so the README's key-free local setup still works. Non-http(s) values are rejected and fall back. Documented in `.env.example` and README. **This does not by itself make the app compliant** — see the open item below.
- [x] Clustering: `Leaflet.markercluster` 1.5.3 vendored through `scripts/vendor-map.mjs` (no CDN, works offline; +8.8 KB gz). Bulk `addLayers`, `disableClusteringAtZoom: 17` with spiderfying so co-located pins stay individually tappable. Cluster bubbles restyled to match the pin language instead of the default green/yellow blobs.
- [x] Category colours and icons on Leaflet pins. Glyph path data moved out of the Google HTML into `constants/categoryMarkers.ts`, which now emits both a TS builder and the in-page JS both renderers inject — one definition instead of one copy per provider. This is what `MAP_HTML_VERSION` existed to paper over.
- [x] **Business pins were always grey.** Found by a drift-guard test: `CATEGORY_ICON_CONFIG` is keyed by event slug *and* by business label ('Restaurant', 'Bar & Nightlife', …), and `BusinessDetail` passes the business label through as a marker `categorySlug`. The palette only knew event slugs, so every business map rendered the default pin — on the Google path too. Fixed via aliases; a test now asserts map colour matches the in-app `CategoryIcon` colour for every category.
- [x] Pin tap targets raised 22px (Leaflet) / 32px (Google) → 44pt. The visible disc keeps its original ~30px; the extra space is transparent padding, so the map is no heavier-looking.
- [x] Stage 2: vendor scripts/styles escaped and concatenated once at module load rather than per map mount (~200 KB of constant work per embedded map).
- [x] Stage 2: `EventDetail` and `BusinessDetail` maps wrapped in `components/DeferredMount.tsx` — they sit below the fold and were building a WebView during the navigation transition. Not applied to Discover or the pickers, where the map is the primary content.
- [x] Stage 2: WebView `cacheEnabled` turned on. The page is inline HTML and can't go stale, so this only affects subresources — i.e. map tiles, which were being re-downloaded on every mount.

## Thorough test pass — maps + auth (2026-10-31)

Stress/edge-case round over the two reviewed systems. **201 tests, 14 files.**
Four real bugs surfaced and were fixed; everything else held.

### Bugs found by testing and fixed

- [x] **`Infinity` coordinates blanked the Leaflet map.** `validMarkers` filtered with `!Number.isNaN`, which lets `Infinity` through; the Leaflet page then threw inside `L.marker` *after* `clearMarkers()` had already run, so one bad row left the map with no pins at all and the error was swallowed by the injection's try/catch. Fixed at both layers: `Number.isFinite` in `GoogleMapView.validMarkers`, plus a per-marker coordinate guard in the Leaflet page mirroring the one the Google page already had.
- [x] **`animateTo(null, …)` panned to 0,0.** `Number(null)` is `0`, so a null latitude silently recentred the map on the Gulf of Guinea instead of being ignored. `buildAnimateToInjection` now rejects null/undefined/boolean/empty-string while still accepting a genuine `0`.
- [x] **GoTrue machine codes were unmatched by the error mapper.** Codes arrive underscored (`weak_password`, `invalid_credentials`, `same_password`, `signup_disabled`) while the patterns were written against prose. The haystack is now matched in both forms, and the missing code variants were added.
- [x] **`DeferredMount` changed the layout tree between states** (wrapping `View` → bare fragment). Now always renders the same wrapper. Collapsed the resulting double-wrap in `EventDetail`.

### New coverage

- `tests/webviewInject.test.ts` — marker data crosses the bridge as *source code*; a malformed string literal is a syntax error that silently stops all marker updates. Extracted the builders to `utils/webviewInject.ts` and round-trip them through `new Function` with quotes, backslashes, newlines, emoji, RTL overrides, null bytes, `</script>`, template syntax and breakout attempts. Also escapes U+2028/U+2029, which `JSON.stringify` leaves raw but which terminate a JS string literal on older engines.
- `tests/googleMapHtml.dom.test.ts` — **the Google provider had zero DOM coverage.** Extracted its page builder to `utils/googleMapHtml.ts` (mirroring `openMapHtml.ts`) and boot it in jsdom against a stubbed `google.maps`, covering marker creation, icon generation, clustering, the clusterer-missing and clusterer-throws fallbacks, and the full message contract.
- `tests/providerParity.dom.test.ts` — pins both providers against the same contract: identical injected API, identical message types, and byte-identical marker SVGs for every category and state. Leaflet is the default and Google is opt-in, so they drift silently otherwise.
- `tests/openMapHtml.stress.dom.test.ts` — malformed/missing fields, duplicate ids, poles and the date line, out-of-range longitudes, 60 rapid update cycles, 10k-character titles, attribution presence.
- `tests/authCallback.stress.test.ts` — adversarial input against the deep-link allow-list (host look-alikes, `user@host` credentials tricks, scheme confusion, path suffixes, payload-laundering via query/fragment, malformed and non-string input). All held; no changes needed.
- `tests/authErrors.stress.test.ts` — asserts unrecognised Supabase errors never reach users verbatim (SQL, goroutine traces, HTML error pages, request ids).

### Still requires manual device testing

Nothing below can be exercised in this environment.

- [ ] **All visual output.** jsdom confirms a pin is a 44px `<svg>` with the right fill; it cannot say whether the map *looks* right — cluster bubble legibility at real density, pin contrast over tiles, chip row over the map, the new suggestion-row layout.
- [ ] **Real touch targets.** 44pt is asserted in style values and SVG dimensions, not measured against a finger on a device.
- [ ] **Gesture behaviour.** The `mapGesturesEnabled={false}` scroll-trap fix on the event page, pinch/pan on Discover, and cluster spiderfying at max zoom are all untestable without touch input.
- [ ] **`DeferredMount` timing.** `InteractionManager.runAfterInteractions` has no meaningful behaviour outside a running RN runtime; whether the map appears promptly enough when scrolling to the venue section is a device question.
- [ ] **Autofill and keyboard flow.** `autoComplete`/`textContentType` only do anything with a real password manager; the `returnKeyType` field-to-field chain needs a real keyboard.
- [ ] **The whole auth round-trip.** Sign-in, PKCE deep links, password reset email, and the new current-password re-verification all need a live backend. Only the pure helpers around them are covered.
- [ ] **Google provider end-to-end.** Covered against a *stubbed* SDK. Real tile rendering, real clustering and real billing behaviour are unverified — and the provider is off by default.

### Flagged, not fixed (needs more than a patch)

- [ ] **No React component testing.** `DeferredMount`, `AuthContext`'s state machine (the `loadSeqRef` guard, `profileLoadedFor` derivation, sign-out clearing) and `GoogleMapView`'s effect wiring are all untested — the bugs those could hide are exactly the kind that reach production. Needs a RN test renderer and a jest/RN preset, which is a setup project rather than a patch.
- [ ] **`GoogleMapView`'s web path** posts to `window.parent` with `'*'` and filters inbound by `event.source`. Reasonable, but untestable without a component renderer and worth revisiting alongside the item above.

## Minor polish sweep (done 2026-10-31)

Surface pass over the remaining small findings from the maps/auth review.

- [x] Discover category chips were ~21pt tall with 9pt text (`discover.tsx`) — now ~30pt with `Typography.sizes.xs`, plus `CHIP_HIT_SLOP` to clear 44pt without making the over-map row visually heavier. Added `accessibilityRole`/`accessibilityLabel`/`accessibilityState` to the chips, which had none.
- [x] `hitSlop` + roles/labels on the remaining bare text links: discover "See all", `AddressMapPicker` "Open in Google Maps", `AddressSearchInput` clear button.
- [x] `AddressSearchInput`: added a monotonic request guard (a slow response for "san" could land after and overwrite "san francisco"), an inline loading spinner, unmount-safe blur/debounce timers, a leading pin icon, and 48pt suggestion rows (were ~35pt).
- [x] Antimeridian: `isInBounds` excluded everything when a viewport straddles ±180° (sw.lng > ne.lng), emptying the list near the date line. Fixed and tested.
- [x] Extracted `haversineKm` / `radiusKmFromBounds` / `isInBounds` out of `discover.tsx` into `utils/geoBounds.ts` so the radius math that drives every search query is testable. 11 tests.
- [x] Leaflet posted two identical `regionChange` messages per zoom (`moveend` *and* `zoomend` both fire). Now `moveend` only — verified by a DOM test counting messages, not by assumption.
- [x] Cluster bubbles had no accessible name; now carry `role="button"` and an `aria-label` with the child count.
- [x] Dead imports removed from `welcome.tsx`; unescaped apostrophe fixed in `Followers.tsx`.
- [x] **ESLint was effectively unusable repo-wide**: `eslint .` reported 24,837 problems, 24,729 of them from `admin/.next` build output. Root config now ignores `admin/**` (it is a separate Next.js app with its own `eslint.config.mjs`, `tsconfig` and lint script — linting it from the root resolved its `@/` alias against the repo root and produced only false positives), plus build output and the vendored Leaflet bundle. Added a Node globals override for `scripts/**` (Buffer/__dirname were flagged as undefined under the Expo browser preset). **Repo now lints clean: 0 errors.**

### Deliberately not done in this pass

- [ ] Feeding `visibleEvents` rather than `events` to the Discover map (was a Pass 4 item). With clustering now in place this would be a *regression*: bounds-filtering before injection means every small pan changes the marker set and rebuilds the cluster group, while Leaflet already culls off-screen markers itself. Dropped unless marker counts grow enough to change the trade.
- [ ] Relabelling Settings' "Change password" row for OAuth-only accounts. The row's description already reads "Set a new password for your account", which is accurate either way; making the *title* adaptive needs an async `hasPasswordIdentity()` call on Settings render for negligible gain.

### Open after this pass

- [ ] **Compliance still requires a real tile provider.** The default is still `tile.openstreetmap.org`. The config hook and docs exist; someone has to pick a provider and set the env vars before any public build. **Blocker for shipping, not a polish item.**
- [ ] Selecting a pin that is inside a collapsed cluster shows no visible active state. `clusterGroup.zoomToShowLayer` would surface it, but `discover.tsx` already drives the camera on list scroll (`animateTo` + the programmatic-move guard) and a second source of viewport movement would fight it. Needs the two to be reconciled deliberately.
- [~] Cluster bubbles are not colour-coded by dominant category (still open); accessible label added (`accessibilityLabel`/`aria-label`) for the child count.
- [ ] `markerStateKey` still changes whenever any marker moves, so a single new event in a 300-marker set rebuilds the whole cluster group. Fine at current page sizes (50/page); revisit if marker counts grow.
- [ ] `tests/openMapHtml.dom.test.ts` boots the real map in jsdom. Tiles are never fetched (jsdom doesn't load images by default), but if `resources: 'usable'` is ever enabled the suite would start hitting the OSM tile server.

## Pass 3 (original scoping) — the default map provider is worse than the optional one

`.env.example` ships `EXPO_PUBLIC_MAP_PROVIDER=openstreetmap`, so Leaflet is the
default and Google is opt-in — but `utils/openMapHtml.ts` is far thinner than the
Google branch. Product call: bring Leaflet to parity, or make Google the default
(which reintroduces the API-key requirement the README deliberately avoids).

- [x] No clustering on the Leaflet path — every marker is added directly to the map (`utils/openMapHtml.ts:14`) while the Google path uses `@googlemaps/markerclusterer` (`GoogleMapView.tsx:177`). Discover appends 50 events per page, so pan/zoom degrades after a few pages. Needs `Leaflet.markercluster`.
- [x] No category colors or icons on the Leaflet path: every pin is hardcoded `#b41924` (`openMapHtml.ts:5`), discarding `categorySlug`. The 10-category icon set only ships to users with their own Google key.
- [x] Marker tap targets below minimum: 22×22px on Leaflet (`openMapHtml.ts:12`), 32×32 on Google (`GoogleMapView.tsx:132`) — against 44pt/48dp.
- [x] Category icon SVG paths are hand-duplicated in the map HTML (`GoogleMapView.tsx:100-131`) against the Lucide components in `constants/categoryIcons.ts`. Two sources of truth that have already drifted — that's what `MAP_HTML_VERSION` exists for. Extract to a shared constant.

## Pass 4 — performance and polish

- [~] 166 KB of Leaflet (`utils/leaflet.generated.ts`) is string-concatenated into the HTML on every map mount with `cacheEnabled={false}` (`GoogleMapView.tsx:413`) — rebuilt in JS, sent across the bridge, re-parsed, never cached. The HTML only varies on ~4 booleans: cache it at module level, and/or write it to a file and load via `source={{uri}}`.
- [~] `cacheEnabled={false}` also re-downloads the Google Maps SDK and the clusterer on every mount.
- [ ] Marker clusterer loads from `unpkg.com` at runtime with no SRI and no vendoring (`GoogleMapView.tsx:233`) — third-party network dependency on the critical path. `scripts/vendor-map.mjs` already establishes the vendoring pattern used for Leaflet.
- [ ] Places Autocomplete has no `sessiontoken` (`services/places.ts:42`) — Google bills per-request without one and per-session with one (~10x on a typical 8-keystroke search). Also missing `locationbias`/`components`, so results rank globally rather than near the user.
- [ ] Non-`business` address path round-trips autocomplete `description` through the **Geocoding** API (`components/AddressSearchInput.tsx:122`) instead of using `place_id` with Place Details — a second billed call, and using predictions outside a Places request is against the Places ToS.
- [~] Discover feeds the map every event ever loaded (`discover.tsx:517` uses `events`) while the list uses the bounds-filtered `visibleEvents` (`discover.tsx:441`) — off-screen markers accumulate across pages. Compounded by the missing Leaflet clustering above.
- [x] Map category chips are ~21pt tall: `paddingVertical: 4` + `fontSize: 9` (`discover.tsx:1035-1055`), against a 44pt minimum, and 9pt is below the legibility floor. These are the primary filter affordance over the map.
- [x] Text-link touchables with no `hitSlop`: `discover.tsx:608` "See all", `AddressMapPicker.tsx:204` "Open in Google Maps", `login.tsx:141` "Forgot Password?"; `AddressSearchInput.tsx:300` suggestion rows are ~35pt.
- [x] `AddressSearchInput.fetchSuggestions` has no request-sequence guard (`AddressSearchInput.tsx:76`) unlike `discover.tsx`'s `loadRequestIdRef` — a slow response for `"san"` can land after `"san francisco"` and replace the correct suggestions. Also no loading indicator, and the 300ms `onBlur` timeout (line 176) isn't cleared on unmount.

## Test harness (added 2026-10-31)

- [x] **No test framework at all** — nothing to pin regressions with. Added `vitest` (`npm test` / `npm run test:watch`, config in `vitest.config.mts`, specs in `tests/`). Scope is deliberately pure logic: no RN renderer, no Metro, no backend. `react-native` is aliased to `tests/stubs/react-native.ts` so modules needing only `Platform` stay testable. 38 tests covering the map HTML builder, the marker dedupe key, the auth-callback allow-list and the auth error mapper. Installed at v5 — v3/v4 carry two critical advisories (GHSA-82fw-gwwq-j7x9, GHSA-5gmw-xhrv-c9v3).
- [ ] Coverage is thin by design: anything importing Expo/RN native modules is untested. Growing it means extracting pure helpers (as done for `utils/authCallback.ts`, `utils/mapMarkers.ts`) rather than mocking the native surface. Candidates: `utils/recurrence.ts`, `radiusKmFromBounds`/`haversineKm`/`isInBounds` in `discover.tsx`, `services/localPlaces.ts`.
- [ ] No component or e2e coverage. `.maestro/smoke.yaml` exists but needs a running app + backend, so it can't gate a commit.

## Follow-ups found while implementing Pass 1 and 2

- [ ] **Pickers still have an inherent scroll-trap.** `AddressMapPicker`, `app/business-location.tsx` and `BusinessOnboarding` step 2 all put a gesture-enabled map inside a `ScrollView`. Unlike the event page this can't be fixed by disabling gestures — panning is the point of a picker. Needs a real affordance (tap-to-activate overlay, drag handle, or full-screen map mode). **Design call.**
- [x] **Antimeridian**: `isInBounds` (`discover.tsx:431`) doesn't handle a viewport crossing ±180° longitude — all events filter out. Edge case.
- [x] **Leaflet emits two `regionChange` messages per zoom** (`moveend` + `zoomend` both fire, `openMapHtml.ts:17`). Debounced downstream, so waste rather than breakage.
- [ ] **Possibly-stale entry above**: the Discovery item "Mount-time race / no request cancellation can show wrong-city results" is listed open, but `loadEventsWithCenter` now has a `loadRequestIdRef` guard (`discover.tsx:256`). Re-verify before working it.
- [ ] `app/index.tsx` never routes on `isBanned` although `AuthContext` computes it and `.github/copilot-instructions.md:74` says to redirect banned users in `_layout.tsx` — only `create.tsx:192` and `EventDetail.tsx:295` consult it, so banned users browse normally and are blocked at the point of action. May be intended; flagged as a divergence from documented intent.
- [ ] `admin/middleware.ts:54` runs a `profiles.is_admin` query on every matched request. Fine at current scale.
- [~] Settings' "Change password" row is shown to OAuth-only accounts too, where it really means "set a password". The screen now handles this correctly, but the row's label still says "Change" — reword based on `hasPasswordIdentity()`.
- [ ] `authErrorMessage` patterns are matched against English GoTrue strings. If the app is ever localised, or GoTrue rewords an error, the mapping silently degrades to the generic fallback — matching on `error.code` where one exists is more durable, but GoTrue does not populate it for every failure.
- [ ] `npm audit` reports 70 pre-existing vulnerabilities in the Expo/Metro dependency tree (unrelated to the vitest addition, which is clean at v5). Worth a separate triage pass.

# Events flow review — Tier 0 pass (2026-11-02)

Context: all `20261030*` migrations are applied on the shared local DB, so the
pre-apply fallbacks were dead code and have been removed from the events path.
Work is done against the live schema; SQL changes are validated on an isolated
scratch database only (`SCRATCH_DB=eventmap_scratch_<worktree> scripts/db-scratch.sh`).

## Done in this pass (client)

- [x] Cancelled state rendered: EventDetail banner + "Event cancelled" CTA, calendar/chat/RSVP controls hidden, owner loses Edit/Cancel; MyEvents hides Edit on cancelled rows; EditEvent refuses to open a cancelled event; chat shows a cancelled notice; SavedEvents badges `status === 'cancelled'` (once the RPC exposes it, see below).
- [x] RSVP errors mapped to specific copy (`utils/rsvpErrors.ts`: full / closed / suspended / not found) and the screen re-fetches the event on state-changing failures instead of keeping a stale Join button.
- [x] Double-submit on Create closed: `loading` is set before the limit check; limit-reached now offers an Upgrade action.
- [x] Web: date/time fields use a `datetime-local` input (`components/WebDateTimeInput.web.tsx`); photo upload fetches the picker URI as a Blob instead of the unavailable legacy file-system read.
- [x] Dead fallbacks removed: `getRankedEventsPage` legacy call, `cancelEvent`→hard-delete, RSVP plain upsert, `max_attendees` missing-column retries, unused `getRankedEvents`. `types/supabase.generated.ts` regenerated; `as any` RPC casts dropped in events/social services.
- [x] `Event` type carries `status` / `max_attendees`; `RankedEvent` carries optional `status`.
- [x] Tests: `tests/rsvpErrors.test.ts`, datetime-local round-trip in `tests/eventDatetime.test.ts`.

## Written, NOT applied to the shared DB — `20261102100000_event_lifecycle_followups.sql`

Validated on scratch (applies cleanly; behaviour checked). Apply when the DB can be coordinated.

- [ ] **[DB]** `send_event_reminders` skips cancelled events (was sending "starting soon" for them) and prefers the event address over the business address.
- [ ] **[DB]** `notify_rsvp_users_on_event_update` ignores cancelled events and clears `event_reminder_sent` when `start_datetime` changes (rescheduled events now get a fresh reminder).
- [ ] **[DB]** `get_ranked_events` ORDER BY gains a trailing `e.id` tiebreaker (offset pages were unstable).
- [ ] **[DB]** `get_user_going_events` / `get_user_attendance_counts` exclude cancelled events; `get_user_going_events` and `get_user_saved_events` return `status`; cancelled saves sort with past saves. Client already badges `status` when present.

## Deferred after Tier 0 (superseded by the Tier 1 section below)

- [ ] Events INSERT policy still allows bypassing `create_event_with_limit_check` (monthly limit + premium-recurring gate); capacity not enforced at the `rsvps` table; banned hosts can create events.
- [ ] Chat INSERT policy requires a going RSVP even for the host; `event_chat_settings` not in the realtime publication; `notify_attendees_on_chat_message` ignores `user_blocks`.
- [ ] RSVP realtime cannot see other users' rows under the self-scoped rsvps SELECT policy — replace with a broadcast trigger or drop the subscription.
- [ ] Discovery ranking (premium-first, then distance), date filters hidden in the overlay, recurring events show first-occurrence dates, no recurrence end date in the form, My Events / venue page ordering.

# Events flow review — Tier 1 pass (2026-11-02)

Same rules as Tier 0: no writes to the shared local DB; SQL is prepared as
migration files and validated on the scratch copy only. Client changes work
against the current (20261030*) schema and need no migration.

## Done in this pass (client)

- [x] Create: monthly quota pill in the header, inline "limit reached" banner with Upgrade, Publish disabled at the limit; quota refreshed after publishing.
- [x] Create: lands on the new event page (owner view) instead of Discover with ignored params; a venue picked from the map is no longer overwritten when the business object refreshes.
- [x] Recurrence end date: "Repeats until" row (`components/RecurrenceEndRow.tsx`) on both forms, stored as `recurrence_pattern.endDate` (`YYYY-MM-DD`, local), honoured by the existing server `event_has_ended`; cadence changes keep the end date. Lapsed-premium hosts can open the picker to turn a series off (`noneOnly`).
- [x] Edit: sends only changed columns (stops spurious "event updated" blasts), confirms before time/location changes when people are going, warns when lowering capacity below current attendance, and the unsaved-changes guard now covers hardware back and swipe (`usePreventRemove`).
- [x] My Events: Upcoming / Past tabs (cancelled under Past), LIVE / Repeats / Past badges from `utils/eventStatus`, recurring rows show the next occurrence, silent refresh on focus instead of a full skeleton. `eventsService.getBusinessEvents` gained a `scope`.
- [x] Profile "Events Created" preview and the venue page list upcoming events only (next occurrence for series). Venue stat relabelled "Upcoming".
- [x] EventDetail: dead rsvps realtime subscription removed (it could only ever see the viewer's own rows); 20s poll remains, with the swap-in snippet for `event_rsvp_counts` documented inline.
- [x] Chat: lock copy no longer claims the host can post (today's policy needs a going RSVP); a send refused by RLS removes the optimistic bubble, restores the draft and says why (locked / removed) instead of a dead "tap to retry".
- [x] Tests: recurrence end-date helpers (`tests/recurrence.test.ts`).

## Written, NOT applied — validated on scratch 2026-11-02

Apply in order after `20261102100000`. All are idempotent re-creations; no data migration beyond the counts backfill.

- [ ] **[DB]** `20261102100000_event_lifecycle_followups.sql` (from Tier 0) now also excludes banned hosts' events from `get_ranked_events`.
- [ ] **[DB]** `20261102110000_events_write_hardening.sql`: drops the direct events INSERT policy (creation only via `create_event_with_limit_check`, which now checks bans, validates title/coords/dates/recurrence and locks the business row); `status` can only change through `cancel_event` (trigger, admins exempt) and cancelled events are read-only; `cancel_event` also notifies savers and clears pending reminders; capacity enforced by a BEFORE INSERT/UPDATE trigger on `rsvps` (`EVENT_FULL`); public events SELECT policy is recurrence-aware so visitors see ongoing series.
- [ ] **[DB]** `20261102120000_chat_host_posting_and_blocks.sql`: hosts can post in their own chat without an RSVP (INSERT policy + `get_event_chat_post_status.can_post`); `event_chat_settings` added to the realtime publication (client already subscribes); `notify_attendees_on_chat_message` and `get_event_chat_unread_counts` honour `user_blocks`.
- [ ] **[DB]** `20261102130000_event_rsvp_counts_realtime.sql`: public `event_rsvp_counts` aggregate table kept by trigger, backfilled, published; `rsvps` removed from the publication. Client follow-up (subscribe in EventDetail) is a ~10-line change described in the file header.

## Post-apply client follow-ups (small)

- [ ] EventDetail: subscribe to `event_rsvp_counts` (see migration header); chat lock copy can say "Only you can post" again once 20261102120000 is live.
- [ ] Regenerate `types/supabase.generated.ts` after applying (new table/function signatures).

## Superseded by the Tier 2 section below

- [ ] Discovery ranking (premium-first then distance), date filters hidden behind the overlay's location step, `get_ranked_events` performance (no bounding box, full-table aggregates) and `next_start_datetime` for recurring rows.
- [ ] Event links UI, capacity/spots-left on Discover cards, waitlist, Follow on the organizer row, chat row before RSVP, recurring-aware calendar export, web share fallback.
- [ ] Chat: sender → profile, block/report from message sheet, Settings blocked-users list, host remove-attendee, moderation/report-outcome notifications; push tap marks read; notification list pagination.
- [ ] Structure/perf: split the four 1–2k-line screens, memoised list rows, React Query for list screens, one shared event card + date formatter, image resize before upload.

# Events flow review — Tier 2 pass (2026-11-02)

Same rules: no writes to the shared local DB; SQL prepared as migration files
and validated on the scratch copy only. Client changes work against the
current schema and need no migration.

## Done in this pass (client)

- [x] **Event links are authorable.** New `components/EventLinksEditor.tsx` (+ pure `utils/eventLinks.ts`) on both create and edit; `eventsService.syncEventLinks` diffs rows so unchanged links keep their id. The `event_links` table, service and the detail screen's Links section already existed — only the UI was missing.
- [x] **Date filters are discoverable.** Shared presets (`utils/datePresets.ts`: Any time / Today / Tomorrow / This weekend / Next 7 / Next 30) now drive a "When" section at the top of the Filters sheet, a TODAY toggle in the header chip row, and the search overlay — previously dates were reachable only after picking a destination in the overlay.
- [x] **Calendar export is recurrence-aware.** Exports use the occurrence the header shows (a weekly series no longer exports its original past date) and carry an `RRULE` so Google Calendar and .ics import a series. Added `buildRecurrenceRule`; pure helpers split into `utils/eventIcs.ts` so they are testable.
- [x] **Share works on desktop web.** `shareEventLink` falls back to copying the link when `navigator.share` is missing or rejects, with a confirmation toast.
- [x] **Reporting is one cross-platform sheet** (`components/ReportReasonSheet.tsx`): five reasons plus optional free text, replacing the native 4-option Alert / web two-dialog chain where "Other" was unreachable and Cancel meant "next question". A duplicate report now reads as "already reported".
- [x] **Follow from the event page** — a Follow/Following chip on the organizer row, using the `user_following_business` the RPC already returned.
- [x] **Chat is visible before RSVP** with a "Join the event to unlock" state, instead of being hidden until you were already going.
- [x] **Chat: reach the person.** Tap an avatar to open a profile; the message sheet gained View profile / Block / Unblock / Report user. Blocked senders are tracked client-side and the list reloads after a block.
- [x] **Blocked users list** — `screens/BlockedUsers.tsx` at `/blocked-users`, linked from Settings → Privacy, with unblock. Unblocking no longer requires finding the person's profile again.
- [x] **Notifications**: tapping a push marks that notification read (the payload has carried `notificationId` since 20260228110000); the centre pages 30 at a time with a Load older button and uses the server-side unread count, so the chip no longer disagrees with the tab badge.
- [x] Tests: `tests/datePresets.test.ts`, `tests/eventShare.test.ts` (RRULE + ICS), `tests/eventLinks.test.ts`. 322 total.

## Written, NOT applied — validated on scratch 2026-11-02

Apply after the Tier 0/1 files, in timestamp order.

- [ ] **[DB]** `20261102140000_discovery_ranking_and_fields.sql`: replaces the premium-first/distance ordering with a weighted score (proximity + imminence + log-damped popularity, premium as a bounded +0.25 boost); ranks and date-filters recurring events on their **next occurrence**; returns `next_start_datetime`, `max_attendees`, `has_ended` so cards can show spots-left; adds a bounding-box pre-filter and correlated counts (the old body haversined every row three times and aggregated all of `rsvps`/`saves` per call); clamps `result_limit`. Verified: near+soon outranks far+later, a 60-day-old weekly series is matched by a next-30-days filter, and 3 paged calls return 25 distinct ids.
- [ ] **[DB]** `20261102150000_moderation_feedback_and_attendees.sql`: report dedupe index across **all** target types (was chat_message only) with a pre-dedupe cleanup; reporters notified when an admin resolves/dismisses; users told when a message of theirs is removed or their chat access is cut; new `host_remove_attendee()` (drops the RSVP, blocks the chat, clears reminders, notifies); host RSVP notifications no longer fire on every going↔interested flap and a new DELETE trigger reports leaves. Verified on scratch, including that the message-delete RPC keeps its evidence-stashing behaviour.

## Post-apply client follow-ups (small)

- [ ] Discover cards: render `max_attendees` / spots-left and use `next_start_datetime` instead of recomputing occurrences client-side.
- [ ] Add a host "Remove attendee" action to the attendees sheet calling `host_remove_attendee`.
- [ ] Notification centre: icons/copy for the new `moderation` and `report_update` types (they render with the neutral fallback today).
- [ ] Regenerate `types/supabase.generated.ts` after applying.

## Superseded by the Tier 3 section below

- [ ] Split the four 1–2k-line screens (EventDetail, discover, event-chat, Settings) into hooks + memoised components; memoise Discover list rows and the chat message row; bound the `FadeInDown` stagger.
- [ ] Move list screens onto React Query (installed, unused) for caching, focus refetch and pagination.
- [ ] One shared event card + one date formatter (six card variants, four formatters today); image resize before upload with per-photo progress.
- [ ] Waitlist when an event is full; `pg_trgm` index for keyword search; PostGIS for distance.

# Events flow review — Tier 3 pass (2026-11-02)

Same rules: no writes to the shared local DB; SQL prepared as migration files
and validated on the scratch copy only. Client changes work against the
current schema; the waitlist UI is gated on a key the RPC only returns once
its migration is applied.

## Done in this pass (client)

- [x] **Chat transcript is memoised.** `components/chat/ChatMessageRow.tsx` holds the day / divider / message rows and the linkified body (mention regex cached per message). The screen's `renderRow` is a `useCallback` passing primitives + stable callbacks, so composer keystrokes, typing ticks and the slow-mode countdown no longer re-render every bubble. The bubble's text moved from `accessibilityHint` to the label (hints are read late and truncated).
- [x] **Discover cards are memoised** (`components/DiscoverEventCard.tsx`) with stable `onPress` handlers, so map pans stop re-rendering every mounted card. The entrance stagger is capped at 6 rows (second-page cards used to sit blank for seconds). Cards now show a going count and, when it changes a decision, "N LEFT" / "FULL" from `max_attendees` (already populated by `get_event_details`; discovery gets it after 20261102140000). Empty state says what was searched/filtered.
- [x] **One date/distance formatter** (`utils/formatEventWhen.ts`): Discover, Profile, UserProfile, BusinessDetail, Joined, Saved and EventListItem all use it. Device locale throughout (four of them were hard-coded `en-US`); distance follows the region (mi for US/GB/LR/MM, otherwise km/m) instead of always miles. UserProfile shows a series' next occurrence.
- [x] **List screens on React Query.** `JoinedEvents` and `SavedEvents` use `useInfiniteQuery` (per-tab keys in `hooks/queryKeys.ts`), `useRefetchOnFocus` for stale-while-revalidate on return, and `focusManager` is fed `AppState` in the root layout. Saved is paged (was a single page of 50 with no way to older saves). EventDetail invalidates these caches after RSVP / leave / save, closing the "stale list after RSVP" gap.
- [x] **Image pipeline.** Photos are resized to a 1600px longest edge before upload (a 12 MP photo was previously base64-encoded at full size); both forms show "Uploading photo N of M…" on the submit button.
- [x] **Waitlist UI** on EventDetail: when an event is full and the RPC advertises `waitlist`, the primary button becomes "Join waitlist" / "On waitlist · #n · tap to leave", with a hint showing how many are waiting. Hidden until the migration is applied.
- [x] Tests: `tests/formatEventWhen.test.ts`. 334 total.

## Written, NOT applied — validated on scratch 2026-11-02

- [ ] **[DB]** `20261102160000_waitlist_and_search_index.sql`: `event_waitlist` table (RLS: own rows; writes via RPC only), `join_event_waitlist` (returns position; refuses when there's no cap, a spot is free, or the caller is already going) and `leave_event_waitlist`; a trigger on `rsvps` notifies the earliest waiters (one per freed seat, at most once a day) and drops anyone who joins; cancelling clears and notifies the waitlist without duplicating the RSVP/saves notice; `get_event_details` gains an additive `waitlist` key; `pg_trgm` GIN indexes on event title/description and business name for the ILIKE search. Verified: full lifecycle on a 1-seat event, idempotent join, guards, cancel cleanup, counts table consistency.

## Post-apply client follow-ups

- [ ] Notification centre: icon/copy for the `waitlist` type (neutral fallback today) and deep link straight to the event.
- [ ] Discover: once 20261102140000 is live, use `next_start_datetime` from the RPC instead of `getNextOccurrences` per card.

## UX / UI issues noticed during Tier 3 (status updated in the UX pass below)

Ordered by how much they'd change what a user does.

- [ ] **Saved: confirm dialog on unsave.** Removing a bookmark is trivially reversible; the confirm adds friction. An undo toast is the better pattern — `utils/notify.ts` has no action-button toast yet, so this needs a small toast extension first.
- [ ] **Venue page "Upcoming" stat counts only the first 10 fetched rows** (`screens/BusinessDetail.tsx`); needs a count query or a dedicated RPC. Same page has no "Create event" CTA for the owner when the list is empty.
- [ ] **Module-level `Dimensions.get('window')`** in `EventCardCarousel`, `EventDetail`, `UserProfile` and Discover (`EVENT_CARD_WIDTH`): card widths and the hero pager never update on rotation, split-screen or browser resize. Replace with `useWindowDimensions` and pass widths down.
- [ ] **Discover floating card unmounts the bottom sheet** (`{!(activeEvent && showFloatingCard) && <BottomSheet …>}`): tapping a pin then closing the preview remounts the list at index 0 with scroll position and animations reset. Needs the sheet to stay mounted and snap instead.
- [ ] **Discover refetches twice per overlay search** (`setSearchQuery` triggers the effect and `handleSearchFromOverlay` also calls `loadEventsWithCenter`), and date chips in the overlay write to context immediately, refetching behind the modal. Stage overlay selections locally and commit on Search.
- [ ] **Report flow has no "my reports" view**; reporters only get the outcome notification (after 20261102150000). Low priority.
- [ ] **Edit event: no photo reorder / "set as cover"**; changing the cover means remove + re-upload.
- [ ] **Create form scrolls to the top on any validation error**, even when the only error is Capacity or Links at the bottom. Needs per-field `onLayout` + `scrollTo`.
- [ ] **Timezone is implicit** (device TZ, no label) on both forms and the detail page; a host travelling sets the wrong instant with no hint. Show the TZ abbreviation; longer term store an IANA zone per event.
- [ ] **Hosts can RSVP to their own event** (no server or client guard); a host's "going" consumes a seat and counts toward the 2-person chat unlock. Decide whether that's intended now that hosts can post in chat without an RSVP (20261102120000).
- [ ] **Interested doesn't reserve a seat but nothing says so**; a one-line hint under the star on capped events would prevent surprise.
- [ ] **Push notifications for the new types** (`moderation`, `report_update`, `waitlist`) share the generic channel; consider separate Android channels so users can mute chat without muting moderation notices.
- [ ] **`screens/Settings.tsx` (≈2,000 lines) and `app/(onboarding)/index.tsx` (≈2,100)** are outside the events flow but are the two largest files left; same hook-extraction treatment applies.
- [ ] **Design tokens**: `DiscoverEventCard` inherits literal sizes (`fontSize: 22`, `borderRadius: 32`, `fontSize: 12`) from the original card; snap to `Typography.sizes` / `BorderRadius` in the next UI pass along with the remaining ≈120 literals the tracker already lists.

## Remaining structural debt

- [ ] `screens/EventDetail.tsx` (≈2,250 lines) still owns data loading, RSVP/waitlist/save/follow handlers, reviews, share/calendar and ~900 lines of styles. Next split: `useEventDetails(id)`, `useEventReviews(businessId)`, `RsvpActionBar`, `ReviewsSection`, `EventHero`. `app/(tabs)/discover.tsx` (≈1,700) likewise: `useDiscoverEvents` (center/radius/pagination/filters) and `DiscoverFiltersSheet`.
- [ ] `MyEvents`, `BusinessDetail` and Profile still hand-roll fetch state; move onto React Query with the same pattern as Joined/Saved.
- [ ] PostGIS (`geography` column + GiST) for discovery distance; the bounding-box prefilter in 20261102140000 is the stop-gap. Needs a decision on enabling the extension in hosted Supabase.

# Events flow review — UX/UI fix pass (2026-11-02)

Works through the Tier 3 UX list in user-impact order. All client-side; no
database writes, no migrations applied. Typecheck, lint (12 pre-existing
warnings, none added) and 336 unit tests pass.

## Fixed

- [x] **Map preview no longer resets the list.** The Discover bottom sheet stays mounted and is animated closed when a pin is tapped (`bottomSheetRef.close()`), then snapped back on dismiss. Previously it was conditionally unmounted, so closing a preview rebuilt the list at the top and replayed every card's entrance animation. Closing it also sidesteps the z-order question between the sheet and the floating card.
- [x] **One fetch per search instead of up to three.** Discover compares a filter signature before refetching, so the programmatic search path and the filter effect are mutually exclusive, and the signature is seeded at mount so the first render no longer fires a throwaway request against the default San Francisco centre. The search overlay now stages its date selection locally and commits it on Search — tapping a date chip used to write straight to context and refetch behind the open modal.
- [x] **Layouts follow the window.** `useWindowDimensions` replaces module-level `Dimensions.get()` in `EventCardCarousel`, `EventDetail` (hero pager + cover width), `UserProfile` (card width) and Discover (card width, sheet snap points, FAB offset). Rotation, split-screen and browser resize now reflow instead of keeping first-import values.
- [x] **Validation scrolls to the field that failed.** The create form records each section's Y offset on layout and scrolls to the first failing section; it used to jump to the top even when the only problem was Capacity or Links at the bottom. `validate()` now returns the failing keys rather than a boolean.
- [x] **Unsave is an undo toast, not a confirm.** `notify.withAction` / `notify.undo` add an inline action to the toast system (7s lifetime for actionable toasts); Saved Events removes the blocking confirm and offers Undo, which re-saves and refetches so ordering stays server-authoritative.
- [x] **Timezone is labelled.** `timeZoneLabel()` added to `utils/formatEventWhen`; both forms note "Times are in your device timezone (PDT)" above the pickers and the detail page appends the zone to the time row. Storing an IANA zone per event is still open (needs a migration).
- [x] **Venue "Upcoming" count is real.** `getBusinessEventsCount` takes a scope and the venue page uses it, instead of reporting the length of the first page of 10.
- [x] **Capacity semantics are stated.** The create form notes that only "going" counts toward the limit, so marking interested doesn't hold a spot.
- [x] **Cover photo can be changed in place.** Non-first thumbnails get a "Cover" button that promotes them to position 0; changing the cover previously meant removing and re-uploading.
- [x] **Discover card uses design tokens** (sizes, radii, spacing) instead of the literals inherited from the original inline card.

## Still open from that list

- [ ] **Photo reorder beyond set-as-cover** (drag to arrange) — the editor is now position-aware, so this is a drag-handle away.
- [ ] **"My reports" view** for reporters; they get an outcome notification once 20261102150000 is applied, but can't browse what they filed.
- [ ] **Separate push channels** for `moderation` / `report_update` / `waitlist` so chat can be muted without losing moderation notices.
- [ ] **Hosts can RSVP to their own event** server-side. The UI already hides the RSVP bar for owners, so this is a data-integrity nicety rather than a user-facing bug; it needs a trigger and a product decision now that hosts can post in chat without an RSVP.
- [ ] **`screens/Settings.tsx` and `app/(onboarding)/index.tsx`** remain the two largest files; outside the events flow.

## New observations from this pass

- [ ] `app/(tabs)/discover.tsx` still has `searchLocation` destructured but unused, and two `Array<T>` style warnings — harmless, but the file is the obvious next candidate for the `useDiscoverEvents` extraction noted in Tier 3.
- [x] Map/list disagreement and the single-image pager — fixed below.

# Events flow review — map, carousel and photo reorder (2026-11-02)

Client-only; no migrations and no database writes. Typecheck, lint (12
pre-existing warnings, none added) and 356 unit tests pass.

## Fixed

- [x] **Map and list no longer disagree.** The list is bounds-filtered but the map is injected from the full fetched set (deliberately — bounds-filtering the markers rebuilds the cluster group on every pan, a trade the Pass 4 notes already rejected). So the list could read "nothing here" while pins sat just off-screen. Rather than dropping those markers — which would hide results the user can pan to — the empty state now counts them and offers **"Show them"**, which fits the map to those events. New pure helpers `boundsOfPoints` / `centroidOf` / `zoomForPoints` in `utils/geoBounds.ts`, unit tested.
- [x] **No pager for a single image.** `EventCardCarousel` renders a plain view when there is one image (or none, the placeholder case) instead of an `Animated.ScrollView` with a scroll handler and an animated child. Every Discover card hits this path, since cards only ever pass the cover image.
- [x] **Drag to reorder event photos.** The photo grid is now an absolutely-positioned animated grid: hold a thumbnail for ~220 ms to pick it up, drag it, and the other photos animate out of the way live; position 0 is the cover. Long-press activation means the surrounding form still scrolls normally. Index maths lives in pure, unit-tested helpers (`utils/reorder.ts`); `slotIndexAt` / `slotPosition` carry the `'worklet'` directive because the drag gesture calls them on Reanimated's UI thread.

## Implementation notes worth knowing

- The drag gesture is memoised on values that cannot change mid-drag, and the
  dragged cell is positioned from a slot captured at drag start, so the live
  reordering of its neighbours never yanks it out from under the finger.
- Reordering is also exposed as **accessibility actions** ("Move earlier" /
  "Move later") because dragging is pointer-only, and the existing "Cover"
  button still promotes any photo to first in one tap.
- Drag relies on `react-native-gesture-handler` on web, where long-press pan
  is less well exercised than on native. The Cover button and the
  accessibility actions are the fallback if it proves unreliable there —
  worth a manual check on web before release.

## Still open

- [ ] Verify the photo drag on a real device and on web (gesture timing and
      the 1.06 lift look right in code but are untestable here — the repo has
      no component renderer).
- [ ] `useDiscoverEvents` extraction for `app/(tabs)/discover.tsx`.

# Events flow — regression pass (2026-11-02)

Layers: typecheck (app + admin), lint, 358 unit tests, a web bundle export
(Metro-level breakage), three independent code reviews of the diff by area,
and an **API-level integration suite against an isolated backend**
(`scripts/regress-isolated.mjs`): a private PostgREST bound to a fresh scratch
copy with all seven prepared migrations applied, authenticated with locally
minted JWTs — so neither the shared database nor the shared auth service is
touched (no sign-ins, no sign-ups). The suite mirrors the exact table / RPC /
filter shapes the client services use. 32 checks, all passing; the migrations
also re-apply idempotently.

## Found and fixed in this pass

Regressions introduced by earlier passes (the ones that mattered most):

- [x] **Overlay search fetched with stale filters.** The filter-signature de-dupe suppressed the corrective refetch that used to mask the stale direct call, so "jazz · this weekend" showed unfiltered results. `loadEventsWithCenter` now takes explicit overrides from the overlay path.
- [x] **Photo reorder didn't persist on Edit (or Settings).** The drag grid promised reordering but only `cover_image_url` was written. Both save paths now rewrite `sort_order` for moved photos and insert new ones at their position; the cover falls back to the first photo that has a URL instead of nulling out after a failed upload.
- [x] **Waitlist "spot just opened" path was unreachable.** The `RsvpError` wrapper replaced the server's `spot_available` hint with generic copy, so the auto-join branch never ran. New `SPOT_AVAILABLE` / `ALREADY_GOING` / `WAITLIST_NOT_NEEDED` codes, with tests.
- [x] **Discover sheet could be left closed** with nothing to reopen it when the previewed event dropped out of a reloaded page; a reconciliation effect restores it, and the active event is looked up in the full set rather than the bounds-filtered one.
- [x] **Ended recurring series vanished from both My Events tabs**; the past query now matches them and the tab filters with `hasEventEnded`.
- [x] **US devices could show kilometres** where Hermes lacks `Intl.Locale`; region is parsed from the tag first.
- [x] **Pull-to-refresh spinner animated on every background refetch** in Joined/Saved; only the pull gesture drives it now, and focus refetches no longer restart an in-flight invalidation fetch.
- [x] Optimistic unsave could be overwritten by an in-flight refetch (now cancels first and invalidates after); overlay "Clear all" no longer bypasses staging; notification unread chip tracks realtime read updates; load-older button survives a transient error.
- [x] Chat lock-rejection appends the rejected text to an in-progress draft (was replacing it) and restores mention ids; user reports from chat use the chat reason set; repeat business/review reports read as "already reported".
- [x] Drag grid: cells are `accessible` on iOS with Remove / Make cover exposed as actions; preview order is synced to the ref before React flushes; a parent list swap mid-drag abandons the preview instead of clobbering it.
- [x] Recurrence end date is validated against the first occurrence on both forms; "Repeats until" commits the displayed date when opened; link validation errors clear on edit; create inserts photos at their list position.

SQL (unapplied migration files, re-validated on scratch):

- [x] `get_ranked_events` date filter tests **overlap** for recurring series (a daily event is now matched by a "this weekend" window even though its next occurrence is today); one-offs unchanged.
- [x] Status flips are refused for **everyone** including admins (the admin dashboard never writes status; the exemption was only a loophole). The demo host is an admin, which is how the suite caught it.
- [x] `notify_business_on_rsvp_delete` skips the host's own removals and never emits a NULL body during an account-deletion cascade; `DROP TRIGGER` name matches; `refresh_event_rsvp_counts` is no longer callable over RPC; `pg_trgm` installs into `extensions`.

## Reviewed and left as-is (recorded, not fixed)

- [ ] `LinkifiedText`'s inner memo is redundant because the row builds `mentionNames` per render — a missed optimisation, not a regression (rows only re-render when the transcript changes).
- [ ] Edit's "notify attendees?" confirmation gates on the going count only; interested-only events skip the prompt but still notify. Needs an interested count from the details RPC.
- [ ] Profile "Created" stat and the venue "Upcoming" count include recurring series whose own end date has passed, which the lists drop client-side. Cosmetic until the counts move server-side.
- [ ] `convertToJpeg` resizes by height when only one dimension is known (web only); still bounded.
- [ ] Discover's `[profile]` effect re-running `loadInitialData` (categories + events) on any profile identity change is pre-existing.
- [ ] Returning to Joined/Saved after an RSVP still issues two fetches (invalidation + focus); the second no longer cancels the first.

## How to re-run the isolated suite

```
SCRATCH_DB=eventmap_scratch_elm scripts/db-scratch.sh refresh
for f in supabase/migrations/20261102*.sql; do SCRATCH_DB=eventmap_scratch_elm scripts/db-scratch.sh apply "$f"; done
# private PostgREST on :3999 bound to the scratch DB (see scripts/e2e-isolated-env.sh for the docker run)
JWT_K=<oct key from PGRST_JWT_SECRET JWKS> node scripts/regress-isolated.mjs
```

# Host tools — Manage event hub, phase 1 foundations (2026-11-03)

Rules this pass: the shared local DB is owned by another dev session. Nothing
was applied or reset there; SQL was validated on a per-worktree scratch copy
(`SCRATCH_DB=eventmap_scratch_oak scripts/db-scratch.sh …`) only. Plan and
remaining scope: `docs/HOST_TOOLS_PLAN.md`.

## Observation about the shared DB

The scratch copy dumped from `postgres` on 2026-11-03 already lists every
`20261102*` file in `supabase_migrations.schema_migrations`, and
`host_remove_attendee`, `event_waitlist`, `event_rsvp_counts` exist there. So the
"Written, NOT applied" labels above for that set are stale: someone applied them.
Re-applying `20261102100000` on top fails with "cannot change return type of
existing function" — harmless for the shared DB (already applied) but worth
knowing if a scratch run replays the whole set.

## Done in this pass (client, works against the current schema)

- [x] **`/business/manage-event/[id]`** (`screens/ManageEvent.tsx`): host-only hub with Overview · Attendees · Chat tabs. Overview shows phase badge, next occurrence, capacity bar with spots left, going / interested / waitlist / saves / views, and the quick actions that used to be scattered (Edit, Notify followers, Insights, public page, Cancel). Attendees tab lists going / interested / waitlist with name search, paging and **Remove attendee** (calls `host_remove_attendee`). Chat tab exposes lock, slow mode, and opens the existing `ChatModerationSheet` and the chat screen.
- [x] Entry points: My Events rows now open the hub (the action icons are unchanged); Event Detail shows a "Manage event" button above Edit / Cancel for the owner.
- [x] Shared primitives extracted so later host settings don't re-roll styles: `components/ui/SegmentedControl.tsx`, `SettingsSection.tsx`, `SettingsRow.tsx` (nav / switch / static variants, same look as `screens/Settings.tsx`).
- [x] `services/hostTools.ts`: tries the new host RPCs first and falls back to `get_event_details` / `get_event_attendees_page` when Postgres reports them missing (42883 / PGRST202). Each result carries `source` so the UI can explain reduced data instead of failing.
- [x] Pure helpers in `utils/hostEvent.ts` (phase, capacity summary, allowed actions, count line) with `tests/hostEvent.test.ts` (13 cases; suite 371 passing).

## Written, NOT applied — validated on scratch 2026-11-03

- [ ] **[DB]** `20261103100000_host_event_tools.sql`: `get_event_host_overview(p_event_id)` (going / interested / waitlist / saves / views total + 7d / chat lock, slow mode, message, block and open-report counts) and `get_event_host_attendees_page(p_event_id, p_status, p_limit, p_offset, p_search)` (real ids + RSVP status + joined_at + chat_blocked for going / interested / waitlist; private profiles keep their name but drop avatar and bio). Both host-or-admin only; verified on scratch: host gets correct counts and rows, attendee and anon callers are refused, invalid status and unknown event raise. Until applied, the hub shows going + saves only, and anonymised rows cannot be removed.
- [ ] Regenerate `types/supabase.generated.ts` after applying and drop the `untypedRpc` cast in `services/hostTools.ts`.

## Phase 1, second pass (2026-11-03, later the same day)

Same rules: nothing applied to the shared DB; SQL validated on the scratch copy
`eventmap_scratch_oak` (re-applies idempotently on top of 20261103100000).

### Decision: what hosts see of private profiles

Investigated before deciding. In this app the two toggles promise anonymity
from *other attendees* ("Off means you count but show as Anonymous"; "Let
others view your profile"), not from the organiser, and the host already gets
the attendee's full name in the "X is going to your event" notification
(`notify_business_on_rsvp`, no privacy check). Luma, Meetup, Partiful and
Eventbrite all give hosts full identity of registrants; their privacy controls
only govern what other guests or the public see.

Decision: hosts see private-profile attendees as **first name + last initial**
("Sam K."), no avatar, no bio, not tappable, with a "Private" tag. Implemented
server-side (`host_display_name`, used by the host attendee page) and mirrored
client-side (`abbreviateName`). Toggle copy in Settings and onboarding now says
so. Follow-up: make the RSVP notification use the same abbreviated name for
private profiles so the two surfaces agree.

- [x] `20261103100000_host_event_tools.sql` updated (unapplied, so edited in place): `host_display_name(name, private)`; attendee page uses it. Verified: a private "Demo Sam" lists as "Demo S." with null avatar/bio.
- [x] Client: `abbreviateName` + tests; hub rows show the Private tag and don't open the (private) profile; Settings + onboarding copy.

### Event bans and waitlist promote

- [x] **[DB, NOT applied]** `20261103110000_event_bans_and_waitlist_promote.sql`: `event_bans` table (host/admin/subject SELECT, RPC-only writes); `host_remove_attendee` gains `p_ban boolean DEFAULT true` (3-arg overload dropped to keep PostgREST unambiguous) and also clears the waitlist row; `host_unban_attendee` lifts the ban and the removal's chat block; `join_event_with_capacity`, `join_event_waitlist` and the rsvps INSERT/UPDATE policies refuse banned users with `removed_from_event`; `get_event_host_attendees_page` accepts `p_status = 'removed'` (with the host's reason) and the overview returns `removed`; `host_promote_from_waitlist` moves a waitlisted user to going under the event row lock, raising `EVENT_FULL` / `not_on_waitlist` / `event_closed`, and notifies them ("You're in"). Verified on scratch: remove → Alex refused on RPC join, waitlist join and direct insert → allow back → Alex rejoins and chat block is gone; promote refused when full, when not listed, and for a non-host; succeeds otherwise with the waitlist row removed and the notification written.
- [x] Client: `REMOVED` RSVP error code and copy ("The host removed you…", triggers a refresh) with tests; `hostToolsService.unbanAttendee` / `promoteFromWaitlist`; `removeAttendee` tries the 4-arg shape then falls back to the 3-arg one that exists today. Hub attendee tab: a **Removed** segment appears once someone has been removed, waitlist rows get a "Move to going" action, removed rows get "Allow back"; EVENT_FULL on promote tells the host to raise capacity first.
- [ ] Regenerate `types/supabase.generated.ts` after applying both 20261103 files.

## Phase 1, third pass (2026-11-03): capacity hardening, private-name guard, row counts

Same rules. Scratch copy refreshed from the shared DB and all three 20261103 files re-applied in order; scenarios below verified there.

### Found on the shared DB with no migration file

The fresh dump contains `guard_event_capacity_shrink()` + trigger `b_guard_event_capacity_shrink` (refuses lowering `max_attendees` below current going unless `eventmap.allow_capacity_shrink = 'on'`), `host_set_event_capacity(p_event_id, p_max_attendees)` (sets that flag; granted to PUBLIC/anon too, which is harmless since it checks `auth.uid()` but worth tightening) and `get_user_past_event_count()`. None is recorded in `supabase_migrations.schema_migrations` or in any file in this tree, so the other session applied them by hand. The capacity pair is now reproduced **verbatim** in `20261103120000` so a DB built from files gets it and re-applying on the shared DB is a no-op; the client calls `host_set_event_capacity`. `get_user_past_event_count` is left alone — whoever added it should file it.

### Private-name leak audit

Checked every read of `profiles.name` in SQL and every client fetch of profile data. Findings and fixes (all in `20261103120000`, NOT applied):

- [x] **`get_profiles_display(user_ids)` returned full name + avatar for any profile to any signed-in user.** It backs chat sender names and the blocked-users list; `services/social.ts` even carried a comment claiming it respected privacy. Private profiles now come back as "First L." with `avatar_url = null` and `is_private = true`; the caller still sees their own full profile.
- [x] Host RSVP notifications ("X is going to…", "X is no longer going…") and chat pushes ("X: …", "X mentioned you in …") used the full name. All use `host_display_name` now; the chat trigger body is otherwise identical to 20261102120000.
- [x] Host attendee search matched the *full* name of private rows, so a hidden surname could be probed letter by letter. Both 20261103100000 and 20261103110000 (unapplied, edited in place) now match the abbreviated name for private rows. Verified: "Sam" finds nothing for private "Demo Sam"; "Demo S" finds them.
- [x] Already correct and left as-is: `get_public_profile` (returns only `is_private`), `get_event_attendees_public` / `get_event_attendees_page` (Anonymous + hashed id), `can_view_user_events`, profile table SELECT (owner only), chat sender display (goes through `get_profiles_display`, so fixed above), moderation log / reported messages (host + admin only, agreed).
- [ ] Not changed: a private user who *posts* in a chat is shown to other attendees as "First L." now, not full name. That is a visible UX change for them; flagging in case the product answer is "posting is opting in".

### Capacity

- [x] **[DB, NOT applied]** `create_event_with_limit_check` gains `p_max_attendees` (body otherwise identical to 20261102110000; old 12-arg signature dropped). Verified: creation with cap 25 stores 25; cap 0 is refused.
- [x] **[DB, NOT applied]** `notify_event_waitlist_free_seats()` + trigger `trigger_notify_waitlist_on_capacity_change`: raising or removing the cap pings the waitlist exactly like a leave does (bounded to 100 when the cap is removed, once per person per day). Verified: cap 1 → 3 with one waitlisted user → one `waitlist` notification and `notified_at` set.
- [x] Verified the shared guard on scratch: plain UPDATE to 1 with 2 going → `capacity_below_going`; lowering to exactly the going count is allowed; `host_set_event_capacity` lowers below with the flag; a non-host is refused.
- [x] Client: `eventsService.createEvent` passes the cap in the RPC and returns `{ id, capacityApplied }` (pre-migration it retries the 12-arg shape and does the second write itself); `create.tsx` lost its second write. `EditEvent` routes a confirmed below-attendance lowering through `hostToolsService.setCapacity` (→ `host_set_event_capacity`) and, if the going count moved under it, shows "More people are going than the new limit allows. Reload the event and confirm again."

### My Events row counts

- [x] **[DB, NOT applied]** `get_host_events_counts(p_event_ids)` → going / interested / waitlist for the caller's events only (verified: the host gets both rows, an attendee gets `[]`).
- [x] Client: rows show "12 / 40 going · Full · 2 waiting · 3 interested" via `EventListItem.metaLines`; falls back to the public `event_rsvp_counts` table (no waitlist) while the RPC is missing. Best-effort: the list renders without it.

## Phase 1, fourth pass (2026-11-03): settings tab, announcements, cleanup — Phase 1 complete

Same rules. Scratch refreshed from the shared DB; all four 20261103 files applied in order; scenarios verified there.

### Drift note

This refresh of the shared DB **no longer** had the hand-applied trigger `b_guard_event_capacity_shrink` (the apply logged "trigger does not exist, skipping"), while the `guard_event_capacity_shrink()` and `host_set_event_capacity()` functions were still present. The other session appears to be reworking it. `20261103120000` recreates the trigger from the same source, so whichever way they land, applying the file converges on the guarded state. `get_user_past_event_count()` remains unfiled.

### Done

- [x] **[DB, NOT applied]** `20261103130000_event_settings_and_announcements.sql`: `events.rsvp_closed` and `events.waitlist_mode` (`off` | `notify` | `auto`); `host_set_event_settings`; join RPCs and the rsvps INSERT policy refuse new joins while closed (`rsvps_closed`) but let existing attendees switch going ↔ interested; `join_event_waitlist` refuses when the waitlist is off (`waitlist_off`); seat-freed handling (`handle_event_seats_freed`) is mode-aware — **auto** moves the first in line to going and tells them "You're in", **notify** pings as before, **off** does nothing; reopening RSVPs runs the same handler. `host_announcements` + `send_event_announcement(p_event_id, p_body, p_audience)`: 1–500 chars, 3 per event per day, recipients = going (or going + interested) minus the host, honouring a new `host_announcement` notification preference and user blocks; the text is also posted into the chat as the host. Overview returns `announcements_today`. Verified: close → attendee refused on RPC and direct insert, existing attendee can switch, reopen admits; invalid mode refused; waitlist off refused; auto promotes on leave with notification; notify mode leaves them in line and pings; announcements: non-host refused, going-only reaches 1, "all" skips the opted-out user, empty refused, fourth refused, chat mirror written, overview count 3.
- [x] **[DB, edited in place]** `20261103120000`: `REVOKE … FROM PUBLIC, anon` on `host_set_event_capacity`.
- [x] Hub **Settings tab**: capacity stepper (−/+, free text, "No limit", Save) going through `host_set_event_capacity` with the below-attendance confirm; "Accepting RSVPs" switch; waitlist mode chips (disabled until a capacity is set). Shows a clear note while the columns are missing.
- [x] Hub **Announce** quick action: sheet with 500-char body, audience chips with live counts, "N left today", confirm, result toast; limit and unavailable errors mapped.
- [x] Event Detail: owner block is now just "Manage event" (Edit / Cancel moved to the hub; the dead cancel handler and imports removed). Attendee join bar shows **RSVPs closed** when the host closed them (existing attendees still see their state and can leave).
- [x] Notifications: `host_announcement`, `waitlist`, `moderation`, `report_update` typed with icons; Settings gains a **Host announcements** toggle; `RSVPS_CLOSED` / `WAITLIST_OFF` RSVP error codes with copy and tests.

### Deliberately not done here

- [ ] **Regenerate `types/supabase.generated.ts` and drop the `untypedRpc` casts.** This must happen *after* the four 20261103 files are applied to the DB the types are generated from; generating from the scratch copy now would make the shared types claim functions the shared DB does not have. One command once applied: `npm run backend:types`, then replace `untypedRpc(...)` in `services/hostTools.ts` / `services/events.ts` with `supabase.rpc(...)`.

## Phase 1 is complete; what remains is Phases 2–4 (see `docs/HOST_TOOLS_PLAN.md` §11).


# Phase 2 — time zones (2026-11-03)

Same rules: nothing applied to the shared DB; `20261103140000_event_timezones.sql`
validated on the per-worktree scratch copy after the four 20261103 files.
Plan reference: `docs/HOST_TOOLS_PLAN.md` §4D.

## Model decision (plan §9 Q4, resolved)

`events.timezone` is **nullable with no backfill**. A guessed zone (business
location, single default) would silently move legacy events for viewers in other
zones; NULL instead means "render in the viewer's zone, compute days in UTC",
which is exactly today's behaviour. Hosts see "Time zone: Not set" on Edit with a
one-line nudge; new events get the device zone from the form. Nothing changes for
anyone until a host touches the zone.

## Done

- [x] **`utils/timezone.ts`** (pure, 13 tests): device zone, IANA validation (named zones only; `+02:00` and abbreviations rejected), zone list with a curated fallback when `Intl.supportedValuesOf` is missing, wall-clock ↔ instant conversion that handles DST gaps/overlaps, picker helpers (`instantToPickerDate` / `pickerDateToInstant`: native pickers edit *local* components, so form dates are wall-clock values in the event zone), labels ("Lisbon (GMT+1)"), search, and `describeEventTime` — the display rule: event-zone time, plus "2:00 PM your time (Nov 7)" when the viewer's zone reads differently.
- [x] **`components/TimeZonePicker.tsx`**: searchable sheet, device zone and current value pinned, sorted by offset, accepts a full id typed in.
- [x] **Create / Edit**: a Time zone row above Start (device zone by default; Edit shows "Not set · yours is …" for legacy events and leaves the column untouched unless the host picks one). Start/end are converted with the chosen zone on validate and on save, so a host travelling in New York can schedule 7 pm Lisbon. Hard-coded `en-US` removed from both forms' date labels and from `utils/relativeTime.ts`.
- [x] **Event Detail**: date and time render in the event zone; when the viewer's zone differs the time line gets the zone abbreviation and a second line "… your time" (with the viewer's date when it rolls over). Legacy events render exactly as before. Cards and lists elsewhere keep showing the viewer's local time by design (that *is* "your time"); the detail page is where the event's own clock matters.
- [x] **Calendar export**: ICS writes `DTSTART;TZID=<zone>:<local>` (Apple/Google/Outlook resolve IANA TZIDs without a VTIMEZONE block) so "7 pm Lisbon" imports as 7 pm and the series follows that zone's DST; RRULE `UNTIL` is the end of the final day *in the event zone*; Google Calendar link gets `ctz=`. Legacy events keep UTC instants. 4 new tests.
- [x] **`eventsService.createEvent`** sends `p_timezone` and falls back through the 13- and 12-argument shapes while migrations are unapplied, then writes what it could not send with one follow-up UPDATE (and retries capacity alone if the `timezone` column is missing). The create screen warns when the zone could not be saved.
- [x] **[DB, NOT applied]** `20261103140000_event_timezones.sql`: `events.timezone` + `is_valid_time_zone()` + validation trigger; 4-arg `event_has_ended(…, tz)` (recurrence end compared on the event's *local* date) and `event_next_occurrence(…, tz)` (days stepped on the wall clock, so 19:00 stays 19:00 across DST); the 3-arg forms delegate with NULL = UTC so untouched callers keep today's behaviour; public SELECT policy, `event_is_open_for_rsvp`, `get_ranked_events`, `get_user_going_events`, `get_user_saved_events`, `get_user_attendance_counts` re-created from their latest bodies with `e.timezone` passed through; `create_event_with_limit_check` gains `p_timezone` (13-arg dropped). Verified on scratch: validation accepts `Europe/Lisbon`/`UTC`, rejects `+02:00`, `CET`, junk; bad zone on UPDATE and on create raises; create stores the zone; a weekly series started in WET and stepped into WEST stays 19:00 local with the zoned arithmetic where UTC stepping gave 20:00; an Auckland series whose end date is "yesterday local" is ended while a Honolulu one ending "today local" is not; patched RPCs run.

## Left in Phase 2 (small)

- [ ] `send_event_reminders`: the "still interested?" nudge is "a day before" in absolute time; with a zone it could fire at a sensible local hour. Not started.
- [ ] All-day / multi-day display (plan §4D follow-on).
- [ ] Remaining `en-US` outside event times: `screens/Followers.tsx`, `components/ReviewCard.tsx`, `app/premium/manage.tsx` (cosmetic; not touched).
- [ ] After apply: `npm run backend:types`; drop the fallback chain in `eventsService.createEvent`.


# Phase 3 — publishing, lifecycle, details (2026-11-03)

Same rules: nothing applied to the shared DB; `20261103150000_event_publishing_and_lifecycle.sql`
validated on the per-worktree scratch copy after a fresh dump and all five earlier
20261103 files. Plan reference: `docs/HOST_TOOLS_PLAN.md` §4B–C, §4G.

## Drift note — the other session is applying Phase 3 by hand

The fresh dump already carried: the seven detail/publishing columns, two extra
CHECKs (`events_notes_len`, `events_price_label_len` ≤ 80), `publish_event(uuid)→void`,
`postpone_event(uuid)→void`, `reschedule_event(uuid,tstz,tstz,text)→void` and a
`duplicate_event` that keeps the original dates — none recorded in
`schema_migrations` or in a file. `20261103150000` converges: it drops the older
overloads (PostgREST cannot resolve `postpone_event(uuid)` next to
`postpone_event(uuid, text DEFAULT)`), drops the duplicate CHECKs in favour of the
named ones, and replaces the void RPCs with json-returning ones (supabase-js callers
that ignore the result keep working). The shared DB should be brought under
migration control before Phase 4; applying the six 20261103 files in order does it.

## Time-zone follow-ups fixed in this pass

- [x] `getNextOccurrences` and `hasEventEnded` were still walking the *device* calendar for zoned events; both now use the event zone (3 new tests, including a WET→WEST week where UTC stepping gave 20:00 and zoned stepping keeps 19:00).
- [x] `zoneDisplayLabel('UTC')` read "UTC (GMT)"; now "UTC". The host hub hero shows the event-zone time with the viewer reading in brackets when it differs.

## Done

- [x] **[DB, NOT applied]** `20261103150000_event_publishing_and_lifecycle.sql`: columns `publish_state`, `visibility`, `ticket_url`, `price_label`, `age_restriction`, `accessibility_notes`, `what_to_bring`, `status_note`; `status` gains `postponed`. Public SELECT policy = published + public + active/postponed + not ended. `get_event_details` refuses drafts to non-hosts (unlisted stays reachable by id — the share link). `get_ranked_events` excludes drafts and unlisted. `event_is_open_for_rsvp` requires published + active. `create_event_with_limit_check` gains `p_publish_state` (drafts skip the allowance and the counter). `publish_event` checks the allowance, increments, flips state and notifies followers through `notify_followers_for_event` (deduped; the INSERT trigger now uses the same helper and skips drafts/unlisted). Guards: `business_id` frozen; `publish_state` only draft→published and only via the RPC; `d_guard_event_time_changes` refuses plain time/place updates once anyone is going (`reschedule_required`). `reschedule_event(…, p_note, p_address, p_lat, p_lng)` is the sanctioned path: resets reminders, re-arms the waitlist, resumes a postponed event, sends one "Event rescheduled"/"location changed" notice (time in the event zone, host note appended) and suppresses the generic "Event updated". `postpone_event(p_event_id, p_note)` keeps RSVPs, closes joining, notifies going/interested/savers/waitlist. `duplicate_event` → new draft a week later with links/photos/settings. Verified on scratch: draft doesn't count or ping; hidden from attendee by RPC and table; direct publish refused; `publish_event` counts, pings the follower, is idempotent; unpublish refused; unlisted hidden from ranked and table but opens by id; plain time update refused with one going while a title edit passes; reschedule notifies 2 (attendee + waitlist), generic notice suppressed, waitlist re-armed; postpone sets status + note, join refused `event_closed`, still visible, reschedule resumes and clears the note; duplicate is a future-dated draft with links, refused for non-hosts.
- [x] **Create**: "More options" card (`components/EventExtrasFields.tsx`: Unlisted switch, tickets link, price, age chips, accessibility, what to bring; validated) and a **Save as draft** button that skips the allowance check, sends `p_publish_state = 'draft'` and lands on the hub. Pre-migration: drafts fail with a clear message; extras are written with a follow-up update and reported if the columns are missing.
- [x] **Edit**: same "More options" (auto-expanded when anything is set; diffed per field); time/place changes with anyone going — or on a postponed event — go through `rescheduleEvent` after the confirm (copy now says "rescheduled"; postponed says "Set the new date?"); `reschedule_required` from a race is explained.
- [x] **Event Detail**: Draft (owner), Unlisted (owner) and Postponed notices; Tickets row (price + "Get tickets" link), Age row, "What to bring" and "Accessibility" blocks; join bar reads "Postponed · new date coming / your spot is kept".
- [x] **My Events**: Drafts segment (newest first), Draft/Postponed badges, no Notify/Cancel on drafts, empty copy.
- [x] **Hub**: Draft section with **Publish**; **Duplicate**; **Schedule** section with **Reschedule** (→ Edit) / **Set the new date** for postponed, and **Postpone**; Settings tab gains an **Unlisted** switch. `getHostActions` knows draft/postponed phases (tests).
- [x] `eventsService.getBusinessEvents` gains `scope: 'drafts'`, excludes drafts from Upcoming, and retries without the column while the migration is unapplied.

## Phase 3 items not done here (next pass)

- [ ] RSVP modes `approval` / `invite` (`requested` rsvp status, `host_review_rsvp`, `event_invites`, Requested segment in the hub).
- [ ] Chat: `chat_mode` (open / announcements / off) replacing `locked`, `chat_open_policy`, pinned message; wire announcements to the pin.
- [ ] Extracting a shared `EventForm` from `create.tsx` / `EditEvent.tsx` (the More-options block is shared via `EventExtrasFields`, so the duplication did not grow).
- [ ] After apply: `npm run backend:types`; drop the create-RPC fallback chain and the `42703` retry.


# Phase 3 (continued) — chat mode + pins, RSVP approval (2026-11-03)

## Correction: the "shared DB drift" was a scratch-name collision

This worktree had been validating on `SCRATCH_DB=eventmap_scratch_oak` — a name
the other session evidently also uses (this repo has an `oak` worktree). The
hand-applied objects reported in the earlier drift notes (phase-3 columns,
`publish_event(uuid)→void`, the capacity guard pair, `get_user_past_event_count`,
and today an entire approval-mode implementation) were the **other session's
scratch work**, not the shared DB. A fresh dump confirms the shared `postgres`
DB is exactly at `20261102160000` with none of it; all eight 20261103 files
apply cleanly on that true state. This worktree now uses
`SCRATCH_DB=eventmap_scratch_elm_host3`. Earlier drift notes in this file
should be read with that correction; the convergence work they motivated is
still harmless (DROP IF EXISTS of overloads that may never exist). Follow-up
for both sessions: suffix SCRATCH_DB with your own worktree name.

## Done

- [x] **[DB, NOT applied]** `20261103160000_chat_mode_policy_and_pins.sql`: `event_chat_settings` gains `chat_mode` (open / announcements / off), `open_policy` (`two_going` = today's rule, `any_going` = chat works from the first going attendee) and `pinned_message_id`. `locked` stays in sync and the legacy `set_event_chat_settings(p_locked)` maps onto the mode, so pre-migration clients keep working. Attendees post only in `open`; host/admins post unless `off`; `off` hides the chat from attendees while the host keeps read + moderation. `set_event_chat_mode`, `set_event_chat_pin` (one pin per event; deleting a message unpins it via trigger; moderation log gains mode/open_policy/pin/unpin). `get_event_chat_post_status` re-created with `chat_mode`, `open_policy`, `pinned_message_id`. `send_event_announcement` pins its chat mirror. Verified on scratch: two-going default, any_going opens with one attendee, announcements = host-only posting, off blocks everyone and hides from attendees while the host still reads, legacy lock round-trips, pin/unpin permissions, foreign/deleted-message pins refused, announcement auto-pin, attendee sees the pin id.
- [x] **[DB, NOT applied]** `20261103170000_rsvp_approval_mode.sql`: `events.rsvp_mode` (open / approval), `rsvps.status` + `requested`. Under approval a Join tap lands as a request (join RPC now RETURNS text so the client knows); a guard trigger stops the direct-table bypass; host-driven paths (review, waitlist promote, auto-promote) pre-approve via a flag. `host_review_rsvp(approve|decline)` re-checks capacity under the event lock, notifies either way; host gets "Request to join your event"; approving stays quiet. Requests are invisible in public counts/lists/chat; the hub attendee page + overview + `host_set_event_settings` re-created with `requested` / `p_rsvp_mode`. Verified end to end on scratch (request, bypass refusals, interested unaffected, hidden from public surfaces, approve → "You're in", decline → row gone + notice, EVENT_FULL at approval, non-host refused, mode back to open lets the requester join directly).
- [x] Client, chat: `eventChatService.setMode` / `setPin` (legacy-lock fallback), hub Chat tab gains mode chips + "Open from the first attendee" switch (lock switch remains pre-migration), chat screen shows a pinned banner (host can unpin from it) and the message long-press sheet gains Pin/Unpin for moderators.
- [x] Client, approval: `createOrUpdateRsvp` returns the resulting status; Event Detail shows "Request to join" / "Request pending · host will review" with a Cancel request action; `APPROVAL_REQUIRED` error code; hub gains a **Requests** segment with approve/decline, a requested count, and an "Approve new attendees" switch in Settings (4-arg settings RPC with 3-arg fallback).

## Phase 3 remaining (deferred)

- [ ] Invite-only mode (`event_invites`) — plan §9; approval mode covers the main gate.
- [ ] Shared `EventForm` extraction (pure refactor; `EventExtrasFields` keeps the duplication from growing).
- [ ] Requested events in the attendee's own Joined lists (today only the event page shows the pending state).
- [ ] After apply: `npm run backend:types`; drop the untyped casts and fallback chains.


# Host tools — final regression round (2026-11-03)

Everything below ran against isolated scratch copies only (`SCRATCH_DB=eventmap_scratch_elm_host3`);
the shared DB was never touched. Two durable test artifacts now exist and should be
re-run at apply time:

- **`scripts/test-host-tools.sql`** — 90+ assertions in 11 sections (host views &
  auth, private names, remove/ban/unban, capacity, closed RSVPs + waitlist modes,
  announcements, time zones, publishing/visibility/lifecycle, chat mode/policy/pins,
  approval mode, review-driven hardening). Fails loudly via ASSERT; rolls back.
  Run: refresh scratch → apply the eight 20261103 files in order → apply this file.
- **`scripts/regress-host-tools.mjs`** (+ `regress-host-tools.fixture.sql`) — 19
  PostgREST-layer checks mirroring the exact named-argument shapes the client
  services send (overload resolution, undefined-key dropping, return-type decoding).
  Run against a private PostgREST bound to the scratch (docker run in this section's
  shell history / e2e-isolated-env.sh pattern; `JWT_K` = the oct key from the
  stack's `PGRST_JWT_SECRET` JWKS).

Final state: SQL suite ALL CHECKS PASSED on a clean slate; PostgREST 19/19;
`tsc` clean; vitest 397/397 (27 files); eslint 0 errors on every touched file
(12 pre-existing warnings in MyEvents/Settings, untouched).

## Fixed during this round (small issues, per instructions)

Server (all in the unapplied 20261103 files; every fix has a suite assertion in §11):
- [x] Requested users were missing from cancel / reschedule / postpone / generic-update notification audiences.
- [x] **RSVP event-move bypass**: `UPDATE rsvps SET event_id = …` slid a row past closed/approval/full checks; the guard trigger now refuses event moves outright (11.1).
- [x] **Waitlist bypassed approval mode**: waitlist join on approval events now raises `approval_required`; seat-freed handling never auto-admits on approval events (11.2–11.3).
- [x] Direct `'requested'` inserts on open-mode events refused (11.4).
- [x] `duplicate_event` dropped `rsvp_mode` (defined before the column existed); re-created with it (11.5).
- [x] Legacy `set_event_chat_settings(p_locked)` broke the `locked = (chat_mode <> 'open')` invariant on `'off'` chats and logged spurious unlocks (11.6).
- [x] Announcement chat mirror is SECURITY DEFINER and bypassed the posting policy: it now skips (and doesn't pin into) a switched-off chat (11.7).
- [x] **Postponed events stranded attendees**: going→interested downgrades now work (RPC + direct upsert), while new rows and self-upgrades still raise `event_closed` — enforced in the guard trigger because RLS can't compare old/new; note the upsert arrives as INSERT, so "existing row" marks a downgrade (11.8).
- [x] `publish_event` now refuses recurring drafts whose series already ended; `is_valid_time_zone` STABLE (depends on tzdata).

Client:
- [x] **Stuck RSVP states**: Leave / Cancel request / un-star / leave-waitlist survive "RSVPs closed" and postponed (only cancelled/ended/draft freeze them); a pending request takes label/tap precedence over "Event full · Join waitlist".
- [x] **Pinned banner showed moderated content**: deleting the pinned message now clears the banner and refreshes post status immediately.
- [x] **Attendee list race**: segment/search switches mid-flight no longer let a stale page land under the wrong segment (requestSeq guard, totals reset); one row action at a time; waitlist "#N in line" hidden while searching; empty-state no longer flashes pre-load.
- [x] `wallClockToUtc` resolved spring-forward-gap times an hour EARLY; now resolves forward (02:30 → 03:30 EDT) like calendars, with an exact test.
- [x] A timezone-only edit skipped the "start must be in the future" check (picker values compared instead of instants).
- [x] Announce audience count includes pending requests ("Everyone (N)"), matching the SQL.

## Flagged, NOT fixed (larger / needs product input)

- [ ] **Event Detail's chat entry ignores `chat_mode` / `open_policy`** (`screens/EventDetail.tsx` `chatIsOpen`): with `any_going` a sole attendee sees "unlocks with 2 attendees" though the room is open; with mode `off` a going user sees an entry that opens a no-access screen. Needs chat settings in `get_event_details` (one more field in the RPC) or a post-status call from the detail page.
- [ ] **Device-zone DST-gap picker round-trip**: if an event-zone wall time happens to be nonexistent in the *device* zone on that date, `instantToPickerDate` shifts it and edits drift an hour. Rare double-DST corner; fix would need a picker that edits wall-clock fields directly.
- [ ] Approval + closed RSVPs: a user with an existing interested row can still produce new join requests while "Accepting RSVPs" is off (the existing-row exception). Defensible but worth a product decision.
- [ ] `get_event_host_overview.chat` doesn't carry `chat_mode`/`open_policy`/`pinned_message_id`; the hub makes a second call (`get_event_chat_post_status`) — works, mildly wasteful.
- [ ] ChatModerationSheet failure path can double-toast and routes an error text through the success-styled `onNotice`.
- [ ] Nitpicks: stale "status can only be changed through cancel_event" error text (postpone/reschedule are legitimate now); `allow_capacity_shrink` uses `'on'` while other flags use `'true'`; `refetchAll` identity churn re-subscribes the focus hook each render.

## Consolidated: remaining unfinished implementations (whole task)

**Blocked on applying the migrations** (owner of the shared DB; apply the eight
20261103 files in order, then):
- [ ] `npm run backend:types`; drop the `untypedRpc` casts and fallback ladders in `services/hostTools.ts`, `services/events.ts`, `services/eventChat.ts`, `services/social.ts`; re-run both regression artifacts against the shared schema.
- [ ] Note: re-applying an OLDER 20261103 file after a NEWER one fails loudly on return-type changes (safe), but a stray re-run of 20261103130000 after 170000 would recreate a 3-arg `host_set_event_settings` overload (PostgREST ambiguity) before failing — drop it if that ever happens. One-shot ordered application has no such issue.

**Phase 3 leftovers**:
- [ ] Invite-only RSVP mode (`event_invites`) — plan §9.
- [ ] Shared `EventForm` extraction from `create.tsx` / `EditEvent.tsx` (pure refactor; `EventExtrasFields` already shares the new fields).
- [ ] Requested events in the attendee's own Joined lists (only the event page shows the pending state).

**Phase 2 leftovers**: local-hour reminder windows; all-day / multi-day display;
`en-US` leftovers outside event times (`screens/Followers.tsx`, `components/ReviewCard.tsx`,
`app/premium/manage.tsx`).

**Phase 1 leftovers**: dedicated Android push channel / icon for `host_announcement`
(currently `default`); `get_user_past_event_count()` exists only on scratch copies, unfiled.

**Phase 4 (not started)** — plan §11: event-size presets, check-in + QR, CSV export,
`event_sections`, recurrence weekdays/count + per-occurrence overrides, real insights
with server-side tier gating. **Cross-cutting**: co-hosts need `business_members` and
touch every `user_is_event_host` check.
