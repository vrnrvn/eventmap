# Fake-backend browser E2E (no database)

Headless-Chrome end-to-end checks of the signed-in app with **no database
access**: the web export targets a dead address (`127.0.0.1:9`) and every
request to it is intercepted over the Chrome DevTools Protocol and answered
from an in-memory fake (`fakebackend.mjs`). `run.sh` refuses to run if the
bundle references a real backend. Each scenario uses a fresh Chrome profile
and random free ports.

```sh
scripts/fake-backend-e2e/run.sh              # all suites (~12 min)
scripts/fake-backend-e2e/run.sh suiteB B3,B5 # selected scenarios
```

Requires Google Chrome at the default macOS path.

| Suite | Covers |
|---|---|
| A | Signed-in cold start request profile; persisted cache (byte cap, normalization); full offline restart from cache; oversized (2.7 MB, non-ASCII) and corrupt stored caches; expired token offline; image thumbnails + fallback |
| B | Notifications paging + failure/Retry; Saved paging + Retry; EventDetail focus freshness + write invalidation; live count poll (table missing → fallback, present → light path); chat composer (counter, @mentions, send/clear, slow mode, draft restore); Following; business mode (derived premium, Manage event); 320 px / 1280 px viewports; sign-out clears device data |
| C | Stress: 5,000 notifications, 400 events, chat history paging, rapid tab hopping, keystroke cost |
| D | Offline → online recovery burst; expired token refresh |

Fixture knobs: `makeData({ notifications, events, business, longText })`,
per-path `overrides` (inject 500s, delays, missing functions), `ctl.offline`.
Unknown endpoints are recorded in `h.unknown` so new calls show up.

Known limitation: React Native Web's inverted lists only page on real wheel
input; scroll the chat with `Input.dispatchMouseEvent` (see suite C3).
