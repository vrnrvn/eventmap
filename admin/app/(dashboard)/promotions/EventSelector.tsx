'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Event = {
  id: string;
  title: string;
  business_id: string;
  businesses: { name: string } | { name: string }[] | null;
};

type EventSelectorProps = {
  value: string | null;
  onChange: (id: string | null) => void;
  required?: boolean;
};

export function EventSelector({ value, onChange, required }: EventSelectorProps) {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from('events')
      .select('id, title, business_id, businesses(name)')
      .order('start_datetime', { ascending: false })
      .limit(500)
      .then(({ data, error }) => {
        if (!error) setEvents(data ?? []);
        setLoading(false);
      });
  }, []);

  const getLabel = (e: Event) => {
    const b = e.businesses;
    const name = Array.isArray(b) ? b[0]?.name : (b as { name: string })?.name;
    return `${e.title} (${name ?? '—'})`;
  };

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading events...</p>;
  }

  return (
    <select
      name="event_id"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      required={required}
      className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
    >
      <option value="">Select an event</option>
      {events.map((e) => (
        <option key={e.id} value={e.id}>
          {getLabel(e)}
        </option>
      ))}
    </select>
  );
}
