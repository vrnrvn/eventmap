'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { CATEGORY_ICON_KEYS } from '@/lib/categoryIcons';
import { hasErrors, readCategoryForm, type CategoryFormErrors, type CategoryInput } from '@/lib/categoryForm';
import { describeWriteError } from './shared';

export type CategoryActionState = {
  errors: CategoryFormErrors;
  /** Whole-form failure (permissions, duplicate slug…). */
  message: string | null;
  /** Echoed back so the form keeps what was typed after a failed submit. */
  values: CategoryInput | null;
};

export const INITIAL_CATEGORY_STATE: CategoryActionState = { errors: {}, message: null, values: null };

/**
 * Create (id null) or update a category. Writes go through the admin's own
 * session, so RLS decides: before 20261109120000 an update touches 0 rows
 * and an insert is refused, and the message says so.
 *
 * If the taxonomy columns don't exist yet (42703) the base columns are saved
 * anyway and the list page explains what was dropped.
 */
export async function saveCategory(
  id: string | null,
  _prev: CategoryActionState,
  formData: FormData
): Promise<CategoryActionState> {
  const { value, errors } = readCategoryForm(formData, CATEGORY_ICON_KEYS);
  if (hasErrors(errors)) return { errors, message: null, values: value };

  const supabase = await createClient();
  const full = {
    slug: value.slug,
    label: value.label,
    icon_key: value.icon_key,
    color: value.color,
    description: value.description,
    synonyms: value.synonyms,
    is_active: value.is_active,
  };
  const base = { slug: value.slug, label: value.label, icon_key: value.icon_key };

  let notice: string | null = null;
  const write = async (payload: Record<string, unknown>) => {
    if (id) {
      const { data, error } = await supabase.from('categories').update(payload).eq('id', id).select('id');
      return { error, rows: data?.length ?? 0 };
    }
    const { data: maxRow } = await supabase
      .from('categories')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    const sort_order = ((maxRow as { sort_order?: number } | null)?.sort_order ?? 0) + 1;
    const { data, error } = await supabase.from('categories').insert({ ...payload, sort_order }).select('id');
    return { error, rows: data?.length ?? 0 };
  };

  let result = await write(full);
  if (result.error?.code === '42703') {
    notice = 'taxonomy-missing';
    result = await write(base);
  }
  const failure = describeWriteError(result.error, result.rows);
  if (failure) return { errors: {}, message: failure, values: value };

  revalidatePath('/categories');
  redirect(notice ? `/categories?notice=${notice}` : '/categories?notice=saved');
}
