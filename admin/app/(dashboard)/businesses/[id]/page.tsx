import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BusinessActions } from './BusinessActions';

export default async function BusinessDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: business } = await supabase
    .from('businesses')
    .select(`
      *,
      profiles:owner_id (id, name)
    `)
    .eq('id', id)
    .single();

  if (!business) notFound();

  const owner = Array.isArray(business.profiles) ? business.profiles[0] : business.profiles;

  return (
    <div>
      <Link href="/businesses" className="mb-4 inline-block text-sm text-zinc-600 hover:text-zinc-900">
        ← Back to Businesses
      </Link>
      <div className="rounded-lg border border-zinc-200 bg-white p-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-zinc-900">{business.name}</h1>
          <BusinessActions business={business} />
        </div>
        <dl className="space-y-3">
          <div>
            <dt className="text-sm text-zinc-500">Category</dt>
            <dd>{business.category}</dd>
          </div>
          <div>
            <dt className="text-sm text-zinc-500">Subscription</dt>
            <dd>
              <span
                className={`rounded px-2 py-0.5 text-xs ${
                  business.subscription_tier === 'premium' ? 'bg-amber-100 text-amber-800' : 'bg-zinc-100 text-zinc-700'
                }`}
              >
                {business.subscription_tier}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-sm text-zinc-500">Events this month</dt>
            <dd>{business.events_created_this_month}</dd>
          </div>
          <div>
            <dt className="text-sm text-zinc-500">Owner</dt>
            <dd>
              <Link href={`/users/${business.owner_id}`} className="text-blue-600 hover:underline">
                {owner?.name ?? business.owner_id}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-sm text-zinc-500">Address</dt>
            <dd>{business.address}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
