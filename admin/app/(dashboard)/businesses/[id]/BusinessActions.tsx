'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function BusinessActions({
  business,
}: {
  business: { id: string; subscription_tier: string; verified: boolean | null };
}) {
  const [loading, setLoading] = useState(false);
  const [tier, setTier] = useState(business.subscription_tier);
  const [verified, setVerified] = useState(!!business.verified);
  const [error, setError] = useState<string | null>(null);

  const handleTogglePremium = async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const isPremium = tier === 'premium';
      const { error } = await supabase.rpc('admin_set_business_premium', {
        p_business_id: business.id,
        p_is_premium: !isPremium,
      });
      if (error) throw error;
      setTier(isPremium ? 'free' : 'premium');
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Failed to update subscription');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleVerified = async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      // RPC ships with migration 20261030113000; until applied this errors
      // (missing function) and the message is surfaced below.
      const { error } = await supabase.rpc('admin_set_business_verified', {
        p_business_id: business.id,
        p_verified: !verified,
      });
      if (error) throw error;
      setVerified(!verified);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Failed to update verification');
    } finally {
      setLoading(false);
    }
  };

  const handleResetLimit = async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('admin_reset_business_event_limit', {
        p_business_id: business.id,
      });
      if (error) throw error;
      window.location.reload();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Failed to reset event limit');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <button
          onClick={handleTogglePremium}
          disabled={loading}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {tier === 'premium' ? 'Downgrade to Free' : 'Upgrade to Premium'}
        </button>
        <button
          onClick={handleToggleVerified}
          disabled={loading}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50"
        >
          {verified ? 'Unverify' : 'Verify'}
        </button>
        <button
          onClick={handleResetLimit}
          disabled={loading}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50"
        >
          Reset Event Limit
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
