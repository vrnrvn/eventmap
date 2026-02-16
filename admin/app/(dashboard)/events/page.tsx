import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { EventsTable } from './EventsTable';

export default async function EventsPage() {
  const supabase = await createClient();
  const { data: events } = await supabase
    .from('events')
    .select(`
      id,
      title,
      start_datetime,
      end_datetime,
      created_at,
      businesses (name)
    `)
    .order('start_datetime', { ascending: false });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">Events</h1>
      <EventsTable events={events ?? []} />
    </div>
  );
}
