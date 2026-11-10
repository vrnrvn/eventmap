/** Row shape the categories pages work with (new columns optional pre-migration). */
export type AdminCategory = {
  id: string;
  slug: string;
  label: string;
  icon_key: string;
  sort_order: number;
  created_at: string;
  color?: string | null;
  description?: string | null;
  synonyms?: string[] | null;
  is_active?: boolean | null;
};

export const TAXONOMY_MIGRATION = '20261109100000_category_taxonomy.sql';
export const ADMIN_MIGRATION = '20261109120000_admin_categories.sql';

export const READ_ONLY_MESSAGE =
  `Categories are read-only until supabase/migrations/${ADMIN_MIGRATION} is applied (admins have no write access yet).`;
export const TAXONOMY_MISSING_MESSAGE =
  `supabase/migrations/${TAXONOMY_MIGRATION} is not applied: colour, description, search terms and the active flag are not stored yet.`;

/** Colour shown for a row whose database has no colour column yet. */
export const FALLBACK_COLOR = '#607d8b';

type PgError = { code?: string; message?: string } | null | undefined;

/** Map a PostgREST/Postgres error on a categories write to a sentence for admins. */
export function describeWriteError(error: PgError, rowsAffected?: number): string | null {
  if (!error) {
    if (rowsAffected === 0) return READ_ONLY_MESSAGE;
    return null;
  }
  switch (error.code) {
    case '42501':
      return READ_ONLY_MESSAGE;
    case 'PGRST202':
    case '42883':
      return READ_ONLY_MESSAGE;
    case '42703':
      return TAXONOMY_MISSING_MESSAGE;
    case '23505':
      return 'That slug is already used by another category.';
    case '23514':
      return 'Rejected by the database: check the slug (lower-case, hyphens) and the colour (#rrggbb).';
    default:
      if (error.message?.includes('invalid_category')) {
        return error.message.replace(/^invalid_category:\s*/, '');
      }
      return error.message ?? 'Something went wrong.';
  }
}
