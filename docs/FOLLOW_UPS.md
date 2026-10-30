# Follow-ups

Concerns noticed while working on profile and attendance that were deliberately
left out of that change. Grouped by area, roughly most important first. Remove
items as they are addressed.

## Must do before merge

- **Apply the migration to the local database and run the API test.** The SQL in
  `supabase/migrations/20261029110000_profile_attendance_history.sql` was verified
  only in an isolated scratch copy (`scripts/test-attendance-rpcs.sql`, 26 checks).
  Once no other session is mid-change on the same functions, run
  `npx supabase migration up --local` followed by `npm run test:backend`, which
  now includes an attendance and saved-events block.
- **Regenerate database types.** `types/supabase.generated.ts` was hand-edited to
  add the new RPCs. Run `npm run backend:types` after the migration is applied.
- **Run the isolated browser flow before merging.** `scripts/e2e-isolated-env.sh up|build|run|down`
  stands up a scratch DB + private PostgREST + proxy and drives the web build
  through onboarding, profile, RSVPs, saved events, chat names, and redo-setup
  (69 checks, screenshots in `/tmp/eventmap-e2e-$USER`; `scripts/e2e-seed-demo-user.sql`
  resets the demo attendee inside the scratch copy). Last run after the second
  polish round: 69/69, no console errors, no failed requests.
- **Regenerate typed routes.** `.expo/types/router.d.ts` does not know the new
  `/joined-events` route yet; the profile tab casts the path. Starting the dev
  server regenerates it, after which the casts can be dropped.
- **Parallel migration in another worktree.** A second session drafted
  `20261029100000_profile_attendance_and_privacy.sql` covering overlapping ground
  (it also adds `get_user_past_event_count`). Parameter names for the shared
  functions were aligned so both migrations can apply in either order, but the
  client code in each branch targets different RPCs. Pick one branch's version
  of the profile/attendance work when merging rather than combining both.

## Profile and attendance

- **Joining an in-progress event is still allowed.** The event page now blocks
  joining once an event has ended and labels live events "Happening now", but a
  one-off event that has started still shows "Join Event". Decide whether that is
  intended.
- **Leaving an event does not clean up chat state.** Removing an RSVP revokes
  chat access via RLS, but unread counters and local presence are not reset.
- **Business "Created" count** counts every event ever created. A split into
  upcoming vs past would mirror the attendee side.
- **Public profile has no "attended" count.** History is owner-only by design,
  but a public count of attended events could become a profile setting.
- **Public profile screen** still has no focus refresh (pull-to-refresh only).
  Acceptable for a pushed screen; revisit if RSVP state is ever shown there.
- **No rating stat.** The hardcoded 4.9 was removed. A business-mode rating card
  could use the venue review average that the analytics screen already computes.

## Security and authorization (feeds the Authorization review roadmap row)

- **Profiles lockdown ripple effects.** The profiles SELECT policy is now
  owner-only; other identities flow through `get_public_profile` and
  `get_profiles_display`. Realtime chat payloads, admin tools, and any future
  embed of `profiles:user_id (...)` in a select string will silently return
  null profiles — grep for such embeds when adding features. `get_profiles_display`
  is capped at 200 ids and requires a session.
- **RPC execute grants.** The project relies on the default `EXECUTE` grant to
  `PUBLIC` for every function. The new attendance functions follow the same
  convention for consistency, but a blanket `REVOKE ... FROM PUBLIC` plus
  explicit grants to `authenticated` would be safer across the board.
- **Anonymous attendee ids** now hash the RSVP row id. Row ids are never exposed
  to other users by RLS, so this is not reversible in practice, but an HMAC with
  a server secret would remove even the theoretical link.
- **`get_event_attendees_public` is callable by signed-out clients.** It only
  returns public attendees, but consider requiring a session.

## UI and UX — final polish pass (2026-10-29, second round)

Done in this round: cross-platform confirm helper (`utils/confirm.ts`) used by
Sign Out, Remove saved event, Delete event, and Redo setup; event detail RSVP
collapsed into one bottom control (Join + star for interested, Leave once
joined) and the duplicate action row removed; profile header row realigned;
stat labels 11 px / 1.2 spacing / secondary colour; joined-card titles wrap to
two lines; onboarding subtitles and permission copy use secondary colour; the
onboarding form sits in a card; one shared `AvatarRing` component for the
profile tab and onboarding; Skip hidden on the first onboarding step for brand
new users; "Create Business" moved to a card above Sign Out for personal
accounts; Settings gained an Account group; carousel placeholder uses the
calendar icon; onboarding reads already-granted OS permissions on load;
Settings lint entities fixed.

Third round (2026-10-29, evening):

- **Attendees pagination.** `get_event_attendees_page(event, limit, offset, search)`
  returns `{total, items, has_more}`; the sheet loads pages of 30, searches
  server-side by name (never matches anonymous rows), lists the viewer first,
  and has a "Show more" footer plus infinite scroll. The event page fetches only
  four faces for the preview. The legacy full-list RPC (chat mentions) is capped
  at 500 named-first rows.
- **Reminders follow RSVP context.** `send_event_reminders()` now sends the
  existing lead-time reminder to "going" users and a single "Still interested?"
  nudge to "interested" users, the day before (or ~2h before when the interest
  was registered inside the last day). No RSVP or a removed RSVP gets nothing.
  `event_reminder_sent` gained a `kind` column (PK now includes it) so the two
  kinds never collide. New preference `notification_preferences.interested_reminder`
  with a Settings toggle. The job's EXECUTE grant was revoked from PUBLIC; it
  was callable by any signed-in user before.
- **Load check** (`scripts/stress-attendance.sql`, scratch only): with a
  3,000-going / 500-interested / 800-saved user and a 5,000-attendee event every
  RPC answers in under 10 ms.

Still open (flagged):

1. **Reviews and followers lists not exercised in the browser run** (need the
   host account). Both resolve names through `get_profiles_display`.
2. **Native device pass** for the image picker and OS permission prompts in
   onboarding; the browser run cannot exercise those.
3. **Recurring events and reminders.** Both reminder kinds key off
   `start_datetime`, which for recurring events is the first occurrence. The
   interested nudge skips recurring events; the going reminder (pre-existing)
   fires only around the first occurrence. Needs a next-occurrence-aware job.
4. **Going-reminder window is ±5 minutes.** If pg_cron misses two consecutive
   runs the reminder is lost. Pre-existing; widening to ±10 would be safer.
5. **Ten pre-existing lint errors** in auth, premium, and followers screens
   (unescaped quotes). Not touched by this work.

## Earlier UI notes still open

- **Discover and search cards have no bookmark.** Saving works from the event
  page header only.
- **Followers screen** (business mode) lists followers but offers no actions.
  Following screen (personal) has no unfollow action.
- **Joined-events and saved-events screens duplicate card styling** with the
  profile tab. A shared `EventRowCard` component would keep them in sync.
- **Maestro smoke flow** does not cover RSVP, bookmark, profile refresh, or the
  joined-events screen. The browser flow above covers them on web only.
- **Onboarding on native** still needs a device pass for the image picker and
  the OS permission prompts; the browser run cannot exercise those.
