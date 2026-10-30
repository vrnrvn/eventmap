# Onboarding redesign plan

Status: implemented in `app/(onboarding)/index.tsx` on 2026-10-29. Kept as the
design record; the "Open questions" at the bottom were resolved as noted.

## Current flow (6 swipe pages in `app/(onboarding)/index.tsx`)

0. Welcome (feature pitch)
1. Interests (category multi-select → `preferred_categories`)
2. Permissions (location + notifications cards)
3. City / area (prefilled from reverse geocode, map picker)
4. Privacy (three toggles: visible profile, public attendance, shared future events)
5. Tutorial (how the app works) → saves everything, routes to Discover

What it never collects: avatar, bio, hobbies, social handles. The name comes
from signup metadata and is never confirmed. Result: new users land on Discover
with an empty profile, the profile tab nudges them to Settings, and attendee
lists show initial-only avatars.

## Proposed flow (7 pages, profile-first ordering)

0. **Welcome** — unchanged.
1. **"Make it yours" (new profile page)** — the main addition:
   - Avatar picker: tappable ring (same `ImagePicker` + `uploadAvatar` path the
     profile tab already uses), with a "later" state that shows the initial.
   - Name field, prefilled from signup metadata so users can fix typos — today a
     wrong name can only be fixed in Settings.
   - Bio, one-line placeholder ("What should people know about you?"), ~160 chars.
   - Optional hobbies chips or short free text (reuses the Settings field).
   - Everything optional except a non-empty name; single "Continue" button.
2. **Interests** — unchanged.
3. **Permissions** — unchanged.
4. **City / area** — unchanged.
5. **Privacy** — unchanged, but gains context: show the avatar + name the user
   just set in a small preview card ("This is what other attendees see") so the
   three toggles stop being abstract. Social handles stay out of onboarding
   (low value for brand-new users; Settings keeps them).
6. **Tutorial → finish** — unchanged, plus the completion write now includes
   `name`, `bio`, `hobbies`, `avatar_url`.

## Why this shape

- **Profile before interests**: the avatar/bio step works best while motivation
  is highest (right after the welcome pitch), and the privacy page is far more
  concrete when there is a real profile to preview.
- **Skippable but sticky**: every field optional means no drop-off wall; the
  preview on the privacy page gives a second nudge to anyone who skipped the
  photo (tapping the preview jumps back to page 1).
- **No new backend**: all fields already exist on `profiles`; avatar upload and
  update paths already exist. The only write change is extending the single
  `updateProfile` call in `handleComplete`.

## Implementation notes (for when we build it)

- Upload the avatar immediately on pick (background, with spinner on the ring)
  rather than at completion, so a slow connection doesn't block the final step;
  keep the returned URL in state and include it in the completion write.
- Progress dots go from 6 to 7 (`TOTAL_PAGES`); the page-index effects for the
  city page (currently hardcoded to `currentPage === 3`) shift by one — replace
  the magic numbers with named constants while touching this.
- Validation: trim name, block empty-name continue with inline hint (not an
  alert); cap bio length with a live counter.
- Re-run flow: Settings has a "redo onboarding" path? (It does not — not in
  scope, but keep pages idempotent by prefilling from the loaded profile so a
  future re-entry works.)
- Keyboard handling on page 1 needs `KeyboardAvoidingView` + scroll, which the
  current FlatList-of-pages makes awkward on small screens — test on an SE-size
  viewport.
- Analytics-free: no tracking exists in onboarding today; don't add any.

## Decisions taken during implementation

1. Name writes to `profiles.name` only; auth metadata is untouched.
2. Hobbies stay free text to match Settings. Chips can replace this later
   without a schema change.
3. Every optional step has a "Skip" pill in the header. The profile step shows
   it only when a name already exists (from signup or a previous visit), since
   the name is the one required field. Permissions hides it once both are
   granted. Tutorial and Welcome have no skip.
4. Persistence: each step writes its own fields to the profile on Continue, the
   avatar uploads and saves on pick, and a per-user local draft (AsyncStorage)
   stores every answer plus the current page so a killed app resumes in place.
   The final step rewrites everything and clears the draft.
5. Privacy page: the two attendance toggles are disabled (and shown off) while
   the profile is hidden, because the server treats a private profile as
   overriding them anyway.
6. Follow-up additions (same day): "Redo setup" row in Settings → About,
   Instagram/Facebook fields on the profile step, haptics via `utils/haptics.ts`
   (no-op on web), explicit page height so short pages fill the viewport on web.
   Verified end to end in a browser against an isolated backend
   (`scripts/e2e-isolated-env.sh`), including mid-flow reload resume and
   redo-setup prefill.
