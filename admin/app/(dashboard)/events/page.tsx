import { createClient } from '@/lib/supabase/server';
import { EventsTable } from './EventsTable';
import { Pagination, pageFromParams, pageRange } from '../Pagination';
import { orIlike } from '../SearchForm';

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const page = pageFromParams(params.page);
  const q = typeof params.q === 'string' ? params.q.trim() : '';
  const category = typeof params.category === 'string' ? params.category.trim() : '';
  const [from, to] = pageRange(page);

  const supabase = await createClient();
  const { data: categories } = await supabase
    .from('categories')
    .select('id, slug, label, sort_order')
    .order('sort_order');

  let query = supabase
    .from('events')
    .select(
      `
      id,
      title,
      start_datetime,
      end_datetime,
      created_at,
      category_id,
      businesses (name),
      categories (label)
    `,
      { count: 'exact' }
    )
    .order('start_datetime', { ascending: false })
    .order('id')
    .range(from, to);

  if (q) {
    query = query.or(orIlike(['title', 'description', 'address'], q));
  }
  // Only a known category id is accepted; anything else is ignored rather
  // than producing an empty page.
  const activeCategory = (categories ?? []).find((c) => c.id === category);
  if (activeCategory) {
    query = query.eq('category_id', activeCategory.id);
  }

  const { data: events, count } = await query;
  const pageQuery: Record<string, string> = {};
  if (q) pageQuery.q = q;
  if (activeCategory) pageQuery.category = activeCategory.id;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">Events</h1>
      <form action="/events" method="GET" className="mb-4 flex max-w-2xl flex-wrap gap-2">
        <input
          type="search"
          name="q"
          placeholder="Search title, description or address..."
          defaultValue={q}
          className="w-full min-w-[16rem] flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
        <select
          name="category"
          defaultValue={activeCategory?.id ?? ''}
          aria-label="Category"
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700"
        >
          <option value="">All categories</option>
          {(categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
        >
          Filter
        </button>
      </form>
      <EventsTable key={`${page}:${q}:${activeCategory?.id ?? ''}`} events={events ?? []} />
      <Pagination
        page={page}
        count={count}
        basePath="/events"
        query={Object.keys(pageQuery).length ? pageQuery : undefined}
      />
    </div>
  );
}
