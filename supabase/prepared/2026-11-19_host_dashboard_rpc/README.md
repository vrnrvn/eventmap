# Prepared migration — the host dashboard in one request (2026-11-19)

**Status: PREPARED, NOT APPLIED.** One file, independent of every other
prepared folder. **Applying it changes nothing on its own** — it adds an RPC
the client does not call yet. The dashboard keeps working exactly as it does
today until the cutover below.

| # | File | What | Owner decision |
| --- | --- | --- | --- |
| 1 | `20261119130000_get_host_dashboard.sql` | `get_host_dashboard()` — agenda, drafts, counts, exceptions, per-date counts and the needs-attention facts in one call | one, at cutover time (see "The one decision") |

## Why

The dashboard costs **up to 17 requests** today (docs/HOST_DASHBOARD_PLAN.md
§4): upcoming rows, batched counts, batched exceptions, drafts, up to 10
per-event overviews, and one per-date count per series in the window. C1/C2
shipped on that path deliberately, so this RPC has a measured baseline to
replace. One call now returns all of it.

The bounds are the client's own, moved server-side so they cannot drift:

| Bound | Value | Mirrors |
| --- | --- | --- |
| agenda rows | `p_limit`, default 50 | `AGENDA_EVENT_LIMIT`; `truncated` flags the overflow |
| overview fan-out | `p_overview_limit`, default 10, approval-mode first then soonest | `MAX_OVERVIEW_TARGETS` + `overviewTargets` (DC5); `eligible` reports the full count |
| per-date counts | ≤ 10 series, dates inside `[p_from, p_to]` | `MAX_SERIES_DATE_COUNTS` |
| window | `p_to` capped at `p_from + 31 days` | keeps the per-date expansion bounded |

Only the three overview fields the dashboard actually reads are computed
(`requested`, `waitlist`, `chat.open_reports` — `AttentionOverview`), not the
whole `get_event_host_overview` payload.

## Validation (2026-11-19, throwaway PG17 containers, unique names, destroyed)

| Check | Result |
| --- | --- |
| Applies cleanly, idempotent on re-apply | yes |
| **All 17 SQL suites with it applied / without it** | 17/17 both; `test-host-dashboard` skips when absent |
| **Parity — counts** | identical to `get_host_events_counts` for the same event |
| **Parity — requested and open reports** | identical to `get_event_host_overview` |
| **Parity — per-date counts** | identical to `occurrence_going_count` (series goers − opt-outs + date-only goers) |
| Exceptions | match the rows `listExceptionsForEvents` would return |
| Agenda vs drafts | published events in `events`, drafts only in `drafts` |
| Cancelled event | listed, but carries no counts (as today) |
| Cancelled date | excluded from the per-date counts |
| Overview bound | with room for one, the approval-mode event wins over the sooner one; `eligible` still reports the full count |
| `truncated` | set when the agenda hits `p_limit` |
| Access | non-host refused, signed out refused; `authenticated` may execute, `anon` may not |

The payload is bounded by construction (≤ 50 events, ≤ 50 drafts, ≤ 25
overviews, ≤ 10 series × ≤ 31 dates), so it cannot grow with a venue's
history. No timing comparison is quoted here: the win this replaces is
**round trips**, not query time — up to 17 requests become 1.

## How to apply (owner)

```sh
# 0. optional: re-validate on a throwaway container (UNIQUE name — a sibling
#    session shares this Docker host and removes stray containers)
PG17_NAME=dash_check scripts/pg17-isolated.sh init
PG17_NAME=dash_check scripts/pg17-isolated.sh apply supabase/prepared/2026-11-19_host_dashboard_rpc/20261119130000_get_host_dashboard.sql
PG17_NAME=dash_check scripts/pg17-isolated.sh suites && PG17_NAME=dash_check scripts/pg17-isolated.sh destroy

# 1. move it into the migrations folder
git mv supabase/prepared/2026-11-19_host_dashboard_rpc/20261119130000_get_host_dashboard.sql supabase/migrations/

# 2. apply to the local stack
npx supabase migration up

# 3. regenerate types — this one DOES add a new RPC signature
npm run backend:types
```

**Rollback:** `DROP FUNCTION public.get_host_dashboard(uuid, timestamptz, timestamptz, integer, integer);`
Nothing else references it, and the client path it replaces is untouched
until the cutover.

## After applying: the client cutover (~4–6 h)

The payload was shaped to match `hooks/useHostDashboard.ts` field for field,
so the pure logic (`buildAgenda`, `buildAttentionQueue`, `overviewTargets`)
does not change at all:

| Payload | Client |
| --- | --- |
| `events`, `counts`, `exceptions`, `date_going`, `truncated` | `HostDashboardData` (`dateGoing` is the camelCase of `date_going`; `countsUnavailable` becomes `false` — counts always arrive) |
| `drafts`, `overviews`, `inspected`, `eligible` | `AttentionData` |

1. Add `hostToolsService.getDashboard(businessId, from, to)`.
2. Replace `loadHostDashboard`'s four calls and `useAttentionQuery`'s fan-out
   with that one call; keep the same query keys so the screen's refresh,
   focus and pull-to-refresh behaviour is unchanged.
3. Delete `overviewTargets`' use as a *fetch planner* (the server now picks
   the targets); keep the function — `buildAttentionQueue` still needs to
   know which events were inspected.

### The one decision, at cutover time

Today the two halves have deliberately different persistence
(docs/HOST_DASHBOARD_PLAN.md §4): the agenda **is** persisted for hosts on bad
signal, and the needs-attention queue is **not**, because a stale
"4 requests waiting" is worse than showing nothing. One call collapses that
distinction, so pick one:

- **(a) Persist the whole payload, hide the needs-you list when the data is
  older than a few minutes** — `useScreenState` already knows the age.
  *Recommended:* the agenda keeps its offline value and the stale-attention
  problem is solved where it is visible.
- **(b) Persist a stripped copy** (agenda fields only) and keep attention
  memory-only. More faithful to today's behaviour, but it means writing a
  reducer and keeping two shapes in sync.

Also worth knowing: today each overview call warms ManageEvent's
`['host','event',id,'overview']` cache. The RPC returns only three of those
fields, so the cutover should **stop seeding that key** rather than seed a
partial object — ManageEvent fetches its own overview on mount anyway.
