# Submission preparation status

The submission document is an eligibility reference, not an authorization to
publish data, sign terms, or alter contributor ownership.

## Prepared

- Original public repository: https://github.com/vrnrvn/eventmap (not a fork).
- MIT license for original code; contributor credit retained.
- Owner confirmed ownership and Shalom's agreement to licensing.
- Original commit history preserved.
- Local Supabase and synthetic fixtures; no production data copied.
- Current README, environment examples, third-party notices, and 30-44 hour roadmap.
- Google/Firebase configuration and CLI temp files removed from the submitted
  tree and ignored for future use.

## Owner actions before submission

1. **GitHub pull-request copies:** on October 18, 2026, `google-services.json`
   was removed from the history of all 25 published branches, with all 59 commits
   retained. The branch tips were verified to differ only by that file removal,
   and all 591 reachable blobs in the isolated rewritten repository were scanned
   for Google keys. Atomic force-with-lease updates succeeded. Local branches
   were synchronized without changing working-file contents. The local audit
   passes, but GitHub still advertises old commits in pull requests 1-13. Ask
   GitHub Support about removing those retained references/cached views; normal
   Git pushes cannot update them. See [cleanup details](HISTORY_CLEANUP.md).
   The owner no longer has Google Cloud access, so the old key has NOT been
   revoked by this cleanup. Removing Git references does not revoke credentials
   or erase copies held by other people.
2. **Eligibility:** disclose the actual ownership/contributor relationship. The
   document excludes projects processing other people's personal data. This
   setup uses synthetic data, but the intended profile/location/attendance/chat
   features must be described honestly. Confirm acceptability with organizers;
   licensing alone does not establish eligibility.
3. **Media rights:** confirm permission for existing logo assets and external
   media. Third-party assets retain their own terms.
4. **Dependencies:** npm reports existing advisories. Review compatible upgrades
   separately; do not apply `npm audit fix --force` blindly.
5. Review, commit, and push the separate app-preparation changes through the
   normal Git workflow. Select MIT in the form. Do not describe GitHub's retained
   pull-request history or the old credential as purged/revoked.

No hosted project has been deleted, migrated, resumed, or billed by this setup.
The owner manages hosted subscriptions and private backups independently.

## Verification

During preparation, the complete migration chain and synthetic fixtures were
applied to an empty local database. App and admin typechecks, the Expo web export,
and the Next.js production build passed. Local integration checks covered email
authentication, discovery, event creation/editing, RSVP lists, two-attendee chat
gating, realtime delivery, sender spoofing rejection, access revocation after
leaving, and image storage. Browser checks reached the map, event details, joined
state, and seeded chat using the synthetic attendee account.

Native builds, device push, OAuth providers, and hosted deployment were not
validated. The local submission audit now passes for working files and reachable
local refs; it does not fetch or scan GitHub's retained pull-request refs.
