# Performance validation scripts (2026-11-06 perf review)

Benchmarks and equivalence checks used to validate the pending perf
migrations on an ISOLATED Postgres container — never the shared local DB:

- `supabase/migrations/20261106120000_perf_ranked_events.sql`
- `supabase/migrations/20261106130000_perf_chat_read_policies.sql`
- `supabase/migrations/20261106140000_perf_fk_indexes_and_housekeeping.sql`
  (FK indexes, duplicate-index drops, reminder-cron bound; plain DDL — checked
  for idempotency on a throwaway container, no benchmark needed)
- `supabase/migrations/20261106150000_perf_aggregate_rpcs.sql`
  (review-summary + follower-count RPCs; the client calls them already and
  falls back to its old queries until applied — note the follower-count
  fallback under-reports by design of the follows RLS, so applying this is
  also a correctness fix)
- `supabase/migrations/20261106160000_perf_rls_initplan.sql`
  (GENERATED rewrite of all 70 policies that called auth.uid()/is_admin_user()
  per row → initplan form; validated on a throwaway container: policy count
  unchanged, chat-stress 9/9 and host-tools suites pass before/after. If more
  policy migrations land before applying, regenerate — see the file header)

## Setup (throwaway container, same image as the local stack)

```sh
docker run -d --name eventmap_perf_iso -e POSTGRES_PASSWORD=postgres \
  -p 127.0.0.1:55432:5432 public.ecr.aws/supabase/postgres:17.6.1.106
ISO="docker exec -i eventmap_perf_iso psql -U postgres -d postgres"

# All migrations (storage ones fail harmlessly: no storage schema in a bare container)
for f in supabase/migrations/*.sql; do $ISO -q -v ON_ERROR_STOP=1 < "$f" || echo "skip $f"; done

# auth.uid() in this image only reads the legacy request.jwt.claim.sub GUC and
# auth.users lacks a couple of columns the seed expects; the shim aligns both.
docker exec -i -e PGPASSWORD=postgres eventmap_perf_iso psql -U supabase_admin -h localhost \
  -d postgres -v ON_ERROR_STOP=1 < scripts/perf/auth_shim.sql
docker exec -i -e PGPASSWORD=postgres eventmap_perf_iso psql -U supabase_admin -h localhost \
  -d postgres -c "GRANT ALL ON auth.identities TO postgres; GRANT ALL ON auth.users TO postgres;"
```

## Scripts

- `fixture.sql` — synthetic dataset: 20k users, 3k businesses, 120k events
  (80% in 5 metro clusters, 10% recurring), 480k RSVPs, 120k saves. Run inside
  `BEGIN; ... COMMIT;` then `ANALYZE;` (~1 min).
- `bench_ranked.sql` — timings + result fingerprints for `get_ranked_events`
  (dense/sparse areas, paging, search). Baseline before the migration:
  ~285 ms per dense page; after: ~66 ms. Fingerprints must not change.
- `equiv.sql`, `equiv_user.sql` — full-row equivalence between
  `get_ranked_events_old` and the new version (17 cases × anon/user; the old
  function must be installed under that name first — copy it from
  `20261103150000_event_publishing_and_lifecycle.sql`).
- `chat_fixture.sql` — one event with 50 attendees, 20k messages (some
  tombstones), a viewer with 2 blocked senders, 150k messages of other-event
  noise. Records ids in a `_perf_chat` table.
- `bench_chat.sql` — chat read timings + fingerprints per caller type
  (viewer/host/outsider/admin/anon). The policy migration's win is the
  outsider case: ~300 ms → ~2 ms per denied read; fingerprints must not change.
- `chat_insert.sql` — smoke test that INSERT ... RETURNING still works for
  attendee and host, and still fails for an outsider.

The repo's own `scripts/chat-stress-test.sql` (9 PASS checks) must also pass
against seed data before and after the policy migration.
