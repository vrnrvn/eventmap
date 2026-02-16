'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function BusinessActions({ business }: { business: { id: string; subscription_tier: string } }) {
  const [loading, setLoading] = useState(false);
  const [tier, setTier] = useState(business.subscription_tier);

  const handleTogglePremium = async () => {
    setLoading(true);
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
    } finally {
      setLoading(false);
    }
  };

  const handleResetLimit = async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('admin_reset_business_event_limit', {
        p_business_id: business.id,
      });
      if (error) throw error;
      window.location.reload();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex gap-2">
      <button
        onClick={handleTogglePremium}
        disabled={loading}
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-800 disabled:opacity-50"
      >
        {tier === 'premium' ? 'Downgrade to Free' : 'Upgrade to Premium'}
      </button>
      <button
        onClick={handleResetLimit}
        disabled={loading}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50"
      >
        Reset Event Limit
      </button>
    </div>
  );
}
