# Fake-backend browser E2E (no database)

Headless-Chrome end-to-end checks of the signed-in app with **no database
access**: the web export targets a dead address (`127.0.0.1:9`) and every
request to it is intercepted over the Chrome DevTools Protocol and answered
from an in-memory fake (`fakebackend.mjs`). `run.sh` refuses to run if the
bundle references a real backend. Each scenario uses a fresh Chrome profile
and random free ports.

```sh
scripts/fake-backend-e2e/run.sh              # all suites (~15 min)
scripts/fake-backend-e2e/run.sh suiteB B3,B5 # selected scenarios
```

Requires Google Chrome at the default macOS path.

| Suite | Covers |
|---|---|
| A | Signed-in cold start request profile; persisted cache (byte cap, normalization); full offline restart from cache; oversized (2.7 MB, non-ASCII) and corrupt stored caches; expired token offline; image thumbnails + fallback |
| B | Notifications paging + failure/Retry; Saved paging + Retry; EventDetail focus freshness + write invalidation; live count poll (table missing → fallback, present → light path); chat composer (counter, @mentions, send/clear, slow mode, draft restore); Following; business mode (derived premium, Manage event); 320 px / 1280 px viewports; sign-out clears device data |
| C | Stress: 5,000 notifications, 400 events, chat history paging, rapid tab hopping, keystroke cost |
| D | Offline → online recovery burst; expired token refresh; refresh answered 500 keeps the user signed in and keeps queued writes (D3); refresh rejected signs out and clears that user's device data (D4); writes failed on a degraded connection replay on the next successful request (D5); no REST request carries the anon key while a signed-in session is mid-refresh (D6) |
| A11y | Accessibility (web): axe-core WCAG A/AA per screen, unnamed controls, targets under 24 px, headings, Tab order + focus ring, Escape on overlays, toast/banner live regions, map in the Tab order, 320/1280 px. Not in `run.sh` (needs axe): `node scripts/fake-backend-e2e/suiteA11y.mjs "$PWD" <dist> S,A,E,L,K,V <axe.min.js> <outDir>` |
| Host | Host onboarding Stages 1–4: Create shows "Start hosting" for non-hosts; venue guided first event (suggested preset applies nothing, preset merge, preview sheet); organiser wording and "set a place" guard; guided Publish → preview → published sheet (create payload, `event_type`, preset waitlist RPC); getting-started checklist (fresh expanded + dismiss, established collapsed, missing-RPC fallback); one-time tips (first attendee, full event, report waiting, free-plan slot, one guidance at a time); trust (restricted host, guidelines accept-and-retry, verification request); stop hosting / reopen. `node scripts/fake-backend-e2e/suiteHost.mjs "$PWD" <dist> all <outDir>` |
| HostUi | Host workflow UI review at 390 px and 320 px: labelled controls, 24 px floor / 44 px targets, headings, horizontal overflow, clipped labels, host-type wording; `HOST_UI_WIDTHS=1280,640` for wide/zoomed, `AXE=<axe.min.js>` for an axe WCAG A/AA pass. `node scripts/fake-backend-e2e/suiteHostUi.mjs "$PWD" <dist> all <outDir>` |
| Onboarding | Flow 1 as a new user: welcome → sign up → the six onboarding steps → Discover; resume after a reload; sign-in / wrong password / forgot password / confirm-email branch. `node scripts/fake-backend-e2e/suiteOnboarding.mjs "$PWD" <dist> J,R,A <outDir>` |
| Collections | Private collections (Phases B–C): home cards + counts + cover mosaic + All saved row, create / duplicate-name guard / rename / delete / reorder, detail segments and sorts drive the RPC, pinned remove + undo, smart (by-rule) rows have chips and no remove, server without the migration shows "coming soon", Profile entry + 320 px, cold deep-link back fallback, add-to-collection sheet from the event page and Saved rows (membership chips, inline create-and-add, post-save toast action), a pin on a weak connection queued → pending row → replayed; favourite a type from Category Browse (create / open / unfavourite), the "More <type> near you" rail with See all, and the create sheet's Event type mode; Repeating rows expand to their next five dates with cancelled / moved marks and the viewer's per-date Going / Not going; Saved rows' "In N collections" hint, Discover's For-you chip, the `?date=` deep link, the .ics export of a collection, an accessibility sweep of the collection surfaces, and the Calendar's Collections source including the old-backend fallback. `node scripts/fake-backend-e2e/suiteCollections.mjs "$PWD" <dist> K1,K2 <outDir>` |
| F | The offline day: expired token + nothing reachable → cached screens usable, a write queued, restart offline, reconnect sends it exactly once (F1); sign-out removes every device key for the user (F2); a second user on the device never sends the first user's token and gets their own cache key (F3) |

Fixture knobs: `makeData({ notifications, events, business, longText })`,
per-path `overrides` (inject 500s, delays, missing functions), `ctl.offline`.
Unknown endpoints are recorded in `h.unknown` so new calls show up.

Known limitation: React Native Web's inverted lists only page on real wheel
input; scroll the chat with `Input.dispatchMouseEvent` (see suite C3).
