import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { BusinessesTable } from './BusinessesTable';

export default async function BusinessesPage() {
  const supabase = await createClient();
  const { data: businesses } = await supabase
    .from('businesses')
    .select(`
      id,
      name,
      category,
      subscription_tier,
      events_created_this_month,
      last_reset_date,
      created_at,
      profiles:owner_id (name)
    `)
    .order('created_at', { ascending: false });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">Businesses</h1>
      <BusinessesTable businesses={businesses ?? []} />
    </div>
  );
}
