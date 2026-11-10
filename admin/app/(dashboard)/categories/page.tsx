import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { CategoryTable, type CategoryRow } from './CategoryTable';
import { ADMIN_MIGRATION, TAXONOMY_MISSING_MESSAGE, type AdminCategory } from './shared';

const FULL_COLUMNS = 'id, slug, label, icon_key, sort_order, created_at, color, description, synonyms, is_active';
const BASE_COLUMNS = 'id, slug, label, icon_key, sort_order, created_at';

const NOTICES: Record<string, string> = {
  saved: 'Category saved.',
  'taxonomy-missing': `Saved label, slug and icon only. ${TAXONOMY_MISSING_MESSAGE}`,
};

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const notice = typeof params.notice === 'string' ? NOTICES[params.notice] : undefined;
  const supabase = await createClient();

  // Taxonomy columns arrive with 20261109100000; before that the select
  // fails with 42703 and the page shows what it can.
  let taxonomyMissing = false;
  let list: AdminCategory[] = [];
  let error: { code?: string; message: string } | null = null;
  const full = await supabase.from('categories').select(FULL_COLUMNS).order('sort_order');
  if (full.error?.code === '42703') {
    taxonomyMissing = true;
    const base = await supabase.from('categories').select(BASE_COLUMNS).order('sort_order');
    list = (base.data ?? []) as unknown as AdminCategory[];
    error = base.error;
  } else {
    list = (full.data ?? []) as unknown as AdminCategory[];
    error = full.error;
  }

  // Event counts: one RPC when available, else one count per category
  // (12 cheap head requests) so the column still works pre-migration.
  const stats = new Map<string, { total: number; upcoming: number | null }>();
  const { data: statRows, error: statError } = await supabase.rpc('admin_category_stats');
  if (!statError && Array.isArray(statRows)) {
    for (const r of statRows as { category_id: string; total_events: number; upcoming_events: number }[]) {
      stats.set(r.category_id, { total: Number(r.total_events), upcoming: Number(r.upcoming_events) });
    }
  } else {
    await Promise.all(
      list.map(async (c) => {
        const { count } = await supabase
          .from('events')
          .select('id', { count: 'exact', head: true })
          .eq('category_id', c.id);
        stats.set(c.id, { total: count ?? 0, upcoming: null });
      })
    );
  }

  const rows: CategoryRow[] = list.map((c) => ({
    ...c,
    total_events: stats.get(c.id)?.total ?? null,
    upcoming_events: stats.get(c.id)?.upcoming ?? null,
  }));

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900">Categories</h1>
        <Link
          href="/categories/new"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          New category
        </Link>
      </div>

      {notice ? (
        <p role="status" className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}
      {taxonomyMissing ? (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {TAXONOMY_MISSING_MESSAGE} The app shows these categories with bundled colours and icons in the meantime.
        </p>
      ) : null}
      <p className="mb-4 text-sm text-zinc-600">
        Order here is the order in the app&apos;s pickers and Discover chips. Categories cannot be deleted while events
        use them; retire them instead. Writes need{' '}
        <code className="rounded bg-zinc-100 px-1 text-xs">{ADMIN_MIGRATION}</code>; until it is applied the page is
        read-only and says so when you try.
      </p>

      {error ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Couldn&apos;t load categories: {error.message}
        </p>
      ) : (
        <CategoryTable rows={rows} taxonomyMissing={taxonomyMissing} />
      )}
    </div>
  );
}
