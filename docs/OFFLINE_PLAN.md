# Offline and poor-connection UX plan

Status: written 2026-11-05. Steps 0-7 and the no-dependency part of step 8
implemented the same day, followed by a full regression pass (see the
implementation log); the rest is a proposal. Issues found along the way are
tracked in `docs/ISSUES.md` ("Offline and poor-connection work"). It covers
the ROADMAP item "Offline and poor-connection UX": the user should be able to
open the app and browse what they have seen before (their plans, saved
events, recently viewed events, the last discover area, their profile) with
no connection, and get honest, recoverable feedback on a slow or flaky one.

## 1. What exists today

Nothing in the app tracks connectivity. There is no NetInfo, no React Query
`onlineManager`, no persisted cache, no request timeout and no offline
queue. Below is what each system does with no network or a flaky one.

### Startup and auth (`contexts/AuthContext.tsx`, `app/index.tsx`)
- **Token expired + offline (the usual case after an hour away):** supabase-js
  `getSession()` tries to refresh, gets `AuthRetryableFetchError` and returns
  no session. The error is only logged (`AuthContext.tsx:81-83`), so
  `app/index.tsx:20` redirects to welcome and the user looks signed out. The
  stored tokens survive, and the auto-refresh later fires `TOKEN_REFRESHED`,
  but `welcome.tsx` doesn't watch auth, so the user stays there.
- **Token valid + offline:** the profile and banned checks share one
  `Promise.all` (`AuthContext.tsx:57-60`). Either failing sets `profileError`,
  and the whole app sits behind "Couldn't load your profile / Retry"
  (`index.tsx:27-56`). Retry is manual only, and no profile is cached locally.
- **Flaky connection:** no fetch timeout, so the startup spinner can hang
  indefinitely (or around 30 s while auth-js retries the refresh).
- `AppContext`: if the business fetch fails, `userBusiness` stays null, the
  Create tab disappears and nothing retries. `PremiumContext` silently drops
  to free-tier defaults.
- Push taps that arrive while `profileError` is set or no session is known
  are dropped (`app/_layout.tsx:75, 92-97`).

### Reading data
- Only Saved, Joined, Calendar, ManageEvent, EventInsights and
  profile-analytics use React Query, and its cache lives in memory only
  (`app/_layout.tsx:116`). Discover, EventDetail, notifications, profile,
  UserProfile, BusinessDetail, MyEvents, Followers/Following, BlockedUsers
  and chat all use `useState` + `useEffect`: nothing survives navigating
  away or restarting.
- **An error replaces data that is already on screen** in notifications
  (`:304`), profile (`:156, :430`), UserProfile (`:110`), BusinessDetail
  (`:123`), MyEvents (`:139`), SavedEvents (`:235`), BlockedUsers (`:123`),
  ManageEvent (`:1421`), EventInsights (`:117`) and profile-analytics
  (`:196`). Calendar is the right model: it only shows the error when there
  are no rows (`screens/Calendar.tsx:407-414`).
- **Failures shown as "missing":**
  - EventDetail shows "Event not found" with no retry when the first load
    fails (`EventDetail.tsx:183`, `:709`).
  - Discover fetches categories before events (`discover.tsx:178`). If
    categories fail, events are never requested, `loadError` stays false
    and the user sees "No events nearby".
- `getAllCategories().then(...)` has no catch in `create.tsx:174` and
  `EditEvent.tsx:188`.
- 31 service calls (outside `auth.ts`) run `supabase.auth.getUser()` first (`services/social.ts`,
  `events.ts`, `eventChat.ts`, …). That is a network round trip to the auth
  server before the real query: twice the latency and a second way to fail
  on a bad connection.

### Writes
- RSVP, waitlist, leave and review are not optimistic; a failure shows a
  toast. Save, follow, notification read/delete, chat mute and chat delete
  are optimistic with rollback.
- **Not idempotent on retry:** `saveEvent` and `followBusiness`
  (`social.ts:246, 327`) use a plain insert. If the first request landed but
  the response was lost, the retry hits 23505, the UI rolls back and shows
  an error while the server has the row. `blockUser` (`:446`) already
  treats 23505 as success.
- **Event create has no idempotency key**
  (`create_event_with_limit_check`). A lost response followed by another tap
  on Publish creates a duplicate and uses another slot of the monthly limit.
- If `rescheduleEvent` succeeds but a later step fails, saving EditEvent
  again re-sends the "rescheduled" notifications (`EditEvent.tsx:514-534`).
- If `addEventPhoto` fails after the upload, the storage object is
  orphaned, and a retry uploads it again under a new name.
- Review submit reports failure if the refetch after a successful upsert
  fails.
- No local drafts for create/edit, and none for the chat composer or
  pending messages (onboarding is the only screen with one,
  `utils/onboardingDraft.ts`).

### Chat and realtime
- Chat is the strongest area: client UUIDs, optimistic bubbles, 23505
  treated as success, failed bubbles that can be tapped to retry, channel
  reconnect with backoff and a banner, and catch-up on subscribe, focus and
  foreground.
- Gaps:
  - Pending and failed messages live in memory only, and nothing retries
    automatically on reconnect.
  - The slow-mode and rate-limit triggers run before the primary-key check,
    so retrying a message that already landed can fail with `chat_slow_mode`
    instead of 23505.
- The notifications channel has no status callback and no backfill after a
  drop. The badge only recovers on foreground, the list only on
  pull-to-refresh.

### Map and images
- Every map is a WebView or iframe (`components/GoogleMapView.tsx`).
  Leaflet (the default) is bundled, so the map page and pins work offline
  over a grey, tile-less background with no message. Google mode needs
  `maps.googleapis.com`, unpkg (clusterer) and Google Fonts; offline it is
  a blank white box with no pins. No `onError`/`onHttpError` on the
  WebView, and no `tileerror` handler.
- `expo-image` is not installed. Plain RN `<Image>` everywhere: no disk
  cache control, no prefetch. Only `Avatar` falls back when an image fails
  to load.
- `getCurrentPositionAsync({})` has no timeout and no last-known fallback,
  and it holds up the first discover load. The SF default is used when the
  profile has no location.
- Web (`output: "single"`) has no service worker, so the web app shell
  itself can't load offline.

## 2. Goals and non-goals

**Goals**
1. A signed-in user always gets into the app offline, with their last-known
   profile.
2. These are readable offline and show when they were last updated:
   - upcoming joined events and calendar
   - saved events
   - the last ~30 event details viewed
   - the last discover area (list + pins)
   - notifications
   - the user's own profile and business
   - recent chat messages, read-only
3. Never replace data on screen with an error. An error state only shows
   when there is nothing to show.
4. A single, calm connectivity indicator instead of a pile of error toasts.
5. Every write ends in one clear state: done, pending (will send), or
   failed (with retry). Retries never create duplicates.
6. On a slow connection nothing spins forever. Requests time out and fall
   back to cached data.

**Non-goals (for now)**
- Offline map tiles or tile packs. The OSM tile policy forbids bulk
  prefetch; it would need a commercial provider.
- Offline RSVP / waitlist joins. Capacity and approval rules are decided on
  the server, so queuing "going" would promise a spot we can't guarantee.
- Offline event creation and publishing (a local draft is in scope).
- A web PWA / service worker (possible follow-up, see §6).
- Full offline search. Search runs only over cached results.

## 3. Design

### 3.1 Connectivity layer (`services/connectivity.ts`)
- Add `@react-native-community/netinfo` (`npx expo install`). It is a
  native module, so it needs a new dev-client / EAS build. It works on web
  via `navigator.onLine`.
- One status store exposed through `useConnectivity()`. Statuses:
  - `online`
  - `offline`: NetInfo says not connected. (`isInternetReachable` is not
    used: NetInfo's reachability probe pings a Google URL, which is turned
    off, and with it off NetInfo reports `false` permanently on iOS / web.)
  - `degraded`: the device is connected but recent Supabase requests timed
    out or hit network errors (≥2 in 30 s). This catches captive portals
    and one-bar connections that NetInfo calls "connected".
- Wire it into React Query `onlineManager.setEventListener`. Queries then
  pause instead of failing offline, and refetch and resume mutations on
  reconnect for free.
- A successful request clears `degraded`. Discover's pan reloads, the
  20-second EventDetail poll and auto-retries are skipped while `offline`.

### 3.2 Request layer (`services/supabase.ts`, `utils/networkErrors.ts`)
- Pass a custom `global.fetch` to `createClient` that adds an
  `AbortSignal.timeout` to every REST/RPC call: 12 s for normal calls, 60 s
  for storage uploads. Realtime uses WebSockets and is unaffected. It
  reports outcomes to the connectivity store, which is how `degraded` is
  detected.
- `isNetworkError(err)` / `classifyError(err)`, which recognises:
  - `TypeError: Network request failed` / `Failed to fetch`
  - `AuthRetryableFetchError`
  - `AbortError` / `TimeoutError`
  - HTTP 5xx

  It returns `network | timeout | server | client`. `utils/authErrors.ts` and
  `utils/rsvpErrors.ts` use it so a network failure always gets connection
  copy ("You're offline — try again when you're connected") instead of
  "Failed to update RSVP" or "link expired" (`AuthRedirectHandler.tsx:49`).
- React Query defaults: `retry` uses the classifier (retry network, timeout
  and 5xx up to 3 times with backoff; never retry 4xx). Set
  `networkMode: 'offlineFirst'` so cached data is served before the network
  is tried.
- Replace `supabase.auth.getUser()` in services with a `getSessionUser()`
  helper that reads the local session (`getSession()`). RLS still enforces
  identity on the server, so this costs no security, and it removes 31
  extra round trips.

### 3.3 Persistent query cache
- Add `@tanstack/react-query-persist-client` and
  `@tanstack/query-async-storage-persister` (pure JS, no native build).
  Swap `QueryClientProvider` for `PersistQueryClientProvider`.
- Only queries that set `meta: { persist: true }` are written
  (`dehydrateOptions.shouldDehydrateQuery`).
- `maxAge` 7 days. `buster` = app version + `CACHE_SCHEMA` constant, bumped
  whenever a persisted shape changes.
- **Per user and private.** The storage key includes the user id. Sign-out
  and account switch clear the persisted cache and `queryClient.clear()`.
- **Size budget.** AsyncStorage is roughly 6 MB on Android and localStorage
  roughly 5 MB on web.
  - Persist at most 2 discover pages and the 30 most recent event details
    (LRU, enforced by `gcTime` plus a trim step before persisting).
  - Persist list rows only, never image data.
  - `throttleTime` 2 s.
  - If budgets turn out tight, swap the storage adapter for
    `expo-sqlite/kv-store` (same API, no size cap).
- The UI shows freshness from `dataUpdatedAt`: "Updated 3 h ago" on screens
  showing cached data while offline or after a failed refresh.

### 3.4 Screen-state contract
One small helper, `components/ui/QueryState.tsx` or a
`useScreenState(query)` hook, so every screen behaves the same:

| Has data? | Fetch status | Shows |
|---|---|---|
| yes | fetching | data + small spinner (no skeleton) |
| yes | error / offline | data + "Offline · updated X ago" chip, retry on pull |
| no | fetching | skeleton |
| no | offline | "You're offline. This will load when you reconnect." |
| no | error | ErrorState + Retry, worded by error class |
| no | success, empty | real empty state |

A confirmed 404 / no row is kept separate from a network error, so "Event
not found" is only shown when it is true.

### 3.5 What becomes available offline
- **Moved to React Query and persisted:**
  - discover (`useInfiniteQuery` keyed by rounded centre, radius and
    filters)
  - categories (`staleTime` 24 h, plus a bundled seed list from
    `constants/categories.ts` as a last resort)
  - banners
  - EventDetail (`['event', id]`)
  - notifications
  - profile (reuse `queryKeys.attendanceCounts`)
  - UserProfile, BusinessDetail, MyEvents
  - Followers/Following and BlockedUsers (not persisted)
- **Already on React Query, add `persist`:** saved, joined, calendar.
- **Instant event open:** EventDetail uses `initialData` built from the row
  the user tapped in a cached list (discover / saved / joined / calendar).
  Even a never-opened event shows title, time, place and cover offline;
  the full details load when online.
- **Warm the cache for "my plans":** when online, and not on a cellular
  "expensive" connection per NetInfo `details.isConnectionExpensive`,
  prefetch details for upcoming joined and saved events (cap 20). The
  events the user is most likely to need on the go then open offline.
- **Chat:** persist the newest 50 messages per room for the 5 most recent
  rooms. Offline, the room is read-only with a banner; catch-up runs on
  reconnect as it does today.

### 3.6 Startup and auth offline
- **Restore the session offline.** When `getSession()` fails with a
  retryable error, read the stored session directly from AsyncStorage (the
  key supabase-js already writes). If it exists, set `user` from it and set
  a new `sessionStale` flag, instead of treating the user as signed out.
  The router treats `sessionStale` as signed in. Requests that need a fresh
  token fail as network errors and are paused by `onlineManager` anyway.
  When `TOKEN_REFRESHED` arrives, clear the flag. If `SIGNED_OUT` arrives (a
  revoked refresh token), go to welcome as today.
- **Profile, banned and business snapshot.** After every successful load,
  write a per-user snapshot to AsyncStorage. If a later load fails and a
  snapshot exists, use it, set `profileStale` rather than `profileError`,
  and retry automatically on reconnect and on foreground. The full-screen
  profile error stays only for "no snapshot and the load failed" (first
  sign-in on this device). It keeps the existing rule: a failed load never
  routes to onboarding.
- Split the banned check so a failure falls back to the snapshot value
  instead of failing the profile.
- `AppContext` / `PremiumContext`:
  - use the cached business so the Create tab doesn't vanish
  - retry on reconnect
  - premium state becomes "unknown" while offline instead of silently
    downgrading to free
- Cap the startup wait at around 8 s using the request timeout, then
  continue with snapshots.
- Queue push taps while auth is restoring or stale, instead of dropping
  them.

### 3.7 Writes

| Class | Actions | Offline behaviour |
|---|---|---|
| Queue and replay | save/unsave, follow/unfollow, notification read/read-all/dismiss, chat mute, chat send | Optimistic. Stored as a paused React Query mutation (persisted, with `setMutationDefaults` so it can resume after restart), replayed on reconnect. Shown as pending ("Will sync when online"). |
| Needs connection | RSVP going/interested, leave, waitlist, review, report, block, event publish/edit, host tools, settings, avatar upload | The button stays enabled. Tapping it offline shows "You're offline — connect to RSVP" without sending. On `degraded`, send with the timeout; on network failure, show a toast with a Retry action (`notify.withAction`). |
| Local draft | create event, edit event, chat composer | Autosave to AsyncStorage (debounced, per user, same pattern as `onboardingDraft`). Restored when the screen opens. Cleared on success. |

Queued writes must be safe to replay, which needs these fixes:
- `saveEvent` / `followBusiness`: treat 23505 as success, or upsert with
  `ignoreDuplicates`.
- Review submit: separate the write from the refetch, so a successful write
  is never reported as failed.
- EditEvent: don't re-run reschedule if it already succeeded in this edit
  session (track per-step success); this avoids duplicate notifications.
- Chat retry: before a retry, look the message up by id. If it exists,
  merge it and skip the insert. This is client-side only and sidesteps the
  trigger-before-PK problem. Persist pending and failed bubbles per room and
  auto-retry `pending` ones on reconnect (same UUID, so it is safe). Only
  messages the user explicitly sent are auto-retried, and only within 24 h;
  older ones become `failed`.
- Event create idempotency: **needs a DB change.**
  `create_event_with_limit_check` takes a `p_client_request_id uuid`, with a
  unique partial index on `(user_id, client_request_id)`. On conflict it
  returns the existing event id without counting against the limit. The
  client generates the id once per form session and keeps it in the draft.
- Event photos: generate the storage path from a client id kept in the
  draft, and upload with `upsert: true`. A retry then overwrites instead of
  orphaning. A unique `(event_id, storage_path)` constraint on
  `event_photos` (DB change) dedupes the row.

### 3.8 Realtime
- Notifications channel:
  - add a status callback
  - on `SUBSCRIBED` after a drop, invalidate the notifications query and
    the unread count (backfill)
  - on reconnect (connectivity `online`), call `realtime.connect()`
- Chat: when connectivity flips to `online`, skip the remaining backoff
  wait and rejoin right away.
- On any `offline → online` transition, invalidate active queries
  (`onlineManager` does this for queries; add the contexts' refreshers).

### 3.9 Connectivity UI
- `components/OfflineBanner.tsx`, mounted once in `app/_layout.tsx` under
  the status bar and inside the safe area:
  - `offline`: "You're offline · showing saved content"
  - `degraded`: "Slow connection"
  - on reconnect: "Back online" for 2 s, then hidden
  - announced via `accessibilityLiveRegion` / `AccessibilityInfo`
- While the banner is visible, per-request failure toasts are suppressed;
  the banner already explains them. Toasts remain for explicit user actions
  (with Retry).
- Stale chips on cached screens (§3.4) and a "pending" marker on queued
  writes (save icon outline, chat clock icon).
- Copy follows `style.md`.

### 3.10 Map, images, location
- Add `expo-image` (native module, needs a rebuild) and replace `<Image>`
  in `EventCardCarousel`, `EventListItem`, `Avatar`, `AppBannerCarousel` and
  `ImageViewer`:
  - `cachePolicy="memory-disk"`
  - a blurhash or tint placeholder
  - an `onError` fallback to the existing icon placeholder
  - prefetch covers for the "my plans" warm-up set (§3.5)
- Map:
  - Leaflet page: on `tileerror`, emit a message
  - WebView: `onError`, `onHttpError`
  - Google page: script `onerror` and `gm_authFailure`
  - the native side shows a small overlay: "Map tiles unavailable offline —
    showing N saved events"
  - Leaflet still draws pins from the cached feed
  - vendor the Google markerclusterer (as `scripts/vendor-map.mjs` already
    does for Leaflet)
- Location:
  - `getLastKnownPositionAsync()` first, then `getCurrentPositionAsync` with
    a 5 s timeout, never blocking the events load
  - persist the last map centre so an offline start opens where the user
    was, not SF

## 4. Database impact and environment

Only two changes touch the database, both optional and backwards
compatible:
1. `p_client_request_id` on `create_event_with_limit_check`, plus the
   unique partial index.
2. A unique `(event_id, storage_path)` on `event_photos`, after a dedupe
   check of existing rows.

**Rule for this whole effort (decided 2026-11-05): no database writes.**
Another dev session is working in the shared local database, so this work
must not disturb it:
- No `db reset`, no migrations applied, no scratch databases created in
  the shared Postgres cluster, and no sign-ins or test data against the
  shared API.
- Anything database-related is only *prepared*: SQL goes under
  `supabase/pending/` (not `supabase/migrations/`, so `supabase start` /
  `db reset` can't pick it up) with notes on how to apply and test it. It
  is left for a later, separately approved migration.
- The client must keep working, unchanged, against the current schema
  until then.
- Runtime checks use a web export pointed at an unused port, with every
  backend request answered from fixtures or failed by the browser over
  CDP (see the implementation log), so no database is involved.

Everything else in this plan is client-only.

## 5. Steps and estimate

| # | Step | Native build? | DB? | Estimate |
|---|---|---|---|---|
| 0 | Quick fixes with no new deps: categories no longer blocks discover; EventDetail network error ≠ not-found; data-over-error on the 10 screens listed; catch on `getAllCategories`; 23505-as-success for save/follow; review write/refetch split; `getSessionUser()` | no | no | 4-6 h |
| 1 | Connectivity layer, fetch timeout, error classifier, `onlineManager`, OfflineBanner | yes (NetInfo) | no | 4-6 h |
| 2 | Offline startup: session restore, profile/business snapshot, auto-retry, push queue | no | no | 4-6 h |
| 3 | Persisted cache + screen-state helper; persist saved / joined / calendar | no | no | 3-4 h |
| 4 | Move discover, EventDetail (with list-row `initialData`), notifications, profile to React Query; categories seed; recent-events LRU | no | no | 8-12 h |
| 5 | Remaining screens (UserProfile, BusinessDetail, MyEvents, Followers/Following, BlockedUsers) | no | no | 4-6 h |
| 6 | Writes: offline gating, persisted mutation queue for save / follow / read, local drafts for create/edit | no | no | 6-8 h |
| 7 | Chat: persisted pending messages and drafts, auto-retry, check-before-retry, cached rooms; notifications realtime backfill | no | no | 4-6 h |
| 8 | expo-image + prefetch, map error overlays, vendored clusterer, location fallback | yes (expo-image) | no | 4-6 h |
| 9 | Event-create idempotency and photo dedupe (scratch DB first) | no | yes | 3-4 h |
| 10 | Tests and QA pass (§7) | — | — | 4-6 h |

Total about 48-70 h. Step 0 can ship alone and fixes the worst problems
right away. Steps 1-3 are the foundation for everything after. Batch steps
1 and 8 into one native build.

## 6. Decisions (2026-11-05)
1. **Offline RSVP:** blocked, with a clear message. No queued RSVPs.
2. **Cache storage:** AsyncStorage with the budgets in §3.3.
3. **Warm-up prefetch:** deferred. Leaning Wi-Fi only when it is built.
4. **Web offline:** web stays online-only (it still gets the banner and
   in-session caching). No PWA / service worker.
5. **DB changes (step 9):** prepared only, under `supabase/pending/`, and
   never applied during this effort (see §4).

## 7. Testing
- **Unit (vitest):**
  - error classifier
  - connectivity reducer (online / offline / degraded transitions)
  - persist allowlist, trim and buster
  - draft serialisation
  - service idempotency (23505 → success), with mocked clients
- **Web:** run the existing visual scripts with the browser forced offline
  and throttled (DevTools / CDP `Network.emulateNetworkConditions`).
  Screenshot discover, EventDetail, saved, calendar and the profile in each
  state.
- **Native:**
  - Maestro flows using `setAirplaneMode` (Android) to cover: cold start
    with an expired token, open a saved event, queue a save, reconnect
  - iOS: Network Link Conditioner (100% loss / "Very Bad Network") for the
    `degraded` path
- **DB (step 9):** SQL suite in the scratch DB. Calling create twice with
  the same request id gives one row and one limit slot.

## 8. Implementation log

### Step 0: quick fixes, no new deps (2026-11-05)
Main rule: **a failed request never erases data that is already on
screen.** The error state only shows when there is nothing to show; a
failed refresh keeps the data and shows a "Couldn't refresh …" toast.

- **Data kept on refresh failure:**
  - notifications
  - profile tab (keyed by user + business, so another account's data can
    never stay on screen)
  - UserProfile and BusinessDetail (keyed by route id)
  - MyEvents and BlockedUsers (quiet refreshes)
  - SavedEvents (RQ error only shown with no rows; a failed pull shows a
    toast)
  - ManageEvent, EventInsights, profile-analytics (render data when
    present, even if the latest refetch failed)
- **Partial failures no longer reset values:**
  - BusinessDetail photos, links and upcoming count
  - notifications unread count (was reset to 0)
  - UserProfile block state (was flipped to "not blocked")
  - EventDetail attendee faces, chat badge and reviews
  - BusinessDetail and UserProfile now fetch everything before writing
    state, so a failure part way through can't mix new and stale data
- **MyEvents:** a failed page load no longer stops paging for good;
  scrolling again retries it.
- **AuthContext:** a failed profile refresh (Settings save, avatar change)
  keeps an onboarded profile instead of raising `profileError` and
  bouncing the user out of the tabs. First loads and un-onboarded profiles
  still get the retry screen, so a failure can never route into onboarding.
- **EventDetail:** a failed first load shows "Couldn't load this event"
  with Try again. "Event not found" is only shown for a real missing event.
  ManageEvent separates the two the same way.
- **Discover:**
  - categories load on their own (and on pull-to-refresh); a failure no
    longer stops the events request
  - the GPS fix is capped at 8 s with a last-known fallback, and a GPS
    error falls back to the default center instead of skipping the events
    load
- **Create / EditEvent:** a failed categories load shows an error toast
  with Retry instead of an unhandled rejection. `notify.error` takes an
  optional action.
- **Retry-safe writes:** `saveEvent` / `followBusiness` treat 23505 as
  success (the earlier insert landed). Review submit and host responses
  report failure only for the write. The reload after it is best-effort,
  and responses show locally right away.
- **`getSessionUser()`** (`services/supabase.ts`) replaces 31
  `auth.getUser()` calls in services: one less auth-server round trip per
  call. It throws when the session can't be restored, so offline reads
  fail visibly instead of returning "signed out" empties (e.g.
  notifications showed "All caught up"). `services/auth.ts` keeps
  `getUser()` for password and identity checks.
- **Tests:** `tests/offlineResilience.test.ts` covers duplicate save /
  follow, a failed session restore, and a guard against `auth.getUser()`
  coming back into services.
- **Runtime check (web, no database):**
  - Setup: an export built with `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:59999`,
    driven by headless Chrome. Every backend request is answered from
    fixtures or failed as `InternetDisconnected` via CDP `Fetch`.
  - Verified:
    - discover lists events while categories fail
    - EventDetail first-load failure shows the retry state, and Try again
      recovers once requests succeed
    - the profile tab keeps its stats and joined events with a "Couldn't
      refresh your profile" toast after an offline refocus
    - saved events keep both rows after an offline refocus
- **Not done in step 0:** the event-create idempotency key and photo dedupe
  (DB, step 9, prepared later under `supabase/pending/`). The EditEvent
  reschedule re-send moves to step 6.

### Step 1: connectivity foundations (2026-11-05)
- **`utils/networkErrors.ts`:** `classifyError` → `network | timeout |
  server | client | unknown`, plus `isConnectionError`, `isRetryableError`
  and `connectionErrorMessage`. If the server answered (an HTTP status or a
  PostgREST / Postgres code), it is never classed as a connection error,
  whatever the text says. The auth stress test caught an early version
  that read a 500 "dial tcp … connection refused" body as "you're
  offline".
- **`utils/connectivity.ts`:** a pure reducer plus a small store
  (`online | offline | degraded`):
  - offline = the device reports no connection
  - degraded = ≥2 connection failures in 30 s with no success since; it
    clears on the next success or once the failures age out
  - coming back from offline starts clean
- **`utils/timeoutFetch.ts`, wired as the Supabase `global.fetch`:**
  - REST, RPC, auth and storage requests time out after 12 s (60 s for
    storage uploads). The timer stops once headers arrive, so body reads
    are never cut off.
  - A caller's own abort passes through and is never reported.
  - Every HTTP answer reports success; network errors and timeouts report
    a connection failure.
  - Realtime (WebSocket) is unaffected.
- **`services/connectivity.ts`:**
  - NetInfo (`@react-native-community/netinfo` 11.4.1, the SDK 54 pin)
    feeds the device state. It is loaded only if `RNCNetInfo` exists, so a
    dev client built before this change keeps working, from request
    outcomes alone (degraded, never offline), until it is rebuilt.
  - The Google reachability probe is off.
  - React Query `onlineManager` follows the store (degraded counts as
    online).
  - `useConnectivity()` hook.
- **React Query defaults:**
  - `networkMode: 'offlineFirst'`, so requests are always tried and a
    first load can't sit "paused" on a spinner
  - `retry: shouldRetryQuery` (`utils/queryRetry.ts`): connection errors
    and 5xx only, at most 2 retries, never timeouts, never while offline
  - EventInsights and the calendar hook use the same rule
  - React Query refetches active queries on reconnect
- **`components/OfflineBanner.tsx`:**
  - a compact pill under the status bar that ignores touches
  - copy: "You're offline · Showing what's already loaded" / "Weak
    connection · Some things may not load" / "Back online" for 2 s
  - announced to screen readers
  - toasts stack below it while it is up
- **`notify.backgroundError`:** used for every "Couldn't refresh …" toast
  from step 0 and stays quiet while the banner is up. `notify.error` is
  unchanged for things the user explicitly did.
- **Connection-aware copy:**
  - RSVP gets `OFFLINE` / `TIMEOUT` codes; a timeout re-reads the event,
    because the write may have landed
  - auth screens catch `AuthRetryableFetchError` and timeouts
  - auth links that fail offline no longer say "may have expired"
  - EventDetail leave / waitlist / save / follow / report and BusinessDetail
    follow say "You're offline" when that's the cause
- **Offline behaviour:** discover skips map-pan reloads while offline and
  reloads the visible area once on reconnect (also recovering a first load
  that failed offline). EventDetail's 20 s count poll pauses while offline.
- **Tests:** `tests/connectivity.test.ts` (26) covers the classifier,
  reducer, store timers, timeout fetch, retry rule and copy.
- **Runtime check (web, no database; same CDP harness as step 0):**
  - DevTools offline emulation shows the offline banner; the profile keeps
    its data on refocus, with no toast
  - on reconnect, "Back online" shows, then hides
  - requests failing while the device is connected → "Weak connection";
    the next success clears it
  - an event request that never answers fails at ~12 s with "Couldn't load
    this event" instead of spinning
- **Needs a native rebuild** (dev client / EAS) for NetInfo's offline
  detection on iOS / Android. Not verified on a device yet.

### Step 2: offline startup (2026-11-05)
- **Stay signed in when the refresh can't reach the server**
  (`contexts/AuthContext.tsx`):
  - If `getSession()` hasn't settled within 6 s (offline, supabase-js
    retries the refresh for ~25 s), or fails with a retryable error
    (network / timeout / 5xx), the app continues on the session
    supabase-js stored (`authService.readStoredSession`).
  - New `sessionStale` flag. It clears on `TOKEN_REFRESHED`, which is
    nudged on reconnect / foreground and on the retry screen's Retry, as
    well as by supabase-js's own 30 s ticker.
  - Only a real `SIGNED_OUT`, or a rejected session at startup, signs the
    user out. `INITIAL_SESSION` with null (what supabase-js emits when the
    refresh fails offline) no longer clears the user.
  - `supabaseStorageKey` is set explicitly, with the same value as the
    supabase-js default, so existing stored sessions are still found.
- **No account reads while the session is unverified.** When it can't
  refresh, supabase-js sends requests with the anonymous key, and an
  anonymous profile read can come back empty, which would route an
  onboarded user into onboarding. So while `sessionStale` is set:
  - profile, business and premium loads use device snapshots only and run
    once the session is verified
  - with no profile snapshot (first offline start on this device), the
    retry screen shows, never the welcome screen and never onboarding
- **Device snapshots** (`services/offlineSnapshots.ts`, pure parsing in
  `utils/offlineSnapshot.ts`):
  - AsyncStorage, keyed per user / business, versioned, owner-checked
  - profile + ban flag (onboarded profiles only), business (or "no
    business"), premium plan / subscription / event count
  - shown at once on every start and refreshed in the background, so
    business users keep business mode and the Create tab offline, and
    premium hosts aren't dropped to free-tier limits
  - cleared on sign-out, on `SIGNED_OUT` and when the startup session is
    rejected. That last case reads the user id from
    `storedSessionAtLaunch`, captured before the client's own startup
    refresh can remove it.
- **Profile load:** a failed ban check keeps the last known value instead
  of failing the whole profile (bans are enforced by RLS; the flag only
  gates UI). A failed refresh keeps an onboarded profile and marks it
  `profileStale`.
- **Auto-retry** of a stale / failed profile, business and premium load
  once the session is verified, on reconnect and on foreground. It never
  runs while offline and never loops; an attempt already in flight isn't
  duplicated.
- **Retry screen** (`app/index.tsx`): offline copy "We'll try again as soon
  as you reconnect."
- **Push taps:** queued while the profile can't load (signed in +
  `profileError`) and opened once it does, instead of being dropped.
- **Considered and rejected:** redirecting the welcome screen when a
  session appears. Welcome stays mounted under login / reset-password, so
  it could race login's deep-link `redirectTo` or pull a user out of a
  required password reset. It is also unnecessary now: with the stored
  session restored, the "stuck on welcome after a late refresh" case can't
  happen.
- **Tests:** `tests/offlineSnapshot.test.ts` (10): round trip,
  other-user / other-version / malformed rejection, the un-onboarded
  guard, business ownership, stored-session parsing including the legacy
  wrapper.
- **Runtime check (web, no database; CDP fixtures incl. `/auth/v1/token`):**
  1. An online start saves the profile and business snapshots.
  2. Cold start with an **expired token and every request failing**: tabs
     at ~6.3 s with the saved profile and the Create tab, and the stored
     session kept.
  3. On reconnect, the token refreshes, the profile is re-fetched and the
     stored session gets a future expiry.
  4. No snapshot + expired + offline: retry screen, no profile request
     sent while unverified; Retry verifies the session and opens the tabs.
  5. Revoked refresh token (400 `invalid_grant`): signed out to welcome,
     with the stored session and device snapshots removed.

  The step 1 suite still passes. The step 0 "refresh toast" check now
  expects the banner instead, as designed in step 1.
- **Known limitation:** other screens' own queries can still go out with
  the anonymous key if a refresh attempt fails while the very next request
  gets through (a flaky moment, not "offline"). They show empty or error
  states rather than wrong-account data, and recover on the next refresh.
  Steps 3-4 (persisted cache, no error-over-data) soften this further.

### Step 3: persisted cache and screen-state rule (2026-11-05)
- **Packages:** `@tanstack/react-query-persist-client` and
  `@tanstack/query-async-storage-persister`, both pinned at **5.90.24**,
  which matches the installed `react-query` 5.90.21 / `query-core`
  5.90.20, so query-core resolves to a single copy. The newer 5.90.25+
  require react-query 5.91.
- **`utils/queryPersistence.ts` (pure):**
  - Only queries with `...PERSISTED_QUERY` (`meta.persist`) are saved.
  - Queries are saved whenever they have data, not only on "success". A
    refetch that fails offline sets an error status, and since every save
    rewrites the whole cache, a success-only rule would delete the copy
    exactly when it's needed.
  - Stored queries are normalized to plain cached data (no error, idle, no
    promise); mutations are never stored.
  - Infinite lists keep their first 3 pages. A 1.5 M-character budget
    drops the oldest queries first.
  - 7-day max age. The buster is the app version + `CACHE_SCHEMA`.
- **`PERSISTED_QUERY` also sets `gcTime` to 7 days,** and restored queries
  get it through `hydrateOptions`. Otherwise React Query would drop an
  unused list from memory after 5 minutes and the next save would erase it
  from storage too.
- **`services/queryCache.ts` + `components/QueryCachePersistence.tsx`:**
  - one AsyncStorage entry per user (`eventmap.queryCache.<uid>`), with
    saves throttled to 2 s
  - queries wait (`IsRestoringProvider`, at most 1.5 s) while the user's
    cache restores, so an offline start doesn't flash an error before the
    saved rows
  - writes go through a gate that closes on sign-out, so a throttled save
    can't write the previous user's data back after it was removed
- **Account isolation:** a sign-out or account switch now runs
  `queryClient.clear()`. Before this, the in-memory cache survived
  sign-out, and keys like `['events','saved']` carry no user id, so the
  next account could briefly see the previous one's saved list. The stored
  copy is removed by `clearOfflineSnapshots` (sign-out, `SIGNED_OUT`,
  rejected startup session).
- **Screen-state rule** (`utils/screenState.ts`, `hooks/useScreenState.ts`,
  `components/ui/QueryStates.tsx`):
  - data, whatever the connection → content / real empty state
  - no data: restoring → loading; offline → "You're offline · This will
    load when you reconnect."; failed → error + Retry; else loading
  - a freshness note shows above data only when it may be out of date:
    "Offline / Weak connection / Couldn't refresh · Updated 3 h ago"
- **Applied to:**
  - Saved Events and Joined Events (incl. attendance counts): persisted,
    with the screen-state rule. Their subtitles say "Not loaded yet"
    instead of "0 events" when nothing has loaded.
  - Calendar (range and fallback list queries): persisted, and the hook
    now reports `hasData` / `dataUpdatedAt`. "Nothing selected" is checked
    first, since with no source selected nothing is fetched. Query data is
    JSON-safe; the `Date` fields are on derived occurrences only.
- **Tests:** `tests/queryPersistence.test.ts` (13) covers the persist rule,
  normalization, page trim, budget order, the screen-state resolver and
  freshness copy.
- **Runtime check (web, no database; private harness directory and
  ports):**
  - lists are written to the device cache online
  - after a restart with every request failing, Saved / Joined / Calendar
    show their cached rows with "Weak connection · Updated just now",
    which switches to "Offline · …" on DevTools offline
  - failed refetches don't erase the stored copy
  - no cache + offline → "You're offline"; reconnect loads the list
  - a rejected session or a UI sign-out removes the cache, and nothing is
    written back after the throttle window

  The step 1 and step 2 suites pass unchanged (51/51 overall).
- **Follow-up noticed:** the step 1 offline banner floats over screen
  headers (it covers the "Saved Events" title while up). Consider placing
  it below the header area or adding top padding while it shows.

### Step 4: main screens on the device cache (2026-11-05)
- **Event pages** (`screens/EventDetail.tsx`):
  - The screen keeps its own `details` state (a dozen optimistic RSVP /
    save / follow updates rely on it) and mirrors it into the persisted
    entry `['event','details',id]` (`setQueryDefaults` in
    `app/_layout.tsx`). The 30 most recent events are stored
    (`PERSIST_LIMITS`).
  - On open, the page starts from the stored details. Failing that, it
    builds a **preview** from any cached list row for the event
    (`utils/eventPreview.ts`: discover area, saved, joined, calendar,
    profile).
  - A preview is labelled "Saved summary · Full details load when you
    reconnect". RSVP, leave, waitlist, save, follow and report refuse with
    a connection message until the real details load. The venue map is
    hidden when coordinates are unknown (calendar rows), and the category
    pill is hidden when its label is unknown.
  - A deleted event (`null` details) is removed from the cache. The
    freshness note shows when stored details may be out of date.
- **Profile tab:** one persisted query, `['events','profile',uid,bid]`
  (under the `events` prefix, so RSVP / save invalidation refreshes it), in
  place of the manual focus loader.
  - Ended events are filtered at render time, since cached rows can be days
    old.
  - Chat badges are best-effort, refreshed on focus, and keep their last
    value on failure.
  - Offline with nothing cached shows the offline state; otherwise the
    freshness note.
- **Notifications:** the first page and unread count are mirrored into
  `['notifications',uid]` (with realtime and read / dismiss changes) and
  seeded on open. Timestamps are revived to `Date` on restore. The
  "Couldn't refresh" toast is replaced by the freshness note.
- **Discover:**
  - **Last area:** after each successful *unfiltered* first page, the map
    centre and up to 50 events are stored (`utils/discoverSnapshot.ts`).
    Filtered results aren't stored, since Discover always starts
    unfiltered.
  - **Opening on it:** Discover opens on that area with its pins and list.
    The real location (profile / GPS) loads first, and the map only moves
    there if that load works, so pins and list always match. A failed
    real-location load is retried on reconnect, unless the user has panned
    since.
  - **Full migration not done:** moving Discover to `useInfiniteQuery` was
    judged too invasive for this step (1,700 lines of map / paging state);
    the snapshot gives the same offline result.
  - **Categories:** `hooks/useCategories.ts`, persisted, 24 h fresh, shared
    with create / edit forms. There's no bundled fallback list:
    `constants/categories.ts` only maps slugs to colours, and filtering
    needs the database ids.
  - **Banners:** persisted query.
- **Two issues found by the runtime check and fixed:**
  - *Lost saves.* Saves are throttled to 2 s, so leaving the app (or
    reloading a web page) within 2 s of loading something dropped that
    save. `services/queryCache.ts` now writes straight away when the app
    goes to the background or the tab is hidden (only after the restore
    finished, so an empty cache can't overwrite the stored one).
  - *Screens opened before the restore finished* (cold start, deep links,
    web reloads) read an empty cache. Event pages, notifications and
    Discover now adopt the restored data when restoring ends, if nothing
    has loaded by then.
- **Tests:** `tests/offlineScreens.test.ts` (9): row lookup across list
  shapes, preview building incl. sparse rows, Discover snapshot rules,
  recent-events cap.
- **Runtime check (web, no database):**
  - visit online, then restart with every request failing
  - Discover opens on the saved area with chips and the note
  - an opened event shows full details with the note
  - a never-opened event opens as a labelled preview, and Save is refused
    without sending a request
  - notifications and the profile tab show cached data with the note
  - back online, Discover fetches fresh events

  19/19 here; steps 1-3 still pass (12 + 20 + 19).
- **Other issues noticed (not fixed):**
  - The connection banner also draws over the branded splash screen
    (cosmetic, same fix as the header overlap above).
  - The profile query key includes the business id, so a business user
    briefly gets a second cached entry under `none` while their business
    loads. It is harmless (bounded, expires) but wasteful.
  - Banner images and event covers still need the network (expo-image,
    step 8). `AppBannerCarousel` shows text over a blank area offline.
  - Previews have no links, photos, reviews or waitlist state by design.
  - **Test environment:** another local session uses similar `/tmp`
    paths, ports and even reused this session's private harness directory
    and Chrome profile. Chrome hands a second launch on the same profile to
    the running instance, so results mixed. Runtime checks now use a fresh
    random directory and random ports per run.

### Step 5: remaining screens (2026-11-05)
- **UserProfile:** one persisted query per profile,
  `['user-profile', id, own|public]`, returning profile / private /
  missing, upcoming events and block status.
  - Block / unblock still update local state; a fresh server value wins.
  - Ended events are filtered at render time.
  - Offline with nothing cached: offline copy; otherwise the freshness
    note.
- **BusinessDetail:** one persisted query per page, `['business-page', id]`.
  - Optional sections that fail keep their previous cached values.
  - The page bundle is copied into the existing local state, which follow
    and review actions keep updating. A follow also updates the cached
    entry, so an offline reopen shows it.
  - The spinner covers the one render where data is fetched but not yet
    copied (avoids a "Business not found" flash).
- **MyEvents:** each tab's first page is mirrored into
  `['events','mine',bid,scope]` (persisted via `setQueryDefaults`) and
  seeded on the first visit to a tab; the focus loader also reruns when the
  restore finishes. Paging, request sequencing and cancel / duplicate
  reloads are unchanged. The "Couldn't refresh" toast is replaced by the
  freshness note, plus an offline state when nothing is cached.
- **Followers / Following / Blocked users:** not persisted (per plan).
  - They show the offline state when nothing loaded.
  - Followers / Following subtitles say "Not loaded yet" instead of "0".
- **Caps:** visited user profiles and business pages are capped at 20
  stored entries each (`PERSIST_LIMITS`), like event details (30).
- **Runtime check (web, no database):**
  - visit online, then restart with every request failing
  - a visited profile, business page and My Events open from the cache
    with the freshness note
  - Followers offline with nothing cached shows the offline state

  11/11; steps 1-4 still pass (12 + 19 + 20 + 19 = 81/81 overall).

### Step 6: writes (2026-11-05)
- **Write queue** (`utils/pendingWrites.ts` pure, `services/pendingWrites.ts`,
  `components/PendingWritesSync.tsx`):
  - **What it stores:** the latest *intent* per target, not a call log.
    Kinds: `save`, `follow`, `notificationRead` (`*` = all) and
    `notificationDelete`. Saving then unsaving offline leaves one "unsave";
    a dismiss replaces a pending read-mark, and mark-all replaces every
    read-mark.
  - **Why replay is safe:** every call behind it is idempotent (23505 is
    treated as success; deletes and read-marks repeat harmlessly).
  - **`runOrQueue(write)`:** offline → queue without sending; a
    connection failure → queue; a server refusal → reject (the caller
    rolls back as before). A direct success also clears an older queued
    intent for the same target. `runOrQueueWithNotice` adds "… on this
    device. It will sync when you're back online." for saves and follows.
  - **Storage:** per user (`eventmap.pendingWrites.<uid>`), entries expire
    after 7 days, and the queue is removed with the other device data on
    sign-out. Sign-out first tries to send it (returns at once offline).
  - **Replay:** at sign-in, on reconnect and on foreground — never while
    the session is unverified (anon key → refused). Oldest first; it stops
    at the first connection failure, drops refusals (with a "Couldn't
    save …" message), and drops other failures after 5 attempts. Afterwards
    the affected caches are invalidated (attendance lists, event details,
    business pages, notifications).
  - **Wired into:** EventDetail save / follow, SavedEvents unsave + undo
    (re-read only when sent; a queued undo restores the row locally),
    BusinessDetail follow, Following unfollow, the notifications tab read /
    read-all / dismiss, and the push-tap read-mark.
  - **RSVPs are never queued** (decision 1). A test asserts the queue has
    no RSVP kind.
- **Offline gate** (`utils/requireOnline.ts`, `blockedOffline(action)`):
  "You're offline. Connect to …" without sending. Used for RSVP / change
  RSVP / join and leave the waitlist / leave / review / report on event
  pages, report and block on profiles, avatar upload, and publish / save
  in create and edit (whose copy says the form is kept on the device).
- **Local drafts** (`utils/formDraft.ts` pure, `hooks/useFormDraft.ts`):
  - Debounced autosave. Dates are revived on restore. Only images that
    survive a restart are kept (uploaded or `file:` / `content:` URIs;
    `blob:` / `data:` are dropped). Drafts expire after 14 days.
  - Nothing is written until the screen has decided whether to restore
    (otherwise a "not dirty, remove" could delete the draft first).
  - **Create:** per user. Restored with "Restored the event you were
    writing · Start over"; cleared on publish / save-as-draft or Start
    over.
  - **Edit:** per user + event, tied to the event's `updated_at`, so it is
    never restored over newer edits. Restored with "Restored your unsaved
    changes · Discard"; cleared on save, Discard, or confirming "Discard
    changes?".
- **EditEvent re-send fix:** each step that succeeds (reschedule, update,
  capacity) is folded into `originalEvent` (the row every save diffs
  against). After a partial failure, saving again sends only what's still
  missing: no second "rescheduled" notice, and no repeat confirm dialog.
- **Tests:** `tests/offlineWrites.test.ts` (15):
  - queue rules, replay outcomes, parsing, copy
  - `runOrQueue` / flush against a fake backend: direct send, offline
    coalescing + replay, connection-failure queueing, refusal rejection,
    flush drop / stop, per-user queues
  - drafts and the RSVP guard
- **Runtime check (web, no database):**
  - an offline save on an event page is queued (message shown, button
    flips, nothing sent, intent stored)
  - an offline RSVP is refused with the connect message and nothing sent
  - on reconnect, the queued save is sent and the queue cleared
  - a create-form draft survives a reload and is restored
  - offline publish is refused with the "form is kept" copy and the draft
    stays

  14/14; steps 1-5 still pass (95/95 overall).

### Step 7: chat and notification backfill (2026-11-05)
- **Safe re-send in one place** (`services/eventChat.ts` `sendMessage`):
  when an insert fails for any reason other than the connection, the
  message is looked up by its client id, and if it exists that's success.
  This covers both the unique violation and the slow-mode / rate-limit
  triggers that run before the primary-key check. Done in the service, not
  in the screen, so manual and automatic retries share it. Costs one extra
  read only after a failure.
- **Outbox per room** (`utils/chatOutbox.ts` pure;
  `eventmap.chat.outbox.<uid>.<eventId>`):
  - holds the composer draft (with its mentions) and unsent messages,
    written debounced
  - messages that failed for lack of a connection carry `autoRetry` and
    show "Waiting for connection · tap for options"
  - offline, sending doesn't even try the request
  - messages that were mid-send when the app stopped come back as waiting
  - entries older than 24 h are dropped instead of re-sent
  - waiting messages are re-sent after the room loads online and when the
    connection recovers (from offline *or* weak); their ids make repeats
    harmless
  - a server refusal keeps the existing handling (text back to the draft
    with an explanation)
- **Recent rooms offline** (`['chat','room',id]`, 5 rooms via
  `PERSIST_LIMITS`): the newest 50 server messages plus details and post
  status are mirrored.
  - Offline, or when the room can't load, it opens from that copy with
    "Offline · Showing saved messages. New ones send when you reconnect."
    The composer stays usable (messages queue).
  - On recovery the room reloads for real and re-sends.
  - Room loads keep any local unsent messages instead of replacing them,
    and a failed load with nothing cached keeps them too.
- **Found while testing:** after an offline start the signed-in user is
  known only after the ~6 s startup fallback. The first version read the
  outbox before that and cached "nothing", and its mirror could then
  delete the stored outbox. The outbox now restores in its own effect once
  the user is known, and is only written after that restore.
- **Notifications backfill:**
  - `subscribeToNotifications` reports `onResubscribed` when the channel
    rejoins after a drop
  - the notifications tab and the badge reload on it, and also on recovery
    from offline
  - queued read / dismiss intents are overlaid on freshly loaded rows
    (`overlayNotificationWrites`), so a dismissed notification no longer
    flashes back before the queue replays (step 6 issue)
- **Privacy fix:** sign-out now also removes chat outboxes and the event
  form drafts from step 6, which weren't cleared before. These are keys
  with one entry per item, found by prefix.
- **Tests:** `tests/offlineChat.test.ts` (11) covers outbox build / parse /
  auto-retry / merge / keys, the notification overlay, and the
  `sendMessage` re-send rules against a fake client (slow-mode +
  stored = success, slow-mode alone = error, connection failure =
  rethrown).
- **Runtime check (web, no database):**
  - the room loads and is cached
  - an offline send shows "Waiting for connection", nothing is posted, and
    the message and draft are stored
  - a restart with requests failing opens the cached room with the banner,
    the unsent message and the draft
  - back online, the message is posted exactly once and the banner and
    waiting state clear

  14/14; steps 1-6 still pass (123/123 overall).

### Step 8 (no-dependency part) and final regression pass (2026-11-05)
**Step 8, done without installs:**
- **Map unavailable overlay.**
  - The Leaflet page emits `mapUnavailable` (reason `tiles`) after 3
    failing tiles and `mapAvailable` when a tile loads again.
  - The Google page emits `mapUnavailable` on a failed SDK script
    (`onerror`) or a refused key (`gm_authFailure`).
  - The WebView's own `onError` counts too.
  - `GoogleMapView` shows a small pill that ignores touches: "Map images
    can't load right now. Pins still show." / "The map can't load right
    now. Events are still listed."
  - `MAP_HTML_VERSION` bumped to 9. Parity tests cover both pages.
- **Image fallbacks** (`hooks/useImageFallback.ts`): event covers
  (carousel), list thumbnails and banners fall back to their existing
  placeholders when an image fails; the photo viewer shows "This photo
  can't load right now."
- **Not done (needs installs or downloads):** expo-image disk cache and
  prefetch, the vendored Google markerclusterer (`scripts/vendor-map.mjs`
  downloads it). Location fallback and remembering the last map area were
  already covered in steps 0 and 4.

**Final regression pass.**
- **Coverage:** 547 unit tests, typecheck and lint diff are clean. The web
  harness (isolated, no database: fake backend over CDP, OSM tiles
  intercepted too) now starts every suite on a fresh Chrome profile.
  145/145 checks across 8 suites; the new final suite (F0-F8) covers:
  - first load on a fresh browser
  - every cached screen online, and the storage size (~17 K chars, budget
    1.5 M)
  - broken cover fallback and the map overlay
  - a full "offline day": expired token, nothing reachable, every screen
    usable, a save and a chat message queued
  - restart while offline
  - reconnect: refresh, then everything sent exactly once, with no
    wrong-session reads
  - sign-out removing every key for the user, and a second user not seeing
    the first user's data
  - corrupted device data at startup
- **Bugs found and fixed:**
  1. **Blank page on first load (regression from step 4).** Discover now
     mounts with saved markers, which are injected into the map iframe
     before its document has a body. The throw unmounted the whole app.
     Injection is skipped until then; `mapReady` re-injects.
  2. **Taps ignored for the first seconds of an offline cold start**
     (deep links). The stored session was applied only after the 6 s
     startup wait. When the device is known offline it now applies at
     once (a tap works about 2.5 s after start).
  3. **Saves made while the session is unverified** waited on supabase-js's
     token-refresh retries (about 25 s) before being queued, and were lost
     if the app closed meanwhile. They're queued at once now
     (`setPendingWritesSessionVerified`).
  4. **Chat on an expired token + failing connection** sat on "Loading
     chat…" for the same ~25 s. The saved room now shows right away
     (provisional, replaced by the live load), including after a late
     cache restore. Sends wait until the session is verified.
- **Test-only fixes:** a warm-up for the first navigation (no longer
  needed after fix 1, kept for timing), a non-host event fixture, and the
  phase 1 timeout check moved to an uncached event (listed events open as
  saved summaries since step 4, by design).
