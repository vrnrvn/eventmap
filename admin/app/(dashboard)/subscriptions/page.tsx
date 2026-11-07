import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { Pagination, pageFromParams, pageRange } from '../Pagination';

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const page = pageFromParams(params.page);
  const [from, to] = pageRange(page);

  const supabase = await createClient();

  const [{ data: businesses, count }, { count: premiumCount }, { count: freeCount }] =
    await Promise.all([
      supabase
        .from('businesses')
        .select(
          `
      id,
      name,
      subscription_tier,
      subscription_expires_at,
      events_created_this_month,
      profiles:owner_id (name)
    `,
          { count: 'exact' }
        )
        .order('subscription_tier', { ascending: false })
    .order('id')
        .range(from, to),
      supabase
        .from('businesses')
        .select('*', { count: 'exact', head: true })
        .eq('subscription_tier', 'premium'),
      supabase
        .from('businesses')
        .select('*', { count: 'exact', head: true })
        .eq('subscription_tier', 'free'),
    ]);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">Subscriptions</h1>
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-sm text-zinc-600">Premium</p>
          <p className="text-2xl font-semibold text-zinc-900">{premiumCount ?? 0}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-sm text-zinc-600">Free</p>
          <p className="text-2xl font-semibold text-zinc-900">{freeCount ?? 0}</p>
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
      <Pagination page={page} count={count} basePath="/subscriptions" />
    </div>
  );
}
