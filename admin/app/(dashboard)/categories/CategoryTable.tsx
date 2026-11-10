'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { CategoryGlyph } from './CategoryGlyph';
import { describeWriteError, FALLBACK_COLOR, type AdminCategory } from './shared';

export type CategoryRow = AdminCategory & { total_events: number | null; upcoming_events: number | null };

export function CategoryTable({ rows, taxonomyMissing }: { rows: CategoryRow[]; taxonomyMissing: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const move = async (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const ids = rows.map((r) => r.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setBusy(rows[index].id);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('admin_reorder_categories', { p_ids: ids });
      const failure = describeWriteError(error);
      if (failure) setError(failure);
      else startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  };

  const toggleActive = async (row: CategoryRow) => {
    setBusy(row.id);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('categories')
        .update({ is_active: !(row.is_active ?? true) })
        .eq('id', row.id)
        .select('id');
      const failure = describeWriteError(error, data?.length ?? 0);
      if (failure) setError(failure);
      else startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      {error ? (
        <p role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="w-24 px-4 py-3 text-left font-medium text-zinc-700">Order</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Category</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Slug</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Search terms</th>
              <th className="px-4 py-3 text-right font-medium text-zinc-700">Events</th>
              <th className="px-4 py-3 text-right font-medium text-zinc-700">Upcoming</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Status</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const color = row.color ?? FALLBACK_COLOR;
              const active = row.is_active ?? true;
              const isBusy = busy === row.id;
              return (
                <tr key={row.id} className={`border-t border-zinc-200 ${active ? '' : 'bg-zinc-50 text-zinc-500'}`}>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void move(i, -1)}
                        disabled={i === 0 || isBusy}
                        aria-label={`Move ${row.label} up`}
                        className="rounded border border-zinc-300 px-1.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => void move(i, 1)}
                        disabled={i === rows.length - 1 || isBusy}
                        aria-label={`Move ${row.label} down`}
                        className="rounded border border-zinc-300 px-1.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <span className="ml-1 tabular-nums text-zinc-400">{row.sort_order}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-3">
                      <CategoryGlyph iconKey={row.icon_key} color={color} />
                      <div className="min-w-0">
                        <Link href={`/categories/${row.id}`} className="font-medium text-zinc-900 hover:underline">
                          {row.label}
                        </Link>
                        {row.description ? <p className="truncate text-xs text-zinc-500">{row.description}</p> : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-zinc-600">{row.slug}</td>
                  <td className="max-w-xs truncate px-4 py-2 text-xs text-zinc-600" title={(row.synonyms ?? []).join(', ')}>
                    {row.synonyms?.length ? row.synonyms.join(', ') : <span className="text-zinc-400">—</span>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{row.total_events ?? '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{row.upcoming_events ?? '—'}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        active ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-200 text-zinc-700'
                      }`}
                    >
                      {active ? 'Active' : 'Retired'}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-3">
                      <Link href={`/categories/${row.id}`} className="text-zinc-700 hover:underline">
                        Edit
                      </Link>
                      <button
                        type="button"
                        onClick={() => void toggleActive(row)}
                        disabled={isBusy || taxonomyMissing}
                        title={taxonomyMissing ? 'Needs the taxonomy migration' : undefined}
                        className="text-zinc-700 hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {active ? 'Retire' : 'Restore'}
                      </button>
                    </div>
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
