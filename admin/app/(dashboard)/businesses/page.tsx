import { createClient } from '@/lib/supabase/server';
import { BusinessesTable } from './BusinessesTable';
import { Pagination, pageFromParams, pageRange } from '../Pagination';

export default async function BusinessesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const page = pageFromParams(params.page);
  const [from, to] = pageRange(page);

  const supabase = await createClient();
  const { data: businesses, count } = await supabase
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

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">Businesses</h1>
      <BusinessesTable key={page} businesses={businesses ?? []} />
      <Pagination page={page} count={count} basePath="/businesses" />
    </div>
  );
}
