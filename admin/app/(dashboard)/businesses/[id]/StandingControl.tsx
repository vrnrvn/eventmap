'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type Standing = 'good' | 'warning' | 'restricted';

/**
 * Host standing (migration 20261110140000). `restricted` pauses publishing;
 * the host sees the reason in the app, so a reason is required for anything
 * other than good standing.
 */
export function StandingControl({
  businessId,
  standing,
  reason,
}: {
  businessId: string;
  standing: Standing;
  reason: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState<Standing>(standing);
  const [text, setText] = useState(reason ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (value !== 'good' && !text.trim()) {
      setError('Add a reason. The host will see it.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('admin_set_host_standing', {
        p_business_id: businessId,
        p_standing: value,
        p_reason: value === 'good' ? null : text.trim(),
      });
      if (error) throw error;
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const changed = value !== standing || (value !== 'good' && text.trim() !== (reason ?? ''));

  return (
    <div className="mt-6 rounded border border-zinc-200 p-4">
      <h2 className="mb-1 text-sm font-semibold text-zinc-900">Host standing</h2>
      <p className="mb-3 text-xs text-zinc-500">Restricted pauses publishing; drafts and existing events are kept.</p>
      <div className="mb-3 flex gap-4" role="radiogroup" aria-label="Host standing">
        {(['good', 'warning', 'restricted'] as const).map((s) => (
          <label key={s} className="flex items-center gap-2 text-sm capitalize">
            <input type="radio" name="standing" checked={value === s} onChange={() => setValue(s)} />
            {s}
          </label>
        ))}
      </div>
      {value !== 'good' ? (
        <>
          <label className="mb-1 block text-xs text-zinc-600" htmlFor="standing-reason">
            Reason shown to the host
          </label>
          <textarea
            id="standing-reason"
            className="mb-3 w-full rounded border border-zinc-300 p-2 text-sm"
            rows={2}
            maxLength={500}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </>
      ) : null}
      {error ? <p className="mb-2 text-sm text-red-700">{error}</p> : null}
      <button
        className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        disabled={!changed || busy}
        onClick={save}
      >
        Save standing
      </button>
    </div>
  );
}
