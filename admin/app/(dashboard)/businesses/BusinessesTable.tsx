'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

type Business = {
  id: string;
  name: string;
  category: string;
  subscription_tier: string;
  events_created_this_month: number;
  last_reset_date: string;
  created_at: string;
  profiles: { name: string } | { name: string }[] | null;
};

export function BusinessesTable({ businesses }: { businesses: Business[] }) {
  const [filter, setFilter] = useState('');
  const [tiers, setTiers] = useState<Record<string, string>>(
    Object.fromEntries(businesses.map((b) => [b.id, b.subscription_tier]))
  );
  const [limits, setLimits] = useState<Record<string, number>>(
    Object.fromEntries(businesses.map((b) => [b.id, b.events_created_this_month]))
  );
  const [loading, setLoading] = useState<string | null>(null);

  const filtered = businesses.filter(
    (b) =>
      !filter ||
      b.name.toLowerCase().includes(filter.toLowerCase()) ||
      b.category.toLowerCase().includes(filter.toLowerCase())
  );

  const handleTogglePremium = async (businessId: string) => {
    setLoading(businessId);
    try {
      const supabase = createClient();
      const current = tiers[businessId];
      const isPremium = current === 'premium';
      const { error } = await supabase.rpc('admin_set_business_premium', {
        p_business_id: businessId,
        p_is_premium: !isPremium,
      });
      if (error) throw error;
      setTiers((prev) => ({ ...prev, [businessId]: isPremium ? 'free' : 'premium' }));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(null);
    }
  };

  const handleResetLimit = async (businessId: string) => {
    setLoading(businessId);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('admin_reset_business_event_limit', {
        p_business_id: businessId,
      });
      if (error) throw error;
      setLimits((prev) => ({ ...prev, [businessId]: 0 }));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div>
      <input
        type="search"
        placeholder="Search by name or category..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="mb-4 w-full max-w-md rounded-md border border-zinc-300 px-3 py-2 text-sm"
      />
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Name</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Owner</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Tier</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Events This Month</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((b) => (
              <tr key={b.id} className="border-t border-zinc-200">
                <td className="px-4 py-3">
                  <Link href={`/businesses/${b.id}`} className="font-medium text-zinc-900 hover:underline">
                    {b.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-zinc-600">
                  {Array.isArray(b.profiles) ? b.profiles[0]?.name : (b.profiles as { name: string })?.name ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      (tiers[b.id] ?? b.subscription_tier) === 'premium'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-zinc-100 text-zinc-700'
                    }`}
                  >
                    {tiers[b.id] ?? b.subscription_tier}
                  </span>
                </td>
                <td className="px-4 py-3">{limits[b.id] ?? b.events_created_this_month}</td>
                <td className="px-4 py-3 space-x-2">
                  {loading === b.id ? (
                    <span className="text-zinc-400">...</span>
                  ) : (
                    <>
                      <button
                        onClick={() => handleTogglePremium(b.id)}
                        className="text-blue-600 hover:text-blue-700"
                      >
                        {(tiers[b.id] ?? b.subscription_tier) === 'premium' ? 'Downgrade' : 'Upgrade'}
                      </button>
                      <span className="text-zinc-300">|</span>
                      <button
                        onClick={() => handleResetLimit(b.id)}
                        className="text-zinc-600 hover:text-zinc-900"
                      >
                        Reset limit
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
