import { createClient } from '@/lib/supabase/server';
import { ComplaintsTable } from './ComplaintsTable';

export default async function ComplaintsPage() {
  const supabase = await createClient();
  const { data: complaints } = await supabase
    .from('complaints')
    .select(`
      id,
      reporter_id,
      target_type,
      target_id,
      reason,
      status,
      created_at,
      profiles:reporter_id (name)
    `)
    .order('created_at', { ascending: false });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">Complaints</h1>
      <ComplaintsTable complaints={complaints ?? []} />
    </div>
  );
}
