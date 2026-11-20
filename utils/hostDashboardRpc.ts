/**
 * Maps `get_host_dashboard()` (20261119130000, C3) onto the shapes the
 * dashboard already builds from: the persisted `HostDashboardData` and the
 * in-memory attention facts. Pure, node-tested (tests/hostDashboardRpc.test.ts).
 *
 * Kept deliberately identical to the N-call path's output so buildAgenda /
 * buildAttentionQueue, the persisted cache and the Profile "Today" card do
 * not know which path produced the data.
 */
import type { Event } from '@/types/database';
import type { OccurrenceException } from '@/utils/occurrences';
import type { AgendaCounts, AttentionOverview } from '@/utils/hostDashboard';

export type HostDashboardRpcPayload = {
  events?: Event[] | null;
  drafts?: Event[] | null;
  counts?: Record<string, { going?: number | string | null; waitlist?: number | string | null }> | null;
  exceptions?: OccurrenceException[] | null;
  overviews?: Record<
    string,
    { requested?: number | null; waitlist?: number | null; chat?: { open_reports?: number | null } | null }
  > | null;
  date_going?: Record<string, Record<string, number | string>> | null;
  inspected?: number | string | null;
  eligible?: number | string | null;
  truncated?: boolean | null;
};

export type ParsedHostDashboard = {
  data: {
    events: Event[];
    counts: Record<string, AgendaCounts>;
    exceptions: OccurrenceException[];
    dateGoing: Record<string, Record<string, number>>;
    truncated: boolean;
    countsUnavailable: boolean;
    /** Which path produced this copy; the attention facts follow it. */
    source: 'rpc';
  };
  attention: {
    drafts: Event[];
    overviews: Record<string, AttentionOverview>;
    inspected: number;
    eligible: number;
  };
};

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => (v == null ? null : num(v));

export function parseHostDashboardRpc(raw: unknown): ParsedHostDashboard {
  const p = (raw ?? {}) as HostDashboardRpcPayload;

  const counts: Record<string, AgendaCounts> = {};
  for (const [id, c] of Object.entries(p.counts ?? {})) {
    counts[id] = { going: num(c?.going), waitlist: num(c?.waitlist) };
  }

  const dateGoing: Record<string, Record<string, number>> = {};
  for (const [id, dates] of Object.entries(p.date_going ?? {})) {
    const out: Record<string, number> = {};
    for (const [key, going] of Object.entries(dates ?? {})) out[key.slice(0, 10)] = num(going);
    if (Object.keys(out).length > 0) dateGoing[id] = out;
  }

  const exceptions = (p.exceptions ?? []).map((x) => ({
    ...x,
    // `date` columns serialize as YYYY-MM-DD already; trim defensively, as
    // the agenda keys on the bare date.
    occurrence_date: String(x.occurrence_date).slice(0, 10),
  }));

  const overviews: Record<string, AttentionOverview> = {};
  for (const [id, o] of Object.entries(p.overviews ?? {})) {
    overviews[id] = {
      requested: numOrNull(o?.requested),
      waitlist: numOrNull(o?.waitlist),
      chat: { open_reports: numOrNull(o?.chat?.open_reports) },
    };
  }

  return {
    data: {
      events: p.events ?? [],
      counts,
      exceptions,
      dateGoing,
      truncated: !!p.truncated,
      countsUnavailable: false,
      source: 'rpc',
    },
    attention: {
      drafts: p.drafts ?? [],
      overviews,
      inspected: num(p.inspected),
      eligible: num(p.eligible),
    },
  };
}
