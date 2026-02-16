'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Complaint = {
  id: string;
  reporter_id: string;
  target_type: string;
  target_id: string;
  reason: string | null;
  status: string;
  created_at: string;
  profiles: { name: string } | { name: string }[] | null;
};

export function ComplaintsTable({ complaints }: { complaints: Complaint[] }) {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [statuses, setStatuses] = useState<Record<string, string>>(
    Object.fromEntries(complaints.map((c) => [c.id, c.status]))
  );
  const [loading, setLoading] = useState<string | null>(null);

  const filtered =
    statusFilter === 'all'
      ? complaints
      : complaints.filter((c) => (statuses[c.id] ?? c.status) === statusFilter);

  const getReporterName = (c: Complaint) => {
    const p = c.profiles;
    return Array.isArray(p) ? p[0]?.name : (p as { name: string })?.name ?? '—';
  };

  const updateStatus = async (id: string, newStatus: 'resolved' | 'dismissed') => {
    setLoading(id);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('complaints')
        .update({
          status: newStatus,
          resolved_at: new Date().toISOString(),
          resolved_by: user?.id ?? null,
        })
        .eq('id', id);
      if (error) throw error;
      setStatuses((prev) => ({ ...prev, [id]: newStatus }));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div>
      <div className="mb-4 flex gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        >
          <option value="all">All</option>
          <option value="pending">Pending</option>
          <option value="resolved">Resolved</option>
          <option value="dismissed">Dismissed</option>
        </select>
      </div>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Reporter</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Target</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Reason</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Status</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Created</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const status = statuses[c.id] ?? c.status;
              return (
                <tr key={c.id} className="border-t border-zinc-200">
                  <td className="px-4 py-3 text-zinc-600">{getReporterName(c)}</td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs">{c.target_type}</span>:{' '}
                    <span className="font-mono text-xs text-zinc-500">{c.target_id.slice(0, 8)}…</span>
                  </td>
                  <td className="max-w-xs truncate px-4 py-3 text-zinc-600" title={c.reason ?? ''}>
                    {c.reason ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        status === 'pending'
                          ? 'bg-amber-100 text-amber-800'
                          : status === 'resolved'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-zinc-100 text-zinc-700'
                      }`}
                    >
                      {status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-600">
                    {new Date(c.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    {loading === c.id ? (
                      <span className="text-zinc-400">...</span>
                    ) : status === 'pending' ? (
                      <span className="space-x-2">
                        <button
                          onClick={() => updateStatus(c.id, 'resolved')}
                          className="text-green-600 hover:text-green-700"
                        >
                          Resolve
                        </button>
                        <button
                          onClick={() => updateStatus(c.id, 'dismissed')}
                          className="text-zinc-600 hover:text-zinc-900"
                        >
                          Dismiss
                        </button>
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
