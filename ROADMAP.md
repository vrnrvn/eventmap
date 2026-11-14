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

## Additional ideas

- **Host analytics:** Give hosts useful event-level aggregates, such as views,
  RSVPs, waitlist conversions, and attendance trends, while respecting privacy.
- **Personal event calendar:** Show joined and interested events in an agenda or
  calendar, with conflict indicators and quick access to event details.
- **Offline and poor-connection UX:** Cache recently viewed event details and
  make failed or pending actions, including joins and messages, clear to users.
- **Host workflow UI review:** keep `scripts/fake-backend-e2e/suiteHostUi.mjs`
  green as host screens change (labels, 44 px targets, 320 px layout,
  host-type wording), and extend it to large widths, font scaling and native.
- **Event collections:** Let users organize saved events into named lists, such
  as plans for a weekend or venues to explore. Planned in
  `docs/EVENT_COLLECTIONS_PLAN.md`; Phase A (data layer) done 2026-11-12.
- **Host event playbook:** A per-event, phase-aware checklist (before
  publishing, lead-up, day of, after) that ticks itself from server facts and
  points hosts at the right tool. Planned in `docs/HOST_EVENT_PLAYBOOK_PLAN.md`
  (22-31 h; P1-P7 done 2026-11-13, only the owner's apply step remains; two
  migrations prepared and unapplied).
- **Discovery modes:** "Surprise me", "My neighbourhood" and "Just added"
  browse modes on Discover, built on the ranked-events RPC and the browse
  centre. Planned in `docs/DISCOVERY_MODES_PLAN.md` (20-30 h; 15-22 h without the
  server sort change).

These ideas have not yet been scoped or estimated. Hosted deployment, production
payments, device push, and store releases remain separate decisions.
