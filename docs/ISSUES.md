# EventMap — Prioritized Issue Tracker

From the full workflow review (2026-10-30). Ordered by priority. Check items off as fixed.
Items marked **[DB]** require a migration — deferred until migrations can be applied safely
(shared local DB; do not reset or migrate without coordination).

## Suggested order of attack

1. [x] Rebrand reconciliation (style.md ↔ theme.ts, tokens, local palettes) — style.md rewritten for the red brand; `surface`/`primarySoft`/soft status tokens + `alpha()` added to theme.ts; terracotta/teal/amber remnants purged; local palettes dissolved or token-backed.
2. [x] Premium consolidation (single source of truth, client-side) — **done**: `businesses.subscription_tier` + `subscription_expires_at` are the single source of truth; mock in-memory state removed; one plan catalog (Free + Pro, $29.99/mo) in `services/premium.ts`.
3. [ ] Event lifecycle (cancelled state, owner past-events policy, capacity) — **[DB]** [migration written — pending apply: 20261030105000 owner policy, 20261030106000 cancelled status + cancel_event RPC, 20261030108000 capacity + join_event_with_capacity RPC; client cancel + capacity flows wired with pre-apply fallbacks]
4. [ ] Server-side enforcement sweep (reviews, bans, privacy) — **[DB]** [migration written — pending apply: 20261030103000 reviews, 20261030104000 bans + RSVP lifecycle; privacy already server-side since 20261029110000]
5. [x] Quick wins (km/mi, search input, fake description, etc.) — done (see checked items below)

---

## P0 — Top issues by user impact

- [x] Forgot-password dead end: no reset-password screen; `services/auth.ts:141` has no `redirectTo`; `components/AuthRedirectHandler.tsx:29` just logs user in on recovery link — fixed: `app/(auth)/reset-password.tsx` added; resetPassword passes `redirectTo`; handler routes `type=recovery` callbacks to the reset screen (and now handles web-origin callbacks).
- [x] Keyword search unreachable: `searchQuery` in `app/(tabs)/discover.tsx:57` only written by `clearFilters()`; backend ILIKE support unused — fixed: keyword field added to SearchOverlay 'where' step, wired to `searchQuery`.
- [x] `Alert.alert` no-op on web: all auth/onboarding feedback invisible on web (`app/(auth)/signup.tsx:53`, `login.tsx:59`, onboarding saves) — fixed for auth/onboarding/settings: `utils/notify.ts` + `components/AppToast.tsx` toast/confirm system mounted in `app/_layout.tsx`; remaining call sites tracked in P1.
- [x] Past events publishable and instantly hidden: create validates only end>start (`app/(tabs)/create.tsx:166-176`); RLS hides ended events; burns monthly limit — client side fixed: future-start validation + `minimumDate` on pickers (Edit screen only enforces it when the start was changed).
- [ ] **[DB]** Business owners lose past events: only SELECT policy is `end_datetime > now()` (`supabase/migrations/20260213092204:126-130`). Needs owner SELECT policy. [migration written — pending apply: 20261030105000; MyEvents needs no client change]
- [ ] **[DB]** Event deletion strands attendees: hard cascade, no DELETE notification trigger (`services/events.ts:95-99`). Needs "cancelled" soft state + notify. [migration written — pending apply: 20261030106000 adds events.status + cancel_event RPC (notifies going/interested); CLIENT WIRED: MyEvents/EventDetail now call `eventsService.cancelEvent` (cancel_event RPC) with a hard-delete fallback while 42883/PGRST202 (pre-apply); remove fallback in services/events.ts once applied]
- [ ] **[DB]** RLS hole: business owners can rewrite customer reviews — UPDATE policy has no column restriction (`…20260217110000_create_reviews.sql:44-60`). [migration written — pending apply: 20261030103000 column-scoping trigger]
- [x] Premium system three-way contradiction (see Premium section) — fixed: single DB-backed source of truth, one cancel flow (`/premium/manage`), one upsell route (`/premium/plans`).
- [x] Distance km shown as "mi" (`app/(tabs)/discover.tsx:369`) — fixed: km→mi conversion applied (also unified `screens/SavedEvents.tsx` to miles).
- [x] No account deletion (`screens/Settings.tsx`) — fixed: `delete_own_account()` RPC + Settings "Delete account" row with double confirm [migration written — pending apply: 20261030109000; client degrades gracefully via `services/account.ts` NOT_AVAILABLE on 42883/PGRST202]. Report user added to profile header (`screens/UserProfile.tsx`, complaintsService 'user'); global blocking still missing (see [DB] item below).
- [ ] **[DB]** No global user-block table (only per-event `event_chat_blocks`) — [migration written — pending apply: 20261030111000 `user_blocks` table + blocker-scoped RLS; client wired: Block/Unblock on `screens/UserProfile.tsx` via `socialService.blockUser/unblockUser/isBlocked`, degrades to "Blocking isn't enabled on this server yet." pre-apply (42P01 → NOT_AVAILABLE)].
- [ ] **[DB]** Enforce user_blocks in chat/content RPCs — hide blocked users' chat messages/events (and vice versa) once 20261030111000 is applied; blocking is storage-only today. [migration written — pending apply: 20261030116000 filters blocked senders from the attendee chat SELECT policy (viewer-side mute; sending stays allowed, host/admin moderation reads keep full transcript); known mismatch: `get_event_chat_unread_counts` is SECURITY DEFINER and still counts blocked senders' messages, so the unread badge can exceed rendered messages; events/content enforcement still open]

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
- [ ] 100-event hard cap, no pagination (`services/events.ts:21`); no marker clustering; map WebView full-reloads on recenter (`components/GoogleMapView.tsx:245-257`) — pagination: **[DB]** [migration written — pending apply: 20261030110000 adds p_offset to get_ranked_events; client pages 50/append-on-scroll and falls back to the legacy single 100-event fetch pre-apply]; clustering added via @googlemaps/markerclusterer (CDN, plain markers if it fails); WebView now builds HTML once and pans via injected JS (no reload on recenter).
- [x] Signed-out "Join Event" silently no-ops (`screens/EventDetail.tsx:926-929`) — fixed: button shows "Sign in to join" and routes to login with a `redirect` return path back to the event.
- [x] Empty description renders fake marketing copy (`screens/EventDetail.tsx:729`) — fixed: neutral "No description provided." in tertiary text.

### Attendance / multi-user
- [ ] **[DB]** No capacity model: no join cap, no waitlist (`services/social.ts:24-45`). [migration written — pending apply: 20261030108000 (events.max_attendees + join_event_with_capacity RPC); tolerant client wired: join tries RPC then falls back to upsert, EventDetail shows X / Y + "Event full", create/edit forms have optional Max attendees with missing-column retry; discovery (get_ranked_events) intentionally untouched — surface remaining capacity there post-apply; waitlist still open]
- [x] Hosts have no UI entry to their own event chat — gated on `user_rsvp === 'going'` (`screens/EventDetail.tsx:662-667`) — fixed: owner "Manage chat" row on EventDetail → `/event-chat/[id]`; chat screen already honors host read+moderation via `get_event_chat_post_status.can_read` and now shows a host-specific read-only notice (posting still requires a 'going' RSVP per the INSERT policy — no new grants).
- [ ] **[DB]** Anyone can review a business they never attended, incl. the owner (policy only checks `auth.uid() = user_id`). [migration written — pending apply: 20261030103000 eligibility check (past 'going' RSVP, owner excluded)]
- [x] Attendee count / chat unlock not realtime (`screens/EventDetail.tsx:128-157`) — mitigated: 20s focus-scoped poll of rsvp_count (rsvps is not in the realtime publication, so postgres_changes would never fire); true realtime tracked in the [DB] item below.
- [ ] **[DB]** Add `rsvps` to the `supabase_realtime` publication (only `event_chat_messages` is published — 20260301000000) so EventDetail can replace its 20s attendance poll with a debounced postgres_changes subscription filtered by event_id. [client subscription pre-wired; fires once publication is added — the 20s poll stays as primary/fallback] [migration written — pending apply: 20261030115000 adds rsvps to the publication + REPLICA IDENTITY FULL so DELETE payloads carry event_id]

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
- [ ] Changing start doesn't shift end; Android time-step cancel discards chosen date (`create.tsx:84-85,464-466`; `EditEvent.tsx:123-150`).
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
- [ ] No joined/saved indication on cards (`types/database.ts:214-229` lacks viewer fields). **[DB]** [migration written — pending apply: 20261030114000 adds `user_rsvp`/`user_saved` to get_ranked_events; discover cards show a Going badge + saved bookmark and degrade gracefully pre-apply (fields undefined → nothing renders)]
- [ ] Recurring events show original stale date + wrong badge in list (`discover.tsx:379,389`).
- [ ] Marker tap unmounts entire bottom sheet (`discover.tsx:656-720`).
- [x] Photo carousel missing page dots (`screens/EventDetail.tsx:528-550`; styles 1118-1133 unused) — fixed: dots rendered above the hero title when photo count > 1, active dot tracks onMomentumScrollEnd.
- [x] SearchOverlay Airbnb-template "guests" leftovers (`contexts/SearchContext.tsx:14-18`, `components/SearchOverlay.tsx:44`) — removed: 'who' step type, guests context state, and the collapsed-bar "Guests" segment; hasSelection/clearAll no longer reference guests.
- [x] Fixed 50 km radius regardless of zoom (`discover.tsx:179`) — radius now derived from the map viewport (half the bounds diagonal, clamped 5–150 km; falls back to 50 km until the map reports bounds).

### Attendance / notifications
- [ ] **[DB]** Bans not enforced on rsvps/saves/reviews policies (chat does it right). [migration written — pending apply: 20261030104000 adds `user_is_banned()` to all three INSERT policies]
- [ ] **[DB]** RSVP to ended events blocked client-side only. [migration written — pending apply: 20261030104000 `event_is_open_for_rsvp()` on rsvps INSERT/UPDATE, recurrence-aware]
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
