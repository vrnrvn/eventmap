import { createClient } from '@/lib/supabase/server';
import { ComplaintsTable } from './ComplaintsTable';
import { Pagination, pageFromParams, pageRange } from '../Pagination';

export default async function ComplaintsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const page = pageFromParams(params.page);
  const [from, to] = pageRange(page);

  const supabase = await createClient();
  const { data: complaints, count } = await supabase
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

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">Complaints</h1>
      <ComplaintsTable key={page} complaints={complaints ?? []} />
      <Pagination page={page} count={count} basePath="/complaints" />
    </div>
  );
}
