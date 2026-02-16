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
  businesses: { name: string } | { name: string }[] | null;
};

export function EventsTable({ events }: { events: Event[] }) {
  const [filter, setFilter] = useState('');
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<string | null>(null);

  const filtered = events.filter(
    (e) =>
      !deleted.has(e.id) &&
      (!filter ||
        e.title.toLowerCase().includes(filter.toLowerCase()) ||
        (Array.isArray(e.businesses) ? e.businesses[0]?.name : (e.businesses as { name: string })?.name ?? '')
          .toLowerCase()
          .includes(filter.toLowerCase()))
  );

  const getBusinessName = (e: Event) => {
    const b = e.businesses;
    return Array.isArray(b) ? b[0]?.name : (b as { name: string })?.name ?? '—';
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
      <input
        type="search"
        placeholder="Search by title or business..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="mb-4 w-full max-w-md rounded-md border border-zinc-300 px-3 py-2 text-sm"
      />
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Title</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Business</th>
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
