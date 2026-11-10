/**
 * Pure validation for the admin category form. Mirrors the database rules in
 * supabase/migrations/20261109100000_category_taxonomy.sql (hex colour) and
 * 20261109120000_admin_categories.sql (slug format) so mistakes are caught
 * before a round-trip. Unit-tested from the app repo
 * (tests/adminCategoryForm.test.ts).
 */

export type CategoryInput = {
  slug: string;
  label: string;
  description: string;
  icon_key: string;
  color: string;
  synonyms: string[];
  is_active: boolean;
};

export type CategoryFormErrors = Partial<Record<keyof CategoryInput, string>>;

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;
export const MAX_LABEL = 40;
export const MAX_DESCRIPTION = 120;
export const MAX_SYNONYMS = 30;

/** "Live Music!" → "live-music" (what the form suggests when slug is blank). */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Comma/newline separated → trimmed, lower-cased, de-duplicated, non-empty. */
export function parseSynonyms(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[,\n]/)) {
    const s = part.trim().toLowerCase().replace(/\s+/g, ' ');
    if (s) seen.add(s);
  }
  return [...seen];
}

export function formatSynonyms(list: readonly string[] | null | undefined): string {
  return (list ?? []).join(', ');
}

/** Normalise a hex colour to lower-case `#rrggbb`; null when not a colour. */
export function normalizeHex(raw: string): string | null {
  const v = raw.trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(v)) return `#${v.replace('#', '').toLowerCase()}`;
  if (/^#?[0-9a-fA-F]{3}$/.test(v)) {
    const [r, g, b] = v.replace('#', '').split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

/** WCAG contrast of white text on `hex`; the UI warns below 4.5. */
export function whiteContrast(hex: string): number {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const l = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return (1 + 0.05) / (l + 0.05);
}

export function readCategoryForm(
  formData: { get(name: string): FormDataEntryValue | null },
  knownIconKeys: readonly string[]
): { value: CategoryInput; errors: CategoryFormErrors } {
  const str = (k: string) => String(formData.get(k) ?? '').trim();
  const label = str('label');
  const slugRaw = str('slug');
  const value: CategoryInput = {
    slug: slugRaw || slugify(label),
    label,
    description: str('description'),
    icon_key: str('icon_key'),
    color: normalizeHex(str('color')) ?? str('color'),
    synonyms: parseSynonyms(str('synonyms')),
    is_active: formData.get('is_active') === 'on',
  };
  const errors: CategoryFormErrors = {};
  if (!label) errors.label = 'Label is required';
  else if (label.length > MAX_LABEL) errors.label = `Keep the label under ${MAX_LABEL} characters`;
  if (!value.slug) errors.slug = 'Slug is required';
  else if (!SLUG_RE.test(value.slug)) errors.slug = 'Use lower-case letters, digits and single hyphens (e.g. live-music)';
  if (value.description.length > MAX_DESCRIPTION) errors.description = `Keep the description under ${MAX_DESCRIPTION} characters`;
  if (!knownIconKeys.includes(value.icon_key)) errors.icon_key = 'Pick an icon';
  if (!HEX_RE.test(value.color)) errors.color = 'Colour must be a hex value like #1d4ed8';
  if (value.synonyms.length > MAX_SYNONYMS) errors.synonyms = `At most ${MAX_SYNONYMS} search terms`;
  return { value, errors };
}

export function hasErrors(errors: CategoryFormErrors): boolean {
  return Object.keys(errors).length > 0;
}
