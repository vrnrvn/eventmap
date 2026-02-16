import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';

export default async function SubscriptionsPage() {
  const supabase = await createClient();

  const { data: businesses } = await supabase
    .from('businesses')
    .select(`
      id,
      name,
      subscription_tier,
      subscription_expires_at,
      events_created_this_month,
      profiles:owner_id (name)
    `)
    .order('subscription_tier', { ascending: false });

  const premium = (businesses ?? []).filter((b) => b.subscription_tier === 'premium');
  const free = (businesses ?? []).filter((b) => b.subscription_tier === 'free');

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">Subscriptions</h1>
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-sm text-zinc-600">Premium</p>
          <p className="text-2xl font-semibold text-zinc-900">{premium.length}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-sm text-zinc-600">Free</p>
          <p className="text-2xl font-semibold text-zinc-900">{free.length}</p>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Business</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Owner</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Tier</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Expires</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Events This Month</th>
            </tr>
          </thead>
          <tbody>
            {(businesses ?? []).map((b) => {
              const owner = Array.isArray(b.profiles) ? b.profiles[0] : b.profiles;
              return (
                <tr key={b.id} className="border-t border-zinc-200">
                  <td className="px-4 py-3">
                    <Link
                      href={`/businesses/${b.id}`}
                      className="font-medium text-zinc-900 hover:underline"
                    >
                      {b.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{owner?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        b.subscription_tier === 'premium'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-zinc-100 text-zinc-700'
                      }`}
                    >
                      {b.subscription_tier}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-600">
                    {b.subscription_expires_at
                      ? new Date(b.subscription_expires_at).toLocaleDateString()
                      : '—'}
                  </td>
                  <td className="px-4 py-3">{b.events_created_this_month}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
