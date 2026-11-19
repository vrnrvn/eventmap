# Prepared migrations — D2, reviews per recurring series (2026-11-19)

**Status: PREPARED, NOT APPLIED.** Two files that must be applied in order,
**with a client release in between**. This is the one piece of work in the
whole roadmap where applying everything in one sitting is NOT safe — the gap
is the point of the design.

Owner decisions (2026-11-18): a recurring series gets reviews of its own;
those reviews **do** count toward the venue's overall rating; and the shipping
shape is **option (a)** — introduce an RPC the client can submit through, then
move the schema underneath it.

## The order (this is the contract)

| Step | What | Who | Safe to do early? |
| --- | --- | --- | --- |
| 1 | Apply `20261119100000_submit_review_rpc.sql` | owner | **Yes** — adds one function, changes no column, constraint or policy. Invisible to the running app |
| 2 | Ship a client release that submits reviews through `submit_review()` | dev | Only after step 1 is applied |
| 3 | Apply `20261119110000_series_reviews.sql` | owner | **Only after step 2 is live** |
| 4 | Ship the series-reviews UI | dev | After step 3 |

**Why the gap exists.** The app submits reviews with PostgREST's
`upsert(..., { onConflict: 'user_id,business_id' })`
(`services/reviews.ts:40-50`). Step 3 replaces that plain UNIQUE constraint
with two PARTIAL unique indexes, and Postgres cannot infer a partial index as
an `ON CONFLICT` arbiter — so a client still using the upsert starts failing
the moment step 3 lands. `submit_review()` is deliberately arbiter-free
(update-then-insert), so the schema can change under it.

If you ever need to apply step 3 before the client release is out, the
rollback is simply: re-create
`ALTER TABLE reviews ADD CONSTRAINT reviews_user_id_business_id_key UNIQUE (user_id, business_id)`
after deleting any series reviews — but it is far easier to keep the order.

## What step 2 (`20261119110000`) changes

- `reviews.event_id` (nullable). NULL = a review of the venue, as today; set =
  a review of that recurring series. `business_id` stays set either way, which
  is what makes series reviews count toward the venue average — the decided
  answer — with **no change to `get_business_review_summary`**.
- Two partial unique indexes: one review per (user, venue), one per
  (user, series). A person can hold both.
- `user_can_review_event()` — eligibility for a series review: attended at
  least one finished session, via `user_series_sessions_attended`
  (20261117160000). Series only; one-offs keep reviewing the venue.
- `review_event_venue()` — the series' venue, `SECURITY DEFINER`. **This is
  load-bearing:** a series people want to review has usually ended, and the
  events SELECT policy hides ended events from attendees, so reading
  `business_id` as the caller returns NULL. The first draft of this migration
  did exactly that and refused legitimate reviews with `event_not_found`;
  validation caught it (see below).
- The INSERT policy accepts both kinds and pins a series review to that
  series' own venue; a new BEFORE UPDATE trigger stops a review being moved
  between scopes (which would sidestep eligibility).
- `submit_review()` gains `p_event_id` (defaulted) — a client written against
  step 1's three named arguments keeps working unchanged.
- `get_event_review_summary()` for the series' own average, same shape and
  rounding as the venue one.

## Validation (2026-11-19, throwaway PG17 containers, unique names, destroyed)

| Check | Result |
| --- | --- |
| Each file applies cleanly, idempotent on re-apply | yes |
| **All 16 SQL suites in all three deployment states** — neither applied, step 1 only, both | 16/16 each; `test-series-reviews` skips the blocks whose migration is absent |
| Step 1 keeps today's behaviour | one row per (user, venue), created then updated in place, text trimmed, rating 1–5 enforced, signed-out refused |
| Step 1 does not widen access | `SECURITY INVOKER`: a non-attendee is still refused **by RLS**, exercised against the real `authenticated` role |
| Grants | `authenticated` yes, `anon` no (both signatures) |
| A venue review and a series review coexist | yes; one series review per person (duplicate refused) |
| Series review filed under the series' own venue | yes, even when the caller passes a different business id |
| **A FINISHED series can be reviewed** | yes — and the test proves the row is invisible to that caller under RLS at the time |
| Venue average counts both (the decision) | 3 and 4 → **3.5**; the series' own average is separate |
| Eligibility | attended → yes; never attended → no; the host's own series → no; a one-off → no |
| Scope immutability | editing a venue review into a series review is refused |
| INSERT policy wiring | asserted on the catalog (exercising it needs `SET ROLE`, done during validation, not in the suite — segfault rule) |

**Two defects were found by validating, both fixed before this was written:**
the venue lookup described above, and a test of my own that read the event id
as the restricted role and silently got NULL. The second is worth remembering:
when a suite acts as `authenticated`, capture ids as superuser *before*
switching roles, or RLS will quietly hand you NULL.

## The client work this unblocks

**Step 2 release (~1 h)** — `services/reviews.ts`: replace the
`createOrUpdateReview` upsert with
`supabase.rpc('submit_review', { p_business_id, p_rating, p_text })`. No other
change; the reads stay as they are. This is the gate for everything else.

**Step 4 release (~3–4 h)** — the series-reviews UI:
- a "Reviews of this series" section on a recurring event's page, with its own
  average from `get_event_review_summary`, plus a link to the venue's reviews;
- the review button and eligibility line follow `user_can_review_event` for a
  series (today the page uses the venue rule for everything);
- `submit_review` gains `p_event_id` when the review is about the series;
- reads filter `reviews` by `event_id` (the SELECT policy is already "anyone
  can view", so no new read RPC is needed);
- the rehearsal "Ended" scenario shows the series state.
