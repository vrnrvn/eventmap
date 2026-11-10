import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { CategoryForm } from '../CategoryForm';
import { saveCategory } from '../actions';
import type { AdminCategory } from '../shared';

export default async function EditCategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  // select('*') works on any schema version; the form treats the taxonomy
  // columns as optional.
  const { data: category } = await supabase.from('categories').select('*').eq('id', id).maybeSingle();
  if (!category) notFound();

  const update = saveCategory.bind(null, id);
  const row = category as unknown as AdminCategory;

  return (
    <div>
      <Link href="/categories" className="mb-4 inline-block text-sm text-zinc-600 hover:text-zinc-900">
        ← Back to Categories
      </Link>
      <h1 className="mb-1 text-2xl font-semibold text-zinc-900">Edit category</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Changes show in the app within a day (categories are cached on devices) or on the next cold start.
      </p>
      <CategoryForm action={update} category={row} lockSlug />
    </div>
  );
}
