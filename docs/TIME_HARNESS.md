# The time-simulation harness (2026-11-18)

How events are tested before, during and after they happen — roadmap phase 3,
built as **approach A**: on the SQL side the *event* moves, never the clock;
on the browser side the *clock* moves, never the event. Together they cover
both directions, and each documents the other as its twin.

Researched alternatives and why they lost (2026-11-18 research): a server-side
clock override (`app_now()`) would put test plumbing inside ~15–20
`SECURITY DEFINER` production functions and two RLS policies; faking the
container's clock with an LD_PRELOAD layer is unverified on the Nix-based
Supabase image and gives up single-transaction isolation. Either can still be
added later without undoing this.

## SQL half — `scripts/test-lifecycle.sql`

A self-contained suite (the repo convention: the runner copies exactly one
file into the container) that walks one event through its life **in order**
and calls the scheduled jobs directly at every phase — pg_cron never runs in
isolation. `pg_temp.set_phase(ev, phase)` is the canonical helper; new suites
copy it rather than importing it.

| phase      | start / end relative to now()  | aligned to                              |
| ---------- | ------------------------------ | --------------------------------------- |
| `before`   | +2 days                        | no window — the jobs must stay silent    |
| `dayof`    | +3 h                           | host day-of notice, (+2 h, +4 h]         |
| `reminder` | +60 min                        | going reminder, pref 60 ± 5 min          |
| `live`     | −dur/2 … +dur/2                | mid-event                                |
| `ended`    | end at −3 h                    | host post-event summary, [−26 h, −2 h)   |

Run it (unique container name — a sibling session shares this Docker host):

```sh
PG17_NAME=<unique> scripts/pg17-isolated.sh init
PG17_NAME=<unique> scripts/pg17-isolated.sh apply scripts/test-lifecycle.sql   # just this suite
PG17_NAME=<unique> scripts/pg17-isolated.sh suites                             # all 15
PG17_NAME=<unique> scripts/pg17-isolated.sh destroy
```

What it pins, beyond the phase mechanics ([0]): the jobs fire **inside** their
windows and only there, and once per cron run, not per invocation ([1]–[5]);
joining closes at the END of an event, not its start; attendance appears
exactly when the event is over; a stranded join request is swept and the
requester told (EJ-18); `reschedule_event` stamps `rescheduled_at` while
`set_phase` — test plumbing — does not ([6]); per-session series attendance
counts only sessions whose end has passed, per person (EJ-16, [7]).

**The known limit (by design):** Postgres' `now()` is frozen for the whole
transaction, so no single row ever truly crosses a boundary while being
watched. "Time passes" is only real in the browser half.

**Verified honest:** a mutation test (expectation [7.1] flipped to a wrong
value in a scratch copy) fails loudly with the actual value in the message.

## Browser half — the clock in `scripts/fake-backend-e2e/`

- `lib.mjs` → `open({ clock: true })` injects an **offset clock** before any
  app code: `Date` reports a shifted "now", timers and animations keep
  working, and the offset survives reloads (it lives in `localStorage`, and
  the seed script re-runs per document). Drive it with `h.clock.set(iso)` /
  `h.clock.advance(ms)`; both take effect on the next document load, which is
  also how a real device clock change reaches a cold page.
- `fakebackend.mjs` → `get_ranked_events` now **derives** `has_ended` from the
  row's own dates at request time, so a suite that moves an event's dates can
  no longer disagree with the server flag it hand-patched before.
- `suiteLifecycle.mjs` — one 2-hour event with fixed dates; **only the clock
  moves**: joinable two days early (L1), the minute-precise "Starts in 40 min"
  (L2), "Happening now" mid-event with the chat row still offered (L3), the
  ended page with join gone, the review offered and the chat row reading
  "Chat open until <day>" (L4 — D1's 7-day posting window, 20261118150000),
  the end passing **under an open page** (L5): stale until a reload — EJ-12's
  open gap, pinned as documentation, not as desired behaviour; flip that check
  when an in-page clock lands — and 8 days after, past the window (L6): the
  row reads closed, the chat screen keeps the history with a "closed on <day>"
  notice and no composer. L6 sets the fixture flag `data.chatPostClosed`
  because the fake's router runs on the real clock and cannot see the page's
  virtual one. L7 (not time-driven, but the "after" stage) runs an ended
  event again through duplicate_event v2 and pins the idempotency key.

```sh
scripts/fake-backend-e2e/run.sh suiteLifecycle        # 39 checks (L1–L7)
```

The session token is minted a week long (`expOffsetS`) so the clock walk
cannot out-travel it. The Node-side fake backend keeps the real clock; it
never needs the page's offset because the flags it serves are derived from
the fixtures' dates.

## What this harness still cannot do

- Reminders/notices firing exactly once **across** a boundary in SQL (frozen
  `now()`); the once-per-run dedupe *within* a phase is covered.
- The pg_cron scheduler itself (stubbed in isolation; the job *functions* are
  called directly).
- A server that genuinely lives through time — that is the LD_PRELOAD /
  container-clock spike, deliberately deferred.

## Pinned clock for time-of-day-sensitive scenarios (2026-11-19)

Scenarios whose fixtures sit a few hours from the real "now" used to pass or
fail by the hour they ran: Attendee A6/A7 (UTC date change), Rehearsal V12
(after 21:00 UTC) and Collections K12 (late local evening, calendar day). They
now pin the page clock to a fixed time of day and date their fixtures from the
same instant — `lib.mjs`: `noonUtc()` / `noonLocal()`, `isoFrom(t, h)`,
`PINNED` (clock + a 90-day session), `pinClock(h, t)` before loading the page
under test. Use this for any new scenario that places events within hours of
now.

`PIN_DATE=YYYY-MM-DD` moves the pinned day, to prove a scenario no longer
depends on when it runs. Verified 2026-11-19: A6/A7/V12/K12 pass on today,
2026-11-30, 2026-12-31, 2026-11-01 and 2027-03-14 (US DST changes, month and
year ends); full suites Attendee 39/39, Rehearsal 108/108, Collections 168/168.

**Seeded dates (2026-11-20).** Pinning the page clock was not enough on its
own: the fake's `makeData` gives `ev[0]` a cancelled date, a moved date and a
per-date RSVP dated from the REAL clock. A pinned scenario that re-dates
`ev[0]` as a series inherited them, so at some real hours the "cancelled"
date landed on a pinned session (A7 failed at 01:56 UTC with 4 dates instead
of 5). `clearSeededDates(h, eventId)` in `lib.mjs` drops them; A6, A7, V12 and
the accessibility scenario N call it. Use it in any pinned scenario that
re-dates an event as a series.
