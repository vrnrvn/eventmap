'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export type VerificationRequestRow = {
  id: string;
  status: 'pending' | 'needs_info';
  evidence_url: string;
  note: string | null;
  reviewer_note: string | null;
  created_at: string;
  businesses: { id: string; name: string; host_type?: string | null; description?: string | null } | null;
};

type Decision = 'approved' | 'needs_info' | 'rejected';

/** Only http(s) links are rendered as links; anything else stays text. */
const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? url : undefined);

export function VerificationTable({ requests }: { requests: VerificationRequestRow[] }) {
  const [rows, setRows] = useState(requests);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (row: VerificationRequestRow, decision: Decision) => {
    const note = (notes[row.id] ?? '').trim();
    if (decision !== 'approved' && !note) {
      setError('Add a note so the host knows what to do next.');
      return;
    }
    setBusy(row.id);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('admin_review_verification', {
        p_request_id: row.id,
        p_decision: decision,
        p_note: note || null,
      });
      if (error) throw error;
      setRows((r) => r.filter((x) => x.id !== row.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the decision');
    } finally {
      setBusy(null);
    }
  };

  if (rows.length === 0) {
    return <p className="text-sm text-zinc-600">No requests waiting.</p>;
  }

  return (
    <div className="space-y-4">
      {error ? <p className="rounded bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      {rows.map((row) => {
        const href = safeHref(row.evidence_url);
        return (
          <div key={row.id} className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <p className="font-medium text-zinc-900">{row.businesses?.name ?? 'Unknown host'}</p>
                <p className="text-xs text-zinc-500">
                  <span className="capitalize">{row.businesses?.host_type ?? 'venue'}</span> · requested{' '}
                  {new Date(row.created_at).toLocaleDateString()}
                  {row.status === 'needs_info' ? ' · waiting on the host' : ''}
                </p>
              </div>
              {row.businesses?.id ? (
                <a className="text-sm text-blue-700 hover:underline" href={`/businesses/${row.businesses.id}`}>
                  Host details
                </a>
              ) : null}
            </div>
            <p className="mt-3 text-sm">
              <span className="text-zinc-500">Evidence: </span>
              {href ? (
                <a className="break-all text-blue-700 hover:underline" href={href} target="_blank" rel="noopener noreferrer nofollow">
                  {row.evidence_url}
                </a>
              ) : (
                <span className="break-all">{row.evidence_url}</span>
              )}
            </p>
            {row.note ? <p className="mt-1 text-sm text-zinc-700">Host note: {row.note}</p> : null}
            {row.reviewer_note ? <p className="mt-1 text-sm text-zinc-500">Last asked: {row.reviewer_note}</p> : null}
            {row.status === 'pending' ? (
              <div className="mt-3 space-y-2">
                <label className="block text-xs text-zinc-600" htmlFor={`note-${row.id}`}>
                  Note to the host (required to ask for more or reject)
                </label>
                <textarea
                  id={`note-${row.id}`}
                  className="w-full rounded border border-zinc-300 p-2 text-sm"
                  rows={2}
                  maxLength={1000}
                  value={notes[row.id] ?? ''}
                  onChange={(e) => setNotes((n) => ({ ...n, [row.id]: e.target.value }))}
                />
                <div className="flex gap-2">
                  <button
                    className="rounded bg-green-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                    disabled={busy === row.id}
                    onClick={() => decide(row, 'approved')}
                  >
                    Approve
                  </button>
                  <button
                    className="rounded border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50"
                    disabled={busy === row.id}
                    onClick={() => decide(row, 'needs_info')}
                  >
                    Ask for more
                  </button>
                  <button
                    className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 disabled:opacity-50"
                    disabled={busy === row.id}
                    onClick={() => decide(row, 'rejected')}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
