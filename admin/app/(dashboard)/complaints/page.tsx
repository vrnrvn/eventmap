import { createClient } from '@/lib/supabase/server';
import { ComplaintsTable } from './ComplaintsTable';
import { Pagination, pageFromParams, pageRange } from '../Pagination';

const STATUSES = ['pending', 'resolved', 'dismissed'];

export default async function ComplaintsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const page = pageFromParams(params.page);
  const status = typeof params.status === 'string' && STATUSES.includes(params.status) ? params.status : 'all';
  const [from, to] = pageRange(page);

  const supabase = await createClient();
  // The status filter runs in the query so it covers every page.
  let query = supabase
    .from('complaints')
    .select(
      `
      id,
      reporter_id,
      target_type,
      target_id,
      reason,
      status,
      created_at,
      profiles:reporter_id (name)
    `,
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .order('id')
    .range(from, to);
  if (status !== 'all') query = query.eq('status', status);
  const { data: complaints, count } = await query;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">Complaints</h1>
      <ComplaintsTable key={`${page}:${status}`} complaints={complaints ?? []} statusFilter={status} />
      <Pagination
        page={page}
        count={count}
        basePath="/complaints"
        query={status !== 'all' ? { status } : undefined}
      />
    </div>
  );
}
