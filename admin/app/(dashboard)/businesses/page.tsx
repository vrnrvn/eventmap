import { createClient } from '@/lib/supabase/server';
import { BusinessesTable } from './BusinessesTable';
import { Pagination, pageFromParams, pageRange } from '../Pagination';
import { SearchForm, orIlike } from '../SearchForm';

export default async function BusinessesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const page = pageFromParams(params.page);
  const q = typeof params.q === 'string' ? params.q.trim() : '';
  const [from, to] = pageRange(page);

  const supabase = await createClient();
  // Search runs in the query so it covers every page, not just this one.
  let query = supabase
    .from('businesses')
    .select(
      `
      id,
      name,
      category,
      subscription_tier,
      verified,
      events_created_this_month,
      last_reset_date,
      created_at,
      profiles:owner_id (name)
    `,
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .order('id')
    .range(from, to);
  if (q) query = query.or(orIlike(['name', 'category'], q));
  const { data: businesses, count } = await query;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">Businesses</h1>
      <SearchForm action="/businesses" placeholder="Search by name or category..." defaultValue={q} />
      <BusinessesTable key={`${page}:${q}`} businesses={businesses ?? []} />
      <Pagination page={page} count={count} basePath="/businesses" query={q ? { q } : undefined} />
    </div>
  );
}
