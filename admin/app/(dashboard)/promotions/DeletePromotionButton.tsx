'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type DeletePromotionButtonProps = {
  promotionId: string;
  promotionTitle: string;
  variant?: 'link' | 'button';
};

export function DeletePromotionButton({
  promotionId,
  promotionTitle,
  variant = 'link',
}: DeletePromotionButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Delete promotion "${promotionTitle}"? This cannot be undone.`)) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('promotional_notifications')
        .delete()
        .eq('id', promotionId);
      if (error) throw error;
      router.push('/promotions');
      router.refresh();
    } catch (e) {
      console.error(e);
      alert('Failed to delete promotion');
    } finally {
      setLoading(false);
    }
  };

  if (variant === 'button') {
    return (
      <button
        type="button"
        onClick={handleDelete}
        disabled={loading}
        className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
      >
        {loading ? 'Deleting...' : 'Delete'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={loading}
      className="text-red-600 hover:text-red-700 disabled:opacity-50"
    >
      {loading ? '...' : 'Delete'}
    </button>
  );
}
