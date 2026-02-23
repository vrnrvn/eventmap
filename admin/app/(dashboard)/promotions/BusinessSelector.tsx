'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Business = { id: string; name: string };

type BusinessSelectorProps = {
  value: string | null;
  onChange: (id: string | null) => void;
  required?: boolean;
};

export function BusinessSelector({ value, onChange, required }: BusinessSelectorProps) {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from('businesses')
      .select('id, name')
      .order('name')
      .then(({ data, error }) => {
        if (!error) setBusinesses(data ?? []);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading businesses...</p>;
  }

  return (
    <select
      name="business_id"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      required={required}
      className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
    >
      <option value="">Select a business</option>
      {businesses.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </select>
  );
}
