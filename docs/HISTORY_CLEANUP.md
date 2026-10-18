# Firebase configuration history cleanup

Completed October 18, 2026 for https://github.com/vrnrvn/eventmap.

## Completed work

- Backed up the original Git history and uncommitted work in a private temporary
  directory outside the repository. Do not publish that backup: it contains the
  old file. The temporary backup is not a permanent archival guarantee.
- Removed only `google-services.json` from an isolated mirror with git-filter-repo.
- Retained all 59 commits, including merge topology and author information;
  58 commit IDs changed. No unrelated files changed at any branch/ref tip.
- Verified 591 reachable blobs in the rewritten mirror contain no Google API keys.
- Updated all 25 published branches atomically with explicit leases against the
  original commit IDs, so newer collaborator commits would cause rejection.
- Synchronized the local branches and remote-tracking refs, with all 251 checked
  working-file fingerprints preserved. Existing uncommitted preparation changes
  were not committed or published by this operation.
- Removed the static Firebase config reference from the working app configuration.
  Android push remains an optional integration requiring a new project/config.
- The separate app-preparation changes were subsequently committed and published
  on `main` as `77c8e66df7a3851e4b4357bd9c0cc10e03717c5b`.

## Collaborator action

Shalom and anyone else with an old clone should use a fresh clone of the cleaned
repository. Preserve any uncommitted work separately first; reapply reviewed file
changes rather than merging/pushing old branches, which can restore the old file's
history. Do not use a stale fork as the source of a merge.

## GitHub-retained copies

After the branch updates, GitHub still advertises the original commit IDs under
`refs/pull/1/head` through `refs/pull/13/head`. These server-managed refs cannot be
rewritten with an ordinary Git push. Cached commit views may also remain.

Suggested GitHub Support request (review before sending):

> I maintain vrnrvn/eventmap. We removed an obsolete google-services.json containing
> a Google/Firebase client API key from all 25 branch histories using
> git-filter-repo. All original commits were retained with rewritten IDs.
> Please assess removal of retained PR references/cached views for PRs #1-#13.
> Repository: https://github.com/vrnrvn/eventmap (public).
> Affected pull requests: 13, numbered #1 through #13 inclusive.
> The first changed original commit was
> 57e9055e4bfb55ec026dc49156d01dcb803dbd42.
> No Git LFS objects were involved in this cleanup.
> I no longer have access to the old Google project to revoke the key. It is no
> longer used by the app. I can supply rewrite metadata privately if needed.

GitHub decides whether this client key qualifies for support-assisted removal.
Submit this through GitHub's support portal, linked from the reference below.
Do not attach the original key, deleted configuration, or private history backup.
No support request has been submitted automatically. Repeating the branch rewrite
will not remove GitHub's read-only pull-request refs.

## Credential status

This operation did not revoke or disable the Google key, delete a Firebase
project, or erase copies in third-party clones, forks, or private backups.
Local reflogs may retain old unreachable objects for recovery. Do not claim that
rewriting published branches proves the credential was revoked.

Reference: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository
