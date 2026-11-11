'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export type Business = {
  id: string;
  name: string;
  category: string;
  subscription_tier: string;
  verified: boolean | null;
  events_created_this_month: number;
  last_reset_date: string;
  created_at: string;
  profiles: { name: string } | { name: string }[] | null;
  /** Undefined when migration 20261110110000 is not applied. */
  host_type?: 'venue' | 'organiser' | 'individual';
  location_kind?: 'fixed' | 'area' | 'none';
  host_terms_version?: number | null;
  host_terms_accepted_at?: string | null;
};

const LOCATION_LABEL = { fixed: 'address', area: 'home area', none: 'no location' } as const;

export function BusinessesTable({ businesses }: { businesses: Business[] }) {
  const [tiers, setTiers] = useState<Record<string, string>>(
    Object.fromEntries(businesses.map((b) => [b.id, b.subscription_tier]))
  );
  const [verifiedMap, setVerifiedMap] = useState<Record<string, boolean>>(
    Object.fromEntries(businesses.map((b) => [b.id, !!b.verified]))
  );
  const [limits, setLimits] = useState<Record<string, number>>(
    Object.fromEntries(businesses.map((b) => [b.id, b.events_created_this_month]))
  );
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);


  const handleTogglePremium = async (businessId: string) => {
    setLoading(businessId);
    setError(null);
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
      setError(e instanceof Error ? e.message : 'Failed to update subscription');
    } finally {
      setLoading(null);
    }
  };

  const handleToggleVerified = async (businessId: string) => {
    setLoading(businessId);
    setError(null);
    try {
      const supabase = createClient();
      const current = !!verifiedMap[businessId];
      // RPC ships with migration 20261030113000; until applied this errors
      // (missing function) and the message is surfaced above the table.
      const { error } = await supabase.rpc('admin_set_business_verified', {
        p_business_id: businessId,
        p_verified: !current,
      });
      if (error) throw error;
      setVerifiedMap((prev) => ({ ...prev, [businessId]: !current }));
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Failed to update verification');
    } finally {
      setLoading(null);
    }
  };

  const handleResetLimit = async (businessId: string) => {
    setLoading(businessId);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('admin_reset_business_event_limit', {
        p_business_id: businessId,
      });
      if (error) throw error;
      setLimits((prev) => ({ ...prev, [businessId]: 0 }));
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Failed to reset event limit');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Name</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Owner</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Host type</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Guidelines</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Tier</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Verified</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Events This Month</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-700">Actions</th>
            </tr>
          </thead>
          <tbody>
            {businesses.map((b) => (
              <tr key={b.id} className="border-t border-zinc-200">
                <td className="px-4 py-3">
                  <Link href={`/businesses/${b.id}`} className="font-medium text-zinc-900 hover:underline">
                    {b.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-zinc-600">
                  {Array.isArray(b.profiles) ? b.profiles[0]?.name : (b.profiles as { name: string })?.name ?? '—'}
                </td>
                <td className="px-4 py-3 text-zinc-600">
                  {b.host_type ? (
                    <>
                      <span className="capitalize">{b.host_type}</span>
                      <span className="block text-xs text-zinc-400">{LOCATION_LABEL[b.location_kind ?? 'fixed']}</span>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-4 py-3">
                  {b.host_terms_version ? (
                    <span
                      className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800"
                      title={b.host_terms_accepted_at ? new Date(b.host_terms_accepted_at).toLocaleString() : undefined}
                    >
                      v{b.host_terms_version}
                    </span>
                  ) : (
                    <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">{b.host_type ? 'not accepted' : '—'}</span>
                  )}
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
                <td className="px-4 py-3">
                  {(verifiedMap[b.id] ?? !!b.verified) ? (
                    <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800">verified</span>
                  ) : (
                    <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">—</span>
                  )}
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
                        onClick={() => handleToggleVerified(b.id)}
                        className="text-blue-600 hover:text-blue-700"
                      >
                        {(verifiedMap[b.id] ?? !!b.verified) ? 'Unverify' : 'Verify'}
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
