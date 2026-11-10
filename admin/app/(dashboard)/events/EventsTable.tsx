'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

type Event = {
  id: string;
  title: string;
  start_datetime: string;
  end_datetime: string;
  created_at: string;
  category_id?: string | null;
  businesses: { name: string } | { name: string }[] | null;
  categories?: { label: string } | { label: string }[] | null;
};

export function EventsTable({ events }: { events: Event[] }) {
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<string | null>(null);

  const filtered = events.filter((e) => !deleted.has(e.id));

  const getBusinessName = (e: Event) => {
    const b = e.businesses;
    return Array.isArray(b) ? b[0]?.name : (b as { name: string })?.name ?? '—';
  };

  const getCategoryLabel = (e: Event) => {
    const c = e.categories;
    return (Array.isArray(c) ? c[0]?.label : c?.label) ?? '—';
  };

  const handleDelete = async (eventId: string) => {
    if (!confirm('Delete this event?')) return;
    setLoading(eventId);
    try {
      const supabase = createClient();
      const { error } = await supabase.from('events').delete().eq('id', eventId);
      if (error) throw error;
      setDeleted((prev) => new Set(prev).add(eventId));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Title</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Business</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Category</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Start</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">End</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id} className="border-t border-zinc-200">
                <td className="px-4 py-3">
                  <Link href={`/events/${e.id}`} className="font-medium text-zinc-900 hover:underline">
                    {e.title}
                  </Link>
                </td>
                <td className="px-4 py-3 text-zinc-600">{getBusinessName(e)}</td>
                <td className="px-4 py-3 text-zinc-600">{getCategoryLabel(e)}</td>
                <td className="px-4 py-3 text-zinc-600">
                  {new Date(e.start_datetime).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-zinc-600">
                  {new Date(e.end_datetime).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  {loading === e.id ? (
                    <span className="text-zinc-400">...</span>
                  ) : (
                    <button
                      onClick={() => handleDelete(e.id)}
                      className="text-red-600 hover:text-red-700"
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
