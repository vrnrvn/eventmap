'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function EventDeleteButton({ eventId }: { eventId: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleDelete = async () => {
    if (!confirm('Delete this event?')) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.from('events').delete().eq('id', eventId);
      if (error) throw error;
      router.push('/events');
      router.refresh();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
    >
      {loading ? 'Deleting...' : 'Delete Event'}
    </button>
  );
}
