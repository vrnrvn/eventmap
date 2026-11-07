'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { escapeLike } from '../SearchForm';

type Business = { id: string; name: string };

type BusinessSelectorProps = {
  value: string | null;
  onChange: (id: string | null) => void;
  required?: boolean;
};


export function BusinessSelector({ value, onChange, required }: BusinessSelectorProps) {
  const [search, setSearch] = useState('');
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selected, setSelected] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);

  // Keep the currently selected business available even when it doesn't
  // match the current search results.
  useEffect(() => {
    if (!value || selected?.id === value) return;
    const supabase = createClient();
    supabase
      .from('businesses')
      .select('id, name')
      .eq('id', value)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setSelected(data);
      });
  }, [value, selected]);

  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      const supabase = createClient();
      let query = supabase.from('businesses').select('id, name').order('name').limit(50);
      if (search.trim()) {
        query = query.ilike('name', `%${escapeLike(search.trim())}%`);
      }
      query.then(({ data, error }) => {
        if (cancelled) return;
        if (!error) setBusinesses(data ?? []);
        setLoading(false);
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [search]);

  const selectedBusiness = value && selected?.id === value ? selected : null;
  const options =
    selectedBusiness && !businesses.some((b) => b.id === selectedBusiness.id)
      ? [selectedBusiness, ...businesses]
      : businesses;

  return (
    <div className="space-y-2">
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search businesses by name..."
        className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
      />
      <select
        name="business_id"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        required={required}
        className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
      >
        <option value="">{loading ? 'Loading businesses...' : 'Select a business'}</option>
        {options.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </div>
  );
}
