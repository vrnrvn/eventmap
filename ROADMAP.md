# EventMap roadmap

This is ongoing product work. Estimates exclude the local setup already implemented.

| Planned work | Deliverable | Estimate |
| --- | --- | --- |
| Chat reliability | Subscribe-before-fetch, reconnect recovery, pagination, focused-screen cleanup | 5-7 h |
| Chat moderation | Reporting, host moderation, server send limits, ban enforcement | 5-7 h |
| Profile and attendance | Refresh on focus, upcoming/history separation, remove remaining mock cards | 3-5 h |
| Workflow coverage | Signup, onboarding, creation, RSVP, two-user chat, leave-event tests on web/native | 5-7 h |
| Authorization review | Profile/admin field restrictions, RPC privacy, ownership and storage policies | 4-6 h |
| Dependency maintenance | Review npm advisories, compatible upgrades, native build verification | 4-6 h |
| Provider/accessibility polish | Production tile configuration, global geocoding, screen-reader and small-screen checks | 4-6 h |

Original estimate: approximately 30-44 hours for the items above, before recent
work; their current status and remaining effort need review.

## Shipped since this roadmap was written

Status verified 2026-11-14. The remaining work for each is tracked in
`docs/ISSUES.md` and `docs/REVIEW_AND_ROADMAP_2026-11-14.md`, not here.

- **Host analytics** — built. `screens/EventInsights.tsx`, business analytics,
  `get_event_insights` / `get_business_analytics` (`20261104100000`, applied).
  Plan and open items: `docs/ANALYTICS_AND_CALENDAR_PLAN.md`.
- **Personal event calendar** — built. `screens/Calendar.tsx`, `app/calendar.tsx`,
  `get_user_calendar` (`20261104110000`, applied). Open: a `webcal://` feed and
  a device run of `.maestro/calendar.yaml`.
- **Offline and poor-connection UX** — built, steps 0-8 of
  `docs/OFFLINE_PLAN.md` (connectivity layer, persisted cache, pending-write
  queue, chat outbox). Verified on web only; never on a device. Note: RSVPs are
  deliberately **not** queued offline (plan §6 decision 1), contrary to the
  original wording of this entry.
- **Event collections** — Phases A-F built 2026-11-12; migration
  `20261112100000` applied. Remaining: the §6-§7 product decisions and the
  §8 steps 3-6 verification. `docs/EVENT_COLLECTIONS_PLAN.md`.
- **Host event playbook** — P1-P7 built 2026-11-13; both migrations
  (`20261113100000`, `20261113110000`) applied. Remaining: type regeneration
  and a real-device pass (P8). `docs/HOST_EVENT_PLAYBOOK_PLAN.md`.
- **Host onboarding** (not previously listed here) — Stages 1-7 built
  2026-11-10; all eight `20261110*` migrations applied. Remaining in
  `docs/HOST_ONBOARDING_PLAN.md` §18-§20: appeals queue, verified badge on
  Discover cards, transfer of ownership, Stage 8 growth.

## Additional ideas

- **Host workflow UI review:** keep `scripts/fake-backend-e2e/suiteHostUi.mjs`
  green as host screens change (labels, 44 px targets, 320 px layout,
  host-type wording), and extend it to large widths, font scaling and native.
- **Discovery modes:** "Surprise me", "My neighbourhood" and "Just added"
  browse modes on Discover, built on the ranked-events RPC and the browse
  centre. Planned in `docs/DISCOVERY_MODES_PLAN.md` (20-30 h; 15-22 h without the
  server sort change). Proposal only — nothing built, and the six decisions in
  §6 are open.
- **Host tools Phase 4:** attendee check-in + QR, CSV export, event sections
  and co-hosts (`business_members`). `docs/HOST_TOOLS_PLAN.md` §11.

These ideas have not yet been scoped or estimated. Hosted deployment, production
payments, device push, and store releases remain separate decisions.
