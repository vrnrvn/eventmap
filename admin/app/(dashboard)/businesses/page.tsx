import { createClient } from '@/lib/supabase/server';
import { BusinessesTable, type Business } from './BusinessesTable';
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
  const baseColumns = `
      id,
      name,
      category,
      subscription_tier,
      verified,
      events_created_this_month,
      last_reset_date,
      created_at,
      profiles:owner_id (name)`;
  // Host columns come from migration 20261110110000. If it is not applied the
  // select fails with 42703 (undefined column); retry without them.
  const hostColumns = `,
      host_type,
      location_kind,
      host_terms_version,
      host_terms_accepted_at`;
  const run = (columns: string) => {
    let query = supabase
      .from('businesses')
      .select(columns, { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to);
    if (q) query = query.or(orIlike(['name', 'category'], q));
    return query;
  };
  let result = await run(baseColumns + hostColumns);
  if (result.error?.code === '42703') result = await run(baseColumns);
  const { data: businesses, count } = result;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">Businesses</h1>
      <SearchForm action="/businesses" placeholder="Search by name or category..." defaultValue={q} />
      <BusinessesTable key={`${page}:${q}`} businesses={(businesses ?? []) as unknown as Business[]} />
      <Pagination page={page} count={count} basePath="/businesses" query={q ? { q } : undefined} />
    </div>
  );
}
