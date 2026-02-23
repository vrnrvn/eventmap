import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { DeletePromotionButton } from './DeletePromotionButton';

function targetType(p: {
  target_cities: string[] | null;
  target_lat: number | null;
  target_lng: number | null;
  target_radius_km: number | null;
}): string {
  const hasCity = p.target_cities && p.target_cities.length > 0;
  const hasRadius =
    p.target_lat != null && p.target_lng != null && p.target_radius_km != null;
  if (hasCity && hasRadius) return 'City + Radius';
  if (hasCity) return 'City';
  if (hasRadius) return 'Radius';
  return '—';
}

export default async function PromotionsPage() {
  const supabase = await createClient();
  const { data: promotions } = await supabase
    .from('promotional_notifications')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900">Promotional Notifications</h1>
        <Link
          href="/promotions/new"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          New Promotion
        </Link>
      </div>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Title</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Target</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Status</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Created</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(promotions ?? []).map((p) => (
              <tr key={p.id} className="border-t border-zinc-200">
                <td className="px-4 py-3 font-medium text-zinc-900">{p.title}</td>
                <td className="px-4 py-3 text-zinc-600">{targetType(p)}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      p.is_active ? 'bg-green-100 text-green-700' : 'bg-zinc-100 text-zinc-700'
                    }`}
                  >
                    {p.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-600">
                  {p.created_at
                    ? new Date(p.created_at).toLocaleDateString()
                    : '—'}
                </td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-3">
                    <Link
                      href={`/promotions/${p.id}`}
                      className="text-blue-600 hover:text-blue-700"
                    >
                      Edit
                    </Link>
                    <DeletePromotionButton
                      promotionId={p.id}
                      promotionTitle={p.title}
                    />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
