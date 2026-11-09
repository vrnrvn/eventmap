import { createClient } from '@/lib/supabase/server';
import { EventsTable } from './EventsTable';
import { Pagination, pageFromParams, pageRange } from '../Pagination';
import { SearchForm, orIlike } from '../SearchForm';

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const page = pageFromParams(params.page);
  const q = typeof params.q === 'string' ? params.q.trim() : '';
  const [from, to] = pageRange(page);

  const supabase = await createClient();
  let query = supabase
    .from('events')
    .select(
      `
      id,
      title,
      start_datetime,
      end_datetime,
      created_at,
      businesses (name)
    `,
      { count: 'exact' }
    )
    .order('start_datetime', { ascending: false })
    .order('id')
    .range(from, to);

  if (q) {
    query = query.or(orIlike(['title', 'description', 'address'], q));
  }

  const { data: events, count } = await query;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">Events</h1>
      <SearchForm action="/events" placeholder="Search title, description or address..." defaultValue={q} />
      <EventsTable key={`${page}:${q}`} events={events ?? []} />
      <Pagination page={page} count={count} basePath="/events" query={q ? { q } : undefined} />
    </div>
  );
}
