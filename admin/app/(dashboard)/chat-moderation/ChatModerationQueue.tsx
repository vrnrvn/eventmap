'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export type ChatReport = {
  message_id: string;
  event_id: string;
  event_title: string | null;
  sender_id: string;
  sender_name: string | null;
  body: string;
  message_created_at: string;
  deleted_at: string | null;
  report_count: number;
  reasons: string[];
  first_reported_at: string;
  last_reported_at: string;
  report_status: 'pending' | 'resolved' | 'dismissed';
  sender_banned: boolean;
  sender_blocked: boolean;
};

export type ModerationLogEntry = {
  id: string;
  event_id: string;
  event_title: string | null;
  message_id: string | null;
  message_body: string | null;
  target_user_id: string | null;
  target_user_name: string | null;
  actor_id: string | null;
  actor_name: string | null;
  action:
    | 'delete'
    | 'block'
    | 'unblock'
    | 'dismiss_reports'
    | 'resolve_reports'
    | 'restore'
    | 'auto_hide'
    | 'lock'
    | 'unlock'
    | 'slow_mode';
  reason: string | null;
  created_at: string;
};

type StatusFilter = 'pending' | 'resolved' | 'dismissed' | 'all';

type ReportDetails = {
  reporters: {
    reporter_id: string;
    reporter_name: string | null;
    reason: string | null;
    status: string;
    created_at: string;
    reporter_total_reports: number;
  }[];
  context: {
    id: string;
    sender_name: string | null;
    body: string;
    created_at: string;
    deleted_at: string | null;
    is_target: boolean;
  }[];
  sender_history: {
    messages_total: number;
    messages_removed: number;
    reports_received: number;
    blocks: number;
  } | null;
};

const ACTION_LABEL: Record<ModerationLogEntry['action'], string> = {
  delete: 'Deleted message',
  block: 'Blocked from chat',
  unblock: 'Unblocked',
  dismiss_reports: 'Dismissed reports',
  resolve_reports: 'Confirmed removal',
  restore: 'Restored message',
  auto_hide: 'Auto-hidden',
  lock: 'Locked chat',
  unlock: 'Unlocked chat',
  slow_mode: 'Changed slow mode',
};

const BLOCK_DURATIONS: { label: string; minutes: number | null }[] = [
  { label: '24 hours', minutes: 24 * 60 },
  { label: '7 days', minutes: 7 * 24 * 60 },
  { label: 'Until undone', minutes: null },
];

export function ChatModerationQueue({
  reports: initialReports,
  log: initialLog,
}: {
  reports: ChatReport[];
  log: ModerationLogEntry[];
}) {
  const [reports, setReports] = useState(initialReports);
  const [log, setLog] = useState(initialLog);
  const [filter, setFilter] = useState<StatusFilter>('pending');
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, ReportDetails | 'loading' | 'error'>>({});
  const [blockMinutes, setBlockMinutes] = useState<Record<string, number | null>>({});
  const [error, setError] = useState<string | null>(null);

  const toggleDetails = async (messageId: string) => {
    if (expanded === messageId) {
      setExpanded(null);
      return;
    }
    setExpanded(messageId);
    if (details[messageId]) return;
    setDetails((prev) => ({ ...prev, [messageId]: 'loading' }));
    const supabase = createClient();
    const { data, error: err } = await supabase.rpc('admin_get_chat_report_details', { p_message_id: messageId });
    setDetails((prev) => ({ ...prev, [messageId]: err || !data ? 'error' : (data as ReportDetails) }));
  };

  const filtered = useMemo(
    () => (filter === 'all' ? reports : reports.filter((r) => r.report_status === filter)),
    [reports, filter]
  );
  const pendingCount = reports.filter((r) => r.report_status === 'pending').length;

  const refresh = async () => {
    const supabase = createClient();
    const [reportsRes, logRes] = await Promise.all([
      supabase.rpc('admin_get_chat_reports', { p_status: 'all' }),
      supabase.rpc('admin_get_chat_moderation_log', { p_limit: 50 }),
    ]);
    if (reportsRes.error || logRes.error) {
      throw new Error(`Action succeeded but the list could not refresh: ${(reportsRes.error ?? logRes.error)?.message}`);
    }
    setReports((reportsRes.data ?? []) as ChatReport[]);
    setLog((logRes.data ?? []) as ModerationLogEntry[]);
  };

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  const deleteMessage = (r: ChatReport) =>
    run(`${r.message_id}:delete`, async () => {
      const supabase = createClient();
      const { error: err } = await supabase.rpc('delete_event_chat_message', { p_message_id: r.message_id });
      if (err) throw err;
    });

  const deleteAndBlock = (r: ChatReport) =>
    run(`${r.message_id}:block`, async () => {
      const supabase = createClient();
      const del = await supabase.rpc('delete_event_chat_message', { p_message_id: r.message_id });
      if (del.error) throw del.error;
      const minutes = blockMinutes[r.message_id] ?? BLOCK_DURATIONS[0].minutes;
      const blk = await supabase.rpc('block_event_chat_user', {
        p_event_id: r.event_id,
        p_user_id: r.sender_id,
        p_reason: `Reported message: ${r.reasons.join(', ') || 'no reason given'}`,
        p_duration_minutes: minutes ?? undefined,
      });
      if (blk.error) throw blk.error;
    });

  const unblock = (r: ChatReport) =>
    run(`${r.message_id}:unblock`, async () => {
      const supabase = createClient();
      const { error: err } = await supabase.rpc('unblock_event_chat_user', {
        p_event_id: r.event_id,
        p_user_id: r.sender_id,
      });
      if (err) throw err;
    });

  const resolve = (r: ChatReport) =>
    run(`${r.message_id}:resolve`, async () => {
      const supabase = createClient();
      const { error: err } = await supabase.rpc('admin_resolve_chat_reports', { p_message_id: r.message_id });
      if (err) throw err;
    });

  const restore = (r: ChatReport) => {
    if (!window.confirm('Restore this message for everyone and dismiss its reports?')) return;
    void run(`${r.message_id}:restore`, async () => {
      const supabase = createClient();
      const { error: err } = await supabase.rpc('admin_restore_chat_message', { p_message_id: r.message_id });
      if (err) throw err;
    });
  };

  const dismiss = (r: ChatReport) =>
    run(`${r.message_id}:dismiss`, async () => {
      const supabase = createClient();
      const { error: err } = await supabase.rpc('admin_dismiss_chat_reports', { p_message_id: r.message_id });
      if (err) throw err;
    });

  const banSender = (r: ChatReport) => {
    if (!window.confirm(`Ban ${r.sender_name ?? 'this user'} from the entire app?`)) return;
    void run(`${r.message_id}:ban`, async () => {
      const supabase = createClient();
      const { error: err } = await supabase.rpc('admin_ban_user', {
        p_user_id: r.sender_id,
        p_reason: `Chat report: ${r.reasons.join(', ') || 'no reason given'}`,
      });
      if (err) throw err;
      if (!r.deleted_at) {
        const del = await supabase.rpc('delete_event_chat_message', { p_message_id: r.message_id });
        if (del.error) throw del.error;
      }
      const res = await supabase.rpc('admin_resolve_chat_reports', { p_message_id: r.message_id });
      if (res.error) throw res.error;
    });
  };

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex rounded-md border border-zinc-300 bg-white p-0.5 text-sm">
            {(['pending', 'resolved', 'dismissed', 'all'] as StatusFilter[]).map((value) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`rounded px-3 py-1.5 capitalize ${
                  filter === value ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'
                }`}
              >
                {value}
                {value === 'pending' && pendingCount > 0 ? (
                  <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-xs text-white">
                    {pendingCount}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-500">
            {filter === 'pending' ? 'No reports waiting for review.' : 'Nothing here.'}
          </div>
        ) : (
          <ul className="space-y-3">
            {filtered.map((r) => {
              const isOpen = expanded === r.message_id;
              const isBusy = busy?.startsWith(r.message_id) ?? false;
              return (
                <li key={r.message_id} className="rounded-lg border border-zinc-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                        <StatusBadge status={r.report_status} />
                        <span className="rounded bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700">
                          {r.report_count} {r.report_count === 1 ? 'report' : 'reports'}
                        </span>
                        {r.deleted_at ? (
                          <span className="rounded bg-red-50 px-2 py-0.5 text-red-700">Hidden</span>
                        ) : null}
                        {r.sender_blocked ? (
                          <span className="rounded bg-orange-50 px-2 py-0.5 text-orange-700">Sender blocked in chat</span>
                        ) : null}
                        {r.sender_banned ? (
                          <span className="rounded bg-red-100 px-2 py-0.5 text-red-800">Sender banned</span>
                        ) : null}
                        <span className="text-zinc-400">
                          last reported {new Date(r.last_reported_at).toLocaleString()}
                        </span>
                      </div>
                      <p
                        className={`text-sm text-zinc-900 ${isOpen ? 'whitespace-pre-wrap' : 'truncate'} ${
                          r.deleted_at ? 'line-through text-zinc-400' : ''
                        }`}
                      >
                        {r.body}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        <Link href={`/users/${r.sender_id}`} className="font-medium text-zinc-700 hover:underline">
                          {r.sender_name ?? 'Unknown user'}
                        </Link>
                        {' in '}
                        <Link href={`/events/${r.event_id}`} className="font-medium text-zinc-700 hover:underline">
                          {r.event_title ?? 'Unknown event'}
                        </Link>
                        {' · sent '}
                        {new Date(r.message_created_at).toLocaleString()}
                        {r.reasons.length > 0 ? (
                          <>
                            {' · reasons: '}
                            <span className="text-zinc-700">{r.reasons.join(', ')}</span>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <button
                      onClick={() => void toggleDetails(r.message_id)}
                      className="shrink-0 text-xs text-zinc-500 hover:text-zinc-900"
                    >
                      {isOpen ? 'Hide details' : 'Details'}
                    </button>
                  </div>

                  {isOpen ? <ReportDetailsPanel state={details[r.message_id]} /> : null}

                  <div className="mt-3 flex flex-wrap gap-2 text-sm">
                    {isBusy ? (
                      <span className="text-zinc-400">Working…</span>
                    ) : (
                      <>
                        {r.report_status === 'pending' && r.deleted_at ? (
                          <ActionButton onClick={() => void resolve(r)}>Confirm removal</ActionButton>
                        ) : null}
                        {r.report_status === 'pending' && !r.deleted_at ? (
                          <ActionButton onClick={() => void dismiss(r)}>Dismiss reports</ActionButton>
                        ) : null}
                        {r.deleted_at ? (
                          <ActionButton onClick={() => restore(r)}>Restore message</ActionButton>
                        ) : (
                          <ActionButton tone="danger" onClick={() => void deleteMessage(r)}>
                            Delete message
                          </ActionButton>
                        )}
                        {!r.sender_blocked ? (
                          <span className="inline-flex items-center overflow-hidden rounded-md border border-red-200">
                            <button
                              onClick={() => void deleteAndBlock(r)}
                              className="px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
                            >
                              {r.deleted_at ? 'Block sender' : 'Delete + block'}
                            </button>
                            <select
                              aria-label="Block duration"
                              value={String(blockMinutes[r.message_id] ?? BLOCK_DURATIONS[0].minutes)}
                              onChange={(e) =>
                                setBlockMinutes((prev) => ({
                                  ...prev,
                                  [r.message_id]: e.target.value === 'null' ? null : Number(e.target.value),
                                }))
                              }
                              className="h-full border-l border-red-200 bg-red-50/40 px-2 py-1.5 text-xs text-red-700"
                            >
                              {BLOCK_DURATIONS.map((d) => (
                                <option key={d.label} value={String(d.minutes)}>
                                  {d.label}
                                </option>
                              ))}
                            </select>
                          </span>
                        ) : (
                          <ActionButton onClick={() => void unblock(r)}>Unblock sender</ActionButton>
                        )}
                        {!r.sender_banned ? (
                          <ActionButton tone="danger" onClick={() => banSender(r)}>
                            Ban user
                          </ActionButton>
                        ) : null}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-zinc-900">Recent moderation activity</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-zinc-700">When</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-700">Action</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-700">By</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-700">Target</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-700">Event</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-700">Details</th>
              </tr>
            </thead>
            <tbody>
              {log.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">
                    No moderation actions yet.
                  </td>
                </tr>
              ) : (
                log.map((entry) => (
                  <tr key={entry.id} className="border-t border-zinc-200 align-top">
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-600">
                      {new Date(entry.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-zinc-900">{ACTION_LABEL[entry.action] ?? entry.action}</td>
                    <td className="px-4 py-3 text-zinc-600">
                      {entry.actor_id ? (
                        <Link href={`/users/${entry.actor_id}`} className="hover:underline">
                          {entry.actor_name ?? 'Unknown'}
                        </Link>
                      ) : (
                        <span className="italic text-zinc-400">System</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      {entry.target_user_id ? (
                        <Link href={`/users/${entry.target_user_id}`} className="hover:underline">
                          {entry.target_user_name ?? 'Unknown'}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      <Link href={`/events/${entry.event_id}`} className="hover:underline">
                        {entry.event_title ?? 'Unknown event'}
                      </Link>
                    </td>
                    <td className="max-w-xs px-4 py-3 text-zinc-600">
                      {entry.message_body ? (
                        <span className="block truncate" title={entry.message_body}>
                          “{entry.message_body}”
                        </span>
                      ) : null}
                      {entry.reason ? <span className="block text-xs text-zinc-500">{entry.reason}</span> : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ReportDetailsPanel({ state }: { state: ReportDetails | 'loading' | 'error' | undefined }) {
  if (!state || state === 'loading') {
    return <p className="mt-3 text-xs text-zinc-400">Loading details…</p>;
  }
  if (state === 'error') {
    return <p className="mt-3 text-xs text-red-600">Couldn&apos;t load details.</p>;
  }
  const history = state.sender_history;
  return (
    <div className="mt-4 grid gap-4 border-t border-zinc-100 pt-4 md:grid-cols-2">
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Reporters ({state.reporters.length})
        </h3>
        <ul className="space-y-1.5 text-sm">
          {state.reporters.map((rep) => (
            <li key={`${rep.reporter_id}-${rep.created_at}`} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate">
                <Link href={`/users/${rep.reporter_id}`} className="font-medium text-zinc-800 hover:underline">
                  {rep.reporter_name ?? 'Unknown'}
                </Link>
                <span className="text-zinc-500"> · {rep.reason ?? 'no reason'}</span>
              </span>
              <span className="shrink-0 text-xs text-zinc-400" title="Total reports filed by this user">
                {rep.reporter_total_reports} filed
              </span>
            </li>
          ))}
        </ul>
        {history ? (
          <div className="mt-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Sender history</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-zinc-500">Messages</dt>
              <dd className="text-zinc-800">{history.messages_total}</dd>
              <dt className="text-zinc-500">Removed</dt>
              <dd className={history.messages_removed > 0 ? 'text-red-700' : 'text-zinc-800'}>{history.messages_removed}</dd>
              <dt className="text-zinc-500">Reports received</dt>
              <dd className={history.reports_received > 1 ? 'text-red-700' : 'text-zinc-800'}>{history.reports_received}</dd>
              <dt className="text-zinc-500">Chat blocks</dt>
              <dd className="text-zinc-800">{history.blocks}</dd>
            </dl>
          </div>
        ) : null}
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Conversation context</h3>
        <ol className="space-y-1.5 text-sm">
          {state.context.map((m) => (
            <li
              key={m.id}
              className={`rounded px-2 py-1 ${m.is_target ? 'bg-amber-50 ring-1 ring-amber-200' : ''}`}
            >
              <span className="font-medium text-zinc-700">{m.sender_name ?? 'Unknown'}: </span>
              <span className={m.deleted_at ? 'italic text-zinc-400' : 'text-zinc-800'}>
                {m.deleted_at ? '(removed)' : m.body}
              </span>
              <span className="ml-2 text-xs text-zinc-400">
                {new Date(m.created_at).toLocaleTimeString()}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ChatReport['report_status'] }) {
  const className =
    status === 'pending'
      ? 'bg-amber-100 text-amber-800'
      : status === 'resolved'
        ? 'bg-green-100 text-green-700'
        : 'bg-zinc-100 text-zinc-700';
  return <span className={`rounded px-2 py-0.5 font-medium capitalize ${className}`}>{status}</span>;
}

function ActionButton({
  children,
  onClick,
  tone = 'default',
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: 'default' | 'danger';
}) {
  const className =
    tone === 'danger'
      ? 'border-red-200 text-red-700 hover:bg-red-50'
      : 'border-zinc-300 text-zinc-700 hover:bg-zinc-50';
  return (
    <button onClick={onClick} className={`rounded-md border px-3 py-1.5 text-sm ${className}`}>
      {children}
    </button>
  );
}
