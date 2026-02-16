import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';

export default async function BannersPage() {
  const supabase = await createClient();
  const { data: banners } = await supabase
    .from('app_banners')
    .select('*')
    .order('sort_order', { ascending: true });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900">Banners / Ads</h1>
        <Link
          href="/banners/new"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          Add Banner
        </Link>
      </div>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Title</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Type</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Placement</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Status</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(banners ?? []).map((b) => (
              <tr key={b.id} className="border-t border-zinc-200">
                <td className="px-4 py-3 font-medium text-zinc-900">{b.title}</td>
                <td className="px-4 py-3 text-zinc-600">{b.type}</td>
                <td className="px-4 py-3 text-zinc-600">{b.placement}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      b.is_active ? 'bg-green-100 text-green-700' : 'bg-zinc-100 text-zinc-700'
                    }`}
                  >
                    {b.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/banners/${b.id}`}
                    className="text-blue-600 hover:text-blue-700"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
